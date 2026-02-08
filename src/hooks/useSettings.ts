import { useState, useEffect, useCallback } from 'react';
import { mmkvStorage } from '../services/mmkvStorage';

// Simple event emitter for settings changes
class SettingsEventEmitter {
  private listeners: Array<() => void> = [];

  addListener(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  emit() {
    this.listeners.forEach(listener => listener());
  }
}

// Singleton instance for app-wide access
export const settingsEmitter = new SettingsEventEmitter();

export interface CustomThemeDef {
  id: string;
  name: string;
  colors: { primary: string; secondary: string; darkBackground: string };
  isEditable: boolean;
}

export interface AppSettings {
  enableDarkMode: boolean;
  enableNotifications: boolean;
  streamQuality: 'auto' | 'low' | 'medium' | 'high';
  enableSubtitles: boolean;
  enableBackgroundPlayback: boolean;
  cacheLimit: number;
  useExternalPlayer: boolean;
  preferredPlayer: 'internal' | 'vlc' | 'infuse' | 'outplayer' | 'vidhub' | 'infuse_livecontainer' | 'external';
  showHeroSection: boolean;
  showThisWeekSection: boolean; // Toggle "This Week" section
  featuredContentSource: 'tmdb' | 'catalogs';
  heroStyle: 'legacy' | 'carousel' | 'appletv';
  selectedHeroCatalogs: string[]; // Array of catalog IDs to display in hero section
  logoSourcePreference: 'metahub' | 'tmdb'; // Preferred source for title logos
  tmdbLanguagePreference: string; // Preferred language for TMDB logos (ISO 639-1 code)
  episodeLayoutStyle: 'vertical' | 'horizontal'; // Layout style for episode cards
  autoplayBestStream: boolean; // Automatically play the best available stream
  // Local scraper settings
  scraperRepositoryUrl: string; // URL to the scraper repository
  enableLocalScrapers: boolean; // Enable/disable local scraper functionality
  scraperTimeout: number; // Timeout for scraper execution in seconds
  streamDisplayMode: 'separate' | 'grouped'; // How to display streaming links - separately by provider or grouped under one name
  streamSortMode: 'scraper-then-quality' | 'quality-then-scraper'; // How to sort streams - by scraper first or quality first
  showScraperLogos: boolean; // Show scraper logos next to streaming links
  // Quality filtering settings
  excludedQualities: string[]; // Array of quality strings to exclude (e.g., ['2160p', '4K', '1080p', '720p'])
  // Language filtering settings
  excludedLanguages: string[]; // Array of language strings to exclude (e.g., ['Spanish', 'German', 'French'])
  // Playback behavior
  alwaysResume: boolean; // If true, resume automatically without prompt when progress < 85%
  skipIntroEnabled: boolean; // Enable/disable Skip Intro overlay (IntroDB)
  introSubmitEnabled: boolean; // Enable/disable Intro Submission
  introDbApiKey: string; // API Key for IntroDB submission
  // Downloads
  enableDownloads: boolean; // Show Downloads tab and enable saving streams
  // Theme settings
  themeId: string;
  customThemes: CustomThemeDef[];
  useDominantBackgroundColor: boolean;
  // Home screen poster customization
  posterSize: 'small' | 'medium' | 'large'; // Predefined sizes
  posterBorderRadius: number; // 0-20 range for border radius
  postersPerRow: number; // 3-6 range for number of posters per row
  // Home screen content item
  showPosterTitles: boolean; // Show text titles under posters
  // Home screen background behavior
  enableHomeHeroBackground: boolean; // Enable dynamic hero background on Home
  // Trailer settings
  showTrailers: boolean; // Enable/disable trailer playback in hero section
  trailerMuted: boolean; // Default to muted for better user experience
  // AI
  aiChatEnabled: boolean; // Enable/disable Ask AI and AI features
  // Metadata enrichment
  enrichMetadataWithTMDB: boolean; // Master switch - use TMDB to enrich metadata
  useTmdbLocalizedMetadata: boolean; // Use TMDB localized metadata (titles, overviews) per tmdbLanguagePreference
  // Granular TMDB enrichment controls (only apply when enrichMetadataWithTMDB is true)
  tmdbEnrichCast: boolean; // Use TMDB cast data (actors, directors, crew)
  tmdbEnrichLogos: boolean; // Use TMDB title logos
  tmdbEnrichBanners: boolean; // Use TMDB backdrop/banner images
  tmdbEnrichCertification: boolean; // Show TMDB content certification (PG-13, R, etc.)
  tmdbEnrichRecommendations: boolean; // Show TMDB recommendations
  tmdbEnrichEpisodes: boolean; // Use TMDB episode data (thumbnails, info, fallbacks)
  tmdbEnrichSeasonPosters: boolean; // Use TMDB season posters
  tmdbEnrichProductionInfo: boolean; // Show networks/production companies with logos
  tmdbEnrichMovieDetails: boolean; // Show movie details (budget, revenue, tagline, etc.)
  tmdbEnrichTvDetails: boolean; // Show TV details (status, seasons count, networks, etc.)
  tmdbEnrichCollections: boolean; // Show movie collections/franchises
  tmdbEnrichTitleDescription: boolean; // Use TMDB title/description (overrides addon when localization enabled)
  // Trakt integration
  showTraktComments: boolean; // Show Trakt comments in metadata screens
  // Continue Watching behavior
  useCachedStreams: boolean; // Enable/disable direct player navigation from Continue Watching cache
  openMetadataScreenWhenCacheDisabled: boolean; // When cache disabled, open MetadataScreen instead of StreamsScreen
  streamCacheTTL: number; // Stream cache duration in milliseconds (default: 1 hour)
  continueWatchingCardStyle: 'wide' | 'poster'; // Card style: 'wide' (horizontal) or 'poster' (vertical)
  enableStreamsBackdrop: boolean; // Enable blurred backdrop background on StreamsScreen mobile
  useExternalPlayerForDownloads: boolean; // Enable/disable external player for downloaded content
  // Android MPV player settings
  videoPlayerEngine: 'auto' | 'mpv'; // Video player engine: auto (ExoPlayer primary, MPV fallback) or mpv (MPV only)
  decoderMode: 'auto' | 'sw' | 'hw' | 'hw+'; // Decoder mode: auto (auto-copy), sw (software), hw (mediacodec-copy), hw+ (mediacodec)
  gpuMode: 'gpu' | 'gpu-next'; // GPU rendering mode: gpu (standard) or gpu-next (advanced HDR/color)
  showDiscover: boolean;
  // Audio/Subtitle Language Preferences
  preferredSubtitleLanguage: string; // Preferred language for subtitles (ISO 639-1 code, e.g., 'en', 'es', 'fr')
  preferredAudioLanguage: string; // Preferred language for audio tracks (ISO 639-1 code)
  subtitleSourcePreference: 'internal' | 'external' | 'any'; // Prefer internal (embedded), external (addon), or any
  enableSubtitleAutoSelect: boolean; // Auto-select subtitles based on preferences
  // Upscaler settings
  enableShaders: boolean; // Enable/disable real-time upscalers
  shaderProfile: 'MID-END' | 'HIGH-END'; // Hardware profile for upscalers
  defaultShaderMode: string; // Persisted shader preset (e.g. 'Anime4K: Mode A')
}

export const DEFAULT_SETTINGS: AppSettings = {
  enableDarkMode: true,
  enableNotifications: true,
  streamQuality: 'auto',
  enableSubtitles: true,
  enableBackgroundPlayback: false,
  cacheLimit: 1024,
  useExternalPlayer: false,
  preferredPlayer: 'internal',
  showHeroSection: true,
  showThisWeekSection: true, // Enabled by default
  featuredContentSource: 'catalogs',
  heroStyle: 'appletv',
  selectedHeroCatalogs: [], // Empty array means all catalogs are selected
  logoSourcePreference: 'tmdb', // Default to TMDB as first source
  tmdbLanguagePreference: 'en', // Default to English
  episodeLayoutStyle: 'vertical', // Default to vertical layout for new installs
  autoplayBestStream: false, // Disabled by default for user choice
  // Local scraper defaults
  scraperRepositoryUrl: '',
  enableLocalScrapers: true,
  scraperTimeout: 60, // 60 seconds timeout
  streamDisplayMode: 'separate', // Default to separate display by provider
  streamSortMode: 'scraper-then-quality', // Default to current behavior (scraper first, then quality)
  showScraperLogos: true, // Show scraper logos by default
  // Quality filtering defaults
  excludedQualities: [], // No qualities excluded by default
  // Language filtering defaults
  excludedLanguages: [], // No languages excluded by default
  // Playback behavior defaults
  alwaysResume: true,
  skipIntroEnabled: true,
  introSubmitEnabled: false,
  introDbApiKey: '',
  // Downloads
  enableDownloads: false,
  useExternalPlayerForDownloads: false,
  // Theme defaults
  themeId: 'default',
  customThemes: [],
  useDominantBackgroundColor: false,
  // Home screen poster customization
  posterSize: 'medium',
  posterBorderRadius: 12,
  postersPerRow: 4,
  showPosterTitles: true,
  enableHomeHeroBackground: true,
  // Trailer settings
  showTrailers: false, // Trailers disabled by default
  trailerMuted: true, // Default to muted for better user experience
  // AI
  aiChatEnabled: false,
  // Metadata enrichment
  enrichMetadataWithTMDB: true,
  useTmdbLocalizedMetadata: false,
  // Granular TMDB enrichment controls (all enabled by default for backward compatibility)
  tmdbEnrichCast: true,
  tmdbEnrichLogos: true,
  tmdbEnrichBanners: true,
  tmdbEnrichCertification: true,
  tmdbEnrichRecommendations: true,
  tmdbEnrichEpisodes: true,
  tmdbEnrichSeasonPosters: true,
  tmdbEnrichProductionInfo: true,
  tmdbEnrichMovieDetails: true,
  tmdbEnrichTvDetails: true,
  tmdbEnrichCollections: true,
  tmdbEnrichTitleDescription: true, // Enabled by default for backward compatibility
  // Trakt integration
  showTraktComments: true, // Show Trakt comments by default when authenticated
  // Continue Watching behavior
  useCachedStreams: false, // Enable by default
  openMetadataScreenWhenCacheDisabled: true, // Default to StreamsScreen when cache disabled
  streamCacheTTL: 60 * 60 * 1000, // Default: 1 hour in milliseconds
  continueWatchingCardStyle: 'wide', // Default to wide (horizontal) card style
  enableStreamsBackdrop: true, // Enable by default (new behavior)
  // Android MPV player settings
  videoPlayerEngine: 'auto', // Default to auto (ExoPlayer primary, MPV fallback)
  decoderMode: 'auto', // Default to auto (best compatibility and performance)
  gpuMode: 'gpu', // Default to gpu (gpu-next for advanced HDR)
  showDiscover: true, // Show Discover section in SearchScreen
  // Audio/Subtitle Language Preferences
  preferredSubtitleLanguage: 'en', // Default to English subtitles
  preferredAudioLanguage: 'en', // Default to English audio
  subtitleSourcePreference: 'internal', // Prefer internal/embedded subtitles first
  enableSubtitleAutoSelect: true, // Auto-select subtitles by default
  // Upscaler defaults
  enableShaders: false,
  shaderProfile: 'MID-END',
  defaultShaderMode: 'none',
};

const SETTINGS_STORAGE_KEY = 'app_settings';

// Singleton settings cache
let cachedSettings: AppSettings | null = null;
let settingsCacheTimestamp = 0;
const SETTINGS_CACHE_TTL = 60000; // 1 minute

export const useSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    loadSettings();

    // Subscribe to settings changes
    const unsubscribe = settingsEmitter.addListener(() => {
      loadSettings();
    });

    return unsubscribe;
  }, []);

  const loadSettings = async () => {
    try {
      // Use cached settings if available and fresh
      const now = Date.now();
      if (cachedSettings && (now - settingsCacheTimestamp) < SETTINGS_CACHE_TTL) {
        setSettings(cachedSettings);
        setIsLoaded(true);
        return;
      }

      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const scopedKey = `@user:${scope}:${SETTINGS_STORAGE_KEY}`;

      // Use synchronous MMKV reads for better performance
      const [scopedJson, legacyJson] = await Promise.all([
        mmkvStorage.getItem(scopedKey),
        mmkvStorage.getItem(SETTINGS_STORAGE_KEY),
      ]);

      const parsedScoped = scopedJson ? JSON.parse(scopedJson) : null;
      const parsedLegacy = legacyJson ? JSON.parse(legacyJson) : null;

      let merged = parsedScoped || parsedLegacy;

      // Simplified fallback - only use getAllKeys if absolutely necessary
      if (!merged) {
        // Use string search on MMKV storage instead of getAllKeys for performance
        const scoped = mmkvStorage.getString(scopedKey);
        if (scoped) {
          try {
            merged = JSON.parse(scoped);
          } catch { }
        }
      }

      const finalSettings = merged ? { ...DEFAULT_SETTINGS, ...merged } : DEFAULT_SETTINGS;

      // Update cache
      cachedSettings = finalSettings;
      settingsCacheTimestamp = now;

      setSettings(finalSettings);
    } catch (error) {
      if (__DEV__) console.error('Failed to load settings:', error);
      // Fallback to default settings on error
      setSettings(DEFAULT_SETTINGS);
    }
    finally {
      // Mark settings as loaded so UI can render with correct values without flicker
      setIsLoaded(true);
    }
  };

  const updateSetting = useCallback(async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
    emitEvent: boolean = true
  ) => {
    const newSettings = { ...settings, [key]: value };
    try {
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const scopedKey = `@user:${scope}:${SETTINGS_STORAGE_KEY}`;
      // Write to both scoped key (multi-user aware) and legacy key for backward compatibility
      await Promise.all([
        mmkvStorage.setItem(scopedKey, JSON.stringify(newSettings)),
        mmkvStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings)),
      ]);
      // Ensure a current scope exists to avoid future loads missing the chosen scope
      await mmkvStorage.setItem('@user:current', scope);

      // Update cache
      cachedSettings = newSettings;
      settingsCacheTimestamp = Date.now();

      setSettings(newSettings);
      if (__DEV__) console.log(`Setting updated: ${key}`, value);

      // Notify all subscribers that settings have changed (if requested)
      if (emitEvent) {
        if (__DEV__) console.log('Emitting settings change event');
        settingsEmitter.emit();
      }

    } catch (error) {
      if (__DEV__) console.error('Failed to save settings:', error);
    }
  }, [settings]);

  return {
    settings,
    updateSetting,
    isLoaded,
  };
};

export default useSettings;
