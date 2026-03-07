import axios from 'axios';
import { mmkvStorage } from './mmkvStorage';
import { logger } from '../utils/logger';

// TMDB API configuration
const DEFAULT_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY || 'd131017ccc6e5462a81c9304d21476de';
const BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY_STORAGE_KEY = 'tmdb_api_key';
const USE_CUSTOM_TMDB_API_KEY = 'use_custom_tmdb_api_key';

// Cache configuration
const TMDB_CACHE_PREFIX = 'tmdb_cache_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Types for TMDB responses
export interface TMDBEpisode {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  still_path: string | null;
  air_date: string;
  vote_average: number;
  imdb_id?: string;
  imdb_rating?: number;
  season_poster_path?: string | null;
  runtime?: number;
}

export interface TMDBSeason {
  id: number;
  name: string;
  overview: string;
  season_number: number;
  episodes: TMDBEpisode[];
  poster_path: string | null;
  air_date: string;
}

export interface TMDBShow {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  last_air_date: string;
  number_of_seasons: number;
  number_of_episodes: number;
  genres?: { id: number; name: string }[];
  seasons: {
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
    poster_path: string | null;
    air_date: string;
  }[];
  status?: string;
  episode_run_time?: number[];
  type?: string;
  origin_country?: string[];
  original_language?: string;
  created_by?: { id: number; name: string; profile_path?: string | null }[];
  networks?: { id: number; name: string; logo_path: string | null; origin_country: string }[];
}

export interface TMDBTrendingResult {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  genre_ids: number[];
  external_ids?: {
    imdb_id: string | null;
    [key: string]: any;
  };
}

export interface TMDBCollection {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: TMDBCollectionPart[];
}

export interface TMDBCollectionPart {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  adult: boolean;
  video: boolean;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  original_language: string;
  original_title: string;
  popularity: number;
}

// Types for IMDb ratings API responses
export interface IMDbRatingEpisode {
  vote_average: number;
  episode_number: number;
  name: string;
  season_number: number;
  tconst: string;
}

export interface IMDbRatingSeason {
  episodes: IMDbRatingEpisode[];
}

export type IMDbRatings = IMDbRatingSeason[];

export class TMDBService {
  private static instance: TMDBService;
  private static ratingCache: Map<string, number | null> = new Map();
  private apiKey: string = DEFAULT_API_KEY;
  private useCustomKey: boolean = false;
  private apiKeyLoaded: boolean = false;

  private constructor() {
    this.loadApiKey();
  }

  /**
   * Generate a unique cache key from endpoint and parameters
   */
  private generateCacheKey(endpoint: string, params: any = {}): string {
    const paramsStr = JSON.stringify(params);
    // Simple hash function for params
    let hash = 0;
    for (let i = 0; i < paramsStr.length; i++) {
      const char = paramsStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    const cleanEndpoint = endpoint.replace(/[^a-zA-Z0-9]/g, '_');
    return `${TMDB_CACHE_PREFIX}${cleanEndpoint}_${Math.abs(hash)}`;
  }

  /**
   * Retrieve cached data if not expired
   */
  private getCachedData<T>(key: string): T | null {
    try {
      const cachedStr = mmkvStorage.getString(key);
      if (!cachedStr) {
        logger.log(`[TMDB Cache] ❌ MISS: ${key}`);
        return null;
      }

      const cached = JSON.parse(cachedStr);
      const now = Date.now();

      // Check if cache is expired
      if (now - cached.timestamp > CACHE_TTL_MS) {
        mmkvStorage.removeItem(key);
        logger.log(`[TMDB Cache] ⏰ EXPIRED: ${key}`);
        return null;
      }

      const age = Math.floor((now - cached.timestamp) / (1000 * 60 * 60)); // age in hours
      logger.log(`[TMDB Cache] ✅ HIT: ${key} (${age}h old)`);
      return cached.data as T;
    } catch (error) {
      logger.log(`[TMDB Cache] ❌ MISS (error): ${key}`);
      return null;
    }
  }

  /**
   * Get from local cache
   */
  private async getFromCacheOrRemote<T>(key: string): Promise<T | null> {
    return this.getCachedData<T>(key);
  }

  /**
   * Store data in cache with timestamp
   * Only called after successful API responses - never caches error responses
   * This ensures failed API calls will retry on next attempt (cache miss)
   */
  private setCachedData(key: string, data: any): void {
    // Never cache null or undefined - these represent "not found" or errors
    // Ensures next API call will retry to fetch fresh data
    if (data === null || data === undefined) {
      return;
    }

    try {
      const cacheEntry = {
        data,
        timestamp: Date.now()
      };
      mmkvStorage.setString(key, JSON.stringify(cacheEntry));
      logger.log(`[TMDB Cache] 💾 STORED: ${key}`);
    } catch (error) {
      // Ignore cache errors
    }
  }

  /**
   * Clear all TMDB cache entries
   */
  async clearAllCache(): Promise<void> {
    try {
      const keys = await mmkvStorage.getAllKeys();
      const tmdbKeys = keys.filter(key => key.startsWith(TMDB_CACHE_PREFIX));
      const count = tmdbKeys.length;
      if (count > 0) {
        await mmkvStorage.multiRemove(tmdbKeys);
        logger.log(`[TMDB Cache] 🗑️ CLEARED: ${count} cache entries`);
      } else {
        logger.log(`[TMDB Cache] 🗑️ CLEARED: No cache entries to clear`);
      }
    } catch (error) {
      logger.error('[TMDB Cache] Error clearing cache:', error);
    }
  }

  static getInstance(): TMDBService {
    if (!TMDBService.instance) {
      TMDBService.instance = new TMDBService();
    }
    return TMDBService.instance;
  }

  private async loadApiKey() {
    try {
      const [savedKey, savedUseCustomKey] = await Promise.all([
        mmkvStorage.getItem(TMDB_API_KEY_STORAGE_KEY),
        mmkvStorage.getItem(USE_CUSTOM_TMDB_API_KEY)
      ]);

      this.useCustomKey = savedUseCustomKey === 'true';

      if (this.useCustomKey && savedKey) {
        this.apiKey = savedKey;
      } else {
        this.apiKey = DEFAULT_API_KEY;
      }

      this.apiKeyLoaded = true;
    } catch (error) {
      this.apiKey = DEFAULT_API_KEY;
      this.apiKeyLoaded = true;
    }
  }

  /**
   * Returns the resolved TMDB API key (custom user key if set, otherwise default).
   * Always awaits key loading so callers get the correct value.
   */
  async getApiKey(): Promise<string> {
    if (!this.apiKeyLoaded) {
      await this.loadApiKey();
    }
    return this.apiKey;
  }

  private async getHeaders() {
    // Ensure API key is loaded before returning headers
    if (!this.apiKeyLoaded) {
      await this.loadApiKey();
    }

    return {
      'Content-Type': 'application/json',
    };
  }

  private async getParams(additionalParams = {}) {
    // Ensure API key is loaded before returning params
    if (!this.apiKeyLoaded) {
      await this.loadApiKey();
    }

    return {
      api_key: this.apiKey,
      ...additionalParams
    };
  }

  private generateRatingCacheKey(showName: string, seasonNumber: number, episodeNumber: number): string {
    return `${showName.toLowerCase()}_s${seasonNumber}_e${episodeNumber}`;
  }

  /**
   * Search for a TV show by name
   */
  async searchTVShow(query: string, language: string = 'en-US'): Promise<TMDBShow[]> {
    const cacheKey = this.generateCacheKey('search_tv', { query, language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBShow[]>(cacheKey);
    if (cached !== null) return cached;

    logger.log(`[TMDB API] 🌐 FETCHING: searchTVShow("${query}")`);
    try {
      const response = await axios.get(`${BASE_URL}/search/tv`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          query,
          include_adult: false,
          language,
          page: 1,
        }),
      });
      const results = response.data.results;
      this.setCachedData(cacheKey, results);
      return results;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get TV show details by TMDB ID
   */
  async getTVShowDetails(tmdbId: number, language: string = 'en'): Promise<TMDBShow | null> {
    const cacheKey = this.generateCacheKey(`tv_${tmdbId}`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBShow>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/tv/${tmdbId}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
          append_to_response: 'external_ids,credits,keywords,networks' // Append external IDs, cast/crew, keywords, and networks
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get external IDs for an episode (including IMDb ID)
   */
  async getEpisodeExternalIds(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<{ imdb_id: string | null } | null> {
    const cacheKey = this.generateCacheKey(`tv_${tmdbId}_season_${seasonNumber}_episode_${episodeNumber}_external_ids`);

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<{ imdb_id: string | null }>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(
        `${BASE_URL}/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}/external_ids`,
        {
          headers: await this.getHeaders(),
          params: await this.getParams(),
        }
      );
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get IMDb rating for an episode using OMDB API with caching
   * @deprecated This method is deprecated. Use getIMDbRatings instead for better accuracy and performance.
   */
  async getIMDbRating(showName: string, seasonNumber: number, episodeNumber: number): Promise<number | null> {
    const cacheKey = this.generateRatingCacheKey(showName, seasonNumber, episodeNumber);

    // Check cache first
    if (TMDBService.ratingCache.has(cacheKey)) {
      return TMDBService.ratingCache.get(cacheKey) ?? null;
    }

    try {
      const OMDB_API_KEY = '20e793df';
      const response = await axios.get(`http://www.omdbapi.com/`, {
        params: {
          apikey: OMDB_API_KEY,
          t: showName,
          Season: seasonNumber,
          Episode: episodeNumber
        }
      });

      let rating: number | null = null;
      if (response.data && response.data.imdbRating && response.data.imdbRating !== 'N/A') {
        rating = parseFloat(response.data.imdbRating);
      }

      // Store in cache
      TMDBService.ratingCache.set(cacheKey, rating);
      return rating;
    } catch (error) {
      // Cache the failed result too to prevent repeated failed requests
      TMDBService.ratingCache.set(cacheKey, null);
      return null;
    }
  }

  /**
   * Get IMDb ratings for all seasons and episodes
   * This replaces the OMDB API approach and provides more accurate ratings
   */
  async getIMDbRatings(tmdbId: number): Promise<IMDbRatings | null> {
    const IMDB_RATINGS_API_BASE_URL = process.env.EXPO_PUBLIC_IMDB_RATINGS_API_BASE_URL;

    if (!IMDB_RATINGS_API_BASE_URL) {
      logger.error('[TMDB API] Missing EXPO_PUBLIC_IMDB_RATINGS_API_BASE_URL environment variable');
      return null;
    }

    const cacheKey = this.generateCacheKey(`imdb_ratings_${tmdbId}`);

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<IMDbRatings>(cacheKey);
    if (cached !== null) return cached;

    const apiUrl = `${IMDB_RATINGS_API_BASE_URL}/api/shows/${tmdbId}/season-ratings`;

    logger.log(`[TMDB API] 🌐 FETCHING: getIMDbRatings(${tmdbId})`);
    try {
      const response = await axios.get(apiUrl, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = response.data;
      if (data && Array.isArray(data)) {
        this.setCachedData(cacheKey, data);
        return data;
      }

      return null;
    } catch (error) {
      logger.error('[TMDB API] Error fetching IMDb ratings:', error);
      return null;
    }
  }

  /**
   * Get season details including all episodes
   * Note: IMDb ratings are now fetched separately via getIMDbRatings() for better accuracy
   */
  async getSeasonDetails(tmdbId: number, seasonNumber: number, showName?: string, language: string = 'en-US'): Promise<TMDBSeason | null> {
    const cacheKey = this.generateCacheKey(`tv_${tmdbId}_season_${seasonNumber}`, { language, showName });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBSeason>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/tv/${tmdbId}/season/${seasonNumber}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });

      const season = response.data;
      this.setCachedData(cacheKey, season);
      return season;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get episode details
   */
  async getEpisodeDetails(
    tmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
    language: string = 'en-US'
  ): Promise<TMDBEpisode | null> {
    const cacheKey = this.generateCacheKey(`tv_${tmdbId}_season_${seasonNumber}_episode_${episodeNumber}`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBEpisode>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(
        `${BASE_URL}/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`,
        {
          headers: await this.getHeaders(),
          params: await this.getParams({
            language,
            append_to_response: 'credits' // Include guest stars and crew for episode context
          }),
        }
      );
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract TMDB ID from Stremio ID
   * Stremio IDs for series are typically in the format: tt1234567:1:1 (imdbId:season:episode)
   * or just tt1234567 for the series itself
   */
  async extractTMDBIdFromStremioId(stremioId: string): Promise<number | null> {
    try {
      // Extract the base IMDB ID (remove season/episode info if present)
      const imdbId = stremioId.split(':')[0];

      // Use the existing findTMDBIdByIMDB function to get the TMDB ID
      const tmdbId = await this.findTMDBIdByIMDB(imdbId);
      return tmdbId;
    } catch (error) {
      return null;
    }
  }

  /**
   * Find TMDB ID by IMDB ID
   */
  async findTMDBIdByIMDB(imdbId: string, language: string = 'en-US'): Promise<number | null> {
    const cacheKey = this.generateCacheKey('find_imdb', { imdbId, language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<number>(cacheKey);
    if (cached !== null) return cached;

    try {
      // Extract the IMDB ID without season/episode info
      const baseImdbId = imdbId.split(':')[0];

      const response = await axios.get(`${BASE_URL}/find/${baseImdbId}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          external_source: 'imdb_id',
          language,
        }),
      });

      let result: number | null = null;

      // Check TV results first
      if (response.data.tv_results && response.data.tv_results.length > 0) {
        result = response.data.tv_results[0].id;
      }

      // Check movie results as fallback
      if (!result && response.data.movie_results && response.data.movie_results.length > 0) {
        result = response.data.movie_results[0].id;
      }

      if (result !== null) {
        this.setCachedData(cacheKey, result);
      }

      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get image URL for TMDB images
   */
  getImageUrl(path: string | null, size: 'original' | 'w500' | 'w300' | 'w185' | 'profile' = 'original'): string | null {
    if (!path) {
      return null;
    }

    const baseImageUrl = 'https://image.tmdb.org/t/p/';
    const fullUrl = `${baseImageUrl}${size}${path}`;

    return fullUrl;
  }

  /**
   * Get all episodes for a TV show
   * @param language Language for localized episode names/overviews
   */
  async getAllEpisodes(tmdbId: number, language: string = 'en-US'): Promise<{ [seasonNumber: number]: TMDBEpisode[] }> {
    try {
      // First get the show details to know how many seasons there are
      const showDetails = await this.getTVShowDetails(tmdbId, language);
      if (!showDetails) return {};

      const allEpisodes: { [seasonNumber: number]: TMDBEpisode[] } = {};

      // Get episodes for each season (in parallel)
      const seasonPromises = showDetails.seasons
        .filter(season => season.season_number > 0) // Filter out specials (season 0)
        .map(async season => {
          const seasonDetails = await this.getSeasonDetails(tmdbId, season.season_number, showDetails.name, language);
          if (seasonDetails && seasonDetails.episodes) {
            allEpisodes[season.season_number] = seasonDetails.episodes;
          }
        });

      await Promise.all(seasonPromises);
      return allEpisodes;
    } catch (error) {
      return {};
    }
  }

  /**
   * Get episode image URL with fallbacks
   */
  getEpisodeImageUrl(episode: TMDBEpisode, show: TMDBShow | null = null, size: 'original' | 'w500' | 'w300' | 'w185' = 'w300'): string | null {
    // Try episode still image first
    if (episode.still_path) {
      return this.getImageUrl(episode.still_path, size);
    }

    // Try season poster as fallback
    if (show && show.seasons) {
      const season = show.seasons.find(s => s.season_number === episode.season_number);
      if (season && season.poster_path) {
        return this.getImageUrl(season.poster_path, size);
      }
    }

    // Use show poster as last resort
    if (show && show.poster_path) {
      return this.getImageUrl(show.poster_path, size);
    }

    return null;
  }

  /**
   * Convert TMDB air date to a more readable format
   */
  formatAirDate(airDate: string | null): string {
    if (!airDate) return 'Unknown';

    try {
      const date = new Date(airDate);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return airDate;
    }
  }

  async getCredits(tmdbId: number, type: string, language: string = 'en-US') {
    const cacheKey = this.generateCacheKey(`${type}_${tmdbId}_credits`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<{ cast: any[]; crew: any[] }>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/${type === 'series' ? 'tv' : 'movie'}/${tmdbId}/credits`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = {
        cast: response.data.cast || [],
        crew: response.data.crew || []
      };
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return { cast: [], crew: [] };
    }
  }

  async getPersonDetails(personId: number, language: string = 'en-US') {
    const cacheKey = this.generateCacheKey(`person_${personId}`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/person/${personId}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get person's movie credits (cast and crew)
   */
  async getPersonMovieCredits(personId: number, language: string = 'en-US') {
    const cacheKey = this.generateCacheKey(`person_${personId}_movie_credits`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/person/${personId}/movie_credits`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get person's TV credits (cast and crew)
   */
  async getPersonTvCredits(personId: number, language: string = 'en-US') {
    const cacheKey = this.generateCacheKey(`person_${personId}_tv_credits`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/person/${personId}/tv_credits`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get person's combined credits (movies and TV)
   */
  async getPersonCombinedCredits(personId: number, language: string = 'en-US') {
    const cacheKey = this.generateCacheKey(`person_${personId}_combined_credits`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/person/${personId}/combined_credits`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get external IDs for a TV show (including IMDb ID and TVDB ID)
   */
  async getShowExternalIds(tmdbId: number): Promise<{ imdb_id: string | null, tvdb_id?: number | null, [key: string]: any } | null> {
    const cacheKey = this.generateCacheKey(`tv_${tmdbId}_external_ids`);

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<{ imdb_id: string | null }>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(
        `${BASE_URL}/tv/${tmdbId}/external_ids`,
        {
          headers: await this.getHeaders(),
          params: await this.getParams(),
        }
      );
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  async getRecommendations(type: 'movie' | 'tv', tmdbId: string, language: string = 'en-US'): Promise<any[]> {
    if (!this.apiKey) {
      return [];
    }

    const cacheKey = this.generateCacheKey(`${type}_${tmdbId}_recommendations`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/${type}/${tmdbId}/recommendations`, {
        headers: await this.getHeaders(),
        params: await this.getParams({ language })
      });
      const results = response.data.results || [];
      this.setCachedData(cacheKey, results);
      return results;
    } catch (error) {
      return [];
    }
  }

  async searchMulti(query: string, language: string = 'en-US'): Promise<any[]> {
    const cacheKey = this.generateCacheKey('search_multi', { query, language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/search/multi`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          query,
          include_adult: false,
          language,
          page: 1,
        }),
      });
      const results = response.data.results;
      this.setCachedData(cacheKey, results);
      return results;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get movie details by TMDB ID
   */
  async getMovieDetails(movieId: string, language: string = 'en'): Promise<any> {
    const cacheKey = this.generateCacheKey(`movie_${movieId}`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/movie/${movieId}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
          append_to_response: 'external_ids,credits,keywords,release_dates,production_companies' // Include release dates and production companies
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get collection details by collection ID
   */
  async getCollectionDetails(collectionId: number, language: string = 'en'): Promise<TMDBCollection | null> {
    const cacheKey = this.generateCacheKey(`collection_${collectionId}`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBCollection>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/collection/${collectionId}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get collection images by collection ID
   */
  async getCollectionImages(collectionId: number, language: string = 'en'): Promise<any> {
    const cacheKey = this.generateCacheKey(`collection_${collectionId}_images`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/collection/${collectionId}/images`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
          include_image_language: `${language},en,null`
        }),
      });
      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get movie images (logos, posters, backdrops) by TMDB ID - returns full images object
   */
  async getMovieImagesFull(movieId: number | string, language: string = 'en'): Promise<any> {
    const cacheKey = this.generateCacheKey(`movie_${movieId}_images_full`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) {
      return cached;
    }


    try {
      const response = await axios.get(`${BASE_URL}/movie/${movieId}/images`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          include_image_language: `${language},en,null`
        }),
      });

      const data = response.data;


      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get movie images (logos only) by TMDB ID - legacy method
   */
  async getMovieImages(movieId: number | string, preferredLanguage: string = 'en'): Promise<string | null> {
    const cacheKey = this.generateCacheKey(`movie_${movieId}_logo`, { preferredLanguage });

    // Check cache
    const cached = this.getCachedData<string>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/movie/${movieId}/images`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          include_image_language: `${preferredLanguage},en,null`
        }),
      });

      const images = response.data;

      let result: string | null = null;

      if (images && images.logos && images.logos.length > 0) {
        // First prioritize preferred language SVG logos if not English
        if (preferredLanguage !== 'en') {
          const preferredSvgLogo = images.logos.find((logo: any) =>
            logo.file_path &&
            logo.file_path.endsWith('.svg') &&
            logo.iso_639_1 === preferredLanguage
          );
          if (preferredSvgLogo) {
            result = this.getImageUrl(preferredSvgLogo.file_path);
          }

          // Then preferred language PNG logos
          if (!result) {
            const preferredPngLogo = images.logos.find((logo: any) =>
              logo.file_path &&
              logo.file_path.endsWith('.png') &&
              logo.iso_639_1 === preferredLanguage
            );
            if (preferredPngLogo) {
              result = this.getImageUrl(preferredPngLogo.file_path);
            }
          }

          // Then any preferred language logo
          if (!result) {
            const preferredLogo = images.logos.find((logo: any) =>
              logo.iso_639_1 === preferredLanguage
            );
            if (preferredLogo) {
              result = this.getImageUrl(preferredLogo.file_path);
            }
          }
        }

        // Then prioritize English SVG logos
        if (!result) {
          const enSvgLogo = images.logos.find((logo: any) =>
            logo.file_path &&
            logo.file_path.endsWith('.svg') &&
            logo.iso_639_1 === 'en'
          );
          if (enSvgLogo) {
            result = this.getImageUrl(enSvgLogo.file_path);
          }
        }

        // Then English PNG logos
        if (!result) {
          const enPngLogo = images.logos.find((logo: any) =>
            logo.file_path &&
            logo.file_path.endsWith('.png') &&
            logo.iso_639_1 === 'en'
          );
          if (enPngLogo) {
            result = this.getImageUrl(enPngLogo.file_path);
          }
        }

        // Then any English logo
        if (!result) {
          const enLogo = images.logos.find((logo: any) =>
            logo.iso_639_1 === 'en'
          );
          if (enLogo) {
            result = this.getImageUrl(enLogo.file_path);
          }
        }

        // Fallback to any SVG logo
        if (!result) {
          const svgLogo = images.logos.find((logo: any) =>
            logo.file_path && logo.file_path.endsWith('.svg')
          );
          if (svgLogo) {
            result = this.getImageUrl(svgLogo.file_path);
          }
        }

        // Then any PNG logo
        if (!result) {
          const pngLogo = images.logos.find((logo: any) =>
            logo.file_path && logo.file_path.endsWith('.png')
          );
          if (pngLogo) {
            result = this.getImageUrl(pngLogo.file_path);
          }
        }

        // Last resort: any logo
        if (!result) {
          result = this.getImageUrl(images.logos[0].file_path);
        }
      }

      this.setCachedData(cacheKey, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get TV show images (logos, posters, backdrops) by TMDB ID - returns full images object
   */
  async getTvShowImagesFull(showId: number | string, language: string = 'en'): Promise<any> {
    const cacheKey = this.generateCacheKey(`tv_${showId}_images_full`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<any>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/tv/${showId}/images`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          include_image_language: `${language},en,null`
        }),
      });

      const data = response.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get TV show images (logos only) by TMDB ID - legacy method
   */
  async getTvShowImages(showId: number | string, preferredLanguage: string = 'en'): Promise<string | null> {
    const cacheKey = this.generateCacheKey(`tv_${showId}_logo`, { preferredLanguage });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<string>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/tv/${showId}/images`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          include_image_language: `${preferredLanguage},en,null`
        }),
      });

      const images = response.data;

      let result: string | null = null;

      if (images && images.logos && images.logos.length > 0) {
        // First prioritize preferred language SVG logos if not English
        if (preferredLanguage !== 'en') {
          const preferredSvgLogo = images.logos.find((logo: any) =>
            logo.file_path &&
            logo.file_path.endsWith('.svg') &&
            logo.iso_639_1 === preferredLanguage
          );
          if (preferredSvgLogo) {
            result = this.getImageUrl(preferredSvgLogo.file_path);
          }

          // Then preferred language PNG logos
          if (!result) {
            const preferredPngLogo = images.logos.find((logo: any) =>
              logo.file_path &&
              logo.file_path.endsWith('.png') &&
              logo.iso_639_1 === preferredLanguage
            );
            if (preferredPngLogo) {
              result = this.getImageUrl(preferredPngLogo.file_path);
            }
          }

          // Then any preferred language logo
          if (!result) {
            const preferredLogo = images.logos.find((logo: any) =>
              logo.iso_639_1 === preferredLanguage
            );
            if (preferredLogo) {
              result = this.getImageUrl(preferredLogo.file_path);
            }
          }
        }

        // First prioritize English SVG logos
        if (!result) {
          const enSvgLogo = images.logos.find((logo: any) =>
            logo.file_path &&
            logo.file_path.endsWith('.svg') &&
            logo.iso_639_1 === 'en'
          );
          if (enSvgLogo) {
            result = this.getImageUrl(enSvgLogo.file_path);
          }
        }

        // Then English PNG logos
        if (!result) {
          const enPngLogo = images.logos.find((logo: any) =>
            logo.file_path &&
            logo.file_path.endsWith('.png') &&
            logo.iso_639_1 === 'en'
          );
          if (enPngLogo) {
            result = this.getImageUrl(enPngLogo.file_path);
          }
        }

        // Then any English logo
        if (!result) {
          const enLogo = images.logos.find((logo: any) =>
            logo.iso_639_1 === 'en'
          );
          if (enLogo) {
            result = this.getImageUrl(enLogo.file_path);
          }
        }

        // Fallback to any SVG logo
        if (!result) {
          const svgLogo = images.logos.find((logo: any) =>
            logo.file_path && logo.file_path.endsWith('.svg')
          );
          if (svgLogo) {
            result = this.getImageUrl(svgLogo.file_path);
          }
        }

        // Then any PNG logo
        if (!result) {
          const pngLogo = images.logos.find((logo: any) =>
            logo.file_path && logo.file_path.endsWith('.png')
          );
          if (pngLogo) {
            result = this.getImageUrl(pngLogo.file_path);
          }
        }

        // Last resort: any logo
        if (!result) {
          result = this.getImageUrl(images.logos[0].file_path);
        }
      }

      this.setCachedData(cacheKey, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get content logo based on type (movie or TV show)
   */
  async getContentLogo(type: 'movie' | 'tv', id: number | string, preferredLanguage: string = 'en'): Promise<string | null> {
    try {
      const result = type === 'movie'
        ? await this.getMovieImages(id, preferredLanguage)
        : await this.getTvShowImages(id, preferredLanguage);

      if (result) {
      } else {
      }

      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get content certification rating
   */
  async getCertification(type: string, id: number): Promise<string | null> {
    const cacheKey = this.generateCacheKey(`${type}_${id}_certification`);

    // Check cache
    const cached = this.getCachedData<string>(cacheKey);
    if (cached !== null) return cached;

    try {
      let result: string | null = null;

      if (type === 'movie') {
        const response = await axios.get(`${BASE_URL}/movie/${id}/release_dates`, {
          headers: await this.getHeaders(),
          params: await this.getParams()
        });

        if (response.data && response.data.results) {
          // Prefer US, then GB, then any
          const countryPriority = ['US', 'GB'];
          for (const code of countryPriority) {
            const rel = response.data.results.find((r: any) => r.iso_3166_1 === code);
            if (rel?.release_dates?.length) {
              const cert = rel.release_dates.find((rd: any) => rd.certification)?.certification;
              if (cert) {
                result = cert;
                break;
              }
            }
          }
          if (!result) {
            for (const country of response.data.results) {
              const cert = country.release_dates?.find((rd: any) => rd.certification)?.certification;
              if (cert) {
                result = cert;
                break;
              }
            }
          }
        }
      } else {
        // TV uses content ratings endpoint, not release_dates
        const response = await axios.get(`${BASE_URL}/tv/${id}/content_ratings`, {
          headers: await this.getHeaders(),
          params: await this.getParams()
        });

        if (response.data && response.data.results) {
          // Prefer US, then GB, then any
          const countryPriority = ['US', 'GB'];
          for (const code of countryPriority) {
            const rating = response.data.results.find((r: any) => r.iso_3166_1 === code);
            if (rating?.rating) {
              result = rating.rating;
              break;
            }
          }
          if (!result) {
            const any = response.data.results.find((r: any) => !!r.rating);
            if (any?.rating) result = any.rating;
          }
        }
      }

      this.setCachedData(cacheKey, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get trending movies or TV shows
   * @param type 'movie' or 'tv'
   * @param timeWindow 'day' or 'week'
   * @param language Language for localized results
   */
  async getTrending(type: 'movie' | 'tv', timeWindow: 'day' | 'week', language: string = 'en-US'): Promise<TMDBTrendingResult[]> {
    const cacheKey = this.generateCacheKey(`trending_${type}_${timeWindow}`, { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBTrendingResult[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/trending/${type}/${timeWindow}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });

      // Get external IDs for each trending item
      const results = response.data.results || [];
      const resultsWithExternalIds = await Promise.all(
        results.map(async (item: TMDBTrendingResult) => {
          try {
            const externalIdsResponse = await axios.get(
              `${BASE_URL}/${type}/${item.id}/external_ids`,
              {
                headers: await this.getHeaders(),
                params: await this.getParams(),
              }
            );
            return {
              ...item,
              external_ids: externalIdsResponse.data
            };
          } catch (error) {
            return item;
          }
        })
      );

      this.setCachedData(cacheKey, resultsWithExternalIds);
      return resultsWithExternalIds;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get popular movies or TV shows
   * @param type 'movie' or 'tv'
   * @param page Page number for pagination
   * @param language Language for localized results
   */
  async getPopular(type: 'movie' | 'tv', page: number = 1, language: string = 'en-US'): Promise<TMDBTrendingResult[]> {
    const cacheKey = this.generateCacheKey(`popular_${type}`, { page, language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBTrendingResult[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/${type}/popular`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
          page,
        }),
      });

      // Get external IDs for each popular item
      const results = response.data.results || [];
      const resultsWithExternalIds = await Promise.all(
        results.map(async (item: TMDBTrendingResult) => {
          try {
            const externalIdsResponse = await axios.get(
              `${BASE_URL}/${type}/${item.id}/external_ids`,
              {
                headers: await this.getHeaders(),
                params: await this.getParams(),
              }
            );
            return {
              ...item,
              external_ids: externalIdsResponse.data
            };
          } catch (error) {
            return item;
          }
        })
      );

      this.setCachedData(cacheKey, resultsWithExternalIds);
      return resultsWithExternalIds;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get upcoming/now playing content
   * @param type 'movie' or 'tv'
   * @param page Page number for pagination
   * @param language Language for localized results
   */
  async getUpcoming(type: 'movie' | 'tv', page: number = 1, language: string = 'en-US'): Promise<TMDBTrendingResult[]> {
    const cacheKey = this.generateCacheKey(`upcoming_${type}`, { page, language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBTrendingResult[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      // For movies use upcoming, for TV use on_the_air
      const endpoint = type === 'movie' ? 'upcoming' : 'on_the_air';

      const response = await axios.get(`${BASE_URL}/${type}/${endpoint}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
          page,
        }),
      });

      // Get external IDs for each upcoming item
      const results = response.data.results || [];
      const resultsWithExternalIds = await Promise.all(
        results.map(async (item: TMDBTrendingResult) => {
          try {
            const externalIdsResponse = await axios.get(
              `${BASE_URL}/${type}/${item.id}/external_ids`,
              {
                headers: await this.getHeaders(),
                params: await this.getParams(),
              }
            );
            return {
              ...item,
              external_ids: externalIdsResponse.data
            };
          } catch (error) {
            return item;
          }
        })
      );

      this.setCachedData(cacheKey, resultsWithExternalIds);
      return resultsWithExternalIds;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get now playing movies (currently in theaters)
   * @param page Page number for pagination
   * @param region ISO 3166-1 country code (e.g., 'US', 'GB')
   * @param language Language for localized results
   */
  async getNowPlaying(page: number = 1, region: string = 'US', language: string = 'en-US'): Promise<TMDBTrendingResult[]> {
    const cacheKey = this.generateCacheKey('now_playing', { page, region, language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBTrendingResult[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/movie/now_playing`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
          page,
          region, // Filter by region to get accurate theater availability
        }),
      });

      // Get external IDs for each now playing movie
      const results = response.data.results || [];
      const resultsWithExternalIds = await Promise.all(
        results.map(async (item: TMDBTrendingResult) => {
          try {
            const externalIdsResponse = await axios.get(
              `${BASE_URL}/movie/${item.id}/external_ids`,
              {
                headers: await this.getHeaders(),
                params: await this.getParams(),
              }
            );
            return {
              ...item,
              external_ids: externalIdsResponse.data
            };
          } catch (error) {
            return item;
          }
        })
      );

      this.setCachedData(cacheKey, resultsWithExternalIds);
      return resultsWithExternalIds;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get the list of official movie genres from TMDB
   * @param language Language for localized genre names
   */
  async getMovieGenres(language: string = 'en-US'): Promise<{ id: number; name: string }[]> {
    const cacheKey = this.generateCacheKey('genres_movie', { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<{ id: number; name: string }[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/genre/movie/list`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = response.data.genres || [];
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get the list of official TV genres from TMDB
   * @param language Language for localized genre names
   */
  async getTvGenres(language: string = 'en-US'): Promise<{ id: number; name: string }[]> {
    const cacheKey = this.generateCacheKey('genres_tv', { language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<{ id: number; name: string }[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      const response = await axios.get(`${BASE_URL}/genre/tv/list`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
        }),
      });
      const data = response.data.genres || [];
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      return [];
    }
  }

  /**
   * Discover movies or TV shows by genre
   * @param type 'movie' or 'tv'
   * @param genreName The genre name to filter by
   * @param page Page number for pagination
   * @param language Language for localized results
   */
  async discoverByGenre(type: 'movie' | 'tv', genreName: string, page: number = 1, language: string = 'en-US'): Promise<TMDBTrendingResult[]> {
    const cacheKey = this.generateCacheKey(`discover_${type}`, { genreName, page, language });

    // Check cache (local or remote)
    const cached = await this.getFromCacheOrRemote<TMDBTrendingResult[]>(cacheKey);
    if (cached !== null) return cached;

    try {
      // First get the genre ID from the name
      const genreList = type === 'movie'
        ? await this.getMovieGenres(language)
        : await this.getTvGenres(language);

      const genre = genreList.find(g => g.name.toLowerCase() === genreName.toLowerCase());

      if (!genre) {
        return [];
      }

      const response = await axios.get(`${BASE_URL}/discover/${type}`, {
        headers: await this.getHeaders(),
        params: await this.getParams({
          language,
          sort_by: 'popularity.desc',
          include_adult: false,
          include_video: false,
          page,
          with_genres: genre.id.toString(),
        }),
      });

      // Get external IDs for each item
      const results = response.data.results || [];
      const resultsWithExternalIds = await Promise.all(
        results.map(async (item: TMDBTrendingResult) => {
          try {
            const externalIdsResponse = await axios.get(
              `${BASE_URL}/${type}/${item.id}/external_ids`,
              {
                headers: await this.getHeaders(),
                params: await this.getParams(),
              }
            );
            return {
              ...item,
              external_ids: externalIdsResponse.data
            };
          } catch (error) {
            return item;
          }
        })
      );

      this.setCachedData(cacheKey, resultsWithExternalIds);
      return resultsWithExternalIds;
    } catch (error) {
      return [];
    }
  }
}

export const tmdbService = TMDBService.getInstance();
export default tmdbService; 
