import { AppState, Platform } from 'react-native';
import { mmkvStorage } from './mmkvStorage';
import { logger } from '../utils/logger';
import { localScraperService, PLUGIN_SYNC_EVENTS } from './pluginService';
import { stremioService, addonEmitter, ADDON_EVENTS, Manifest } from './stremioService';
import { catalogService, StreamingContent } from './catalogService';
import { storageService } from './storageService';
import { watchedService, LocalWatchedItem } from './watchedService';
import { TraktService } from './traktService';

const SUPABASE_SESSION_KEY = '@supabase:session';
const DEFAULT_SYNC_DEBOUNCE_MS = 2000;

type Nullable<T> = T | null;

export type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: {
    display_name?: string;
    avatar_url?: string;
    [key: string]: unknown;
  };
  app_metadata?: {
    provider?: string;
    [key: string]: unknown;
  };
};

type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user: SupabaseUser;
};

type PluginRow = {
  url: string;
  name?: string;
  enabled?: boolean;
  sort_order?: number;
};

type AddonRow = {
  url: string;
  sort_order: number;
};

type WatchProgressRow = {
  content_id: string;
  content_type: 'movie' | 'series';
  video_id: string;
  season: Nullable<number>;
  episode: Nullable<number>;
  position: number;
  duration: number;
  last_watched: number;
  progress_key: string;
};

type LibraryRow = {
  content_id: string;
  content_type: string;
  name?: string;
  poster?: string;
  poster_shape?: string;
  background?: string;
  description?: string;
  release_info?: string;
  imdb_rating?: number;
  genres?: string[];
  addon_base_url?: string;
  added_at?: number;
};

type WatchedRow = {
  content_id: string;
  content_type: string;
  title?: string;
  season: Nullable<number>;
  episode: Nullable<number>;
  watched_at: number;
};

type RpcClaimSyncCodeRow = {
  result_owner_id: Nullable<string>;
  success: boolean;
  message: string;
};

export type LinkedDevice = {
  owner_id: string;
  device_user_id: string;
  device_name?: string;
  linked_at: string;
};

export type RemoteSyncStats = {
  plugins: number;
  addons: number;
  watchProgress: number;
  libraryItems: number;
  watchedItems: number;
  linkedDevices: number;
};

type PushTarget = 'plugins' | 'addons' | 'watch_progress' | 'library' | 'watched_items';

class SupabaseSyncService {
  private static instance: SupabaseSyncService;

  private readonly supabaseUrl: string;
  private readonly anonKey: string;
  private session: SupabaseSession | null = null;
  private initializePromise: Promise<void> | null = null;
  private startupSyncPromise: Promise<void> | null = null;
  private listenersRegistered = false;
  private suppressPushes = false;
  private appStateSub: { remove: () => void } | null = null;
  private lastForegroundPullAt = 0;
  private readonly foregroundPullCooldownMs = 30000;

  private pendingPushTimers: Record<PushTarget, ReturnType<typeof setTimeout> | null> = {
    plugins: null,
    addons: null,
    watch_progress: null,
    library: null,
    watched_items: null,
  };

  private constructor() {
    this.supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    this.anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  }

  static getInstance(): SupabaseSyncService {
    if (!SupabaseSyncService.instance) {
      SupabaseSyncService.instance = new SupabaseSyncService();
    }
    return SupabaseSyncService.instance;
  }

  public isConfigured(): boolean {
    return Boolean(this.supabaseUrl && this.anonKey);
  }

  public getCurrentSessionUser(): SupabaseUser | null {
    return this.session?.user || null;
  }

  public isAnonymousSession(): boolean {
    return this.session?.user?.app_metadata?.provider === 'anonymous';
  }

  public async initialize(): Promise<void> {
    if (!this.isConfigured()) {
      logger.warn('[SupabaseSyncService] Missing Supabase env vars; sync disabled.');
      return;
    }

    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = (async () => {
      await this.loadStoredSession();
      await this.ensureValidSession();
      this.registerSyncListeners();
    })();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  public async signUpWithEmail(email: string, password: string): Promise<{ user?: SupabaseUser; error?: string }> {
    if (!this.isConfigured()) {
      return { error: 'Supabase is not configured' };
    }

    try {
      const response = await this.requestAuth<{ user?: SupabaseUser; session?: SupabaseSession }>('/auth/v1/signup', {
        method: 'POST',
        body: { email, password },
      });

      if (response.session) {
        await this.setSession(response.session);
      }

      // In email-confirmation mode, Supabase may not establish a session immediately.
      // Treat this as a successful signup attempt and let caller handle next UX step.
      return { user: response.user };
    } catch (error: any) {
      return { error: this.extractErrorMessage(error, 'Signup failed') };
    }
  }

  public async signInWithEmail(email: string, password: string): Promise<{ user?: SupabaseUser; error?: string }> {
    if (!this.isConfigured()) {
      return { error: 'Supabase is not configured' };
    }

    try {
      const response = await this.requestAuth<SupabaseSession>('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email, password },
      });
      await this.setSession(response);
      return { user: response.user };
    } catch (error: any) {
      return { error: this.extractErrorMessage(error, 'Sign in failed') };
    }
  }

  public async signOut(): Promise<void> {
    if (!this.isConfigured()) return;
    const token = await this.getValidAccessToken();

    if (token) {
      try {
        await this.request<void>('/auth/v1/logout', {
          method: 'POST',
          authToken: token,
        });
      } catch (error) {
        logger.warn('[SupabaseSyncService] Supabase logout request failed, clearing local session:', error);
      }
    }

    this.session = null;
    await mmkvStorage.removeItem(SUPABASE_SESSION_KEY);
  }

  public async startupSync(): Promise<void> {
    if (!this.isConfigured()) return;
    await this.initialize();
    logger.log('[SupabaseSyncService] startupSync: begin');

    if (this.startupSyncPromise) {
      await this.startupSyncPromise;
      return;
    }

    this.startupSyncPromise = this.runStartupSync();
    try {
      await this.startupSyncPromise;
      logger.log('[SupabaseSyncService] startupSync: complete');
    } finally {
      this.startupSyncPromise = null;
    }
  }

  public async onSignUpPushAll(): Promise<void> {
    await this.pushAllLocalData();
  }

  public async onSignInPullAll(): Promise<void> {
    await this.pullAllToLocal();
  }

  public async syncNow(): Promise<void> {
    await this.startupSync();
  }

  public async pushAllLocalData(): Promise<void> {
    await this.initialize();
    logger.log('[SupabaseSyncService] pushAllLocalData: begin');

    await this.pushPluginsFromLocal();
    await this.pushAddonsFromLocal();

    const traktConnected = await this.isTraktConnected();
    if (traktConnected) {
      return;
    }

    await this.pushWatchProgressFromLocal();
    await this.pushLibraryFromLocal();
    await this.pushWatchedItemsFromLocal();
    logger.log('[SupabaseSyncService] pushAllLocalData: complete');
  }

  public async pullAllToLocal(): Promise<void> {
    await this.initialize();
    logger.log('[SupabaseSyncService] pullAllToLocal: begin');

    await this.withSuppressedPushes(async () => {
      await this.pullPluginsToLocal();
      await this.pullAddonsToLocal();

      const traktConnected = await this.isTraktConnected();
      if (traktConnected) {
        return;
      }

      await this.pullWatchProgressToLocal();
      await this.pullLibraryToLocal();
      await this.pullWatchedItemsToLocal();
    });
    logger.log('[SupabaseSyncService] pullAllToLocal: complete');
  }

  public async generateSyncCode(pin: string): Promise<{ code?: string; error?: string }> {
    try {
      await this.pushAllLocalData();
      const response = await this.callRpc<Array<{ code: string }>>('generate_sync_code', { p_pin: pin });
      const code = response?.[0]?.code;
      if (!code) return { error: 'Failed to generate sync code' };
      return { code };
    } catch (error: any) {
      return { error: this.extractErrorMessage(error, 'Failed to generate sync code') };
    }
  }

  public async getSyncCode(pin: string): Promise<{ code?: string; error?: string }> {
    try {
      const response = await this.callRpc<Array<{ code: string }>>('get_sync_code', { p_pin: pin });
      const code = response?.[0]?.code;
      if (!code) return { error: 'No sync code found' };
      return { code };
    } catch (error: any) {
      return { error: this.extractErrorMessage(error, 'Failed to fetch sync code') };
    }
  }

  public async claimSyncCode(code: string, pin: string, deviceName?: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.callRpc<RpcClaimSyncCodeRow[]>('claim_sync_code', {
        p_code: code,
        p_pin: pin,
        p_device_name: deviceName || `Nuvio ${Platform.OS}`,
      });
      const result = response?.[0];
      if (!result || !result.success) {
        return {
          success: false,
          message: result?.message || 'Failed to claim sync code',
        };
      }

      await this.pullAllToLocal();

      return {
        success: true,
        message: result.message || 'Device linked successfully',
      };
    } catch (error: any) {
      return {
        success: false,
        message: this.extractErrorMessage(error, 'Failed to claim sync code'),
      };
    }
  }

  public async getLinkedDevices(): Promise<LinkedDevice[]> {
    try {
      const token = await this.getValidAccessToken();
      if (!token) return [];

      const ownerId = await this.getEffectiveOwnerId();
      if (!ownerId) return [];

      return await this.request<LinkedDevice[]>(
        `/rest/v1/linked_devices?select=owner_id,device_user_id,device_name,linked_at&owner_id=eq.${encodeURIComponent(ownerId)}&order=linked_at.desc`,
        {
          method: 'GET',
          authToken: token,
        }
      );
    } catch (error) {
      logger.error('[SupabaseSyncService] Failed to fetch linked devices:', error);
      return [];
    }
  }

  public async getRemoteStats(): Promise<RemoteSyncStats | null> {
    try {
      const token = await this.getValidAccessToken();
      if (!token) return null;

      const ownerId = await this.getEffectiveOwnerId();
      if (!ownerId) return null;

      const ownerFilter = encodeURIComponent(ownerId);
      const [
        pluginRows,
        addonRows,
        watchRows,
        libraryRows,
        watchedRows,
        deviceRows,
      ] = await Promise.all([
        this.request<Array<{ id: string }>>(`/rest/v1/plugins?select=id&user_id=eq.${ownerFilter}`, {
          method: 'GET',
          authToken: token,
        }),
        this.request<Array<{ id: string }>>(`/rest/v1/addons?select=id&user_id=eq.${ownerFilter}`, {
          method: 'GET',
          authToken: token,
        }),
        this.request<Array<{ id: string }>>(`/rest/v1/watch_progress?select=id&user_id=eq.${ownerFilter}`, {
          method: 'GET',
          authToken: token,
        }),
        this.request<Array<{ id: string }>>(`/rest/v1/library_items?select=id&user_id=eq.${ownerFilter}`, {
          method: 'GET',
          authToken: token,
        }),
        this.request<Array<{ id: string }>>(`/rest/v1/watched_items?select=id&user_id=eq.${ownerFilter}`, {
          method: 'GET',
          authToken: token,
        }),
        this.request<Array<{ device_user_id: string }>>(`/rest/v1/linked_devices?select=device_user_id&owner_id=eq.${ownerFilter}`, {
          method: 'GET',
          authToken: token,
        }),
      ]);

      return {
        plugins: pluginRows?.length || 0,
        addons: addonRows?.length || 0,
        watchProgress: watchRows?.length || 0,
        libraryItems: libraryRows?.length || 0,
        watchedItems: watchedRows?.length || 0,
        linkedDevices: deviceRows?.length || 0,
      };
    } catch (error) {
      logger.warn('[SupabaseSyncService] Failed to fetch remote stats:', error);
      return null;
    }
  }

  public async unlinkDevice(deviceUserId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.callRpc<void>('unlink_device', { p_device_user_id: deviceUserId });
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: this.extractErrorMessage(error, 'Failed to unlink device'),
      };
    }
  }

  public async getEffectiveOwnerId(): Promise<string | null> {
    try {
      const response = await this.callRpc<unknown>('get_sync_owner', {});
      if (typeof response === 'string') return response;
      if (Array.isArray(response)) {
        const first = response[0];
        if (typeof first === 'string') return first;
        if (first && typeof first === 'object') {
          const candidate = (first as any).get_sync_owner || (first as any).id;
          return typeof candidate === 'string' ? candidate : null;
        }
      }
      if (response && typeof response === 'object') {
        const candidate = (response as any).get_sync_owner || (response as any).id;
        return typeof candidate === 'string' ? candidate : null;
      }
      return null;
    } catch (error) {
      logger.error('[SupabaseSyncService] Failed to resolve effective owner id:', error);
      return null;
    }
  }

  private async runStartupSync(): Promise<void> {
    logger.log('[SupabaseSyncService] runStartupSync: step=pull_plugins:start');
    const pluginPullOk = await this.safeRun('pull_plugins', async () => {
      await this.withSuppressedPushes(async () => {
        await this.pullPluginsToLocal();
      });
    });
    logger.log(`[SupabaseSyncService] runStartupSync: step=pull_plugins:done ok=${pluginPullOk}`);

    logger.log('[SupabaseSyncService] runStartupSync: step=pull_addons:start');
    const addonPullOk = await this.safeRun('pull_addons', async () => {
      await this.withSuppressedPushes(async () => {
        await this.pullAddonsToLocal();
      });
    });
    logger.log(`[SupabaseSyncService] runStartupSync: step=pull_addons:done ok=${addonPullOk}`);
    if (!pluginPullOk || !addonPullOk) {
      logger.warn('[SupabaseSyncService] runStartupSync: one or more pull steps failed; skipped startup push-by-design');
    }

    const traktConnected = await this.isTraktConnected();
    if (traktConnected) {
      logger.log('[SupabaseSyncService] Trakt is connected; skipping progress/library/watched Supabase sync.');
      return;
    }

    const watchPullOk = await this.safeRun('pull_watch_progress', async () => {
      await this.withSuppressedPushes(async () => {
        await this.pullWatchProgressToLocal();
      });
    });

    const libraryPullOk = await this.safeRun('pull_library', async () => {
      await this.withSuppressedPushes(async () => {
        await this.pullLibraryToLocal();
      });
    });

    const watchedPullOk = await this.safeRun('pull_watched_items', async () => {
      await this.withSuppressedPushes(async () => {
        await this.pullWatchedItemsToLocal();
      });
    });

    if (!watchPullOk || !libraryPullOk || !watchedPullOk) {
      logger.warn('[SupabaseSyncService] runStartupSync: one or more content pulls failed; skipped startup push-by-design');
    }
  }

  private async safeRun(step: string, task: () => Promise<void>): Promise<boolean> {
    try {
      await task();
      return true;
    } catch (error) {
      logger.error(`[SupabaseSyncService] Sync step failed (${step}):`, error);
      return false;
    }
  }

  private registerSyncListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    addonEmitter.on(ADDON_EVENTS.ADDON_ADDED, () => this.schedulePush('addons'));
    addonEmitter.on(ADDON_EVENTS.ADDON_REMOVED, () => this.schedulePush('addons'));
    addonEmitter.on(ADDON_EVENTS.ORDER_CHANGED, () => this.schedulePush('addons'));

    localScraperService.getPluginSyncEventEmitter().on(PLUGIN_SYNC_EVENTS.CHANGED, () => this.schedulePush('plugins'));

    catalogService.onLibraryAdd(() => this.schedulePush('library'));
    catalogService.onLibraryRemove(() => this.schedulePush('library'));

    storageService.subscribeToWatchProgressUpdates(() => this.schedulePush('watch_progress'));
    storageService.onWatchProgressRemoved(() => this.schedulePush('watch_progress'));

    watchedService.subscribeToWatchedUpdates(() => this.schedulePush('watched_items'));

    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          this.onAppForeground().catch((error) => {
            logger.warn('[SupabaseSyncService] Foreground pull failed:', error);
          });
        }
      });
    }
  }

  private async onAppForeground(): Promise<void> {
    if (!this.isConfigured()) return;
    if (this.suppressPushes) return;

    const now = Date.now();
    if (now - this.lastForegroundPullAt < this.foregroundPullCooldownMs) return;
    this.lastForegroundPullAt = now;
    logger.log('[SupabaseSyncService] App foreground: triggering pullAllToLocal');

    await this.initialize();
    if (!this.session) return;

    await this.safeRun('foreground_pull_all', async () => {
      await this.pullAllToLocal();
    });
  }

  private schedulePush(target: PushTarget): void {
    if (!this.isConfigured() || this.suppressPushes) {
      return;
    }

    const existing = this.pendingPushTimers[target];
    if (existing) clearTimeout(existing);
    logger.log(`[SupabaseSyncService] schedulePush: target=${target} delayMs=${DEFAULT_SYNC_DEBOUNCE_MS}`);

    this.pendingPushTimers[target] = setTimeout(() => {
      this.pendingPushTimers[target] = null;
      this.executeScheduledPush(target).catch((error) => {
        logger.error(`[SupabaseSyncService] Scheduled push failed (${target}):`, error);
      });
    }, DEFAULT_SYNC_DEBOUNCE_MS);
  }

  private async executeScheduledPush(target: PushTarget): Promise<void> {
    await this.initialize();
    if (!this.session) return;
    logger.log(`[SupabaseSyncService] executeScheduledPush: target=${target}:start`);

    if (target === 'plugins') {
      await this.pushPluginsFromLocal();
      logger.log(`[SupabaseSyncService] executeScheduledPush: target=${target}:done`);
      return;
    }

    if (target === 'addons') {
      await this.pushAddonsFromLocal();
      logger.log(`[SupabaseSyncService] executeScheduledPush: target=${target}:done`);
      return;
    }

    const traktConnected = await this.isTraktConnected();
    if (traktConnected) {
      return;
    }

    if (target === 'watch_progress') {
      await this.pushWatchProgressFromLocal();
      logger.log(`[SupabaseSyncService] executeScheduledPush: target=${target}:done`);
      return;
    }
    if (target === 'library') {
      await this.pushLibraryFromLocal();
      logger.log(`[SupabaseSyncService] executeScheduledPush: target=${target}:done`);
      return;
    }

    await this.pushWatchedItemsFromLocal();
    logger.log(`[SupabaseSyncService] executeScheduledPush: target=${target}:done`);
  }

  private async withSuppressedPushes(task: () => Promise<void>): Promise<void> {
    this.suppressPushes = true;
    try {
      await task();
    } finally {
      this.suppressPushes = false;
    }
  }

  private async loadStoredSession(): Promise<void> {
    try {
      const raw = await mmkvStorage.getItem(SUPABASE_SESSION_KEY);
      if (!raw) {
        this.session = null;
        return;
      }
      this.session = JSON.parse(raw) as SupabaseSession;
    } catch (error) {
      logger.error('[SupabaseSyncService] Failed to load stored session:', error);
      this.session = null;
      await mmkvStorage.removeItem(SUPABASE_SESSION_KEY);
    }
  }

  private async setSession(session: SupabaseSession): Promise<void> {
    this.session = session;
    await mmkvStorage.setItem(SUPABASE_SESSION_KEY, JSON.stringify(session));
  }

  private isSessionExpired(session: SupabaseSession): boolean {
    if (!session.expires_at) return false;
    const now = Math.floor(Date.now() / 1000);
    return now >= (session.expires_at - 30);
  }

  private async refreshSession(refreshToken: string): Promise<SupabaseSession> {
    return await this.requestAuth<SupabaseSession>('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
  }

  private async ensureValidSession(): Promise<boolean> {
    if (!this.session) return false;
    if (!this.session.access_token || !this.session.refresh_token) return false;

    if (!this.isSessionExpired(this.session)) return true;

    try {
      const refreshed = await this.refreshSession(this.session.refresh_token);
      await this.setSession(refreshed);
      return true;
    } catch (error) {
      logger.error('[SupabaseSyncService] Failed to refresh session:', error);
      this.session = null;
      await mmkvStorage.removeItem(SUPABASE_SESSION_KEY);
      return false;
    }
  }

  private async getValidAccessToken(): Promise<string | null> {
    await this.initialize();
    if (!this.session) return null;

    if (this.isSessionExpired(this.session)) {
      try {
        const refreshed = await this.refreshSession(this.session.refresh_token);
        await this.setSession(refreshed);
      } catch (error) {
        logger.error('[SupabaseSyncService] Token refresh failed:', error);
        this.session = null;
        await mmkvStorage.removeItem(SUPABASE_SESSION_KEY);
        return null;
      }
    }

    return this.session?.access_token || null;
  }

  private async requestAuth<T>(path: string, options: { method: string; body?: unknown }): Promise<T> {
    return await this.request<T>(path, {
      method: options.method,
      body: options.body,
      authToken: null,
    });
  }

  private async request<T>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      authToken: string | null;
    }
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Supabase is not configured');
    }

    const headers: Record<string, string> = {
      apikey: this.anonKey,
    };
    if (options.authToken) {
      headers.Authorization = `Bearer ${options.authToken}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${this.supabaseUrl}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const raw = await response.text();
    const parsed = this.parsePayload(raw);

    if (!response.ok) {
      throw this.buildRequestError(response.status, parsed, raw);
    }

    return parsed as T;
  }

  private parsePayload(raw: string): unknown {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private buildRequestError(status: number, parsed: unknown, raw: string): Error {
    if (parsed && typeof parsed === 'object') {
      const message =
        (parsed as any).message ||
        (parsed as any).msg ||
        (parsed as any).error_description ||
        (parsed as any).error;
      if (typeof message === 'string' && message.trim().length > 0) {
        return new Error(message);
      }
    }
    if (raw && raw.trim().length > 0) {
      return new Error(raw);
    }
    return new Error(`Supabase request failed with status ${status}`);
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      const raw = error.message.trim();

      let parsed: any = null;
      if (raw.startsWith('{') && raw.endsWith('}')) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }

      const errorCode = (parsed?.error_code || parsed?.code || '').toString().toLowerCase();
      const message = (parsed?.msg || parsed?.message || raw).toString().trim();

      if (errorCode === 'invalid_credentials') {
        return 'Invalid email or password';
      }
      if (errorCode === 'email_not_confirmed') {
        return 'Email not confirmed. Check your inbox or Spam/Junk folder, verify your account, then sign in.';
      }

      if (message.length > 0) {
        return message;
      }
    }
    return fallback;
  }

  private async callRpc<T>(functionName: string, payload?: Record<string, unknown>): Promise<T> {
    const token = await this.getValidAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    return await this.request<T>(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body: payload || {},
      authToken: token,
    });
  }

  private normalizeUrl(url: string): string {
    return url.trim().toLowerCase();
  }

  private toBigIntNumber(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.trunc(n);
  }

  private secondsToMsLong(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.trunc(n * 1000);
  }

  private normalizeEpochMs(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // If value looks like seconds, convert to milliseconds.
    if (n < 1_000_000_000_000) {
      return Math.trunc(n * 1000);
    }
    return Math.trunc(n);
  }

  private msToSeconds(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n / 1000;
  }

  private addonManifestUrl(addon: Manifest): string | null {
    const raw = (addon.originalUrl || addon.url || '').trim();
    if (!raw) return null;
    if (raw.includes('manifest.json')) return raw;
    return `${raw.replace(/\/$/, '')}/manifest.json`;
  }

  private parseWatchProgressKey(key: string): {
    contentType: 'movie' | 'series';
    contentId: string;
    season: number | null;
    episode: number | null;
    videoId: string;
    progressKey: string;
  } | null {
    const parts = key.split(':');
    if (parts.length < 2) return null;

    const contentType: 'movie' | 'series' = parts[0] === 'movie' ? 'movie' : 'series';
    const contentId = parts[1];
    const episodeId = parts.length > 2 ? parts.slice(2).join(':') : '';
    let season: number | null = null;
    let episode: number | null = null;

    if (episodeId) {
      const match = episodeId.match(/:(\d+):(\d+)$/);
      if (match) {
        season = Number(match[1]);
        episode = Number(match[2]);
      }
    }

    const videoId = episodeId || contentId;
    const progressKey = contentType === 'movie'
      ? contentId
      : (season != null && episode != null ? `${contentId}_s${season}e${episode}` : `${contentId}_${videoId}`);

    return {
      contentType,
      contentId,
      season,
      episode,
      videoId,
      progressKey,
    };
  }

  private toStreamingContent(item: LibraryRow): StreamingContent {
    const type = item.content_type === 'movie' ? 'movie' : 'series';
    const posterShape = (item.poster_shape || 'POSTER').toLowerCase() as 'poster' | 'square' | 'landscape';

    return {
      id: item.content_id,
      type,
      name: item.name || '',
      poster: item.poster || '',
      posterShape,
      banner: item.background,
      description: item.description,
      releaseInfo: item.release_info,
      imdbRating: item.imdb_rating != null ? String(item.imdb_rating) : undefined,
      genres: item.genres || [],
      addonId: item.addon_base_url,
      addedToLibraryAt: item.added_at,
      inLibrary: true,
    };
  }

  private toWatchedItem(row: WatchedRow): LocalWatchedItem {
    return {
      content_id: row.content_id,
      content_type: row.content_type === 'movie' ? 'movie' : 'series',
      title: row.title || '',
      season: row.season == null ? null : Number(row.season),
      episode: row.episode == null ? null : Number(row.episode),
      watched_at: Number(row.watched_at || Date.now()),
    };
  }

  private async isTraktConnected(): Promise<boolean> {
    try {
      return await TraktService.getInstance().isAuthenticated();
    } catch {
      return false;
    }
  }

  private async pullPluginsToLocal(): Promise<void> {
    const token = await this.getValidAccessToken();
    if (!token) return;
    const ownerId = await this.getEffectiveOwnerId();
    if (!ownerId) return;

    const rows = await this.request<PluginRow[]>(
      `/rest/v1/plugins?select=url,name,enabled,sort_order&user_id=eq.${encodeURIComponent(ownerId)}&order=sort_order.asc`,
      {
        method: 'GET',
        authToken: token,
      }
    );
    logger.log(`[SupabaseSyncService] pullPluginsToLocal: remoteCount=${rows?.length || 0}`);

    const localRepos = await localScraperService.getRepositories();
    const byUrl = new Map(localRepos.map((repo) => [this.normalizeUrl(repo.url), repo]));
    const remoteSet = new Set(
      (rows || [])
        .map((row) => (row?.url ? this.normalizeUrl(row.url) : null))
        .filter((url): url is string => Boolean(url))
    );

    for (const row of rows || []) {
      if (!row.url) continue;
      const normalized = this.normalizeUrl(row.url);
      const existing = byUrl.get(normalized);

      if (!existing) {
        await localScraperService.addRepository({
          name: row.name || localScraperService.extractRepositoryName(row.url),
          url: row.url,
          enabled: row.enabled !== false,
          description: 'Synced from cloud',
        });
        continue;
      }

      const shouldUpdate =
        (row.name && row.name !== existing.name) ||
        (typeof row.enabled === 'boolean' && row.enabled !== existing.enabled);

      if (shouldUpdate) {
        await localScraperService.updateRepository(existing.id, {
          name: row.name || existing.name,
          enabled: typeof row.enabled === 'boolean' ? row.enabled : existing.enabled,
        });
      }
    }

    // Reconcile removals only when remote has at least one entry to avoid wiping local
    // data if backend temporarily returns an empty set.
    if (remoteSet.size > 0) {
      let removedCount = 0;
      for (const repo of localRepos) {
        const normalized = this.normalizeUrl(repo.url);
        if (remoteSet.has(normalized)) continue;
        try {
          await localScraperService.removeRepository(repo.id);
          removedCount += 1;
        } catch (error) {
          logger.warn('[SupabaseSyncService] Failed to remove local plugin repository missing in remote set:', repo.name, error);
        }
      }
      logger.log(`[SupabaseSyncService] pullPluginsToLocal: removedLocalExtras=${removedCount}`);
    } else {
      logger.log('[SupabaseSyncService] pullPluginsToLocal: remote set empty, skipped local prune');
    }
  }

  private async pushPluginsFromLocal(): Promise<void> {
    const repos = await localScraperService.getRepositories();
    logger.log(`[SupabaseSyncService] pushPluginsFromLocal: localCount=${repos.length}`);
    const payload: PluginRow[] = repos.map((repo, index) => ({
      url: repo.url,
      name: repo.name,
      enabled: repo.enabled !== false,
      sort_order: index,
    }));
    await this.callRpc<void>('sync_push_plugins', { p_plugins: payload });
  }

  private async pullAddonsToLocal(): Promise<void> {
    const token = await this.getValidAccessToken();
    if (!token) return;
    const ownerId = await this.getEffectiveOwnerId();
    if (!ownerId) return;

    const rows = await this.request<AddonRow[]>(
      `/rest/v1/addons?select=url,sort_order&user_id=eq.${encodeURIComponent(ownerId)}&order=sort_order.asc`,
      {
        method: 'GET',
        authToken: token,
      }
    );
    logger.log(`[SupabaseSyncService] pullAddonsToLocal: remoteCount=${rows?.length || 0}`);
    const orderedRemoteUrls: string[] = [];
    const seenRemoteUrls = new Set<string>();
    for (const row of rows || []) {
      if (!row?.url) continue;
      const normalized = this.normalizeUrl(row.url);
      if (seenRemoteUrls.has(normalized)) continue;
      seenRemoteUrls.add(normalized);
      orderedRemoteUrls.push(row.url);
    }

    const installed = await stremioService.getInstalledAddonsAsync();
    logger.log(`[SupabaseSyncService] pullAddonsToLocal: localInstalledBefore=${installed.length}`);
    const remoteSet = new Set(
      (rows || [])
        .map((row) => (row?.url ? this.normalizeUrl(row.url) : null))
        .filter((url): url is string => Boolean(url))
    );
    const installedUrls = new Set(
      installed
        .map((addon) => this.addonManifestUrl(addon))
        .filter((url): url is string => Boolean(url))
        .map((url) => this.normalizeUrl(url))
    );

    for (const row of rows || []) {
      if (!row.url) continue;
      const normalized = this.normalizeUrl(row.url);
      if (installedUrls.has(normalized)) continue;

      try {
        await stremioService.installAddon(row.url);
        installedUrls.add(normalized);
      } catch (error) {
        logger.warn('[SupabaseSyncService] Failed to install synced addon:', row.url, error);
      }
    }

    // Reconcile removals only when remote has at least one entry to avoid wiping local
    // data if backend temporarily returns an empty set.
    if (remoteSet.size > 0) {
      let removedCount = 0;
      for (const addon of installed) {
        const url = this.addonManifestUrl(addon);
        const normalized = url ? this.normalizeUrl(url) : null;
        if (!normalized || remoteSet.has(normalized)) continue;
        if (!addon.installationId) continue;
        try {
          await stremioService.removeAddon(addon.installationId);
          removedCount += 1;
        } catch (error) {
          logger.warn('[SupabaseSyncService] Failed to remove local addon missing in remote set:', addon.name, error);
        }
      }
      logger.log(`[SupabaseSyncService] pullAddonsToLocal: removedLocalExtras=${removedCount}`);
    } else {
      logger.log('[SupabaseSyncService] pullAddonsToLocal: remote set empty, skipped local prune');
    }

    if (orderedRemoteUrls.length > 0) {
      try {
        const changed = await stremioService.applyAddonOrderFromManifestUrls(orderedRemoteUrls);
        logger.log(`[SupabaseSyncService] pullAddonsToLocal: orderReconciled changed=${changed}`);
      } catch (error) {
        logger.warn('[SupabaseSyncService] pullAddonsToLocal: failed to reconcile addon order:', error);
      }
    }
  }

  private async pushAddonsFromLocal(): Promise<void> {
    const addons = await stremioService.getInstalledAddonsAsync();
    logger.log(`[SupabaseSyncService] pushAddonsFromLocal: localInstalledRaw=${addons.length}`);
    const seen = new Set<string>();
    const payload: AddonRow[] = addons.reduce<AddonRow[]>((acc, addon) => {
      const url = this.addonManifestUrl(addon);
      if (!url) return acc;
      const normalized = this.normalizeUrl(url);
      if (seen.has(normalized)) return acc;
      seen.add(normalized);
      acc.push({
        url,
        sort_order: acc.length,
      });
      return acc;
    }, []);
    logger.log(`[SupabaseSyncService] pushAddonsFromLocal: payloadDeduped=${payload.length}`);

    await this.callRpc<void>('sync_push_addons', { p_addons: payload });
  }

  private async pullWatchProgressToLocal(): Promise<void> {
    const rows = await this.callRpc<WatchProgressRow[]>('sync_pull_watch_progress', {});
    const remoteSet = new Set<string>();

    for (const row of rows || []) {
      if (!row.content_id) continue;
      const type = row.content_type === 'movie' ? 'movie' : 'series';
      const season = row.season == null ? null : Number(row.season);
      const episode = row.episode == null ? null : Number(row.episode);
      remoteSet.add(`${type}:${row.content_id}:${season ?? ''}:${episode ?? ''}`);

      const episodeId = type === 'series' && season != null && episode != null
        ? `${row.content_id}:${season}:${episode}`
        : undefined;

      const local = await storageService.getWatchProgress(row.content_id, type, episodeId);
      const remoteLastWatched = this.normalizeEpochMs(row.last_watched);
      if (local && Number(local.lastUpdated || 0) >= remoteLastWatched) {
        continue;
      }

      await storageService.setWatchProgress(
        row.content_id,
        type,
        {
          ...(local || {}),
          currentTime: this.msToSeconds(row.position),
          duration: this.msToSeconds(row.duration),
          lastUpdated: remoteLastWatched || Date.now(),
        },
        episodeId,
        {
          preserveTimestamp: true,
          forceWrite: true,
          forceNotify: true,
        }
      );
    }

    // Reconcile removals only when remote has at least one entry to avoid wiping local
    // data if backend temporarily returns an empty set.
    if (remoteSet.size > 0) {
      const allLocal = await storageService.getAllWatchProgress();
      let removedCount = 0;

      for (const [key] of Object.entries(allLocal)) {
        const parsed = this.parseWatchProgressKey(key);
        if (!parsed) continue;
        const localSig = `${parsed.contentType}:${parsed.contentId}:${parsed.season ?? ''}:${parsed.episode ?? ''}`;
        if (remoteSet.has(localSig)) continue;

        const episodeId = parsed.contentType === 'series' && parsed.season != null && parsed.episode != null
          ? `${parsed.contentId}:${parsed.season}:${parsed.episode}`
          : undefined;

        await storageService.removeWatchProgress(parsed.contentId, parsed.contentType, episodeId);
        removedCount += 1;
      }
      logger.log(`[SupabaseSyncService] pullWatchProgressToLocal: removedLocalExtras=${removedCount}`);
    } else {
      logger.log('[SupabaseSyncService] pullWatchProgressToLocal: remote set empty, skipped local prune');
    }
  }

  private async pushWatchProgressFromLocal(): Promise<void> {
    const all = await storageService.getAllWatchProgress();
    const entries: WatchProgressRow[] = Object.entries(all).reduce<WatchProgressRow[]>((acc, [key, value]) => {
      const parsed = this.parseWatchProgressKey(key);
      if (!parsed) return acc;
      acc.push({
        content_id: parsed.contentId,
        content_type: parsed.contentType,
        video_id: parsed.videoId,
        season: parsed.season,
        episode: parsed.episode,
        position: this.secondsToMsLong(value.currentTime),
        duration: this.secondsToMsLong(value.duration),
        last_watched: this.normalizeEpochMs(value.lastUpdated || Date.now()),
        progress_key: parsed.progressKey,
      });
      return acc;
    }, []);

    await this.callRpc<void>('sync_push_watch_progress', { p_entries: entries });
  }

  private async pullLibraryToLocal(): Promise<void> {
    const rows = await this.callRpc<LibraryRow[]>('sync_pull_library', {});
    const localItems = await catalogService.getLibraryItems();
    const existing = new Set(localItems.map((item) => `${item.type}:${item.id}`));
    const remoteSet = new Set<string>();

    for (const row of rows || []) {
      if (!row.content_id || !row.content_type) continue;
      const type = row.content_type === 'movie' ? 'movie' : 'series';
      const key = `${type}:${row.content_id}`;
      remoteSet.add(key);
      if (existing.has(key)) continue;

      try {
        await catalogService.addToLibrary(this.toStreamingContent(row));
        existing.add(key);
      } catch (error) {
        logger.warn('[SupabaseSyncService] Failed to merge library item from sync:', key, error);
      }
    }

    // Reconcile removals only when remote has at least one entry to avoid wiping local
    // data if backend temporarily returns an empty set.
    if (remoteSet.size > 0) {
      let removedCount = 0;
      for (const item of localItems) {
        const key = `${item.type}:${item.id}`;
        if (remoteSet.has(key)) continue;
        try {
          await catalogService.removeFromLibrary(item.type, item.id);
          removedCount += 1;
        } catch (error) {
          logger.warn('[SupabaseSyncService] Failed to remove local library item missing in remote set:', key, error);
        }
      }
      logger.log(`[SupabaseSyncService] pullLibraryToLocal: removedLocalExtras=${removedCount}`);
    } else {
      logger.log('[SupabaseSyncService] pullLibraryToLocal: remote set empty, skipped local prune');
    }
  }

  private async pushLibraryFromLocal(): Promise<void> {
    const items = await catalogService.getLibraryItems();
    const payload: LibraryRow[] = items.map((item) => ({
      content_id: item.id,
      content_type: item.type === 'movie' ? 'movie' : 'series',
      name: item.name,
      poster: item.poster,
      poster_shape: (item.posterShape || 'poster').toUpperCase(),
      background: item.banner || (item as any).background,
      description: item.description,
      release_info: item.releaseInfo,
      imdb_rating: item.imdbRating != null ? Number(item.imdbRating) : undefined,
      genres: item.genres || [],
      addon_base_url: item.addonId,
      added_at: item.addedToLibraryAt,
    }));

    await this.callRpc<void>('sync_push_library', { p_items: payload });
  }

  private async pullWatchedItemsToLocal(): Promise<void> {
    const rows = await this.callRpc<WatchedRow[]>('sync_pull_watched_items', {});
    const mapped = (rows || []).map((row) => this.toWatchedItem(row));
    await watchedService.reconcileRemoteWatchedItems(mapped);
  }

  private async pushWatchedItemsFromLocal(): Promise<void> {
    const items = await watchedService.getAllWatchedItems();
    const payload: WatchedRow[] = items.map((item) => ({
      content_id: item.content_id,
      content_type: item.content_type,
      title: item.title,
      season: item.season,
      episode: item.episode,
      watched_at: item.watched_at,
    }));
    await this.callRpc<void>('sync_push_watched_items', { p_items: payload });
  }
}

export const supabaseSyncService = SupabaseSyncService.getInstance();
export default supabaseSyncService;
