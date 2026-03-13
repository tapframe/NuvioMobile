import { logger } from '../utils/logger';
import { Platform } from 'react-native';
import { YouTubeExtractionResult, YouTubeExtractor } from './youtubeExtractor';

export interface TrailerData {
  url: string;
  title: string;
  year: number;
}

export interface TrailerPlaybackSource {
  videoUrl: string;
  audioUrl: string | null;
  quality?: string;
}

interface CacheEntry {
  source: TrailerPlaybackSource;
  expiresAt: number;
}

export class TrailerService {
  // Cache for 5 seconds — just enough to avoid re-extracting on quick re-renders
  private static readonly CACHE_TTL_MS = 5 * 1000;
  private static urlCache = new Map<string, CacheEntry>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get a playable stream URL from a raw YouTube video ID (e.g. from TMDB).
   * Uses on-device extraction only.
   */
  static async getTrailerFromVideoId(
    youtubeVideoId: string,
    title?: string,
    year?: number
  ): Promise<string | null> {
    const source = await this.getTrailerPlaybackSourceFromVideoId(youtubeVideoId, title, year);
    return source?.videoUrl ?? null;
  }

  static async getTrailerPlaybackSourceFromVideoId(
    youtubeVideoId: string,
    title?: string,
    year?: number
  ): Promise<TrailerPlaybackSource | null> {
    if (!youtubeVideoId) return null;

    logger.info('TrailerService', `getTrailerFromVideoId: ${youtubeVideoId} (${title ?? '?'} ${year ?? ''})`);

    const cached = this.getCached(youtubeVideoId);
    if (cached) {
      logger.info('TrailerService', `Cache hit for videoId=${youtubeVideoId}`);
      return cached;
    }

    try {
      const platform = Platform.OS === 'android' ? 'android' : 'ios';
      const extracted = await YouTubeExtractor.extract(youtubeVideoId, platform);
      if (extracted) {
        const source = this.toPlaybackSource(extracted);
        logger.info('TrailerService', `Extraction succeeded for ${youtubeVideoId}`);
        this.setCache(youtubeVideoId, source);
        return source;
      }
      logger.warn('TrailerService', `Extraction returned null for ${youtubeVideoId}`);
    } catch (err) {
      logger.warn('TrailerService', `Extraction threw for ${youtubeVideoId}:`, err);
    }

    return null;
  }

  /**
   * Called by TrailerModal which has the full YouTube URL from TMDB.
   * Parses the video ID then delegates to getTrailerFromVideoId.
   */
  static async getTrailerFromYouTubeUrl(
    youtubeUrl: string,
    title?: string,
    year?: string
  ): Promise<string | null> {
    const source = await this.getTrailerPlaybackSourceFromYouTubeUrl(youtubeUrl, title, year);
    return source?.videoUrl ?? null;
  }

  static async getTrailerPlaybackSourceFromYouTubeUrl(
    youtubeUrl: string,
    title?: string,
    year?: string
  ): Promise<TrailerPlaybackSource | null> {
    logger.info('TrailerService', `getTrailerFromYouTubeUrl: ${youtubeUrl}`);

    const videoId = YouTubeExtractor.parseVideoId(youtubeUrl);
    if (!videoId) {
      logger.warn('TrailerService', `Could not parse video ID from: ${youtubeUrl}`);
      return null;
    }

    return this.getTrailerPlaybackSourceFromVideoId(
      videoId,
      title,
      year ? parseInt(year, 10) : undefined
    );
  }

  /**
   * Called by AppleTVHero and HeroSection which only have title/year/tmdbId.
   * Without a YouTube video ID there is nothing to extract — returns null.
   * Callers should ensure they pass a video ID via getTrailerFromVideoId instead.
   */
  static async getTrailerUrl(
    title: string,
    year: number,
    _tmdbId?: string,
    _type?: 'movie' | 'tv'
  ): Promise<string | null> {
    logger.warn('TrailerService', `getTrailerUrl called for "${title}" but no YouTube video ID available — cannot extract`);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Public helpers (API compatibility)
  // ---------------------------------------------------------------------------

  static getBestFormatUrl(url: string): string {
    return url;
  }

  static async isTrailerAvailable(videoId: string): Promise<boolean> {
    return (await this.getTrailerFromVideoId(videoId)) !== null;
  }

  static async getTrailerData(title: string, year: number): Promise<TrailerData | null> {
    const url = await this.getTrailerUrl(title, year);
    if (!url) return null;
    return { url, title, year };
  }

  static invalidateCache(videoId: string): void {
    this.urlCache.delete(videoId);
    logger.info('TrailerService', `Cache invalidated for videoId=${videoId}`);
  }

  static setUseLocalServer(_useLocal: boolean): void {}

  static getServerStatus(): { usingLocal: boolean; localUrl: string } {
    return { usingLocal: false, localUrl: '' };
  }

  static async testServers(): Promise<{
    localServer: { status: 'online' | 'offline'; responseTime?: number };
  }> {
    return { localServer: { status: 'offline' } };
  }

  // ---------------------------------------------------------------------------
  // Private — cache
  // ---------------------------------------------------------------------------

  private static getCached(key: string): TrailerPlaybackSource | null {
    const entry = this.urlCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.urlCache.delete(key);
      return null;
    }
    // Check the URL's own CDN expiry — googlevideo.com URLs carry an `expire`
    // param (Unix timestamp). Treat as stale if it expires within 2 minutes.
    if (entry.source.videoUrl.includes('googlevideo.com')) {
      try {
        const u = new URL(entry.source.videoUrl);
        const expire = u.searchParams.get('expire');
        if (expire) {
          const expiresAt = parseInt(expire, 10) * 1000;
          if (Date.now() > expiresAt - 2 * 60 * 1000) {
            logger.info('TrailerService', `Cached URL expired or expiring soon — re-extracting`);
            this.urlCache.delete(key);
            return null;
          }
        }
      } catch { /* ignore */ }
    }
    return entry.source;
  }

  private static setCache(key: string, source: TrailerPlaybackSource): void {
    this.urlCache.set(key, { source, expiresAt: Date.now() + this.CACHE_TTL_MS });
    if (this.urlCache.size > 100) {
      const oldest = this.urlCache.keys().next().value;
      if (oldest) this.urlCache.delete(oldest);
    }
  }

  private static toPlaybackSource(extracted: YouTubeExtractionResult): TrailerPlaybackSource {
    return {
      videoUrl: extracted.videoUrl,
      audioUrl: extracted.audioUrl,
      quality: extracted.quality,
    };
  }
}

export default TrailerService;
