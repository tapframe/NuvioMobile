import { mmkvStorage } from './mmkvStorage';
import { AppState, AppStateStatus } from 'react-native';
import { logger } from '../utils/logger';

// Storage keys
export const TRAKT_ACCESS_TOKEN_KEY = 'trakt_access_token';
export const TRAKT_REFRESH_TOKEN_KEY = 'trakt_refresh_token';
export const TRAKT_TOKEN_EXPIRY_KEY = 'trakt_token_expiry';

// Trakt API configuration
const TRAKT_API_URL = 'https://api.trakt.tv';
const TRAKT_CLIENT_ID = process.env.EXPO_PUBLIC_TRAKT_CLIENT_ID as string;
const TRAKT_CLIENT_SECRET = process.env.EXPO_PUBLIC_TRAKT_CLIENT_SECRET as string;
const TRAKT_REDIRECT_URI = process.env.EXPO_PUBLIC_TRAKT_REDIRECT_URI || 'nuvio://auth/trakt'; // Must match registered callback URL

if (!TRAKT_CLIENT_ID || !TRAKT_CLIENT_SECRET) {
  logger.warn('[TraktService] Missing Trakt env vars. Trakt integration will be disabled.');
}

// Types
export interface TraktUser {
  username: string;
  name?: string;
  private: boolean;
  vip: boolean;
  joined_at: string;
  avatar?: string;
}

export interface TraktUserStats {
  movies?: {
    watched?: number;
    minutes?: number;
  };
  shows?: {
    watched?: number;
    minutes?: number;
  };
  episodes?: {
    watched?: number;
    minutes?: number;
  };
  minutes?: number; // total minutes watched
}

export interface TraktWatchedItem {
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  show?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  plays: number;
  last_watched_at: string;
  last_updated_at?: string; // Timestamp for syncing - only re-process if newer
  reset_at?: string | null; // When user started re-watching - ignore episodes watched before this
  seasons?: {
    number: number;
    episodes: {
      number: number;
      plays: number;
      last_watched_at: string;
    }[];
  }[];
}

export interface TraktWatchlistItem {
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  show?: {
    title: string;
    year: number
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  listed_at: string;
}

export interface TraktCollectionItem {
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  show?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  collected_at: string;
}

export interface TraktRatingItem {
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  show?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  rating: number;
  rated_at: string;
}

export interface TraktImages {
  fanart?: string[];
  poster?: string[];
  logo?: string[];
  clearart?: string[];
  banner?: string[];
  thumb?: string[];
}

export interface TraktItemWithImages {
  title: string;
  year: number;
  ids: {
    trakt: number;
    slug: string;
    imdb: string;
    tmdb: number;
  };
  images?: TraktImages;
}

// New types for scrobbling
export interface TraktPlaybackItem {
  progress: number;
  paused_at: string;
  id: number;
  type: 'movie' | 'episode';
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
  episode?: {
    season: number;
    number: number;
    title: string;
    ids: {
      trakt: number;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
    images?: TraktImages;
  };
  show?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      tvdb?: number;
      imdb: string;
      tmdb: number;
    };
    images?: TraktImages;
  };
}

export interface TraktScrobbleResponse {
  id: number;
  action: 'start' | 'pause' | 'scrobble' | 'conflict';
  progress: number;
  sharing?: {
    twitter?: boolean;
    mastodon?: boolean;
    tumblr?: boolean;
    facebook?: boolean;
  };
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
  };
  episode?: {
    season: number;
    number: number;
    title: string;
    ids: {
      trakt: number;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
  };
  show?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      tvdb?: number;
      imdb: string;
      tmdb: number;
    };
  };
  // Additional field for 409 handling
  alreadyScrobbled?: boolean;
}

/**
 * Content data for Trakt scrobbling.
 * 
 * Required fields:
 * - type: 'movie' or 'episode'
 * - imdbId: A valid IMDb ID (with or without 'tt' prefix)
 * - title: Non-empty content title
 * 
 * Optional fields:
 * - year: Release year (must be valid if provided, e.g., 1800-current year+10)
 * - season/episode: Required for episode type
 * - showTitle/showYear/showImdbId: Show metadata for episodes
 */
export interface TraktContentData {
  type: 'movie' | 'episode';
  imdbId: string;
  title: string;
  /** Release year - optional as Trakt can often resolve content via IMDb ID alone */
  year?: number;
  season?: number;
  episode?: number;
  showTitle?: string;
  showYear?: number;
  showImdbId?: string;
}

export interface TraktHistoryItem {
  id: number;
  watched_at: string;
  action: 'scrobble' | 'checkin' | 'watch';
  type: 'movie' | 'episode';
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
  };
  episode?: {
    season: number;
    number: number;
    title: string;
    ids: {
      trakt: number;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
  };
  show?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      tvdb?: number;
      imdb: string;
      tmdb: number;
    };
  };
}

export interface TraktHistoryRemovePayload {
  movies?: Array<{
    title?: string;
    year?: number;
    ids: {
      trakt?: number;
      slug?: string;
      imdb?: string;
      tmdb?: number;
    };
  }>;
  shows?: Array<{
    title?: string;
    year?: number;
    ids: {
      trakt?: number;
      slug?: string;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
    seasons?: Array<{
      number: number;
      episodes?: Array<{
        number: number;
      }>;
    }>;
  }>;
  seasons?: Array<{
    ids: {
      trakt?: number;
      tvdb?: number;
      tmdb?: number;
    };
  }>;
  episodes?: Array<{
    ids: {
      trakt?: number;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
  }>;
  ids?: number[];
}

export interface TraktHistoryRemoveResponse {
  deleted: {
    movies: number;
    episodes: number;
    shows?: number;
    seasons?: number;
  };
  not_found: {
    movies: Array<{
      ids: {
        imdb?: string;
        trakt?: number;
        tmdb?: number;
      };
    }>;
    shows: Array<{
      ids: {
        imdb?: string;
        trakt?: number;
        tvdb?: number;
        tmdb?: number;
      };
    }>;
    seasons: Array<{
      ids: {
        trakt?: number;
        tvdb?: number;
        tmdb?: number;
      };
    }>;
    episodes: Array<{
      ids: {
        trakt?: number;
        tvdb?: number;
        imdb?: string;
        tmdb?: number;
      };
    }>;
    ids: number[];
  };
}

// Comment types
export interface TraktComment {
  id: number;
  comment: string;
  spoiler: boolean;
  review: boolean;
  parent_id: number;
  created_at: string;
  updated_at: string;
  replies: number;
  likes: number;
  user_stats?: {
    rating?: number | null;
    play_count?: number;
    completed_count?: number;
  };
  user: {
    username: string;
    private: boolean;
    name?: string;
    vip: boolean;
    vip_ep: boolean;
    ids: {
      slug: string;
    };
  };
}

export interface TraktMovieComment {
  type: 'movie';
  movie: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb: string;
      tmdb: number;
    };
  };
  comment: TraktComment;
}

export interface TraktShowComment {
  type: 'show';
  show: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      tvdb?: number;
      imdb: string;
      tmdb: number;
    };
  };
  comment: TraktComment;
}

export interface TraktSeasonComment {
  type: 'season';
  season: {
    number: number;
    ids: {
      trakt: number;
      tvdb?: number;
      tmdb?: number;
    };
  };
  show: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      tvdb?: number;
      imdb: string;
      tmdb: number;
    };
  };
  comment: TraktComment;
}

export interface TraktEpisodeComment {
  type: 'episode';
  episode: {
    season: number;
    number: number;
    title: string;
    ids: {
      trakt: number;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
  };
  show: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      tvdb?: number;
      imdb: string;
      tmdb: number;
    };
  };
  comment: TraktComment;
}

export interface TraktListComment {
  type: 'list';
  list: {
    name: string;
    description?: string;
    privacy: string;
    share_link?: string;
    display_numbers: boolean;
    allow_comments: boolean;
    updated_at: string;
    item_count: number;
    comment_count: number;
    likes: number;
    ids: {
      trakt: number;
      slug: string;
    };
  };
  comment: TraktComment;
}

// Simplified comment type based on actual API response
export interface TraktContentComment {
  id: number;
  comment: string;
  spoiler: boolean;
  review: boolean;
  parent_id: number;
  created_at: string;
  updated_at: string;
  replies: number;
  likes: number;
  language: string;
  user_rating?: number;
  user_stats?: {
    rating?: number;
    play_count?: number;
    completed_count?: number;
  };
  user: {
    username: string;
    private: boolean;
    deleted?: boolean;
    name?: string;
    vip: boolean;
    vip_ep: boolean;
    director?: boolean;
    ids: {
      slug: string;
    };
  };
}

// Keep the old types for backward compatibility if needed
export type TraktContentCommentLegacy =
  | TraktMovieComment
  | TraktShowComment
  | TraktSeasonComment
  | TraktEpisodeComment
  | TraktListComment;


const TRAKT_MAINTENANCE_MODE = false;
const TRAKT_MAINTENANCE_MESSAGE = 'Trakt integration is temporarily unavailable for maintenance. Please try again later.';

export class TraktService {
  private static instance: TraktService;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: number = 0;
  private isInitialized: boolean = false;


  public isMaintenanceMode(): boolean {
    return TRAKT_MAINTENANCE_MODE;
  }


  public getMaintenanceMessage(): string {
    return TRAKT_MAINTENANCE_MESSAGE;
  }

  // Rate limiting - Optimized for real-time scrobbling
  private lastApiCall: number = 0;
  private readonly MIN_API_INTERVAL = 500; // Reduced to 500ms for faster updates
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue: boolean = false;

  // Track items that have been successfully scrobbled to prevent duplicates
  private scrobbledItems: Set<string> = new Set();
  private readonly SCROBBLE_EXPIRY_MS = 46 * 60 * 1000; // 46 minutes (based on Trakt's expiry window)
  private scrobbledTimestamps: Map<string, number> = new Map();

  // Track currently watching sessions to avoid duplicate starts// Sync debouncing - Optimized for real-time updates
  private currentlyWatching: Set<string> = new Set();
  private lastSyncTimes: Map<string, number> = new Map();
  private readonly SYNC_DEBOUNCE_MS = 5000; // Reduced from 20000ms to 5000ms for real-time updates

  // Debounce for stop calls - Optimized for responsiveness
  private lastStopCalls: Map<string, number> = new Map();
  private readonly STOP_DEBOUNCE_MS = 1000; // Reduced from 3000ms to 1000ms for better responsiveness

  // Default completion threshold (overridden by user settings)
  private readonly DEFAULT_COMPLETION_THRESHOLD = 80; // 80%

  private constructor() {
    // Increased cleanup interval from 5 minutes to 15 minutes to reduce heating
    setInterval(() => this.cleanupOldStopCalls(), 15 * 60 * 1000); // Clean up every 15 minutes

    // Add AppState cleanup to reduce memory pressure
    AppState.addEventListener('change', this.handleAppStateChange);

    // Load user settings
    this.loadCompletionThreshold();
  }

  /**
   * Load user-configured completion threshold from AsyncStorage
   */
  private async loadCompletionThreshold(): Promise<void> {
    try {
      const thresholdStr = await mmkvStorage.getItem('@trakt_completion_threshold');
      if (thresholdStr) {
        const threshold = parseInt(thresholdStr, 10);
        if (!isNaN(threshold) && threshold >= 50 && threshold <= 100) {
          logger.log(`[TraktService] Loaded user completion threshold: ${threshold}%`);
          this.completionThreshold = threshold;
        }
      }
    } catch (error) {
      logger.error('[TraktService] Error loading completion threshold:', error);
    }
  }

  /**
   * Get the current completion threshold (user-configured or default)
   */
  public get completionThreshold(): number {
    return this._completionThreshold || this.DEFAULT_COMPLETION_THRESHOLD;
  }

  /**
   * Set the completion threshold
   */
  public set completionThreshold(value: number) {
    this._completionThreshold = value;
  }

  // Backing field for completion threshold
  private _completionThreshold: number | null = null;

  /**
   * Clean up old stop call records to prevent memory leaks
   */
  private cleanupOldStopCalls(): void {
    const now = Date.now();
    let cleanupCount = 0;

    // Remove stop calls older than the debounce window
    for (const [key, timestamp] of this.lastStopCalls.entries()) {
      if (now - timestamp > this.STOP_DEBOUNCE_MS) {
        this.lastStopCalls.delete(key);
        cleanupCount++;
      }
    }

    // Also clean up old scrobbled timestamps
    for (const [key, timestamp] of this.scrobbledTimestamps.entries()) {
      if (now - timestamp > this.SCROBBLE_EXPIRY_MS) {
        this.scrobbledTimestamps.delete(key);
        this.scrobbledItems.delete(key);
        cleanupCount++;
      }
    }

    // Clean up old sync times that haven't been updated in a while
    for (const [key, timestamp] of this.lastSyncTimes.entries()) {
      if (now - timestamp > 24 * 60 * 60 * 1000) { // 24 hours
        this.lastSyncTimes.delete(key);
        cleanupCount++;
      }
    }

    // Skip verbose cleanup logging to reduce CPU load
  }

  public static getInstance(): TraktService {
    if (!TraktService.instance) {
      TraktService.instance = new TraktService();
    }
    return TraktService.instance;
  }

  /**
   * Initialize the Trakt service by loading stored tokens
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const [accessToken, refreshToken, tokenExpiry] = await Promise.all([
        mmkvStorage.getItem(TRAKT_ACCESS_TOKEN_KEY),
        mmkvStorage.getItem(TRAKT_REFRESH_TOKEN_KEY),
        mmkvStorage.getItem(TRAKT_TOKEN_EXPIRY_KEY)
      ]);

      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.tokenExpiry = tokenExpiry ? parseInt(tokenExpiry, 10) : 0;
      this.isInitialized = true;

      logger.log('[TraktService] Initialized, authenticated:', !!this.accessToken);
    } catch (error) {
      logger.error('[TraktService] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Check if the user is authenticated with Trakt
   */
  public async isAuthenticated(): Promise<boolean> {
    // During maintenance, report as not authenticated to disable all syncing
    if (this.isMaintenanceMode()) {
      logger.log('[TraktService] Maintenance mode: reporting as not authenticated');
      return false;
    }

    await this.ensureInitialized();

    if (!this.accessToken) {
      return false;
    }

    // Check if token is expired and needs refresh
    if (this.tokenExpiry && this.tokenExpiry < Date.now() && this.refreshToken) {
      try {
        await this.refreshAccessToken();
        return !!this.accessToken;
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Get the authentication URL for Trakt OAuth
   */
  public getAuthUrl(): string {
    return `https://trakt.tv/oauth/authorize?response_type=code&client_id=${TRAKT_CLIENT_ID}&redirect_uri=${encodeURIComponent(TRAKT_REDIRECT_URI)}`;
  }

  /**
   * Exchange the authorization code for an access token
   */
  public async exchangeCodeForToken(code: string, codeVerifier: string): Promise<boolean> {
    // Block authentication during maintenance
    if (this.isMaintenanceMode()) {
      logger.warn('[TraktService] Maintenance mode: blocking new authentication');
      return false;
    }

    await this.ensureInitialized();

    try {
      const response = await fetch(`${TRAKT_API_URL}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code,
          client_id: TRAKT_CLIENT_ID,
          client_secret: TRAKT_CLIENT_SECRET,
          redirect_uri: TRAKT_REDIRECT_URI,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('[TraktService] Token exchange error response:', errorBody);
        throw new Error(`Failed to exchange code: ${response.status}`);
      }

      const data = await response.json();
      await this.saveTokens(data.access_token, data.refresh_token, data.expires_in);
      return true;
    } catch (error) {
      logger.error('[TraktService] Failed to exchange code for token:', error);
      return false;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(`${TRAKT_API_URL}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: this.refreshToken,
          client_id: TRAKT_CLIENT_ID,
          client_secret: TRAKT_CLIENT_SECRET,
          redirect_uri: TRAKT_REDIRECT_URI,
          grant_type: 'refresh_token'
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.status}`);
      }

      const data = await response.json();
      await this.saveTokens(data.access_token, data.refresh_token, data.expires_in);
    } catch (error) {
      logger.error('[TraktService] Failed to refresh token:', error);
      await this.logout(); // Clear tokens if refresh fails
      throw error;
    }
  }

  /**
   * Save authentication tokens to storage
   */
  private async saveTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiry = Date.now() + (expiresIn * 1000);

    try {
      await mmkvStorage.multiSet([
        [TRAKT_ACCESS_TOKEN_KEY, accessToken],
        [TRAKT_REFRESH_TOKEN_KEY, refreshToken],
        [TRAKT_TOKEN_EXPIRY_KEY, this.tokenExpiry.toString()]
      ]);
      logger.log('[TraktService] Tokens saved successfully');
    } catch (error) {
      logger.error('[TraktService] Failed to save tokens:', error);
      throw error;
    }
  }

  /**
   * Log out the user by clearing all tokens
   */
  public async logout(): Promise<void> {
    await this.ensureInitialized();

    try {
      this.accessToken = null;
      this.refreshToken = null;
      this.tokenExpiry = 0;

      await mmkvStorage.multiRemove([
        TRAKT_ACCESS_TOKEN_KEY,
        TRAKT_REFRESH_TOKEN_KEY,
        TRAKT_TOKEN_EXPIRY_KEY
      ]);
      logger.log('[TraktService] Logged out successfully');
    } catch (error) {
      logger.error('[TraktService] Failed to logout:', error);
      throw error;
    }
  }

  /**
   * Ensure the service is initialized before performing operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Make an authenticated API request to Trakt
   */
  private async apiRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: any,
    retryCount: number = 0
  ): Promise<T> {
    // Block all API requests during maintenance
    if (this.isMaintenanceMode()) {
      logger.warn('[TraktService] Maintenance mode: blocking API request to', endpoint);
      throw new Error(TRAKT_MAINTENANCE_MESSAGE);
    }

    await this.ensureInitialized();

    // Rate limiting: ensure minimum interval between API calls
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCall;
    if (timeSinceLastCall < this.MIN_API_INTERVAL) {
      const delay = this.MIN_API_INTERVAL - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    this.lastApiCall = Date.now();

    // Ensure we have a valid token
    if (this.tokenExpiry && this.tokenExpiry < Date.now() && this.refreshToken) {
      await this.refreshAccessToken();
    }

    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID as string,
      'Authorization': `Bearer ${this.accessToken}`
    };

    const options: RequestInit = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${TRAKT_API_URL}${endpoint}`, options);

    // Debug logging removed to reduce terminal noise

    // Handle rate limiting with exponential backoff
    if (response.status === 429) {
      const maxRetries = 3;
      if (retryCount < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s

        logger.log(`[TraktService] Rate limited (429), retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.apiRequest<T>(endpoint, method, body, retryCount + 1);
      } else {
        logger.error(`[TraktService] Rate limited (429), max retries exceeded for ${endpoint}`);
        throw new Error(`API request failed: 429 (Rate Limited)`);
      }
    }

    // Handle 409 conflicts gracefully (already watched/scrobbled)
    if (response.status === 409) {
      const errorText = await response.text();
      logger.log(`[TraktService] Content already scrobbled (409) for ${endpoint}:`, errorText);

      // Parse the error response to get expiry info
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.watched_at && errorData.expires_at) {
          logger.log(`[TraktService] Item was already watched at ${errorData.watched_at}, expires at ${errorData.expires_at}`);

          // If this is a scrobble endpoint, mark the item as already scrobbled
          if (endpoint.includes('/scrobble/') && body) {
            const contentKey = this.getContentKeyFromPayload(body);
            if (contentKey) {
              this.scrobbledItems.add(contentKey);
              this.scrobbledTimestamps.set(contentKey, Date.now());
              logger.log(`[TraktService] Marked content as already scrobbled: ${contentKey}`);
            }
          }

          // Return a success-like response for 409 conflicts
          // This prevents the error from bubbling up and causing retry loops
          return {
            id: 0,
            action: endpoint.includes('/stop') ? 'scrobble' : 'start',
            progress: body?.progress || 0,
            alreadyScrobbled: true
          } as any;
        }
      } catch (parseError) {
        logger.warn(`[TraktService] Could not parse 409 error response: ${parseError}`);
      }

      // Return a graceful response even if we can't parse the error
      return {
        id: 0,
        action: 'conflict',
        progress: 0,
        alreadyScrobbled: true
      } as any;
    }

    if (!response.ok) {
      const errorText = await response.text();

      // Enhanced error logging for debugging
      logger.error(`[TraktService] API Error ${response.status} for ${endpoint}:`, {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        requestBody: body ? JSON.stringify(body, null, 2) : 'No body',
        headers: Object.fromEntries(response.headers.entries())
      });

      // Handle 404 errors more gracefully - they might indicate content not found in Trakt
      if (response.status === 404) {
        logger.warn(`[TraktService] Content not found in Trakt database (404) for ${endpoint}. This might indicate:`);
        logger.warn(`[TraktService] 1. Invalid IMDb ID: ${body?.movie?.ids?.imdb || body?.show?.ids?.imdb || 'N/A'}`);
        logger.warn(`[TraktService] 2. Content not in Trakt database: ${body?.movie?.title || body?.show?.title || 'N/A'}`);
        logger.warn(`[TraktService] 3. Authentication issues with token`);

        // Return a graceful response for 404s instead of throwing
        return {
          id: 0,
          action: 'not_found',
          progress: body?.progress || 0,
          error: 'Content not found in Trakt database'
        } as any;
      }

      throw new Error(`API request failed: ${response.status}`);
    }

    // Handle "No Content" responses (204/205) which have no JSON body
    if (response.status === 204 || response.status === 205) {
      // Return null casted to expected type to satisfy caller's generic
      return null as unknown as T;
    }

    // Some endpoints (e.g., DELETE) may also return empty body with 200. Attempt safe parse.
    let responseData: T;
    try {
      responseData = await response.json() as T;
    } catch (parseError) {
      // If body is empty, return null instead of throwing
      logger.warn(`[TraktService] Empty JSON body for ${endpoint}, returning null`);
      return null as unknown as T;
    }

    // Debug log successful scrobble responses
    if (endpoint.includes('/scrobble/')) {
      // API success logging removed
    }

    return responseData;
  }

  /**
   * Helper method to extract content key from scrobble payload for deduplication
   */
  private getContentKeyFromPayload(payload: any): string | null {
    try {
      if (payload.movie && payload.movie.ids && payload.movie.ids.imdb) {
        return `movie:${payload.movie.ids.imdb}`;
      } else if (payload.episode && payload.show && payload.show.ids && payload.show.ids.imdb) {
        return `episode:${payload.show.ids.imdb}:${payload.episode.season}:${payload.episode.number}`;
      }
    } catch (error) {
      logger.warn('[TraktService] Could not extract content key from payload:', error);
    }
    return null;
  }

  /**
   * Check if content was recently scrobbled to prevent duplicates
   */
  private isRecentlyScrobbled(contentData: TraktContentData): boolean {
    const contentKey = this.getWatchingKey(contentData);

    // Clean up expired entries
    const now = Date.now();
    for (const [key, timestamp] of this.scrobbledTimestamps.entries()) {
      if (now - timestamp > this.SCROBBLE_EXPIRY_MS) {
        this.scrobbledItems.delete(key);
        this.scrobbledTimestamps.delete(key);
      }
    }

    return this.scrobbledItems.has(contentKey);
  }

  /**
   * Get the user's profile information
   */
  public async getUserProfile(): Promise<TraktUser> {
    return this.apiRequest<TraktUser>('/users/me?extended=full');
  }

  /**
   * Get the user's watch stats
   */
  public async getUserStats(): Promise<TraktUserStats> {
    return this.apiRequest<TraktUserStats>('/users/me/stats');
  }

  /**
   * Get the user's watched movies
   */
  public async getWatchedMovies(): Promise<TraktWatchedItem[]> {
    return this.apiRequest<TraktWatchedItem[]>('/sync/watched/movies');
  }

  /**
   * Get the user's watched shows
   */
  public async getWatchedShows(): Promise<TraktWatchedItem[]> {
    return this.apiRequest<TraktWatchedItem[]>('/sync/watched/shows');
  }


  public async isMovieWatchedAccurate(imdbId: string, fallbackImdbId?: string): Promise<boolean> {
    try {
      const normalise = (id: string) => id.startsWith('tt') ? id : `tt${id}`;
      const imdb = normalise(imdbId);
      const fallback = fallbackImdbId && fallbackImdbId !== imdbId && fallbackImdbId.trim()
        ? normalise(fallbackImdbId)
        : null;

      const movies = await this.apiRequest<any[]>('/sync/watched/movies');
      const moviesArray = Array.isArray(movies) ? movies : [];

      return moviesArray.some(
        (m: any) => m.movie?.ids?.imdb === imdb || (fallback && m.movie?.ids?.imdb === fallback)
      );
    } catch (err) {
      logger.warn('[TraktService] Movie watched check failed', err);
      return false;
    }
  }

  public async isEpisodeWatchedAccurate(
    showImdbId: string,
    season: number,
    episode: number,
    fallbackImdbId?: string
  ): Promise<boolean> {
    try {
      if (season === 0) return false;

      const normalise = (id: string) => id.startsWith('tt') ? id : `tt${id}`;
      const isRealImdbId = (id: string) => /^tt\d+$/.test(id) || /^\d{7,}$/.test(id);

      // Use fallback if primary isn't a real IMDb ID
      const resolvedId = isRealImdbId(showImdbId) ? showImdbId
        : (fallbackImdbId && isRealImdbId(fallbackImdbId) ? fallbackImdbId : showImdbId);

      const imdb = normalise(resolvedId);

      const watchedShows = await this.apiRequest<any[]>(
        '/sync/watched/shows'
      );

      const show = watchedShows.find(
        s => s.show?.ids?.imdb === imdb
      );

      if (show) {
        const seasonData = show.seasons?.find(
          (s: any) => s.number === season
        );

        if (
          seasonData?.episodes?.some(
            (e: any) => e.number === episode
          )
        ) {
          return true;
        }
      }

      let page = 1;

      while (true) {
        const history = await this.apiRequest<any[]>(
          `/sync/history/shows/${imdb}?page=${page}&limit=100`
        );

        if (!history.length) break;

        if (
          history.some(
            (h: any) =>
              h.episode?.season === season &&
              h.episode?.number === episode
          )
        ) {
          return true;
        }

        page++;
      }

      return false;
    } catch (err) {
      logger.warn('[TraktService] Episode watched check failed', err);
      return false;
    }
  }

  public async isSeasonCompletedAccurate(
    showImdbId: string,
    seasonNumber: number,
    totalAiredEpisodes: number
  ): Promise<boolean> {
    try {
      if (seasonNumber === 0) return false;
      if (!totalAiredEpisodes || totalAiredEpisodes <= 0) return false;

      const imdb = showImdbId.startsWith('tt')
        ? showImdbId
        : `tt${showImdbId}`;

      const watchedEpisodes = new Set<number>();

      const watchedShows = await this.apiRequest<any[]>(
        '/sync/watched/shows'
      );

      const show = watchedShows.find(
        s => s.show?.ids?.imdb === imdb
      );

      if (show) {
        const season = show.seasons?.find(
          (s: any) => s.number === seasonNumber
        );

        season?.episodes?.forEach(
          (e: any) => watchedEpisodes.add(e.number)
        );
      }

      let page = 1;

      while (true) {
        const history = await this.apiRequest<any[]>(
          `/sync/history/shows/${imdb}?page=${page}&limit=10`
        );

        if (!history.length) break;

        history.forEach((h: any) => {
          if (
            h.episode?.season === seasonNumber &&
            typeof h.episode?.number === 'number'
          ) {
            watchedEpisodes.add(h.episode.number);
          }
        });

        page++;
      }

      return watchedEpisodes.size >= totalAiredEpisodes;
    } catch (err) {
      logger.warn('[TraktService] Season completion check failed', err);
      return false;
    }
  }

  /**
   * Get the user's watchlist movies
   */
  public async getWatchlistMovies(): Promise<TraktWatchlistItem[]> {
    return this.apiRequest<TraktWatchlistItem[]>('/sync/watchlist/movies');
  }

  /**
   * Get the user's watchlist shows
   */
  public async getWatchlistShows(): Promise<TraktWatchlistItem[]> {
    return this.apiRequest<TraktWatchlistItem[]>('/sync/watchlist/shows');
  }

  /**
   * Get the user's collection movies
   */
  public async getCollectionMovies(): Promise<TraktCollectionItem[]> {
    return this.apiRequest<TraktCollectionItem[]>('/sync/collection/movies');
  }

  /**
   * Get the user's collection shows
   */
  public async getCollectionShows(): Promise<TraktCollectionItem[]> {
    return this.apiRequest<TraktCollectionItem[]>('/sync/collection/shows');
  }

  /**
   * Get the user's ratings
   */
  public async getRatings(type?: 'movies' | 'shows'): Promise<TraktRatingItem[]> {
    const endpoint = type ? `/sync/ratings/${type}` : '/sync/ratings';
    return this.apiRequest<TraktRatingItem[]>(endpoint);
  }

  /**
   * Get the user's watched movies with images
   */
  public async getWatchedMoviesWithImages(): Promise<TraktWatchedItem[]> {
    return this.apiRequest<TraktWatchedItem[]>('/sync/watched/movies?extended=images');
  }

  /**
   * Get the user's watched shows with images
   */
  public async getWatchedShowsWithImages(): Promise<TraktWatchedItem[]> {
    return this.apiRequest<TraktWatchedItem[]>('/sync/watched/shows?extended=images');
  }

  /**
   * Get the user's watchlist movies with images
   */
  public async getWatchlistMoviesWithImages(): Promise<TraktWatchlistItem[]> {
    return this.apiRequest<TraktWatchlistItem[]>('/sync/watchlist/movies?extended=images');
  }

  /**
   * Get the user's watchlist shows with images
   */
  public async getWatchlistShowsWithImages(): Promise<TraktWatchlistItem[]> {
    return this.apiRequest<TraktWatchlistItem[]>('/sync/watchlist/shows?extended=images');
  }

  /**
   * Get the user's collection movies with images
   */
  public async getCollectionMoviesWithImages(): Promise<TraktCollectionItem[]> {
    return this.apiRequest<TraktCollectionItem[]>('/sync/collection/movies?extended=images');
  }

  /**
   * Get the user's collection shows with images
   */
  public async getCollectionShowsWithImages(): Promise<TraktCollectionItem[]> {
    return this.apiRequest<TraktCollectionItem[]>('/sync/collection/shows?extended=images');
  }

  /**
   * Get the user's ratings with images
   */
  public async getRatingsWithImages(type?: 'movies' | 'shows'): Promise<TraktRatingItem[]> {
    const endpoint = type ? `/sync/ratings/${type}?extended=images` : '/sync/ratings?extended=images';
    return this.apiRequest<TraktRatingItem[]>(endpoint);
  }

  /**
   * Get playback progress with images
   */
  public async getPlaybackProgressWithImages(type?: 'movies' | 'shows'): Promise<TraktPlaybackItem[]> {
    try {
      const endpoint = type ? `/sync/playback/${type}?extended=images` : '/sync/playback?extended=images';
      return this.apiRequest<TraktPlaybackItem[]>(endpoint);
    } catch (error) {
      logger.error('[TraktService] Failed to get playback progress with images:', error);
      return [];
    }
  }

  /**
   * Extract poster URL from Trakt images
   */
  public static getTraktPosterUrl(images?: TraktImages): string | null {
    if (!images || !images.poster || images.poster.length === 0) {
      return null;
    }

    // Get the first poster and add https prefix
    const posterPath = images.poster[0];
    return posterPath.startsWith('http') ? posterPath : `https://${posterPath}`;
  }

  /**
   * Extract fanart URL from Trakt images
   */
  public static getTraktFanartUrl(images?: TraktImages): string | null {
    if (!images || !images.fanart || images.fanart.length === 0) {
      return null;
    }

    // Get the first fanart and add https prefix
    const fanartPath = images.fanart[0];
    return fanartPath.startsWith('http') ? fanartPath : `https://${fanartPath}`;
  }

  /**
   * Get trakt id from IMDb id
   */
  public async getTraktIdFromImdbId(imdbId: string, type: 'movie' | 'show'): Promise<number | null> {
    try {
      // Ensure IMDb ID has the 'tt' prefix - Trakt API requires it for exact matches
      const fullImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

      logger.log(`[TraktService] Searching Trakt for ${type} with IMDb ID: ${fullImdbId}`);

      // Use the correct Trakt API endpoint for exact IMDb ID lookup: /search/imdb/{id}
      // This returns exact matches instead of a general search
      const searchUrl = `${TRAKT_API_URL}/search/imdb/${fullImdbId}?type=${type}`;

      try {
        logger.log(`[TraktService] Trying search URL: ${searchUrl}`);

        const response = await fetch(searchUrl, {
          headers: {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': TRAKT_CLIENT_ID
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.warn(`[TraktService] Search attempt failed (${response.status}): ${errorText}`);
          return null;
        }

        const data = await response.json();
        logger.log(`[TraktService] Search response data:`, data);

        if (data && data.length > 0) {
          // Find the result that matches our requested type
          const matchingResult = data.find((item: any) => item.type === type);

          if (matchingResult) {
            const traktId = matchingResult[type]?.ids?.trakt;
            if (traktId) {
              // logger.log(`[TraktService] Found Trakt ID: ${traktId} for IMDb ID: ${fullImdbId}`);
              return traktId;
            }
          }

          // Fallback: try the first result if type filtering didn't work
          const traktId = data[0][type]?.ids?.trakt;
          if (traktId) {
            // logger.log(`[TraktService] Found Trakt ID (fallback): ${traktId} for IMDb ID: ${fullImdbId}`);
            return traktId;
          }
        }
      } catch (urlError) {
        logger.warn(`[TraktService] URL attempt failed:`, urlError);
      }

      logger.warn(`[TraktService] No results found for IMDb ID: ${fullImdbId}`);
      return null;
    } catch (error) {
      logger.error('[TraktService] Failed to get Trakt ID from IMDb ID:', error);
      return null;
    }
  }

  /**
   * Add a movie to user's watched history
   */
  public async addToWatchedMovies(imdbId: string, watchedAt: Date = new Date()): Promise<boolean> {
    try {
      const traktId = await this.getTraktIdFromImdbId(imdbId, 'movie');
      if (!traktId) {
        return false;
      }

      await this.apiRequest('/sync/history', 'POST', {
        movies: [
          {
            ids: {
              trakt: traktId
            },
            watched_at: watchedAt.toISOString()
          }
        ]
      });
      return true;
    } catch (error) {
      logger.error('[TraktService] Failed to mark movie as watched:', error);
      return false;
    }
  }

  /**
   * Add a show episode to user's watched history
   */
  public async addToWatchedEpisodes(
    imdbId: string,
    season: number,
    episode: number,
    watchedAt: Date = new Date(),
    fallbackImdbId?: string
  ): Promise<boolean> {
    try {
      const isImdbFormat = (id: string) => /^tt\d+$/.test(id) || /^\d{7,}$/.test(id);
      const resolvedId = isImdbFormat(imdbId) ? imdbId
        : (fallbackImdbId && isImdbFormat(fallbackImdbId) ? fallbackImdbId : imdbId);

      if (resolvedId !== imdbId) {
        logger.log(`[TraktService] addToWatchedEpisodes: falling back from "${imdbId}" to "${resolvedId}"`);
      }

      const traktId = await this.getTraktIdFromImdbId(resolvedId, 'show');
      if (!traktId) {
        logger.warn(`[TraktService] Could not find Trakt ID for show: ${resolvedId}`);
        return false;
      }

      logger.log(`[TraktService] Marking S${season}E${episode} as watched for show ${resolvedId} (trakt: ${traktId})`);

      // Use shows array with seasons/episodes structure per Trakt API docs
      await this.apiRequest('/sync/history', 'POST', {
        shows: [
          {
            ids: {
              trakt: traktId
            },
            seasons: [
              {
                number: season,
                episodes: [
                  {
                    number: episode,
                    watched_at: watchedAt.toISOString()
                  }
                ]
              }
            ]
          }
        ]
      });
      logger.log(`[TraktService] Successfully marked S${season}E${episode} as watched`);
      return true;
    } catch (error) {
      logger.error('[TraktService] Failed to mark episode as watched:', error);
      return false;
    }
  }

  /**
   * Mark an entire season as watched on Trakt
   * @param imdbId - The IMDb ID of the show
   * @param season - The season number to mark as watched
   * @param watchedAt - Optional date when watched (defaults to now)
   */
  public async markSeasonAsWatched(
    imdbId: string,
    season: number,
    watchedAt: Date = new Date(),
    fallbackImdbId?: string
  ): Promise<boolean> {
    try {
      const isImdbFormat = (id: string) => /^tt\d+$/.test(id) || /^\d{7,}$/.test(id);
      const resolvedId = isImdbFormat(imdbId) ? imdbId
        : (fallbackImdbId && isImdbFormat(fallbackImdbId) ? fallbackImdbId : imdbId);
      if (resolvedId !== imdbId) logger.log(`[TraktService] markSeasonAsWatched: falling back from "${imdbId}" to "${resolvedId}"`);

      const traktId = await this.getTraktIdFromImdbId(resolvedId, 'show');
      if (!traktId) {
        logger.warn(`[TraktService] Could not find Trakt ID for show: ${resolvedId}`);
        return false;
      }

      logger.log(`[TraktService] Marking entire season ${season} as watched for show ${resolvedId} (trakt: ${traktId})`);

      // Mark entire season - Trakt will mark all episodes in the season
      await this.apiRequest('/sync/history', 'POST', {
        shows: [
          {
            ids: {
              trakt: traktId
            },
            seasons: [
              {
                number: season,
                watched_at: watchedAt.toISOString()
              }
            ]
          }
        ]
      });
      logger.log(`[TraktService] Successfully marked season ${season} as watched`);
      return true;
    } catch (error) {
      logger.error('[TraktService] Failed to mark season as watched:', error);
      return false;
    }
  }

  /**
   * Mark multiple episodes as watched on Trakt (batch operation)
   * @param imdbId - The IMDb ID of the show
   * @param episodes - Array of episodes to mark as watched
   * @param watchedAt - Optional date when watched (defaults to now)
   */
  public async markEpisodesAsWatched(
    imdbId: string,
    episodes: Array<{ season: number; episode: number }>,
    watchedAt: Date = new Date(),
    fallbackImdbId?: string
  ): Promise<boolean> {
    try {
      if (episodes.length === 0) {
        logger.warn('[TraktService] No episodes provided to mark as watched');
        return false;
      }

      const isImdbFormat = (id: string) => /^tt\d+$/.test(id) || /^\d{7,}$/.test(id);
      const resolvedId = isImdbFormat(imdbId) ? imdbId
        : (fallbackImdbId && isImdbFormat(fallbackImdbId) ? fallbackImdbId : imdbId);
      if (resolvedId !== imdbId) logger.log(`[TraktService] markEpisodesAsWatched: falling back from "${imdbId}" to "${resolvedId}"`);

      const traktId = await this.getTraktIdFromImdbId(resolvedId, 'show');
      if (!traktId) {
        logger.warn(`[TraktService] Could not find Trakt ID for show: ${resolvedId}`);
        return false;
      }

      logger.log(`[TraktService] Marking ${episodes.length} episodes as watched for show ${resolvedId}`);

      // Group episodes by season for the API call
      const seasonMap = new Map<number, Array<{ number: number; watched_at: string }>>();
      for (const ep of episodes) {
        if (!seasonMap.has(ep.season)) {
          seasonMap.set(ep.season, []);
        }
        seasonMap.get(ep.season)!.push({
          number: ep.episode,
          watched_at: watchedAt.toISOString()
        });
      }

      const seasons = Array.from(seasonMap.entries()).map(([seasonNum, eps]) => ({
        number: seasonNum,
        episodes: eps
      }));

      await this.apiRequest('/sync/history', 'POST', {
        shows: [
          {
            ids: {
              trakt: traktId
            },
            seasons
          }
        ]
      });
      logger.log(`[TraktService] Successfully marked ${episodes.length} episodes as watched`);
      return true;
    } catch (error) {
      logger.error('[TraktService] Failed to mark episodes as watched:', error);
      return false;
    }
  }

  /**
   * Mark entire show as watched on Trakt (all seasons and episodes)
   * @param imdbId - The IMDb ID of the show
   * @param watchedAt - Optional date when watched (defaults to now)
   */
  public async markShowAsWatched(
    imdbId: string,
    watchedAt: Date = new Date()
  ): Promise<boolean> {
    try {
      const traktId = await this.getTraktIdFromImdbId(imdbId, 'show');
      if (!traktId) {
        logger.warn(`[TraktService] Could not find Trakt ID for show: ${imdbId}`);
        return false;
      }

      logger.log(`[TraktService] Marking entire show as watched: ${imdbId} (trakt: ${traktId})`);

      // Mark entire show - Trakt will mark all episodes
      await this.apiRequest('/sync/history', 'POST', {
        shows: [
          {
            ids: {
              trakt: traktId
            },
            watched_at: watchedAt.toISOString()
          }
        ]
      });
      logger.log(`[TraktService] Successfully marked entire show as watched`);
      return true;
    } catch (error) {
      logger.error('[TraktService] Failed to mark show as watched:', error);
      return false;
    }
  }

  /**
   * Remove an entire season from watched history on Trakt
   * @param imdbId - The IMDb ID of the show
   * @param season - The season number to remove from history
   */
  public async removeSeasonFromHistory(
    imdbId: string,
    season: number,
    fallbackImdbId?: string
  ): Promise<boolean> {
    try {
      logger.log(`[TraktService] Removing season ${season} from history for show: ${imdbId}`);

      const isImdbFormat = (id: string) => /^tt\d+$/.test(id) || /^\d{7,}$/.test(id);
      const resolvedId = (!isImdbFormat(imdbId) && fallbackImdbId && isImdbFormat(fallbackImdbId))
        ? fallbackImdbId
        : imdbId;

      const fullImdbId = resolvedId.startsWith('tt') ? resolvedId : `tt${resolvedId}`;

      const payload: TraktHistoryRemovePayload = {
        shows: [
          {
            ids: {
              imdb: fullImdbId
            },
            seasons: [
              {
                number: season
              }
            ]
          }
        ]
      };

      logger.log(`[TraktService] Sending removeSeasonFromHistory payload:`, JSON.stringify(payload, null, 2));

      const result = await this.removeFromHistory(payload);

      if ((result === null || result.deleted.episodes === 0) && fallbackImdbId && fallbackImdbId !== resolvedId && isImdbFormat(fallbackImdbId)) {
        logger.log(`[TraktService] removeSeasonFromHistory: retrying with fallback ID "${fallbackImdbId}"`);
        const fb = fallbackImdbId.startsWith('tt') ? fallbackImdbId : `tt${fallbackImdbId}`;
        const fallbackResult = await this.removeFromHistory({
          shows: [{ ids: { imdb: fb }, seasons: [{ number: season }] }]
        });
        if (fallbackResult) {
          logger.log(`[TraktService] Season removal success via fallback: ${fallbackResult.deleted.episodes} episodes deleted`);
          return fallbackResult.deleted.episodes > 0;
        }
        return false;
      }

      if (result) {
        const success = result.deleted.episodes > 0;
        logger.log(`[TraktService] Season removal success: ${success} (${result.deleted.episodes} episodes deleted)`);
        return success;
      }

      logger.log(`[TraktService] No result from removeSeasonFromHistory`);
      return false;
    } catch (error) {
      logger.error('[TraktService] Failed to remove season from history:', error);
      return false;
    }
  }

  /**
   * Check if a movie is in user's watched history
   */
  public async isMovieWatched(imdbId: string): Promise<boolean> {
    try {
      if (!this.accessToken) {
        return false;
      }

      const traktId = await this.getTraktIdFromImdbId(imdbId, 'movie');
      if (!traktId) {
        return false;
      }

      const response = await this.apiRequest<any[]>(`/sync/history/movies/${traktId}`);
      return response.length > 0;
    } catch (error) {
      logger.error('[TraktService] Failed to check if movie is watched:', error);
      return false;
    }
  }

  /**
   * Check if a show episode is in user's watched history
   */
  public async isEpisodeWatched(
    imdbId: string,
    season: number,
    episode: number
  ): Promise<boolean> {
    try {
      if (!this.accessToken) {
        return false;
      }

      const traktId = await this.getTraktIdFromImdbId(imdbId, 'show');
      if (!traktId) {
        return false;
      }

      const response = await this.apiRequest<any[]>(
        `/sync/history/episodes/${traktId}?season=${season}&episode=${episode}`
      );
      return response.length > 0;
    } catch (error) {
      logger.error('[TraktService] Failed to check if episode is watched:', error);
      return false;
    }
  }

  /**
   * Get current playback progress from Trakt
   */
  public async getPlaybackProgress(type?: 'movies' | 'shows'): Promise<TraktPlaybackItem[]> {
    try {
      const endpoint = type ? `/sync/playback/${type}` : '/sync/playback';
      return this.apiRequest<TraktPlaybackItem[]>(endpoint);
    } catch (error) {
      logger.error('[TraktService] Failed to get playback progress:', error);
      return [];
    }
  }

  /**
   * Start watching content (scrobble start)
   */
  public async startWatching(contentData: TraktContentData, progress: number): Promise<TraktScrobbleResponse | null> {
    try {
      // Validate content data before making API call
      const validation = this.validateContentData(contentData);
      if (!validation.isValid) {
        logger.error('[TraktService] Invalid content data for start watching:', validation.errors);
        return null;
      }

      const payload = await this.buildScrobblePayload(contentData, progress);
      if (!payload) {
        return null;
      }

      return this.apiRequest<TraktScrobbleResponse>('/scrobble/start', 'POST', payload);
    } catch (error) {
      logger.error('[TraktService] Failed to start watching:', error);
      return null;
    }
  }

  /**
   * Pause watching content - saves playback progress
   * 
   * NOTE: Trakt API does NOT have a /scrobble/pause endpoint.
   * Instead, /scrobble/stop handles both cases:
   * - Progress 1-79%: Treated as "pause", saves playback progress to /sync/playback
   * - Progress ≥80%: Treated as "scrobble", marks as watched
   * 
   * This method uses /scrobble/stop which automatically handles the pause/scrobble logic.
   */
  public async pauseWatching(contentData: TraktContentData, progress: number): Promise<TraktScrobbleResponse | null> {
    try {
      // Validate content data before making API call
      const validation = this.validateContentData(contentData);
      if (!validation.isValid) {
        logger.error('[TraktService] Invalid content data for pause watching:', validation.errors);
        return null;
      }

      const payload = await this.buildScrobblePayload(contentData, progress);
      if (!payload) {
        return null;
      }

      // Use /scrobble/stop - Trakt automatically treats <80% as pause, ≥80% as scrobble
      return this.apiRequest<TraktScrobbleResponse>('/scrobble/stop', 'POST', payload);
    } catch (error) {
      logger.error('[TraktService] Failed to pause watching:', error);
      return null;
    }
  }

  /**
   * Stop watching content (scrobble stop) - handles completion logic
   */
  public async stopWatching(contentData: TraktContentData, progress: number): Promise<TraktScrobbleResponse | null> {
    try {
      // Validate content data before making API call
      const validation = this.validateContentData(contentData);
      if (!validation.isValid) {
        logger.error('[TraktService] Invalid content data for stop watching:', validation.errors);
        return null;
      }

      const payload = await this.buildScrobblePayload(contentData, progress);
      if (!payload) {
        return null;
      }

      return this.apiRequest<TraktScrobbleResponse>('/scrobble/stop', 'POST', payload);
    } catch (error) {
      logger.error('[TraktService] Failed to stop watching:', error);
      return null;
    }
  }

  /**
   * Update watching progress or mark as complete (legacy method)
   * @deprecated Use specific methods: startWatching, pauseWatching, stopWatching
   */
  public async updateProgress(contentData: TraktContentData, progress: number): Promise<TraktScrobbleResponse | null> {
    // For backwards compatibility, use stop for now
    return this.stopWatching(contentData, progress);
  }

  /**
   * Validate content data before making API calls.
   *
   * IMDb ID validation is intentionally lenient: a non-IMDb provider ID (e.g. "kitsu:123")
   * is allowed through with a warning. Trakt can still scrobble via title + season/episode.
   * A truly empty ID is still blocked.
   */
  private validateContentData(contentData: TraktContentData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!contentData.type || !['movie', 'episode'].includes(contentData.type)) {
      errors.push('Invalid content type');
    }

    if (!contentData.title || contentData.title.trim() === '') {
      errors.push('Missing or empty title');
    }

    // Block only truly empty IDs — non-IMDb provider IDs are allowed (warn, don't fail)
    if (!contentData.imdbId || contentData.imdbId.trim() === '') {
      errors.push('Missing or empty IMDb ID');
    } else if (!/^tt\d+$/.test(contentData.imdbId) && !/^\d{7,}$/.test(contentData.imdbId)) {
      logger.warn(`[TraktService] imdbId "${contentData.imdbId}" is not a standard IMDb ID — Trakt will match by title/season/episode`);
    }

    if (contentData.type === 'episode') {
      if (!contentData.season || contentData.season < 1) {
        errors.push('Invalid season number');
      }
      if (!contentData.episode || contentData.episode < 1) {
        errors.push('Invalid episode number');
      }
      if (!contentData.showTitle || contentData.showTitle.trim() === '') {
        errors.push('Missing or empty show title');
      }
      // showYear is intentionally not required — Trakt can match episodes by
      // show title + season + episode number alone. Anime and many non-Western
      // shows often have year=0 or missing; blocking scrobble for them is wrong.
      if (contentData.showYear !== undefined && contentData.showYear > 0 && contentData.showYear < 1900) {
        logger.warn(`[TraktService] showYear ${contentData.showYear} looks invalid, omitting from payload`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Build scrobble payload for API requests
   * Returns null if required data is missing or invalid
   */
  private async buildScrobblePayload(contentData: TraktContentData, progress: number): Promise<any | null> {
    try {
      // Clamp progress between 0 and 100 and round to 2 decimals for API
      const clampedProgress = Math.min(100, Math.max(0, Math.round(progress * 100) / 100));

      // Helper function to validate year
      const isValidYear = (year: number | undefined): year is number => {
        if (year === undefined || year === null) return false;
        if (typeof year !== 'number' || isNaN(year)) return false;
        // Year must be between 1800 and current year + 10
        const currentYear = new Date().getFullYear();
        return year > 0 && year >= 1800 && year <= currentYear + 10;
      };

      // Helper function to validate title
      const isValidTitle = (title: string | undefined): title is string => {
        return typeof title === 'string' && title.trim().length > 0;
      };

      // Enhanced debug logging for payload building
      logger.log('[TraktService] Building scrobble payload:', {
        type: contentData.type,
        title: contentData.title,
        imdbId: contentData.imdbId,
        year: contentData.year,
        season: contentData.season,
        episode: contentData.episode,
        showTitle: contentData.showTitle,
        showYear: contentData.showYear,
        showImdbId: contentData.showImdbId,
        progress: clampedProgress
      });

      if (contentData.type === 'movie') {
        // Validate required movie fields
        if (!contentData.imdbId || contentData.imdbId.trim() === '') {
          logger.error('[TraktService] Missing movie imdbId for scrobbling');
          return null;
        }

        if (!isValidTitle(contentData.title)) {
          logger.error('[TraktService] Missing or empty movie title for scrobbling:', {
            title: contentData.title
          });
          return null;
        }

        const isRealImdbId = /^tt\d+$/.test(contentData.imdbId) || /^\d{7,}$/.test(contentData.imdbId);

        // Build movie payload - only include year if valid
        const movieData: { title: string; year?: number; ids: { imdb?: string } } = {
          title: contentData.title.trim(),
          ids: {}
        };

        // Only add IMDb ID to payload when it's a real IMDb format — sending a provider ID
        // (e.g. "kitsu:123") causes Trakt to fail the lookup. Without it, Trakt matches by title.
        if (isRealImdbId) {
          const imdbIdWithPrefix = contentData.imdbId.startsWith('tt')
            ? contentData.imdbId
            : `tt${contentData.imdbId}`;
          (movieData.ids as any).imdb = imdbIdWithPrefix;
        } else {
          logger.warn(`[TraktService] Movie imdbId "${contentData.imdbId}" is not IMDb format — omitting from scrobble payload, Trakt will match by title`);
        }

        // Only add year if it's valid (prevents year: 0 or invalid years)
        if (isValidYear(contentData.year)) {
          movieData.year = contentData.year;
        } else {
          logger.warn('[TraktService] Movie year is missing or invalid, omitting from payload:', {
            year: contentData.year
          });
        }

        const payload = {
          movie: movieData,
          progress: clampedProgress
        };

        logger.log('[TraktService] Movie payload built:', payload);
        return payload;
      } else if (contentData.type === 'episode') {
        // Validate season and episode numbers
        if (contentData.season === undefined || contentData.season === null || contentData.season < 0) {
          logger.error('[TraktService] Invalid season for episode scrobbling:', {
            season: contentData.season
          });
          return null;
        }

        if (contentData.episode === undefined || contentData.episode === null || contentData.episode <= 0) {
          logger.error('[TraktService] Invalid episode number for scrobbling:', {
            episode: contentData.episode
          });
          return null;
        }

        if (!isValidTitle(contentData.showTitle)) {
          logger.error('[TraktService] Missing or empty show title for episode scrobbling:', {
            showTitle: contentData.showTitle
          });
          return null;
        }

        // Build show data - only include year if valid
        const showData: { title: string; year?: number; ids: { imdb?: string } } = {
          title: contentData.showTitle.trim(),
          ids: {}
        };

        // Only add year if it's valid
        if (isValidYear(contentData.showYear)) {
          showData.year = contentData.showYear;
        } else {
          logger.warn('[TraktService] Show year is missing or invalid, omitting from payload:', {
            showYear: contentData.showYear
          });
        }

        const payload: any = {
          show: showData,
          episode: {
            season: contentData.season,
            number: contentData.episode
          },
          progress: clampedProgress
        };

        // Add show IMDB ID if available and valid IMDb format
        if (contentData.showImdbId && contentData.showImdbId.trim() !== '') {
          const isRealShowImdbId = /^tt\d+$/.test(contentData.showImdbId) || /^\d{7,}$/.test(contentData.showImdbId);
          if (isRealShowImdbId) {
            const showImdbWithPrefix = contentData.showImdbId.startsWith('tt')
              ? contentData.showImdbId
              : `tt${contentData.showImdbId}`;
            payload.show.ids.imdb = showImdbWithPrefix;
          } else {
            logger.warn(`[TraktService] showImdbId "${contentData.showImdbId}" is not IMDb format — omitting from scrobble payload, Trakt will match by title`);
          }
        }

        // Add episode IMDB ID if available (for specific episode IDs)
        if (contentData.imdbId && contentData.imdbId.trim() !== '' && contentData.imdbId !== contentData.showImdbId) {
          const episodeImdbWithPrefix = contentData.imdbId.startsWith('tt')
            ? contentData.imdbId
            : `tt${contentData.imdbId}`;

          if (!payload.episode.ids) {
            payload.episode.ids = {};
          }

          payload.episode.ids.imdb = episodeImdbWithPrefix;
        }

        logger.log('[TraktService] Episode payload built:', payload);
        return payload;
      }

      return null;
    } catch (error) {
      logger.error('[TraktService] Failed to build scrobble payload:', error);
      return null;
    }
  }

  /**
   * Process the request queue with proper rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {
          logger.error('[TraktService] Queue request failed:', error);
        }

        // Wait minimum interval before next request
        if (this.requestQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.MIN_API_INTERVAL));
        }
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Add request to queue for rate-limited processing
   */
  private queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      // Start processing if not already running
      this.processQueue();
    });
  }

  /**
   * Generate a unique key for content being watched
   */
  private getWatchingKey(contentData: TraktContentData): string {
    if (contentData.type === 'movie') {
      return `movie:${contentData.imdbId}`;
    } else {
      return `episode:${contentData.showImdbId || contentData.imdbId}:S${contentData.season}E${contentData.episode}`;
    }
  }

  /**
   * Start watching content (use when playback begins)
   */
  public async scrobbleStart(contentData: TraktContentData, progress: number): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      const watchingKey = this.getWatchingKey(contentData);

      // Check if this content was recently scrobbled (to prevent duplicates from component remounts)
      if (this.isRecentlyScrobbled(contentData)) {
        logger.log(`[TraktService] Content was recently scrobbled, skipping start: ${contentData.title}`);
        return true;
      }

      // ENHANCED PROTECTION: Check if we recently stopped this content with high progress
      // This prevents restarting sessions for content that was just completed
      const lastStopTime = this.lastStopCalls.get(watchingKey);
      if (lastStopTime && (Date.now() - lastStopTime) < 30000) { // 30 seconds
        logger.log(`[TraktService] Recently stopped this content (${((Date.now() - lastStopTime) / 1000).toFixed(1)}s ago), preventing restart: ${contentData.title}`);
        return true;
      }

      // Debug log removed to reduce terminal noise

      // Only start if not already watching this content
      if (this.currentlyWatching.has(watchingKey)) {
        logger.log(`[TraktService] Already watching this content, skipping start: ${contentData.title}`);
        return true; // Already started
      }

      const result = await this.queueRequest(async () => {
        return await this.startWatching(contentData, progress);
      });

      if (result) {
        this.currentlyWatching.add(watchingKey);
        logger.log(`[TraktService] Started watching ${contentData.type}: ${contentData.title}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('[TraktService] Failed to start scrobbling:', error);
      return false;
    }
  }

  /**
   * Update progress while watching (use for periodic progress updates)
   */
  public async scrobblePause(contentData: TraktContentData, progress: number, force: boolean = false): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      const now = Date.now();

      const watchingKey = this.getWatchingKey(contentData);
      const lastSync = this.lastSyncTimes.get(watchingKey) || 0;

      // IMMEDIATE SYNC: Remove debouncing for instant sync, only prevent truly rapid calls (< 100ms)
      if (!force && (now - lastSync) < 100) {
        return true; // Skip this sync, but return success
      }

      this.lastSyncTimes.set(watchingKey, now);

      const result = await this.queueRequest(async () => {
        return await this.pauseWatching(contentData, progress);
      });

      if (result) {
        logger.log(`[TraktService] Updated progress ${progress.toFixed(1)}% for ${contentData.type}: ${contentData.title}`);
        return true;
      }

      return false;
    } catch (error) {
      // Handle rate limiting errors more gracefully
      if (error instanceof Error && error.message.includes('429')) {
        logger.warn('[TraktService] Rate limited, will retry later');
        return true; // Return success to avoid error spam
      }

      logger.error('[TraktService] Failed to update progress:', error);
      return false;
    }
  }

  /**
   * Stop watching content (use when playback ends or stops)
   */
  public async scrobbleStop(contentData: TraktContentData, progress: number): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      const watchingKey = this.getWatchingKey(contentData);
      const now = Date.now();

      // IMMEDIATE SYNC: Reduce debouncing for instant sync, only prevent truly duplicate calls (< 1 second)
      const lastStopTime = this.lastStopCalls.get(watchingKey);
      if (lastStopTime && (now - lastStopTime) < 1000) {
        logger.log(`[TraktService] Ignoring duplicate stop call for ${contentData.title} (last stop ${((now - lastStopTime) / 1000).toFixed(1)}s ago)`);
        return true; // Return success to avoid error handling
      }

      // Record this stop attempt
      this.lastStopCalls.set(watchingKey, now);

      // Use pause if below user threshold, stop only when ready to scrobble
      const useStop = progress >= this.completionThreshold;
      const result = await this.queueRequest(async () => {
        return useStop
          ? await this.stopWatching(contentData, progress)
          : await this.pauseWatching(contentData, progress);
      });

      if (result) {
        this.currentlyWatching.delete(watchingKey);

        // Mark as scrobbled if >= user threshold to prevent future duplicates and restarts
        if (progress >= this.completionThreshold) {
          this.scrobbledItems.add(watchingKey);
          this.scrobbledTimestamps.set(watchingKey, Date.now());
          logger.log(`[TraktService] Marked as scrobbled to prevent restarts: ${watchingKey}`);
        }

        // Action reflects actual endpoint used based on user threshold
        const action = progress >= this.completionThreshold ? 'scrobbled' : 'paused';
        logger.log(`[TraktService] Stopped watching ${contentData.type}: ${contentData.title} (${progress.toFixed(1)}% - ${action})`);

        return true;
      } else {
        // If failed, remove from lastStopCalls so we can try again
        this.lastStopCalls.delete(watchingKey);
      }

      return false;
    } catch (error) {
      // Handle rate limiting errors more gracefully
      if (error instanceof Error && error.message.includes('429')) {
        logger.warn('[TraktService] Rate limited, will retry later');
        return true;
      }

      logger.error('[TraktService] Failed to stop scrobbling:', error);
      return false;
    }
  }

  /**
   * IMMEDIATE SCROBBLE METHODS - Bypass rate limiting queue for critical user actions
   */

  /**
   * Immediate scrobble pause - bypasses queue for instant user feedback
   */
  public async scrobblePauseImmediate(contentData: TraktContentData, progress: number): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      const watchingKey = this.getWatchingKey(contentData);

      // MINIMAL DEDUPLICATION: Only prevent calls within 50ms for immediate actions
      const lastSync = this.lastSyncTimes.get(watchingKey) || 0;
      if ((Date.now() - lastSync) < 50) {
        return true; // Skip this sync, but return success
      }

      this.lastSyncTimes.set(watchingKey, Date.now());

      // BYPASS QUEUE: Call API directly for immediate response
      const result = await this.pauseWatching(contentData, progress);

      if (result) {
        logger.log(`[TraktService] IMMEDIATE: Updated progress ${progress.toFixed(1)}% for ${contentData.type}: ${contentData.title}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('[TraktService] Failed to pause scrobbling immediately:', error);
      return false;
    }
  }

  /**
   * Immediate scrobble stop - bypasses queue for instant user feedback
   */
  public async scrobbleStopImmediate(contentData: TraktContentData, progress: number): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      const watchingKey = this.getWatchingKey(contentData);

      // MINIMAL DEDUPLICATION: Only prevent calls within 200ms for immediate actions
      const lastStopTime = this.lastStopCalls.get(watchingKey);
      if (lastStopTime && (Date.now() - lastStopTime) < 200) {
        return true;
      }

      this.lastStopCalls.set(watchingKey, Date.now());

      // BYPASS QUEUE: Use pause if below user threshold, stop only when ready to scrobble
      const useStop = progress >= this.completionThreshold;
      const result = useStop
        ? await this.stopWatching(contentData, progress)
        : await this.pauseWatching(contentData, progress);

      if (result) {
        this.currentlyWatching.delete(watchingKey);

        // Mark as scrobbled if >= user threshold to prevent future duplicates and restarts
        if (progress >= this.completionThreshold) {
          this.scrobbledItems.add(watchingKey);
          this.scrobbledTimestamps.set(watchingKey, Date.now());
        }

        // Action reflects actual endpoint used based on user threshold
        const action = progress >= this.completionThreshold ? 'scrobbled' : 'paused';
        logger.log(`[TraktService] IMMEDIATE: Stopped watching ${contentData.type}: ${contentData.title} (${progress.toFixed(1)}% - ${action})`);

        return true;
      }

      return false;
    } catch (error) {
      logger.error('[TraktService] Failed to stop scrobbling immediately:', error);
      return false;
    }
  }

  /**
   * Legacy sync method - now delegates to proper scrobble methods
   * @deprecated Use scrobbleStart, scrobblePause, scrobbleStop instead
   */
  public async syncProgressToTrakt(
    contentData: TraktContentData,
    progress: number,
    force: boolean = false
  ): Promise<boolean> {
    // For backward compatibility, treat as a pause update
    return this.scrobblePause(contentData, progress, force);
  }

  /**
   * Debug method to test Trakt API connection and scrobble functionality
   */
  public async debugTraktConnection(): Promise<any> {
    try {
      logger.log('[TraktService] Testing Trakt API connection...');

      // Test basic API access
      const userResponse = await this.apiRequest('/users/me', 'GET');
      logger.log('[TraktService] User info:', userResponse);

      // Test a minimal scrobble start to verify API works
      const testPayload = {
        movie: {
          title: "Test Movie",
          year: 2023,
          ids: {
            imdb: "1234567"  // Fake IMDB ID for testing
          }
        },
        progress: 1.0
      };

      logger.log('[TraktService] Testing scrobble/start endpoint with test payload...');
      const scrobbleResponse = await this.apiRequest('/scrobble/start', 'POST', testPayload);
      logger.log('[TraktService] Scrobble test response:', scrobbleResponse);

      return {
        authenticated: true,
        user: userResponse,
        scrobbleTest: scrobbleResponse
      };
    } catch (error) {
      logger.error('[TraktService] Debug connection failed:', error);
      return {
        authenticated: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Debug method to check current playback progress on Trakt
   */
  public async debugPlaybackProgress(): Promise<void> {
    try {
      if (!await this.isAuthenticated()) {
        // Debug logging removed
        return;
      }

      const progress = await this.getPlaybackProgress();
      // Progress logging removed

      progress.forEach((item, index) => {
        if (item.type === 'movie' && item.movie) {
          // Movie progress logging removed
        } else if (item.type === 'episode' && item.episode && item.show) {
          // Episode progress logging removed
        }
      });

      if (progress.length === 0) {
        // No progress logging removed
      }
    } catch (error) {
      logger.error('[TraktService] DEBUG: Error fetching playback progress:', error);
    }
  }

  /**
   * Delete a playback progress entry on Trakt by its playback `id`.
   * Returns true if the request succeeded (204).
   */
  public async deletePlaybackItem(playbackId: number): Promise<boolean> {
    try {
      if (!this.accessToken) return false;
      await this.apiRequest<null>(`/sync/playback/${playbackId}`, 'DELETE');
      return true; // trakt returns 204 no-content on success
    } catch (error) {
      logger.error('[TraktService] Failed to delete playback item:', error);
      return false;
    }
  }

  /**
   * Convenience helper: find a playback entry matching imdb id (and optional season/episode) and delete it.
   */
  public async deletePlaybackForContent(imdbId: string, type: 'movie' | 'series', season?: number, episode?: number): Promise<boolean> {
    try {
      logger.log(`🔍 [TraktService] deletePlaybackForContent called for ${type}:${imdbId} (season:${season}, episode:${episode})`);

      if (!this.accessToken) {
        logger.log(`❌ [TraktService] No access token - cannot delete playback`);
        return false;
      }

      logger.log(`🔍 [TraktService] Fetching current playback progress...`);
      const progressItems = await this.getPlaybackProgress();
      logger.log(`📊 [TraktService] Found ${progressItems.length} playback items`);

      const target = progressItems.find(item => {
        if (type === 'movie' && item.type === 'movie' && item.movie?.ids.imdb === imdbId) {
          logger.log(`🎯 [TraktService] Found matching movie: ${item.movie?.title}`);
          return true;
        }
        if (type === 'series' && item.type === 'episode' && item.show?.ids.imdb === imdbId) {
          if (season !== undefined && episode !== undefined) {
            const matches = item.episode?.season === season && item.episode?.number === episode;
            if (matches) {
              logger.log(`🎯 [TraktService] Found matching episode: ${item.show?.title} S${season}E${episode}`);
            }
            return matches;
          }
          logger.log(`🎯 [TraktService] Found matching series episode: ${item.show?.title} S${item.episode?.season}E${item.episode?.number}`);
          return true; // match any episode of the show if specific not provided
        }
        return false;
      });

      if (target) {
        logger.log(`🗑️ [TraktService] Deleting playback item with ID: ${target.id}`);
        const result = await this.deletePlaybackItem(target.id);
        logger.log(`✅ [TraktService] Delete result: ${result}`);
        return result;
      } else {
        logger.log(`ℹ️ [TraktService] No matching playback item found for ${type}:${imdbId}`);
        return false;
      }
    } catch (error) {
      logger.error(`❌ [TraktService] Error deleting playback for content ${type}:${imdbId}:`, error);
      return false;
    }
  }

  public async getWatchedEpisodesHistory(page: number = 1, limit: number = 100): Promise<any[]> {
    await this.ensureInitialized();

    const cacheKey = `history_episodes_${page}_${limit}`;
    const lastSync = this.lastSyncTimes.get(cacheKey) || 0;
    const now = Date.now();
    if (now - lastSync < this.SYNC_DEBOUNCE_MS) {
      // Return cached result if we fetched recently
      return (this as any)[cacheKey] || [];
    }

    const endpoint = `/sync/history/episodes?page=${page}&limit=${limit}`;
    try {
      const data = await this.apiRequest<any[]>(endpoint, 'GET');
      (this as any)[cacheKey] = data;
      this.lastSyncTimes.set(cacheKey, now);
      return data;
    } catch (error) {
      logger.error('[TraktService] Failed to fetch watched episodes history:', error);
      return [];
    }
  }

  /**
   * Remove items from user's watched history
   */
  public async removeFromHistory(payload: TraktHistoryRemovePayload): Promise<TraktHistoryRemoveResponse | null> {
    try {
      logger.log(`🔍 [TraktService] removeFromHistory called with payload:`, JSON.stringify(payload, null, 2));

      if (!await this.isAuthenticated()) {
        logger.log(`❌ [TraktService] Not authenticated for removeFromHistory`);
        return null;
      }

      const result = await this.apiRequest<TraktHistoryRemoveResponse>('/sync/history/remove', 'POST', payload);

      logger.log(`📥 [TraktService] removeFromHistory API response:`, JSON.stringify(result, null, 2));

      return result;
    } catch (error) {
      logger.error('[TraktService] Failed to remove from history:', error);
      return null;
    }
  }

  /**
   * Get user's watch history with optional filtering
   */
  public async getHistory(
    type?: 'movies' | 'shows' | 'episodes',
    id?: number,
    startAt?: Date,
    endAt?: Date,
    page: number = 1,
    limit: number = 100
  ): Promise<TraktHistoryItem[]> {
    try {
      if (!await this.isAuthenticated()) {
        return [];
      }

      let endpoint = '/sync/history';
      if (type) {
        endpoint += `/${type}`;
        if (id) {
          endpoint += `/${id}`;
        }
      }

      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      if (startAt) {
        params.append('start_at', startAt.toISOString());
      }

      if (endAt) {
        params.append('end_at', endAt.toISOString());
      }

      const queryString = params.toString();
      if (queryString) {
        endpoint += `?${queryString}`;
      }

      return this.apiRequest<TraktHistoryItem[]>(endpoint, 'GET');
    } catch (error) {
      logger.error('[TraktService] Failed to get history:', error);
      return [];
    }
  }

  /**
   * Get user's movie watch history
   */
  public async getHistoryMovies(
    startAt?: Date,
    endAt?: Date,
    page: number = 1,
    limit: number = 100
  ): Promise<TraktHistoryItem[]> {
    return this.getHistory('movies', undefined, startAt, endAt, page, limit);
  }

  /**
   * Get user's episode watch history
   */
  public async getHistoryEpisodes(
    startAt?: Date,
    endAt?: Date,
    page: number = 1,
    limit: number = 100
  ): Promise<TraktHistoryItem[]> {
    return this.getHistory('episodes', undefined, startAt, endAt, page, limit);
  }

  /**
   * Get user's show watch history
   */
  public async getHistoryShows(
    startAt?: Date,
    endAt?: Date,
    page: number = 1,
    limit: number = 100
  ): Promise<TraktHistoryItem[]> {
    return this.getHistory('shows', undefined, startAt, endAt, page, limit);
  }

  /**
   * Remove a movie from watched history by IMDB ID.
   * If the primary imdbId is not a valid IMDb ID (e.g. a provider ID like "kitsu:123"),
   * falls back to fallbackImdbId (typically the resolved IMDb ID from metadata).
   */
  public async removeMovieFromHistory(imdbId: string, fallbackImdbId?: string): Promise<boolean> {
    try {
      const isImdbFormat = (id: string) => /^tt\d+$/.test(id) || /^\d{7,}$/.test(id);

      // Resolve which ID to use: prefer a proper IMDb-format ID
      let resolvedId = imdbId;
      if (!isImdbFormat(imdbId) && fallbackImdbId && isImdbFormat(fallbackImdbId) && fallbackImdbId !== imdbId) {
        logger.log(`[TraktService] removeMovieFromHistory: "${imdbId}" is not IMDb format, falling back to "${fallbackImdbId}"`);
        resolvedId = fallbackImdbId;
      }

      const payload: TraktHistoryRemovePayload = {
        movies: [
          {
            ids: {
              imdb: resolvedId.startsWith('tt') ? resolvedId : `tt${resolvedId}`
            }
          }
        ]
      };

      const result = await this.removeFromHistory(payload);

      // If primary attempt deleted nothing and we haven't tried the fallback yet, try it
      if ((result === null || result.deleted.movies === 0) && fallbackImdbId && fallbackImdbId !== imdbId && fallbackImdbId !== resolvedId && isImdbFormat(fallbackImdbId)) {
        logger.log(`[TraktService] removeMovieFromHistory: primary attempt found nothing, retrying with fallback ID "${fallbackImdbId}"`);
        const fallbackPayload: TraktHistoryRemovePayload = {
          movies: [{ ids: { imdb: fallbackImdbId.startsWith('tt') ? fallbackImdbId : `tt${fallbackImdbId}` } }]
        };
        const fallbackResult = await this.removeFromHistory(fallbackPayload);
        return fallbackResult !== null && fallbackResult.deleted.movies > 0;
      }

      return result !== null && result.deleted.movies > 0;
    } catch (error) {
      logger.error('[TraktService] Failed to remove movie from history:', error);
      return false;
    }
  }

  /**
   * Remove an episode from watched history by IMDB IDs
   */
  public async removeEpisodeFromHistory(showImdbId: string, season: number, episode: number, fallbackImdbId?: string): Promise<boolean> {
    try {
      logger.log(`🔍 [TraktService] removeEpisodeFromHistory called for ${showImdbId} S${season}E${episode}`);

      const isImdbFormat = (id: string) => /^tt\d+$/.test(id) || /^\d{7,}$/.test(id);
      const resolvedId = (!isImdbFormat(showImdbId) && fallbackImdbId && isImdbFormat(fallbackImdbId))
        ? fallbackImdbId
        : showImdbId;

      if (resolvedId !== showImdbId) {
        logger.log(`[TraktService] removeEpisodeFromHistory: "${showImdbId}" is not IMDb format, falling back to "${resolvedId}"`);
      }

      const payload: TraktHistoryRemovePayload = {
        shows: [
          {
            ids: {
              imdb: resolvedId.startsWith('tt') ? resolvedId : `tt${resolvedId}`
            },
            seasons: [
              {
                number: season,
                episodes: [
                  {
                    number: episode
                  }
                ]
              }
            ]
          }
        ]
      };

      logger.log(`📤 [TraktService] Sending removeEpisodeFromHistory payload:`, JSON.stringify(payload, null, 2));

      const result = await this.removeFromHistory(payload);

      // If nothing was deleted and we haven't tried the fallback yet, retry with it
      if ((result === null || result.deleted.episodes === 0) && fallbackImdbId && fallbackImdbId !== resolvedId && isImdbFormat(fallbackImdbId)) {
        logger.log(`[TraktService] removeEpisodeFromHistory: retrying with fallback ID "${fallbackImdbId}"`);
        const fallbackPayload: TraktHistoryRemovePayload = {
          shows: [{
            ids: { imdb: fallbackImdbId.startsWith('tt') ? fallbackImdbId : `tt${fallbackImdbId}` },
            seasons: [{ number: season, episodes: [{ number: episode }] }]
          }]
        };
        const fallbackResult = await this.removeFromHistory(fallbackPayload);
        if (fallbackResult) {
          logger.log(`✅ [TraktService] Episode removal success via fallback: ${fallbackResult.deleted.episodes} episodes deleted`);
          return fallbackResult.deleted.episodes > 0;
        }
        return false;
      }

      if (result) {
        const success = result.deleted.episodes > 0;
        logger.log(`✅ [TraktService] Episode removal success: ${success} (${result.deleted.episodes} episodes deleted)`);
        return success;
      }

      logger.log(`❌ [TraktService] No result from removeEpisodeFromHistory`);
      return false;
    } catch (error) {
      logger.error('[TraktService] Failed to remove episode from history:', error);
      return false;
    }
  }

  /**
   * Remove a playback item from Trakt (Continue Watching) by Playback ID
   */
  public async removePlaybackItem(playbackId: number): Promise<boolean> {
    try {
      logger.log(`🔍 [TraktService] removePlaybackItem called for playback ID: ${playbackId}`);
      if (!playbackId) return false;

      // Use DELETE /sync/playback/{id}
      // Note: The ID here is the playback ID, not the movie/episode ID
      await this.apiRequest<any>(`/sync/playback/${playbackId}`, 'DELETE');

      logger.log(`✅ [TraktService] Successfully removed playback item ${playbackId}. Response: 204 No Content (Standard for DELETE)`);
      return true;
    } catch (error) {
      logger.error(`[TraktService] Failed to remove playback item ${playbackId}:`, error);
      return false;
    }
  }

  /**
   * Remove entire show from watched history by IMDB ID
   */
  public async removeShowFromHistory(imdbId: string): Promise<boolean> {
    try {
      logger.log(`🔍 [TraktService] removeShowFromHistory called for ${imdbId}`);

      // First, let's check if this show exists in history
      logger.log(`🔍 [TraktService] Checking if ${imdbId} exists in watch history...`);
      const history = await this.getHistoryEpisodes(undefined, undefined, 1, 200); // Get recent episode history
      const fullImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
      const showInHistory = history.some(item =>
        item.show?.ids?.imdb === fullImdbId
      );

      logger.log(`📊 [TraktService] Show ${imdbId} found in history: ${showInHistory}`);

      if (!showInHistory) {
        logger.log(`ℹ️ [TraktService] Show ${imdbId} not found in watch history - nothing to remove`);
        return true; // Consider this a success since there's nothing to remove
      }

      const payload: TraktHistoryRemovePayload = {
        shows: [
          {
            ids: {
              imdb: imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`
            }
          }
        ]
      };

      logger.log(`📤 [TraktService] Sending removeFromHistory payload:`, JSON.stringify(payload, null, 2));

      const result = await this.removeFromHistory(payload);

      logger.log(`📥 [TraktService] removeFromHistory response:`, JSON.stringify(result, null, 2));

      if (result) {
        const success = result.deleted.episodes > 0;
        logger.log(`✅ [TraktService] Show removal success: ${success} (${result.deleted.episodes} episodes deleted)`);
        return success;
      }

      logger.log(`❌ [TraktService] No response from removeFromHistory API`);
      return false;
    } catch (error) {
      logger.error('[TraktService] Failed to remove show from history:', error);
      return false;
    }
  }

  /**
   * Remove items from history by history IDs
   */
  public async removeHistoryByIds(historyIds: number[]): Promise<boolean> {
    try {
      const payload: TraktHistoryRemovePayload = {
        ids: historyIds
      };

      const result = await this.removeFromHistory(payload);
      return result !== null && (result.deleted.movies > 0 || result.deleted.episodes > 0);
    } catch (error) {
      logger.error('[TraktService] Failed to remove history by IDs:', error);
      return false;
    }
  }

  /**
   * Get trakt id from TMDB id (fallback method)
   */
  public async getTraktIdFromTmdbId(tmdbId: number, type: 'movie' | 'show'): Promise<number | null> {
    try {
      logger.log(`[TraktService] Searching Trakt for ${type} with TMDB ID: ${tmdbId}`);

      const response = await fetch(`${TRAKT_API_URL}/search/${type === 'show' ? 'show' : type}?id_type=tmdb&id=${tmdbId}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`[TraktService] TMDB search failed (${response.status}): ${errorText}`);
        return null;
      }

      const data = await response.json();
      logger.log(`[TraktService] TMDB search response:`, data);
      if (data && data.length > 0) {
        const traktId = data[0][type === 'show' ? 'show' : type]?.ids?.trakt;
        if (traktId) {
          // logger.log(`[TraktService] Found Trakt ID via TMDB: ${traktId} for TMDB ID: ${tmdbId}`);
          return traktId;
        }
      }

      logger.warn(`[TraktService] No TMDB results found for TMDB ID: ${tmdbId}`);
      return null;
    } catch (error) {
      logger.error('[TraktService] Failed to get Trakt ID from TMDB ID:', error);
      return null;
    }
  }

  /**
   * Get comments for a movie
   */
  public async getMovieComments(imdbId: string, tmdbId?: number, page: number = 1, limit: number = 10): Promise<TraktContentComment[]> {
    try {
      let traktId = await this.getTraktIdFromImdbId(imdbId, 'movie');

      // Fallback to TMDB ID if IMDb search failed
      if (!traktId && tmdbId) {
        logger.log(`[TraktService] IMDb search failed, trying TMDB ID: ${tmdbId}`);
        traktId = await this.getTraktIdFromTmdbId(tmdbId, 'movie');
      }

      if (!traktId) {
        logger.warn(`[TraktService] Could not find Trakt ID for movie with IMDb: ${imdbId}, TMDB: ${tmdbId}`);
        return [];
      }

      const endpoint = `/movies/${traktId}/comments?page=${page}&limit=${limit}`;
      const result = await this.apiRequest<TraktContentComment[]>(endpoint, 'GET');
      // console.log(`[TraktService] Movie comments response:`, result);
      return result;
    } catch (error) {
      logger.error('[TraktService] Failed to get movie comments:', error);
      return [];
    }
  }

  /**
   * Get comments for a show
   */
  public async getShowComments(imdbId: string, tmdbId?: number, page: number = 1, limit: number = 10): Promise<TraktContentComment[]> {
    try {
      let traktId = await this.getTraktIdFromImdbId(imdbId, 'show');

      // Fallback to TMDB ID if IMDb search failed
      if (!traktId && tmdbId) {
        logger.log(`[TraktService] IMDb search failed, trying TMDB ID: ${tmdbId}`);
        traktId = await this.getTraktIdFromTmdbId(tmdbId, 'show');
      }

      if (!traktId) {
        logger.warn(`[TraktService] Could not find Trakt ID for show with IMDb: ${imdbId}, TMDB: ${tmdbId}`);
        return [];
      }

      const endpoint = `/shows/${traktId}/comments?page=${page}&limit=${limit}`;
      const result = await this.apiRequest<TraktContentComment[]>(endpoint, 'GET');
      console.log(`[TraktService] Show comments response:`, result);
      return result;
    } catch (error) {
      logger.error('[TraktService] Failed to get show comments:', error);
      return [];
    }
  }

  /**
   * Get comments for a season
   */
  public async getSeasonComments(imdbId: string, season: number, page: number = 1, limit: number = 10): Promise<TraktContentComment[]> {
    try {
      const traktId = await this.getTraktIdFromImdbId(imdbId, 'show');
      if (!traktId) {
        return [];
      }

      const endpoint = `/shows/${traktId}/seasons/${season}/comments?page=${page}&limit=${limit}`;
      return this.apiRequest<TraktContentComment[]>(endpoint, 'GET');
    } catch (error) {
      logger.error('[TraktService] Failed to get season comments:', error);
      return [];
    }
  }

  /**
   * Get comments for an episode
   */
  public async getEpisodeComments(imdbId: string, season: number, episode: number, page: number = 1, limit: number = 10): Promise<TraktContentComment[]> {
    try {
      const traktId = await this.getTraktIdFromImdbId(imdbId, 'show');
      if (!traktId) {
        return [];
      }

      const endpoint = `/shows/${traktId}/seasons/${season}/episodes/${episode}/comments?page=${page}&limit=${limit}`;
      return this.apiRequest<TraktContentComment[]>(endpoint, 'GET');
    } catch (error) {
      logger.error('[TraktService] Failed to get episode comments:', error);
      return [];
    }
  }

  /**
   * Add content to Trakt watchlist
   */
  public async addToWatchlist(imdbId: string, type: 'movie' | 'show'): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      // Ensure IMDb ID includes the 'tt' prefix
      const imdbIdWithPrefix = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

      const payload = type === 'movie'
        ? { movies: [{ ids: { imdb: imdbIdWithPrefix } }] }
        : { shows: [{ ids: { imdb: imdbIdWithPrefix } }] };

      await this.apiRequest('/sync/watchlist', 'POST', payload);
      logger.log(`[TraktService] Added ${type} to watchlist: ${imdbId}`);
      return true;
    } catch (error) {
      logger.error(`[TraktService] Failed to add ${type} to watchlist:`, error);
      return false;
    }
  }

  /**
   * Remove content from Trakt watchlist
   */
  public async removeFromWatchlist(imdbId: string, type: 'movie' | 'show'): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      // Ensure IMDb ID includes the 'tt' prefix
      const imdbIdWithPrefix = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

      const payload = type === 'movie'
        ? { movies: [{ ids: { imdb: imdbIdWithPrefix } }] }
        : { shows: [{ ids: { imdb: imdbIdWithPrefix } }] };

      await this.apiRequest('/sync/watchlist/remove', 'POST', payload);
      logger.log(`[TraktService] Removed ${type} from watchlist: ${imdbId}`);
      return true;
    } catch (error) {
      logger.error(`[TraktService] Failed to remove ${type} from watchlist:`, error);
      return false;
    }
  }

  /**
   * Add content to Trakt collection
   */
  public async addToCollection(imdbId: string, type: 'movie' | 'show'): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      // Ensure IMDb ID includes the 'tt' prefix
      const imdbIdWithPrefix = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

      const payload = type === 'movie'
        ? { movies: [{ ids: { imdb: imdbIdWithPrefix } }] }
        : { shows: [{ ids: { imdb: imdbIdWithPrefix } }] };

      await this.apiRequest('/sync/collection', 'POST', payload);
      logger.log(`[TraktService] Added ${type} to collection: ${imdbId}`);
      return true;
    } catch (error) {
      logger.error(`[TraktService] Failed to add ${type} to collection:`, error);
      return false;
    }
  }

  /**
   * Remove content from Trakt collection
   */
  public async removeFromCollection(imdbId: string, type: 'movie' | 'show'): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      // Ensure IMDb ID includes the 'tt' prefix
      const imdbIdWithPrefix = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

      const payload = type === 'movie'
        ? { movies: [{ ids: { imdb: imdbIdWithPrefix } }] }
        : { shows: [{ ids: { imdb: imdbIdWithPrefix } }] };

      await this.apiRequest('/sync/collection/remove', 'POST', payload);
      logger.log(`[TraktService] Removed ${type} from collection: ${imdbId}`);
      return true;
    } catch (error) {
      logger.error(`[TraktService] Failed to remove ${type} from collection:`, error);
      return false;
    }
  }

  /**
   * Check if content is in Trakt watchlist
   */
  public async isInWatchlist(imdbId: string, type: 'movie' | 'show'): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      // Ensure IMDb ID includes the 'tt' prefix
      const imdbIdWithPrefix = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

      const watchlistItems = type === 'movie'
        ? await this.getWatchlistMovies()
        : await this.getWatchlistShows();

      return watchlistItems.some(item => {
        const itemImdbId = type === 'movie'
          ? item.movie?.ids?.imdb
          : item.show?.ids?.imdb;
        return itemImdbId === imdbIdWithPrefix;
      });
    } catch (error) {
      logger.error(`[TraktService] Failed to check if ${type} is in watchlist:`, error);
      return false;
    }
  }

  /**
   * Check if content is in Trakt collection
   */
  public async isInCollection(imdbId: string, type: 'movie' | 'show'): Promise<boolean> {
    try {
      if (!await this.isAuthenticated()) {
        return false;
      }

      // Ensure IMDb ID includes the 'tt' prefix
      const imdbIdWithPrefix = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

      const collectionItems = type === 'movie'
        ? await this.getCollectionMovies()
        : await this.getCollectionShows();

      return collectionItems.some(item => {
        const itemImdbId = type === 'movie'
          ? item.movie?.ids?.imdb
          : item.show?.ids?.imdb;
        return itemImdbId === imdbIdWithPrefix;
      });
    } catch (error) {
      logger.error(`[TraktService] Failed to check if ${type} is in collection:`, error);
      return false;
    }
  }

  /**
   * Handle app state changes to reduce memory pressure
   */
  private handleAppStateChange = (nextState: AppStateStatus) => {
    if (nextState !== 'active') {
      // Clear tracking maps to reduce memory pressure when app goes to background
      this.scrobbledItems.clear();
      this.scrobbledTimestamps.clear();
      this.currentlyWatching.clear();
      this.lastSyncTimes.clear();
      this.lastStopCalls.clear();

      // Clear request queue to prevent background processing
      this.requestQueue = [];
      this.isProcessingQueue = false;
    }
  };
}

// Export a singleton instance
export const traktService = TraktService.getInstance();
