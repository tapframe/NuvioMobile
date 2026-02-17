import { mmkvStorage } from './mmkvStorage';
import axios from 'axios';
import { Platform } from 'react-native';
import { logger } from '../utils/logger';
import { Stream } from '../types/streams';
import { cacheService } from './cacheService';
import CryptoJS from 'crypto-js';
import { safeAxiosConfig, createSafeAxiosConfig } from '../utils/axiosConfig';
import EventEmitter from 'eventemitter3';

const MAX_CONCURRENT_SCRAPERS = 5;
const MAX_INFLIGHT_KEYS = 30;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const MAX_RESULT_ITEMS = 150;
const SCRAPER_BATCH_DELAY_MS = 25;

const VIDEO_CONTENT_TYPES = [
  'video/',
  'application/octet-stream',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
  'application/dash+xml',
  'binary/octet-stream',
];

const MAX_PREFLIGHT_SIZE = 50 * 1024 * 1024;

export const PLUGIN_SYNC_EVENTS = {
  CHANGED: 'changed',
} as const;

const pluginSyncEmitter = new EventEmitter();

// Types for local scrapers
export interface ScraperManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  scrapers: ScraperInfo[];
}

export interface ScraperInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  filename: string;
  supportedTypes: ('movie' | 'tv')[];
  enabled: boolean;
  logo?: string;
  contentLanguage?: string[];
  manifestEnabled?: boolean; // Whether the scraper is enabled in the manifest
  supportedPlatforms?: ('ios' | 'android')[]; // Platforms where this scraper is supported
  disabledPlatforms?: ('ios' | 'android')[]; // Platforms where this scraper is disabled
  // Optional list of supported output formats for this provider (e.g., ["mkv", "mp4"]).
  // We support both `formats` and `supportedFormats` keys for manifest flexibility.
  formats?: string[];
  supportedFormats?: string[];
  repositoryId?: string; // Which repository this scraper came from
  supportsExternalPlayer?: boolean; // Whether this scraper supports external players
  limited?: boolean; // Whether this scraper has limited functionality
}

export interface RepositoryInfo {
  id: string;
  name: string;
  url: string;
  description?: string;
  isDefault?: boolean;
  enabled: boolean;
  lastUpdated?: number;
  scraperCount?: number;
}

export interface LocalScraperResult {
  title: string;
  name?: string;
  url: string;
  quality?: string;
  size?: string;
  language?: string;
  provider?: string;
  type?: string;
  seeders?: number;
  peers?: number;
  infoHash?: string;
  [key: string]: any;
}

// Callback type for scraper results
type ScraperCallback = (streams: Stream[] | null, scraperId: string | null, scraperName: string | null, error: Error | null) => void;

async function preflightSizeCheck(url: string, timeout: number = 15000): Promise<void> {
  try {
    // Skip preflight check for non-HTTP(S) URLs (tokens, IDs, etc.)
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      logger.log('[PreflightCheck] Skipping non-HTTP URL:', url.substring(0, 60));
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    const isVideoContent = VIDEO_CONTENT_TYPES.some(type => contentType.includes(type));
    
    if (isVideoContent) {
      logger.warn('[PreflightCheck] Rejected video content type:', contentType, 'for URL:', url.substring(0, 80));
      throw new Error(`Response is video content (${contentType}), not fetching to prevent OOM`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > MAX_PREFLIGHT_SIZE) {
        logger.warn('[PreflightCheck] Rejected large response:', contentLength, 'bytes for URL:', url.substring(0, 80));
        throw new Error(`Response too large (${contentLength} bytes), max allowed is ${MAX_PREFLIGHT_SIZE}`);
      }
    }

    const finalUrl = response.url || url;
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m3u8'];
    const hasVideoExtension = videoExtensions.some(ext => finalUrl.toLowerCase().includes(ext));
    
    if (hasVideoExtension && contentType && !contentType.includes('text') && !contentType.includes('json') && !contentType.includes('html')) {
      logger.warn('[PreflightCheck] URL appears to be a video file:', finalUrl.substring(0, 80));
      throw new Error(`URL appears to be a video file, not fetching to prevent OOM`);
    }

    logger.log('[PreflightCheck] Passed for URL:', url.substring(0, 60), 'Content-Length:', contentLengthHeader || 'unknown');
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.warn('[PreflightCheck] HEAD request timed out for:', url.substring(0, 40));
      return;
    }
    
    if (error.message?.includes('video content') || error.message?.includes('too large') || error.message?.includes('video file')) {
      throw error;
    }
    
    logger.warn('[PreflightCheck] HEAD request failed (allowing GET):', error.message?.substring(0, 100));
  }
}

class LocalScraperService {
  private static instance: LocalScraperService;
  private readonly STORAGE_KEY = 'local-scrapers';
  private readonly REPOSITORY_KEY = 'scraper-repository-url';
  private readonly REPOSITORIES_KEY = 'scraper-repositories';
  private readonly SCRAPER_SETTINGS_KEY = 'scraper-settings';
  private installedScrapers: Map<string, ScraperInfo> = new Map();
  private scraperCode: Map<string, string> = new Map();
  private repositories: Map<string, RepositoryInfo> = new Map();
  private currentRepositoryId: string = '';
  private repositoryUrl: string = '';
  private repositoryName: string = '';
  private initialized: boolean = false;
  private autoRefreshCompleted: boolean = false;
  private isRefreshing: boolean = false;
  private scraperSettingsCache: Record<string, any> | null = null;
  // Single-flight map to prevent duplicate concurrent runs per scraper+title
  private inFlightByKey: Map<string, Promise<LocalScraperResult[]>> = new Map();

  private constructor() {
    this.initialize();
  }

  static getInstance(): LocalScraperService {
    if (!LocalScraperService.instance) {
      LocalScraperService.instance = new LocalScraperService();
    }
    return LocalScraperService.instance;
  }

  public getPluginSyncEventEmitter(): EventEmitter {
    return pluginSyncEmitter;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load repositories
      const repositoriesData = await mmkvStorage.getItem(this.REPOSITORIES_KEY);
      if (repositoriesData) {
        const repos = JSON.parse(repositoriesData);
        this.repositories = new Map(Object.entries(repos));
      } else {
        // Migrate from old single repository format or create default tapframe repository
        const storedRepoUrl = await mmkvStorage.getItem(this.REPOSITORY_KEY);
        if (storedRepoUrl) {
          const defaultRepo: RepositoryInfo = {
            id: 'default',
            name: this.extractRepositoryName(storedRepoUrl),
            url: storedRepoUrl,
            description: 'Default repository',
            isDefault: true,
            enabled: true,
            lastUpdated: Date.now()
          };
          this.repositories.set('default', defaultRepo);
          this.currentRepositoryId = 'default';
          await this.saveRepositories();
        } else {
          // No default repository for new users - they must add their own
        }
      }

      // Load current repository
      const currentRepoId = await mmkvStorage.getItem('current-repository-id');
      if (currentRepoId && this.repositories.has(currentRepoId)) {
        this.currentRepositoryId = currentRepoId;
        const currentRepo = this.repositories.get(currentRepoId)!;
        this.repositoryUrl = currentRepo.url;
        this.repositoryName = currentRepo.name;
      } else if (this.repositories.size > 0) {
        // Use first repository as default
        const firstRepo = Array.from(this.repositories.values())[0];
        this.currentRepositoryId = firstRepo.id;
        this.repositoryUrl = firstRepo.url;
        this.repositoryName = firstRepo.name;
      }

      // Load installed scrapers
      const storedScrapers = await mmkvStorage.getItem(this.STORAGE_KEY);
      if (storedScrapers) {
        const scrapers: ScraperInfo[] = JSON.parse(storedScrapers);
        const validScrapers: ScraperInfo[] = [];

        scrapers.forEach(scraper => {
          // Skip scrapers with missing essential fields
          if (!scraper.id || !scraper.name || !scraper.version) {
            logger.warn('[LocalScraperService] Skipping invalid scraper with missing essential fields:', scraper);
            return;
          }

          // Ensure contentLanguage is an array (migration for older scrapers)
          if (!scraper.contentLanguage) {
            scraper.contentLanguage = ['en']; // Default to English
          } else if (typeof scraper.contentLanguage === 'string') {
            scraper.contentLanguage = [scraper.contentLanguage]; // Convert string to array
          }

          // Ensure supportedTypes is an array (migration for older scrapers)
          if (!scraper.supportedTypes || !Array.isArray(scraper.supportedTypes)) {
            scraper.supportedTypes = ['movie', 'tv']; // Default to both types
          }
          // Normalize formats fields (support both `formats` and `supportedFormats`)
          if (typeof (scraper as any).formats === 'string') {
            scraper.formats = [(scraper as any).formats as unknown as string];
          }
          if (typeof (scraper as any).supportedFormats === 'string') {
            scraper.supportedFormats = [(scraper as any).supportedFormats as unknown as string];
          }
          if (!scraper.supportedFormats && scraper.formats) {
            scraper.supportedFormats = scraper.formats;
          }

          // Ensure other required fields have defaults
          if (!scraper.description) {
            scraper.description = 'No description available';
          }
          if (!scraper.filename) {
            scraper.filename = `${scraper.id}.js`;
          }
          if (scraper.enabled === undefined) {
            scraper.enabled = true;
          }

          this.installedScrapers.set(scraper.id, scraper);
          validScrapers.push(scraper);
        });

        // Save cleaned scrapers back to storage if any were filtered out
        if (validScrapers.length !== scrapers.length) {
          logger.log('[LocalScraperService] Cleaned up invalid scrapers, saving valid ones');
          await mmkvStorage.setItem(this.STORAGE_KEY, JSON.stringify(validScrapers));

          // Clean up cached code for removed scrapers
          const validScraperIds = new Set(validScrapers.map(s => s.id));
          const removedScrapers = scrapers.filter(s => s.id && !validScraperIds.has(s.id));
          for (const removedScraper of removedScrapers) {
            try {
              await mmkvStorage.removeItem(`scraper-code-${removedScraper.id}`);
              logger.log('[LocalScraperService] Removed cached code for invalid scraper:', removedScraper.id);
            } catch (error) {
              logger.error('[LocalScraperService] Failed to remove cached code for', removedScraper.id, ':', error);
            }
          }
        }
      }

      // Load scraper code from cache
      await this.loadScraperCode();

      // Auto-refresh ALL enabled repositories on app startup (non-blocking, in background)
      const enabledRepos = Array.from(this.repositories.values()).filter(r => r.enabled !== false);
      if (enabledRepos.length > 0 && !this.autoRefreshCompleted) {
        this.autoRefreshCompleted = true; // Mark immediately to prevent duplicate calls
        logger.log('[LocalScraperService] Scheduling background refresh of', enabledRepos.length, 'enabled repositories');
        // Don't await - let it run in background so app loads fast
        this.refreshAllEnabledRepositories().catch(error => {
          logger.error('[LocalScraperService] Background auto-refresh failed:', error);
        });
      }

      this.initialized = true;
      logger.log('[LocalScraperService] Initialized with', this.installedScrapers.size, 'scrapers');
    } catch (error) {
      logger.error('[LocalScraperService] Failed to initialize:', error);
      this.initialized = true; // Set to true to prevent infinite retry
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }


  // Set repository URL
  async setRepositoryUrl(url: string): Promise<void> {
    this.repositoryUrl = url;
    await mmkvStorage.setItem(this.REPOSITORY_KEY, url);
    logger.log('[LocalScraperService] Repository URL set to:', url);
  }

  // Get repository URL
  async getRepositoryUrl(): Promise<string> {
    await this.ensureInitialized();
    return this.repositoryUrl;
  }

  // Get repository name
  getRepositoryName(): string {
    return this.repositoryName || 'Plugins';
  }

  // Multiple repository management methods
  async getRepositories(): Promise<RepositoryInfo[]> {
    await this.ensureInitialized();
    return Array.from(this.repositories.values());
  }

  async addRepository(repo: Omit<RepositoryInfo, 'id' | 'lastUpdated' | 'scraperCount'>): Promise<string> {
    await this.ensureInitialized();
    const id = `repo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Try to fetch the repository name from manifest if not provided
    let repositoryName = repo.name;
    if (!repositoryName || repositoryName.trim() === '') {
      try {
        repositoryName = await this.fetchRepositoryNameFromManifest(repo.url);
      } catch (error) {
        logger.warn('[LocalScraperService] Failed to fetch repository name from manifest, using fallback:', error);
        repositoryName = this.extractRepositoryName(repo.url);
      }
    }

    const newRepo: RepositoryInfo = {
      ...repo,
      name: repositoryName,
      id,
      lastUpdated: Date.now(),
      scraperCount: 0
    };
    this.repositories.set(id, newRepo);
    await this.saveRepositories();
    pluginSyncEmitter.emit(PLUGIN_SYNC_EVENTS.CHANGED, { action: 'add_repository', id: newRepo.id });
    logger.log('[LocalScraperService] Added repository:', newRepo.name);
    return id;
  }

  async updateRepository(id: string, updates: Partial<RepositoryInfo>): Promise<void> {
    await this.ensureInitialized();
    const repo = this.repositories.get(id);
    if (!repo) {
      throw new Error(`Repository with id ${id} not found`);
    }
    const updatedRepo = { ...repo, ...updates };
    this.repositories.set(id, updatedRepo);
    await this.saveRepositories();

    // If this is the current repository, update current values
    if (id === this.currentRepositoryId) {
      this.repositoryUrl = updatedRepo.url;
      this.repositoryName = updatedRepo.name;
    }
    pluginSyncEmitter.emit(PLUGIN_SYNC_EVENTS.CHANGED, { action: 'update_repository', id });
    logger.log('[LocalScraperService] Updated repository:', updatedRepo.name);
  }

  async removeRepository(id: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.repositories.has(id)) {
      throw new Error(`Repository with id ${id} not found`);
    }

    // Allow removing the last repository - users can add new ones
    // The app will work without repositories (no scrapers available)

    // If removing current repository, switch to another one or clear current
    if (id === this.currentRepositoryId) {
      const remainingRepos = Array.from(this.repositories.values()).filter(r => r.id !== id);
      if (remainingRepos.length > 0) {
        await this.setCurrentRepository(remainingRepos[0].id);
      } else {
        // No repositories left, clear current repository
        this.currentRepositoryId = '';
        await mmkvStorage.removeItem('current-repository-id');
      }
    }

    // Remove scrapers from this repository
    const scrapersToRemove = Array.from(this.installedScrapers.values())
      .filter(s => s.repositoryId === id)
      .map(s => s.id);

    for (const scraperId of scrapersToRemove) {
      this.installedScrapers.delete(scraperId);
      this.scraperCode.delete(scraperId);
      await mmkvStorage.removeItem(`scraper-code-${scraperId}`);
    }

    this.repositories.delete(id);
    await this.saveRepositories();
    await this.saveInstalledScrapers();
    pluginSyncEmitter.emit(PLUGIN_SYNC_EVENTS.CHANGED, { action: 'remove_repository', id });
    logger.log('[LocalScraperService] Removed repository:', id);
  }

  async setCurrentRepository(id: string): Promise<void> {
    await this.ensureInitialized();
    const repo = this.repositories.get(id);
    if (!repo) {
      throw new Error(`Repository with id ${id} not found`);
    }

    this.currentRepositoryId = id;
    this.repositoryUrl = repo.url;
    this.repositoryName = repo.name;

    await mmkvStorage.setItem('current-repository-id', id);

    // Refresh the repository to get its scrapers
    try {
      logger.log('[LocalScraperService] Refreshing repository after switch:', repo.name);
      await this.performRepositoryRefresh();
    } catch (error) {
      logger.error('[LocalScraperService] Failed to refresh repository after switch:', error);
      // Don't throw error, just log it - the switch should still succeed
    }

    logger.log('[LocalScraperService] Switched to repository:', repo.name);
    pluginSyncEmitter.emit(PLUGIN_SYNC_EVENTS.CHANGED, { action: 'set_current_repository', id });
  }

  getCurrentRepositoryId(): string {
    return this.currentRepositoryId;
  }

  // Public method to extract repository name from URL
  extractRepositoryName(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      if (pathParts.length >= 2) {
        return `${pathParts[0]}/${pathParts[1]}`;
      }
      return urlObj.hostname || 'Unknown Repository';
    } catch {
      return 'Unknown Repository';
    }
  }

  // Fetch repository name from manifest.json
  async fetchRepositoryNameFromManifest(repositoryUrl: string): Promise<string> {
    try {
      logger.log('[LocalScraperService] Fetching repository name from manifest:', repositoryUrl);

      // Construct manifest URL
      const baseManifestUrl = repositoryUrl.endsWith('/')
        ? `${repositoryUrl}manifest.json`
        : `${repositoryUrl}/manifest.json`;
      const manifestUrl = `${baseManifestUrl}?t=${Date.now()}`;

      const response = await axios.get(manifestUrl, createSafeAxiosConfig(10000, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }));

      if (response.data && response.data.name) {
        logger.log('[LocalScraperService] Found repository name in manifest:', response.data.name);
        return response.data.name;
      } else {
        logger.warn('[LocalScraperService] No name found in manifest, using fallback');
        return this.extractRepositoryName(repositoryUrl);
      }
    } catch (error) {
      logger.error('[LocalScraperService] Failed to fetch repository name from manifest:', error);
      throw error;
    }
  }

  // Update repository name from manifest for existing repositories
  async refreshRepositoryNamesFromManifests(): Promise<void> {
    await this.ensureInitialized();

    for (const [id, repo] of this.repositories) {
      try {
        const manifestName = await this.fetchRepositoryNameFromManifest(repo.url);
        if (manifestName !== repo.name) {
          logger.log('[LocalScraperService] Updating repository name:', repo.name, '->', manifestName);
          repo.name = manifestName;

          // If this is the current repository, update the current name
          if (id === this.currentRepositoryId) {
            this.repositoryName = manifestName;
          }
        }
      } catch (error) {
        logger.warn('[LocalScraperService] Failed to refresh name for repository:', repo.name, error);
      }
    }

    await this.saveRepositories();
  }

  private async saveRepositories(): Promise<void> {
    const reposObject = Object.fromEntries(this.repositories);
    await mmkvStorage.setItem(this.REPOSITORIES_KEY, JSON.stringify(reposObject));
  }

  // Get a single repository
  getRepository(id: string): RepositoryInfo | undefined {
    return this.repositories.get(id);
  }

  // Get all enabled repositories (for multi-repo support)
  async getEnabledRepositories(): Promise<RepositoryInfo[]> {
    await this.ensureInitialized();
    return Array.from(this.repositories.values()).filter(r => r.enabled !== false);
  }

  // Toggle a repository's enabled state (for multi-repo support)
  async toggleRepositoryEnabled(id: string, enabled: boolean): Promise<void> {
    await this.ensureInitialized();
    const repo = this.repositories.get(id);
    if (!repo) {
      throw new Error(`Repository with id ${id} not found`);
    }

    repo.enabled = enabled;
    this.repositories.set(id, repo);
    await this.saveRepositories();

    pluginSyncEmitter.emit(PLUGIN_SYNC_EVENTS.CHANGED, { action: 'toggle_repository_enabled', id, enabled });
    logger.log('[LocalScraperService] Toggled repository', repo.name, 'to', enabled ? 'enabled' : 'disabled');
  }

  // Get the repository info for a scraper
  getScraperRepository(scraperId: string): RepositoryInfo | undefined {
    const scraper = this.installedScrapers.get(scraperId);
    if (!scraper?.repositoryId) return undefined;
    return this.repositories.get(scraper.repositoryId);
  }


  // Check if a scraper is compatible with the current platform
  private isPlatformCompatible(scraper: ScraperInfo): boolean {
    const currentPlatform = Platform.OS as 'ios' | 'android';

    // If disabledPlatforms is specified and includes current platform, scraper is not compatible
    if (scraper.disabledPlatforms && scraper.disabledPlatforms.includes(currentPlatform)) {
      logger.log(`[LocalScraperService] Scraper ${scraper.name} is disabled on ${currentPlatform}`);
      return false;
    }

    // If supportedPlatforms is specified and doesn't include current platform, scraper is not compatible
    if (scraper.supportedPlatforms && !scraper.supportedPlatforms.includes(currentPlatform)) {
      logger.log(`[LocalScraperService] Scraper ${scraper.name} is not supported on ${currentPlatform}`);
      return false;
    }

    // If neither supportedPlatforms nor disabledPlatforms is specified, or current platform is supported
    return true;
  }

  // Fetch and install scrapers from repository
  async refreshRepository(): Promise<void> {
    await this.ensureInitialized();
    await this.refreshAllEnabledRepositories();
    this.autoRefreshCompleted = true; // Mark as completed after manual refresh
  }

  // Refresh ALL enabled repositories (for multi-repo support)
  async refreshAllEnabledRepositories(): Promise<void> {
    await this.ensureInitialized();

    const enabledRepos = await this.getEnabledRepositories();

    if (enabledRepos.length === 0) {
      logger.log('[LocalScraperService] No enabled repositories to refresh');
      // Clear all caches when no repositories are enabled
      this.scraperCode.clear();
      this.installedScrapers.clear();
      this.inFlightByKey.clear();
      this.scraperSettingsCache = null;
      try {
        cacheService.clearCache();
      } catch (error) {
        logger.warn('[LocalScraperService] Failed to clear cacheService:', error);
      }
      await this.saveInstalledScrapers();
      return;
    }

    logger.log('[LocalScraperService] Refreshing', enabledRepos.length, 'enabled repositories...');

    // IMPORTANT: Preserve user's enabled preferences before clearing
    const previousEnabledStates = new Map<string, boolean>();
    for (const [id, scraper] of this.installedScrapers) {
      previousEnabledStates.set(id, scraper.enabled);
    }
    // Store it on the instance so downloadScraper can access it
    (this as any)._previousEnabledStates = previousEnabledStates;

    // Clear caches before refreshing all
    this.scraperCode.clear();
    this.installedScrapers.clear();
    this.inFlightByKey.clear();
    this.scraperSettingsCache = null;

    try {
      const allKeys = await mmkvStorage.getAllKeys();
      const scraperCodeKeys = allKeys.filter(key => key.startsWith('scraper-code-'));
      if (scraperCodeKeys.length > 0) {
        await mmkvStorage.multiRemove(scraperCodeKeys);
        logger.log('[LocalScraperService] Removed', scraperCodeKeys.length, 'cached scraper code entries');
      }
    } catch (error) {
      logger.error('[LocalScraperService] Failed to clear cached scraper code:', error);
    }

    try {
      cacheService.clearCache();
      logger.log('[LocalScraperService] Cleared cacheService during refresh');
    } catch (error) {
      logger.warn('[LocalScraperService] Failed to clear cacheService:', error);
    }

    // Refresh all enabled repositories in PARALLEL for faster loading
    logger.log('[LocalScraperService] Starting parallel refresh of', enabledRepos.length, 'repositories...');

    const refreshResults = await Promise.allSettled(
      enabledRepos.map(repo => this.refreshSingleRepository(repo.id))
    );

    // Log results
    refreshResults.forEach((result, index) => {
      const repo = enabledRepos[index];
      if (result.status === 'fulfilled') {
        logger.log('[LocalScraperService] Successfully refreshed repository:', repo.name);
      } else {
        logger.error('[LocalScraperService] Failed to refresh repository:', repo.name, result.reason);
      }
    });

    await this.saveInstalledScrapers();

    // Clean up the temporary preserved states
    delete (this as any)._previousEnabledStates;

    logger.log('[LocalScraperService] Finished refreshing all enabled repositories. Total scrapers:', this.installedScrapers.size);
  }

  // Refresh a single repository by ID (parallel-safe - no shared state mutation)
  async refreshSingleRepository(repoId: string): Promise<void> {
    await this.ensureInitialized();
    const repo = this.repositories.get(repoId);
    if (!repo) {
      throw new Error(`Repository with id ${repoId} not found`);
    }

    // Directly call performSingleRepositoryRefresh - it handles everything with explicit repo object
    await this.performSingleRepositoryRefresh(repo);
  }

  // Internal method to refresh repository without initialization check
  private async performRepositoryRefresh(): Promise<void> {
    if (!this.repositoryUrl) {
      throw new Error('No repository URL configured');
    }

    // Prevent multiple simultaneous refreshes
    if (this.isRefreshing) {
      logger.log('[LocalScraperService] Repository refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;

    try {
      logger.log('[LocalScraperService] Fetching repository manifest from:', this.repositoryUrl);

      // Clear all cached scraper code for this repository to force hard refresh
      const cachedScraperIds = Array.from(this.installedScrapers.keys());
      for (const scraperId of cachedScraperIds) {
        const scraper = this.installedScrapers.get(scraperId);
        if (scraper && scraper.repositoryId === this.currentRepositoryId) {
          this.scraperCode.delete(scraperId);
          await mmkvStorage.removeItem(`scraper-code-${scraperId}`);
          logger.log('[LocalScraperService] Cleared cached code for scraper:', scraper.name);
        }
      }

      // Fetch manifest with cache busting
      const baseManifestUrl = this.repositoryUrl.endsWith('/')
        ? `${this.repositoryUrl}manifest.json`
        : `${this.repositoryUrl}/manifest.json`;
      const manifestUrl = `${baseManifestUrl}?t=${Date.now()}&v=${Math.random()}`;

      const response = await axios.get(manifestUrl, createSafeAxiosConfig(10000, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }));
      const manifest: ScraperManifest = response.data;

      // Store repository name from manifest
      if (manifest.name) {
        this.repositoryName = manifest.name;
      }

      logger.log('[LocalScraperService] getAvailableScrapers - Raw manifest data:', JSON.stringify(manifest, null, 2));
      logger.log('[LocalScraperService] getAvailableScrapers - Manifest scrapers count:', manifest.scrapers?.length || 0);

      // Log each scraper's enabled status from manifest
      manifest.scrapers?.forEach(scraper => {
        logger.log(`[LocalScraperService] getAvailableScrapers - Scraper ${scraper.name}: enabled=${scraper.enabled}`);
      });

      logger.log('[LocalScraperService] Found', manifest.scrapers.length, 'scrapers in repository');

      // Get current manifest scraper IDs
      const manifestScraperIds = new Set(manifest.scrapers.map(s => s.id));

      // Remove scrapers that are no longer in the manifest
      const currentScraperIds = Array.from(this.installedScrapers.keys());
      for (const scraperId of currentScraperIds) {
        if (!manifestScraperIds.has(scraperId)) {
          logger.log('[LocalScraperService] Removing scraper no longer in manifest:', this.installedScrapers.get(scraperId)?.name || scraperId);
          this.installedScrapers.delete(scraperId);
          this.scraperCode.delete(scraperId);
          // Remove from AsyncStorage cache
          await mmkvStorage.removeItem(`scraper-code-${scraperId}`);
        }
      }

      // Download and install each scraper from manifest
      for (const scraperInfo of manifest.scrapers) {
        const isPlatformCompatible = this.isPlatformCompatible(scraperInfo);

        if (isPlatformCompatible) {
          // Add repository ID to scraper info
          const scraperWithRepo = { ...scraperInfo, repositoryId: this.currentRepositoryId };
          // Download/update the scraper (downloadScraper handles force disabling based on manifest.enabled)
          await this.downloadScraper(scraperWithRepo);
        } else {
          logger.log('[LocalScraperService] Skipping platform-incompatible scraper:', scraperInfo.name);
          // Remove if it was previously installed but is now platform-incompatible
          if (this.installedScrapers.has(scraperInfo.id)) {
            logger.log('[LocalScraperService] Removing platform-incompatible scraper:', scraperInfo.name);
            this.installedScrapers.delete(scraperInfo.id);
            this.scraperCode.delete(scraperInfo.id);
            await mmkvStorage.removeItem(`scraper-code-${scraperInfo.id}`);
          }
        }
      }

      await this.saveInstalledScrapers();

      // Update repository info
      const currentRepo = this.repositories.get(this.currentRepositoryId);
      if (currentRepo) {
        const scraperCount = Array.from(this.installedScrapers.values())
          .filter(s => s.repositoryId === this.currentRepositoryId).length;
        await this.updateRepository(this.currentRepositoryId, {
          lastUpdated: Date.now(),
          scraperCount
        });
      }

      logger.log('[LocalScraperService] Repository refresh completed');

    } catch (error) {
      logger.error('[LocalScraperService] Failed to refresh repository:', error);
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  // Refresh a single repository without clearing others (for multi-repo support)
  private async performSingleRepositoryRefresh(repo: RepositoryInfo): Promise<void> {
    logger.log('[LocalScraperService] Fetching repository manifest from:', repo.url);

    try {
      // Fetch manifest with cache busting
      const baseManifestUrl = repo.url.endsWith('/')
        ? `${repo.url}manifest.json`
        : `${repo.url}/manifest.json`;
      const manifestUrl = `${baseManifestUrl}?t=${Date.now()}&v=${Math.random()}`;

      const response = await axios.get(manifestUrl, createSafeAxiosConfig(10000, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }));
      const manifest: ScraperManifest = response.data;

      // Update repository name from manifest
      if (manifest.name) {
        repo.name = manifest.name;
        this.repositories.set(repo.id, repo);
      }

      logger.log('[LocalScraperService] Repository', repo.name, 'has', manifest.scrapers?.length || 0, 'scrapers');

      // Get current manifest scraper IDs for this repository
      const manifestScraperIds = new Set(manifest.scrapers.map(s => s.id));

      // Remove scrapers from this repository that are no longer in its manifest
      const currentScraperIds = Array.from(this.installedScrapers.keys());
      for (const scraperId of currentScraperIds) {
        const scraper = this.installedScrapers.get(scraperId);
        if (scraper?.repositoryId === repo.id && !manifestScraperIds.has(scraperId)) {
          logger.log('[LocalScraperService] Removing scraper no longer in manifest:', scraper.name);
          this.installedScrapers.delete(scraperId);
          this.scraperCode.delete(scraperId);
          await mmkvStorage.removeItem(`scraper-code-${scraperId}`);
        }
      }

      // Download and install each scraper from manifest
      for (const scraperInfo of manifest.scrapers) {
        const isPlatformCompatible = this.isPlatformCompatible(scraperInfo);

        if (isPlatformCompatible) {
          // Add repository ID to scraper info
          const scraperWithRepo = { ...scraperInfo, repositoryId: repo.id };
          // Download/update the scraper - pass repo.url explicitly for parallel-safe operation
          await this.downloadScraper(scraperWithRepo, repo.url);
        } else {
          logger.log('[LocalScraperService] Skipping platform-incompatible scraper:', scraperInfo.name);
          // Remove if it was previously installed but is now platform-incompatible
          if (this.installedScrapers.has(scraperInfo.id)) {
            this.installedScrapers.delete(scraperInfo.id);
            this.scraperCode.delete(scraperInfo.id);
            await mmkvStorage.removeItem(`scraper-code-${scraperInfo.id}`);
          }
        }
      }

      // Update repository info
      const scraperCount = Array.from(this.installedScrapers.values())
        .filter(s => s.repositoryId === repo.id).length;
      await this.updateRepository(repo.id, {
        lastUpdated: Date.now(),
        scraperCount
      });

      logger.log('[LocalScraperService] Repository', repo.name, 'refresh completed with', scraperCount, 'scrapers');

    } catch (error) {
      logger.error('[LocalScraperService] Failed to refresh repository:', repo.name, error);
      throw error;
    }
  }

  // Download individual scraper (repositoryUrl passed explicitly for parallel-safe operation)
  private async downloadScraper(scraperInfo: ScraperInfo, repositoryUrl?: string): Promise<void> {
    try {
      // Use passed repositoryUrl or fall back to this.repositoryUrl for backward compatibility
      const repoUrl = repositoryUrl || this.repositoryUrl;
      const scraperUrl = repoUrl.endsWith('/')
        ? `${repoUrl}${scraperInfo.filename}`
        : `${repoUrl}/${scraperInfo.filename}`;

      logger.log('[LocalScraperService] Downloading scraper:', scraperInfo.name);

      // Add cache-busting parameters to force fresh download
      const scraperUrlWithCacheBust = `${scraperUrl}?t=${Date.now()}&v=${Math.random()}`;

      const response = await axios.get(scraperUrlWithCacheBust, createSafeAxiosConfig(15000, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }));
      const scraperCode = response.data;

      // Store scraper info and code
      const existingScraper = this.installedScrapers.get(scraperInfo.id);
      const isPlatformCompatible = this.isPlatformCompatible(scraperInfo);

      // Check preserved states first (from refresh), then existing scraper, then default
      const previousStates = (this as any)._previousEnabledStates as Map<string, boolean> | undefined;
      const previousEnabled = previousStates?.get(scraperInfo.id);
      const userEnabledState = previousEnabled !== undefined ? previousEnabled : (existingScraper?.enabled ?? true);

      const updatedScraperInfo = {
        ...scraperInfo,
        // Store the manifest's enabled state separately
        manifestEnabled: scraperInfo.enabled,
        // Force disable if:
        // 1. Manifest says enabled: false (globally disabled)
        // 2. Platform incompatible
        // Otherwise, preserve user's enabled state
        enabled: scraperInfo.enabled && isPlatformCompatible ? userEnabledState : false
      };

      // Ensure contentLanguage is an array (migration for older scrapers)
      if (!updatedScraperInfo.contentLanguage) {
        updatedScraperInfo.contentLanguage = ['en']; // Default to English
      } else if (typeof updatedScraperInfo.contentLanguage === 'string') {
        updatedScraperInfo.contentLanguage = [updatedScraperInfo.contentLanguage]; // Convert string to array
      }

      // Ensure supportedTypes is an array (migration for older scrapers)
      if (!updatedScraperInfo.supportedTypes || !Array.isArray(updatedScraperInfo.supportedTypes)) {
        updatedScraperInfo.supportedTypes = ['movie', 'tv']; // Default to both types
      }
      // Normalize formats fields (support both `formats` and `supportedFormats`)
      if (typeof (updatedScraperInfo as any).formats === 'string') {
        updatedScraperInfo.formats = [(updatedScraperInfo as any).formats as unknown as string];
      }
      if (typeof (updatedScraperInfo as any).supportedFormats === 'string') {
        updatedScraperInfo.supportedFormats = [(updatedScraperInfo as any).supportedFormats as unknown as string];
      }
      if (!updatedScraperInfo.supportedFormats && updatedScraperInfo.formats) {
        updatedScraperInfo.supportedFormats = updatedScraperInfo.formats;
      }

      this.installedScrapers.set(scraperInfo.id, updatedScraperInfo);

      this.scraperCode.set(scraperInfo.id, scraperCode);

      // Cache the scraper code
      await this.cacheScraperCode(scraperInfo.id, scraperCode);

      logger.log('[LocalScraperService] Successfully downloaded:', scraperInfo.name);

    } catch (error) {
      logger.error('[LocalScraperService] Failed to download scraper', scraperInfo.name, ':', error);
    }
  }

  // Cache scraper code locally
  private async cacheScraperCode(scraperId: string, code: string): Promise<void> {
    try {
      await mmkvStorage.setItem(`scraper-code-${scraperId}`, code);
    } catch (error) {
      logger.error('[LocalScraperService] Failed to cache scraper code:', error);
    }
  }

  // Load scraper code from cache
  private async loadScraperCode(): Promise<void> {
    for (const [scraperId] of this.installedScrapers) {
      try {
        const cachedCode = await mmkvStorage.getItem(`scraper-code-${scraperId}`);
        if (cachedCode) {
          this.scraperCode.set(scraperId, cachedCode);
        }
      } catch (error) {
        logger.error('[LocalScraperService] Failed to load cached code for', scraperId, ':', error);
      }
    }
  }

  // Save installed scrapers to storage
  private async saveInstalledScrapers(): Promise<void> {
    try {
      const scrapers = Array.from(this.installedScrapers.values());
      await mmkvStorage.setItem(this.STORAGE_KEY, JSON.stringify(scrapers));
    } catch (error) {
      logger.error('[LocalScraperService] Failed to save scrapers:', error);
    }
  }

  // Get installed scrapers
  async getInstalledScrapers(): Promise<ScraperInfo[]> {
    await this.ensureInitialized();
    return Array.from(this.installedScrapers.values());
  }

  // Per-scraper settings storage
  async getScraperSettings(scraperId: string): Promise<Record<string, any>> {
    await this.ensureInitialized();
    try {
      if (!this.scraperSettingsCache) {
        const raw = await mmkvStorage.getItem(this.SCRAPER_SETTINGS_KEY);
        this.scraperSettingsCache = raw ? JSON.parse(raw) : {};
      }
      const cache = this.scraperSettingsCache || {};
      return cache[scraperId] || {};
    } catch (error) {
      logger.warn('[LocalScraperService] Failed to get scraper settings for', scraperId, error);
      return {};
    }
  }

  async setScraperSettings(scraperId: string, settings: Record<string, any>): Promise<void> {
    await this.ensureInitialized();
    try {
      if (!this.scraperSettingsCache) {
        const raw = await mmkvStorage.getItem(this.SCRAPER_SETTINGS_KEY);
        this.scraperSettingsCache = raw ? JSON.parse(raw) : {};
      }
      const cache = this.scraperSettingsCache || {};
      cache[scraperId] = settings || {};
      this.scraperSettingsCache = cache;
      await mmkvStorage.setItem(this.SCRAPER_SETTINGS_KEY, JSON.stringify(cache));
    } catch (error) {
      logger.error('[LocalScraperService] Failed to set scraper settings for', scraperId, error);
    }
  }

  // Get available scrapers from ALL enabled repositories (for display in settings)
  async getAvailableScrapers(): Promise<ScraperInfo[]> {
    await this.ensureInitialized();

    const enabledRepos = await this.getEnabledRepositories();

    if (enabledRepos.length === 0) {
      logger.log('[LocalScraperService] No enabled repositories, returning empty list');
      return [];
    }

    // Return installed scrapers from all enabled repositories
    // These are already synced with manifests during refresh
    const allScrapers = Array.from(this.installedScrapers.values())
      .filter(scraper => {
        // Only include scrapers from enabled repositories
        const repo = this.repositories.get(scraper.repositoryId || '');
        return repo?.enabled !== false;
      });

    logger.log('[LocalScraperService] Found', allScrapers.length, 'scrapers from', enabledRepos.length, 'enabled repositories');

    return allScrapers;
  }

  // Check if a given scraper declares support for a specific format (e.g., 'mkv')
  async supportsFormat(scraperId: string, format: string): Promise<boolean> {
    await this.ensureInitialized();
    try {
      const available = await this.getAvailableScrapers();
      const info = available.find(s => s.id === scraperId);
      if (!info) return false;
      const formats = (info.supportedFormats || info.formats || [])
        .filter(Boolean)
        .map(f => (typeof f === 'string' ? f.toLowerCase() : String(f).toLowerCase()));
      const supported = formats.includes((format || '').toLowerCase());
      logger.log(`[LocalScraperService] supportsFormat('${scraperId}', '${format}') -> ${supported}. Formats: ${JSON.stringify(formats)}`);
      return supported;
    } catch (e) {
      logger.warn(`[LocalScraperService] supportsFormat('${scraperId}', '${format}') failed`, e);
      return false;
    }
  }

  // Enable/disable scraper
  async setScraperEnabled(scraperId: string, enabled: boolean): Promise<void> {
    await this.ensureInitialized();

    const scraper = this.installedScrapers.get(scraperId);
    if (scraper) {
      // Prevent enabling if manifest has disabled it or if platform-incompatible
      if (enabled && (scraper.manifestEnabled === false || !this.isPlatformCompatible(scraper))) {
        logger.log('[LocalScraperService] Cannot enable scraper', scraperId, '- disabled in manifest or platform-incompatible');
        return;
      }

      scraper.enabled = enabled;
      this.installedScrapers.set(scraperId, scraper);
      await this.saveInstalledScrapers();
      logger.log('[LocalScraperService] Scraper', scraperId, enabled ? 'enabled' : 'disabled');
    }
  }

  // Execute scrapers for streams
  async getStreams(type: string, tmdbId: string, season?: number, episode?: number, callback?: ScraperCallback): Promise<void> {
    await this.ensureInitialized();

    // Get list of installed scrapers at the beginning for callback invocations
    const installedScrapers = Array.from(this.installedScrapers.values());

    // Helper function to invoke callback for all installed scrapers with empty results
    const invokeCallbacksForAllScrapers = (reason: string) => {
      if (callback && installedScrapers.length > 0) {
        logger.log(`[LocalScraperService] Invoking callbacks for ${installedScrapers.length} scrapers due to: ${reason}`);
        installedScrapers.forEach(scraper => {
          callback([], scraper.id, scraper.name, null);
        });
      }
    };

    // Check if local scrapers are enabled
    const userSettings = await this.getUserScraperSettings();
    if (!userSettings.enableLocalScrapers) {
      logger.log('[LocalScraperService] Local scrapers are disabled');
      invokeCallbacksForAllScrapers('local scrapers disabled');
      return;
    }

    // If no repository is configured, return early
    if (!this.repositoryUrl) {
      logger.log('[LocalScraperService] No repository URL configured');
      invokeCallbacksForAllScrapers('no repository URL configured');
      return;
    }

    // If no scrapers are installed, try to refresh repository
    if (this.installedScrapers.size === 0) {
      logger.log('[LocalScraperService] No scrapers installed, attempting to refresh repository');
      try {
        await this.performRepositoryRefresh();
      } catch (error) {
        logger.error('[LocalScraperService] Failed to refresh repository for getStreams:', error);
        invokeCallbacksForAllScrapers('repository refresh failed');
        return;
      }
    }

    // Normalize media type for plugin compatibility (treat 'series'/'other' as 'tv')
    const media: 'movie' | 'tv' = (type === 'series' || type === 'other') ? 'tv' : (type as 'movie' | 'tv');

    // Get available scrapers from manifest (respects manifestEnabled)
    const availableScrapers = await this.getAvailableScrapers();
    const enabledScrapers = availableScrapers
      .filter(scraper =>
        scraper.enabled &&
        scraper.manifestEnabled !== false &&
        scraper.supportedTypes.includes(media)
      );

    logger.log(`[LocalScraperService] Media normalized '${type}' -> '${media}'. Enabled scrapers for this media: ${enabledScrapers.length}`);
    if (enabledScrapers.length > 0) {
      try {
        logger.log('[LocalScraperService] Enabled scrapers:', enabledScrapers.map(s => s.name).join(', '));
      } catch { }
    }

    if (enabledScrapers.length === 0) {
      logger.log('[LocalScraperService] No enabled scrapers found for type:', type);
      // No callback needed here since this is after filtering - scrapers weren't added to UI yet
      return;
    }

    logger.log(`[LocalScraperService] Executing ${enabledScrapers.length} scrapers for ${media}:${tmdbId}`);

    // Generate a lightweight request id for tracing
    const requestId = `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const executeBatch = async (scrapers: ScraperInfo[], batchSize: number) => {
      for (let i = 0; i < scrapers.length; i += batchSize) {
        const batch = scrapers.slice(i, i + batchSize);
        batch.forEach(scraper => {
          this.executeScraper(scraper, media, tmdbId, season, episode, callback, requestId);
        });
        if (i + batchSize < scrapers.length) {
          await new Promise(r => setTimeout(r, SCRAPER_BATCH_DELAY_MS));
        }
      }
    };

    executeBatch(enabledScrapers, MAX_CONCURRENT_SCRAPERS);
  }

  // Execute individual scraper
  private async executeScraper(
    scraper: ScraperInfo,
    type: string,
    tmdbId: string,
    season?: number,
    episode?: number,
    callback?: ScraperCallback,
    requestId?: string
  ): Promise<void> {
    try {
      const code = this.scraperCode.get(scraper.id);
      if (!code) {
        throw new Error(`No code found for scraper ${scraper.id}`);
      }

      // Load per-scraper settings
      const scraperSettings = await this.getScraperSettings(scraper.id);

      // Build single-flight key
      const flightKey = `${scraper.id}|${type}|${tmdbId}|${season ?? ''}|${episode ?? ''}`;

      if (this.inFlightByKey.size >= MAX_INFLIGHT_KEYS) {
        const firstKey = this.inFlightByKey.keys().next().value;
        if (firstKey) this.inFlightByKey.delete(firstKey);
      }

      // Create a sandboxed execution environment with single-flight coalescing
      let promise: Promise<LocalScraperResult[]>;
      if (this.inFlightByKey.has(flightKey)) {
        promise = this.inFlightByKey.get(flightKey)!;
      } else {
        promise = this.executePlugin(code, {
          tmdbId,
          mediaType: type,
          season,
          episode,
          scraperId: scraper.id,
          settings: scraperSettings,
          requestId
        });
        this.inFlightByKey.set(flightKey, promise);
        // Clean up after settle; guard against races
        promise.finally(() => {
          const current = this.inFlightByKey.get(flightKey);
          if (current === promise) this.inFlightByKey.delete(flightKey);
        }).catch(() => { });
      }

      let results = await promise;

      if (Array.isArray(results) && results.length > MAX_RESULT_ITEMS) {
        results = results.slice(0, MAX_RESULT_ITEMS);
      }

      // Convert results to Nuvio Stream format
      const streams = this.convertToStreams(results, scraper);

      if (callback) {
        callback(streams, scraper.id, scraper.name, null);
      }

    } catch (error) {
      logger.error('[LocalScraperService] Scraper', scraper.name, 'failed:', error);

      if (callback) {
        callback(null, scraper.id, scraper.name, error as Error);
      }
    }
  }


  private async executePlugin(code: string, params: any, consoleOverride?: any): Promise<LocalScraperResult[]> {
    try {
      const allScraperSettingsRaw = await mmkvStorage.getItem(this.SCRAPER_SETTINGS_KEY);
      const allScraperSettings = allScraperSettingsRaw ? JSON.parse(allScraperSettingsRaw) : {};
      let perScraperSettings = (params && params.scraperId && allScraperSettings[params.scraperId])
        ? allScraperSettings[params.scraperId]
        : (params?.settings || {});

      if (params?.scraperId?.toLowerCase().includes('showbox')) {
        const token = perScraperSettings.uiToken || perScraperSettings.cookie || perScraperSettings.token;
        if (token) {
          perScraperSettings = {
            ...perScraperSettings,
            uiToken: token,
            cookie: token,
            token: token
          };
          if (params) {
            params.settings = perScraperSettings;
          }
        }
      }

      // Module exports for CommonJS compatibility
      const moduleExports: any = {};
      const moduleObj = { exports: moduleExports };

      // Load cheerio (try multiple package names for compatibility)
      let cheerio: any = null;
      try {
        cheerio = require('cheerio-without-node-native');
      } catch {
        try {
          cheerio = require('react-native-cheerio');
        } catch {
          // Cheerio not available - plugins will need to use regex
        }
      }

      // Environment variables for specific providers
      const MOVIEBOX_PRIMARY_KEY = process.env.EXPO_PUBLIC_MOVIEBOX_PRIMARY_KEY;
      const MOVIEBOX_TMDB_API_KEY = process.env.EXPO_PUBLIC_MOVIEBOX_TMDB_API_KEY || '439c478a771f35c05022f9feabcca01c';

      const sandboxedAxios = {
        get: async (url: string, config?: any) => {
          if (!config?.skipSizeCheck) {
            await preflightSizeCheck(url, config?.timeout || 30000);
          }
          return axios.get(url, {
            ...config,
            maxContentLength: MAX_RESPONSE_SIZE,
            maxBodyLength: MAX_RESPONSE_SIZE,
            timeout: config?.timeout || 30000,
          });
        },
        post: async (url: string, data?: any, config?: any) => {
          return axios.post(url, data, {
            ...config,
            maxContentLength: MAX_RESPONSE_SIZE,
            maxBodyLength: MAX_RESPONSE_SIZE,
            timeout: config?.timeout || 30000,
          });
        },
        put: async (url: string, data?: any, config?: any) => {
          return axios.put(url, data, {
            ...config,
            maxContentLength: MAX_RESPONSE_SIZE,
            maxBodyLength: MAX_RESPONSE_SIZE,
            timeout: config?.timeout || 30000,
          });
        },
        delete: async (url: string, config?: any) => {
          return axios.delete(url, {
            ...config,
            maxContentLength: MAX_RESPONSE_SIZE,
            maxBodyLength: MAX_RESPONSE_SIZE,
            timeout: config?.timeout || 30000,
          });
        },
        request: async (config: any) => {
          const method = (config?.method || 'GET').toString().toUpperCase();
          if (method === 'GET' && config?.url && !config?.skipSizeCheck) {
            await preflightSizeCheck(config.url, config?.timeout || 30000);
          }
          return axios.request({
            ...config,
            maxContentLength: MAX_RESPONSE_SIZE,
            maxBodyLength: MAX_RESPONSE_SIZE,
            timeout: config?.timeout || 30000,
          });
        },
        create: (config?: any) => axios.create({
          ...config,
          maxContentLength: MAX_RESPONSE_SIZE,
          maxBodyLength: MAX_RESPONSE_SIZE,
        }),
      };

      // Custom require function for backward compatibility with existing plugins
      const pluginRequire = (moduleName: string): any => {
        switch (moduleName) {
          case 'cheerio-without-node-native':
          case 'react-native-cheerio':
          case 'cheerio':
            if (cheerio) return cheerio;
            throw new Error(`${moduleName} not available`);
          case 'crypto-js':
            return CryptoJS;
          case 'axios':
            return sandboxedAxios;
          default:
            throw new Error(`Module '${moduleName}' is not available in plugins`);
        }
      };

      const polyfilledFetch = async (url: string, options: any = {}): Promise<Response> => {
        const method = (options?.method || 'GET').toString().toUpperCase();
        
        if (method === 'GET' && !options?.skipSizeCheck) {
          try {
            await preflightSizeCheck(url, options?.timeout || 15000);
          } catch (preflightError: any) {
            logger.error('[PolyfilledFetch] Preflight check failed:', preflightError.message);
            throw preflightError;
          }
        }

        if (options.redirect !== 'manual') {
          return fetch(url, options);
        }

        // Try native fetch with redirect: 'manual' first
        try {
          logger.log('[PolyfilledFetch] Attempting native fetch with redirect: manual for:', url.substring(0, 50));
          const nativeResponse = await fetch(url, options);

          // Log what native fetch returns
          const locationHeader = nativeResponse.headers.get('location');
          logger.log('[PolyfilledFetch] Native fetch result - Status:', nativeResponse.status, 'URL:', nativeResponse.url?.substring(0, 60), 'Location:', locationHeader || 'none');

          // Check if redirect happened - compare URLs
          if (nativeResponse.url && nativeResponse.url !== url) {
            // Fetch followed the redirect! Let's try to get the redirect location
            // by making a HEAD request or checking if there's any pattern
            logger.log('[PolyfilledFetch] REDIRECT DETECTED - Original:', url.substring(0, 50), 'Final:', nativeResponse.url.substring(0, 50));

            // Create a mock 302 response with the final URL as location
            const mockHeaders = new Headers(nativeResponse.headers);
            mockHeaders.set('location', nativeResponse.url);

            return {
              ok: false,
              status: 302,  // Mock as 302
              statusText: 'Found',
              headers: mockHeaders,
              url: url,
              text: nativeResponse.text.bind(nativeResponse),
              json: nativeResponse.json.bind(nativeResponse),
              blob: nativeResponse.blob.bind(nativeResponse),
              arrayBuffer: nativeResponse.arrayBuffer.bind(nativeResponse),
              clone: nativeResponse.clone.bind(nativeResponse),
              body: nativeResponse.body,
              bodyUsed: nativeResponse.bodyUsed,
              redirected: true,
              type: nativeResponse.type,
              formData: nativeResponse.formData.bind(nativeResponse),
            } as Response;
          }

          return nativeResponse;
        } catch (error: any) {
          logger.error('[PolyfilledFetch] Native fetch error:', error.message);
          throw error;
        }
      };

      // Execution timeout (1 minute)
      const PLUGIN_TIMEOUT_MS = 60000;

      const executionPromise = new Promise<LocalScraperResult[]>((resolve, reject) => {
        try {
          // Create function with full global access
          // We pass specific utilities but the plugin has access to everything
          const executePlugin = new Function(
            'module',
            'exports',
            'require',
            'axios',
            'fetch',
            'CryptoJS',
            'cheerio',
            'logger',
            'console',
            'params',
            'PRIMARY_KEY',
            'TMDB_API_KEY',
            'SCRAPER_SETTINGS',
            'SCRAPER_ID',
            `
            // Make env vars available globally for backward compatibility
            const globalScope = typeof global !== 'undefined' ? global : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
            
            if (globalScope) {
              globalScope.PRIMARY_KEY = PRIMARY_KEY;
              globalScope.TMDB_API_KEY = TMDB_API_KEY;
              globalScope.SCRAPER_SETTINGS = SCRAPER_SETTINGS;
              globalScope.SCRAPER_ID = SCRAPER_ID;
            } else {
               logger.error('[Plugin Sandbox] Could not find global scope to inject settings');
            }

            // Plugin code
            ${code}

            // Find and call getStreams function
            if (typeof getStreams === 'function') {
              return getStreams(params.tmdbId, params.mediaType, params.season, params.episode);
            } else if (module.exports && typeof module.exports.getStreams === 'function') {
              return module.exports.getStreams(params.tmdbId, params.mediaType, params.season, params.episode);
            } else if (typeof global !== 'undefined' && typeof global.getStreams === 'function') {
              return global.getStreams(params.tmdbId, params.mediaType, params.season, params.episode);
            } else {
              throw new Error('No getStreams function found in plugin');
            }
            `
          );

          // Execute with full access to utilities
          const result = executePlugin(
            moduleObj,
            moduleExports,
            pluginRequire,
            sandboxedAxios,
            polyfilledFetch,  // Use polyfilled fetch for redirect: manual support
            CryptoJS,
            cheerio,
            logger,
            consoleOverride || console,  // Expose console (or override) to plugins for debugging
            params,
            MOVIEBOX_PRIMARY_KEY,
            MOVIEBOX_TMDB_API_KEY,
            perScraperSettings,
            params?.scraperId
          );

          // Handle async results
          if (result && typeof result.then === 'function') {
            result.then(resolve).catch(reject);
          } else {
            resolve(result || []);
          }
        } catch (error) {
          reject(error);
        }
      });

      // Apply timeout to prevent hanging plugins
      return await Promise.race([
        executionPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Plugin execution timed out after ${PLUGIN_TIMEOUT_MS}ms`)), PLUGIN_TIMEOUT_MS)
        )
      ]);

    } catch (error) {
      logger.error('[LocalScraperService] Plugin execution failed:', error);
      throw error;
    }
  }

  // Convert scraper results to Nuvio Stream format
  private convertToStreams(results: LocalScraperResult[], scraper: ScraperInfo): Stream[] {
    if (!Array.isArray(results)) {
      logger.warn('[LocalScraperService] Scraper returned non-array result');
      return [];
    }

    return results.map((result, index) => {
      // Build title with quality information for UI compatibility
      let title = result.title || result.name || `${scraper.name} Stream ${index + 1}`;

      // Add quality to title if available and not already present
      if (result.quality && !title.includes(result.quality)) {
        title = `${title} ${result.quality}`;
      }

      // Build name with quality information
      let streamName = result.name || `${scraper.name}`;
      if (result.quality && !streamName.includes(result.quality)) {
        streamName = `${streamName} - ${result.quality}`;
      }

      const stream: Stream = {
        // Include quality in name field for proper display
        name: streamName,
        title: title,
        url: result.url,
        addon: scraper.id,
        addonId: scraper.id,
        addonName: scraper.name,
        description: result.size ? `${result.size}` : undefined,
        size: result.size ? this.parseSize(result.size) : undefined,
        behaviorHints: {
          bingeGroup: `local-scraper-${scraper.id}`
        }
      };

      // Add additional properties if available
      if (result.infoHash) {
        stream.infoHash = result.infoHash;
      }

      // Preserve any additional fields from the scraper result
      if (result.quality && !stream.quality) {
        stream.quality = result.quality;
      }

      // Pass headers from scraper result if available
      if (result.headers) {
        stream.headers = result.headers;
      }

      return stream;
    }).filter(stream => stream.url); // Filter out streams without URLs
  }

  // Parse size string to bytes
  private parseSize(sizeStr: string): number {
    if (!sizeStr) return 0;

    const match = sizeStr.match(/([0-9.]+)\s*(GB|MB|KB|TB)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    switch (unit) {
      case 'TB': return value * 1024 * 1024 * 1024 * 1024;
      case 'GB': return value * 1024 * 1024 * 1024;
      case 'MB': return value * 1024 * 1024;
      case 'KB': return value * 1024;
      default: return value;
    }
  }

  // Remove all scrapers
  async clearScrapers(): Promise<void> {
    this.installedScrapers.clear();
    this.scraperCode.clear();

    // Clear from storage
    await mmkvStorage.removeItem(this.STORAGE_KEY);

    // Clear cached code
    const keys = await mmkvStorage.getAllKeys();
    const scraperCodeKeys = keys.filter(key => key.startsWith('scraper-code-'));
    await mmkvStorage.multiRemove(scraperCodeKeys);

    logger.log('[LocalScraperService] All scrapers cleared');
  }

  // Check if local scrapers are available
  async hasScrapers(): Promise<boolean> {
    await this.ensureInitialized();

    // Get user settings to check if local scrapers are enabled
    const userSettings = await this.getUserScraperSettings();
    logger.log('[LocalScraperService.hasScrapers] enableLocalScrapers:', userSettings.enableLocalScrapers);
    if (!userSettings.enableLocalScrapers) {
      logger.log('[LocalScraperService.hasScrapers] Returning false: local scrapers disabled');
      return false;
    }

    // If no repository is configured, return false
    if (!this.repositoryUrl) {
      logger.log('[LocalScraperService.hasScrapers] Returning false: no repository URL configured');
      return false;
    }

    // If no scrapers are installed, try to refresh repository
    if (this.installedScrapers.size === 0) {
      logger.log('[LocalScraperService.hasScrapers] No scrapers installed, attempting to refresh repository');
      try {
        await this.performRepositoryRefresh();
      } catch (error) {
        logger.error('[LocalScraperService.hasScrapers] Failed to refresh repository:', error);
        return false;
      }
    }

    logger.log('[LocalScraperService.hasScrapers] installedScrapers.size:', this.installedScrapers.size);
    logger.log('[LocalScraperService.hasScrapers] enabledScrapers set size:', userSettings.enabledScrapers?.size);

    // Check if there are any enabled scrapers based on user settings
    if (userSettings.enabledScrapers && userSettings.enabledScrapers.size > 0) {
      logger.log('[LocalScraperService.hasScrapers] Returning true: enabledScrapers set has items');
      return true;
    }

    // Fallback: check if any scrapers are enabled in the internal state
    const hasEnabledScrapers = Array.from(this.installedScrapers.values()).some(scraper => scraper.enabled);
    logger.log('[LocalScraperService.hasScrapers] Fallback check - hasEnabledScrapers:', hasEnabledScrapers);
    logger.log('[LocalScraperService.hasScrapers] Scrapers state:', Array.from(this.installedScrapers.values()).map(s => ({ id: s.id, name: s.name, enabled: s.enabled })));
    return hasEnabledScrapers;
  }

  // Get current user scraper settings for cache filtering
  private async getUserScraperSettings(): Promise<{ enableLocalScrapers?: boolean; enabledScrapers?: Set<string> }> {
    return this.getUserScraperSettingsWithOverride();
  }

  // Get user scraper settings (can be overridden for testing or external calls)
  async getUserScraperSettingsWithOverride(overrideSettings?: { enableLocalScrapers?: boolean; enabledScrapers?: Set<string> }): Promise<{ enableLocalScrapers?: boolean; enabledScrapers?: Set<string> }> {
    try {
      // If override settings are provided, use them
      if (overrideSettings) {
        return {
          enableLocalScrapers: overrideSettings.enableLocalScrapers,
          enabledScrapers: overrideSettings.enabledScrapers
        };
      }

      // Get user settings from AsyncStorage (scoped with fallback)
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const scopedSettingsJson = await mmkvStorage.getItem(`@user:${scope}:app_settings`);
      const legacySettingsJson = await mmkvStorage.getItem('app_settings');
      const settingsData = scopedSettingsJson || legacySettingsJson;
      const settings = settingsData ? JSON.parse(settingsData) : {};

      // Default to true if the setting is not yet saved
      const enableLocalScrapers = settings.enableLocalScrapers !== false;

      // Get enabled scrapers based on current user settings
      const enabledScrapers = new Set<string>();
      const installedScrapers = Array.from(this.installedScrapers.values());

      for (const scraper of installedScrapers) {
        if (scraper.enabled && enableLocalScrapers) {
          enabledScrapers.add(scraper.id);
        }
      }

      return {
        enableLocalScrapers: enableLocalScrapers,
        enabledScrapers: enabledScrapers.size > 0 ? enabledScrapers : undefined
      };
    } catch (error) {
      logger.error('[LocalScraperService] Error getting user scraper settings:', error);
      return { enableLocalScrapers: false };
    }
  }

  // Test a plugin independently with log capturing.
  // If onLog is provided, each formatted log line is emitted as it happens.
  async testPlugin(
    code: string,
    params: { tmdbId: string; mediaType: string; season?: number; episode?: number },
    options?: { onLog?: (line: string) => void }
  ): Promise<{ streams: Stream[]; logs: string[] }> {
    const logs: string[] = [];
    const emit = (line: string) => {
      logs.push(line);
      options?.onLog?.(line);
    };

    // Create a console proxy to capture logs
    const consoleProxy = {
      log: (...args: any[]) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        emit(`[LOG] ${msg}`);
        console.log('[PluginTest]', msg);
      },
      error: (...args: any[]) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        emit(`[ERROR] ${msg}`);
        console.error('[PluginTest]', msg);
      },
      warn: (...args: any[]) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        emit(`[WARN] ${msg}`);
        console.warn('[PluginTest]', msg);
      },
      info: (...args: any[]) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        emit(`[INFO] ${msg}`);
        console.info('[PluginTest]', msg);
      },
      debug: (...args: any[]) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        emit(`[DEBUG] ${msg}`);
        console.debug('[PluginTest]', msg);
      }
    };

    try {
      const results = await this.executePlugin(code, params, consoleProxy);

      // Convert results using a dummy scraper info since we don't have one for ad-hoc tests
      const dummyScraperInfo: ScraperInfo = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'Test',
        filename: 'test.js',
        supportedTypes: ['movie', 'tv'],
        enabled: true
      };

      const streams = this.convertToStreams(results, dummyScraperInfo);
      return { streams, logs };
    } catch (error: any) {
      emit(`[FATAL ERROR] ${error.message || String(error)}`);
      if (error.stack) {
        emit(`[STACK] ${error.stack}`);
      }
      return { streams: [], logs };
    }
  }

}

export const localScraperService = LocalScraperService.getInstance();
export const pluginService = localScraperService; // Alias for UI consistency
export default localScraperService;
