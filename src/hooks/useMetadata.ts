import { useState, useEffect, useCallback, useRef } from 'react';
import { StreamingContent } from '../services/catalogService';
import { catalogService } from '../services/catalogService';
import { stremioService } from '../services/stremioService';
import { tmdbService } from '../services/tmdbService';
import { cacheService } from '../services/cacheService';
import { localScraperService, ScraperInfo } from '../services/pluginService';
import { Cast, Episode, GroupedEpisodes, GroupedStreams } from '../types/metadata';
import { TMDBService } from '../services/tmdbService';
import { logger } from '../utils/logger';
import { usePersistentSeasons } from './usePersistentSeasons';
import { mmkvStorage } from '../services/mmkvStorage';
import { Stream } from '../types/metadata';
import { storageService } from '../services/storageService';
import { useSettings } from './useSettings';

// Constants for timeouts and retries
const API_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 1; // Reduced since stremioService already retries
const RETRY_DELAY = 1000; // 1 second

// Utility function to add timeout to promises
const withTimeout = <T>(promise: Promise<T>, timeout: number, fallback?: T): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((resolve, reject) =>
      setTimeout(() => fallback ? resolve(fallback) : reject(new Error('Request timed out')), timeout)
    )
  ]);
};

// Utility function for parallel loading with fallback
const loadWithFallback = async <T>(
  loadFn: () => Promise<T>,
  fallback: T,
  timeout: number = API_TIMEOUT
): Promise<T> => {
  try {
    return await withTimeout(loadFn(), timeout, fallback);
  } catch (error) {
    logger.error('Loading failed, using fallback:', error);
    return fallback;
  }
};

// Utility function to retry failed requests
const withRetry = async <T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = RETRY_DELAY
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    await new Promise(resolve => setTimeout(resolve, delay));
    return withRetry(fn, retries - 1, delay);
  }
};

interface UseMetadataProps {
  id: string;
  type: string;
  addonId?: string;
}

interface ScraperStatus {
  id: string;
  name: string;
  isLoading: boolean;
  hasCompleted: boolean;
  error: string | null;
  startTime: number;
  endTime: number | null;
}

interface UseMetadataReturn {
  metadata: StreamingContent | null;
  loading: boolean;
  error: string | null;
  cast: Cast[];
  loadingCast: boolean;
  episodes: Episode[];
  groupedEpisodes: GroupedEpisodes;
  selectedSeason: number;
  tmdbId: number | null;
  loadingSeasons: boolean;
  groupedStreams: GroupedStreams;
  loadingStreams: boolean;
  episodeStreams: GroupedStreams;
  loadingEpisodeStreams: boolean;
  addonResponseOrder: string[];
  preloadedStreams: GroupedStreams;
  preloadedEpisodeStreams: { [episodeId: string]: GroupedStreams };
  selectedEpisode: string | null;
  inLibrary: boolean;
  loadMetadata: () => Promise<void>;
  loadStreams: () => Promise<void>;
  loadEpisodeStreams: (episodeId: string) => Promise<void>;
  handleSeasonChange: (seasonNumber: number) => void;
  toggleLibrary: () => void;
  setSelectedEpisode: (episodeId: string | null) => void;
  setEpisodeStreams: (streams: GroupedStreams) => void;
  recommendations: StreamingContent[];
  loadingRecommendations: boolean;
  setMetadata: React.Dispatch<React.SetStateAction<StreamingContent | null>>;
  imdbId: string | null;
  scraperStatuses: ScraperStatus[];
  activeFetchingScrapers: string[];
  collectionMovies: StreamingContent[];
  loadingCollection: boolean;
}

export const useMetadata = ({ id, type, addonId }: UseMetadataProps): UseMetadataReturn => {
  const { settings, isLoaded: settingsLoaded } = useSettings();
  const [metadata, setMetadata] = useState<StreamingContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cast, setCast] = useState<Cast[]>([]);
  const [loadingCast, setLoadingCast] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [groupedEpisodes, setGroupedEpisodes] = useState<GroupedEpisodes>({});
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [tmdbId, setTmdbId] = useState<number | null>(null);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [groupedStreams, setGroupedStreams] = useState<GroupedStreams>({});
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [episodeStreams, setEpisodeStreams] = useState<GroupedStreams>({});
  const [loadingEpisodeStreams, setLoadingEpisodeStreams] = useState(false);
  const [preloadedStreams, setPreloadedStreams] = useState<GroupedStreams>({});
  const [preloadedEpisodeStreams, setPreloadedEpisodeStreams] = useState<{ [episodeId: string]: GroupedStreams }>({});
  const [selectedEpisode, setSelectedEpisode] = useState<string | null>(null);
  const [inLibrary, setInLibrary] = useState(false);
  const [loadAttempts, setLoadAttempts] = useState(0);
  const [recommendations, setRecommendations] = useState<StreamingContent[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [collectionMovies, setCollectionMovies] = useState<StreamingContent[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [imdbId, setImdbId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [availableStreams, setAvailableStreams] = useState<{ [sourceType: string]: Stream }>({});
  const [scraperStatuses, setScraperStatuses] = useState<ScraperStatus[]>([]);
  const [activeFetchingScrapers, setActiveFetchingScrapers] = useState<string[]>([]);
  // Track response order for addons to preserve actual response order
  const [addonResponseOrder, setAddonResponseOrder] = useState<string[]>([]);
  // Prevent re-initializing season selection repeatedly for the same series
  const initializedSeasonRef = useRef(false);

  // Memory optimization: Track stream counts and implement cleanup (limits removed)
  const streamCountRef = useRef(0);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Add hook for persistent seasons
  const { getSeason, saveSeason } = usePersistentSeasons();

  // Memory optimization: Stream cleanup and garbage collection
  const cleanupStreams = useCallback(() => {
    if (__DEV__) console.log('[useMetadata] Running stream cleanup to free memory');

    // Clear preloaded streams cache
    setPreloadedStreams({});
    setPreloadedEpisodeStreams({});

    // Reset stream count
    streamCountRef.current = 0;

    // Force garbage collection if available (development only)
    if (__DEV__ && global.gc) {
      global.gc();
    }
  }, []);

  // Memory optimization: Debounced stream state updates
  const debouncedStreamUpdate = useCallback((updateFn: () => void) => {
    // Clear existing timeout
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
    }

    // Set new timeout for cleanup
    cleanupTimeoutRef.current = setTimeout(() => {
      cleanupStreams();
    }, 30000); // Cleanup after 30 seconds of inactivity

    // Execute the update
    updateFn();
  }, [cleanupStreams]);

  // Memory optimization: Lightly optimize stream data (no sorting or limiting)
  const optimizeStreams = useCallback((streams: Stream[]): Stream[] => {
    if (!streams || streams.length === 0) return streams;
    return streams.map(stream => ({
      ...stream,
      description: stream.description && stream.description.length > 200
        ? stream.description.substring(0, 200) + '...'
        : stream.description,
      behaviorHints: stream.behaviorHints ? {
        cached: stream.behaviorHints.cached,
        notWebReady: stream.behaviorHints.notWebReady,
        bingeGroup: stream.behaviorHints.bingeGroup,
      } : undefined,
    }));
  }, []);

  const processStremioSource = async (type: string, id: string, isEpisode = false) => {
    const sourceStartTime = Date.now();
    const logPrefix = isEpisode ? 'loadEpisodeStreams' : 'loadStreams';
    const sourceName = 'stremio';

    if (__DEV__) logger.log(`🔍 [${logPrefix}:${sourceName}] Starting fetch`);

    try {
      await stremioService.getStreams(type, id,
        (streams, addonId, addonName, error, installationId) => {
          const processTime = Date.now() - sourceStartTime;

          console.log('🔍 [processStremioSource] Callback received:', {
            addonId,
            addonName,
            installationId,
            streamCount: streams?.length || 0,
            error: error?.message || null,
            processTime
          });

          // ALWAYS remove from active fetching list when callback is received
          // This ensures that even failed scrapers are removed from the "Fetching from:" chip
          if (addonName) {
            setActiveFetchingScrapers(prev => {
              const updated = prev.filter(name => name !== addonName);
              console.log('🔍 [processStremioSource] Removing from activeFetchingScrapers:', {
                addonName,
                before: prev,
                after: updated
              });
              return updated;
            });
          }

          // Update scraper status when we get a callback
          if (addonId && addonName) {
            setScraperStatuses(prevStatuses => {
              const existingIndex = prevStatuses.findIndex(s => s.id === addonId);
              const newStatus: ScraperStatus = {
                id: addonId,
                name: addonName,
                isLoading: false,
                hasCompleted: true,
                error: error ? error.message : null,
                startTime: sourceStartTime,
                endTime: Date.now()
              };

              if (existingIndex >= 0) {
                const updated = [...prevStatuses];
                updated[existingIndex] = newStatus;
                return updated;
              } else {
                return [...prevStatuses, newStatus];
              }
            });
          }

          if (error) {
            logger.error(`❌ [${logPrefix}:${sourceName}] Error for addon ${addonName} (${addonId}):`, error);
          } else if (streams && addonId && addonName) {
            if (__DEV__) logger.log(`✅ [${logPrefix}:${sourceName}] Received ${streams.length} streams from ${addonName} (${addonId}) after ${processTime}ms`);

            if (streams.length > 0) {
              // Optimize streams before storing
              const optimizedStreams = optimizeStreams(streams);
              streamCountRef.current += optimizedStreams.length;

              if (__DEV__) logger.log(`📊 [${logPrefix}:${sourceName}] Optimized ${streams.length} → ${optimizedStreams.length} streams, total: ${streamCountRef.current}`);

              // Use debounced update to prevent rapid state changes
              debouncedStreamUpdate(() => {
                const updateState = (prevState: GroupedStreams): GroupedStreams => {
                  // Use installationId as key to keep multiple installations separate
                  const key = installationId || addonId || 'unknown';
                  if (__DEV__) logger.log(`🔄 [${logPrefix}:${sourceName}] Updating state for addon ${addonName} (${addonId}) [${installationId}]`);
                  return {
                    ...prevState,
                    [key]: {
                      addonName: addonName,
                      streams: optimizedStreams // Use optimized streams
                    }
                  };
                };

                // Track response order for addons (use installationId to track each installation separately)
                setAddonResponseOrder(prevOrder => {
                  const key = installationId || addonId || 'unknown';
                  if (!prevOrder.includes(key)) {
                    return [...prevOrder, key];
                  }
                  return prevOrder;
                });

                if (isEpisode) {
                  setEpisodeStreams(updateState);
                  setLoadingEpisodeStreams(false);
                } else {
                  setGroupedStreams(updateState);
                  setLoadingStreams(false);
                }
              });
            } else {
              // Even providers with no streams should be added to the streams object
              // This ensures streamsEmpty becomes false and UI shows available streams progressively
              if (__DEV__) logger.log(`🤷 [${logPrefix}:${sourceName}] No streams found for addon ${addonName} (${addonId})`);

              debouncedStreamUpdate(() => {
                const updateState = (prevState: GroupedStreams): GroupedStreams => {
                  // Use installationId as key to keep multiple installations separate
                  const key = installationId || addonId || 'unknown';
                  if (__DEV__) logger.log(`🔄 [${logPrefix}:${sourceName}] Adding empty provider ${addonName} (${addonId}) [${installationId}] to state`);
                  return {
                    ...prevState,
                    [key]: {
                      addonName: addonName,
                      streams: [] // Empty array for providers with no streams
                    }
                  };
                };

                // Track response order for addons (use installationId to track each installation separately)
                setAddonResponseOrder(prevOrder => {
                  const key = installationId || addonId || 'unknown';
                  if (!prevOrder.includes(key)) {
                    return [...prevOrder, key];
                  }
                  return prevOrder;
                });

                if (isEpisode) {
                  setEpisodeStreams(updateState);
                  setLoadingEpisodeStreams(false);
                } else {
                  setGroupedStreams(updateState);
                  setLoadingStreams(false);
                }
              });
            }
          } else {
            // Handle case where callback provides null streams without error (e.g., empty results)
            if (__DEV__) logger.log(`🏁 [${logPrefix}:${sourceName}] Finished fetching for addon ${addonName} (${addonId}) with no streams after ${processTime}ms`);
          }
        }
      );
      // The function now returns void, just await to let callbacks fire
      if (__DEV__) logger.log(`🏁 [${logPrefix}:${sourceName}] Stremio fetching process initiated`);
    } catch (error) {
      // Catch errors from the initial call to getStreams (e.g., initialization errors)
      logger.error(`❌ [${logPrefix}:${sourceName}] Initial call failed:`, error);

      // Remove all addons and scrapers from active fetching since the entire request failed
      setActiveFetchingScrapers(prev => {
        // Get both Stremio addon names and local scraper names
        const stremioAddons = stremioService.getInstalledAddons();
        const stremioNames = stremioAddons.map(addon => addon.name);

        // Get local scraper names
        localScraperService.getInstalledScrapers().then(localScrapers => {
          const localScraperNames = localScrapers.filter(s => s.enabled).map(s => s.name);
          const allNames = [...stremioNames, ...localScraperNames];

          // Remove all from active fetching
          setActiveFetchingScrapers(current =>
            current.filter(name => !allNames.includes(name))
          );
        }).catch(() => {
          // If we can't get local scrapers, just remove Stremio addons
          setActiveFetchingScrapers(current =>
            current.filter(name => !stremioNames.includes(name))
          );
        });

        // Immediately remove Stremio addons (local scrapers will be removed async above)
        return prev.filter(name => !stremioNames.includes(name));
      });

      // Update scraper statuses to mark all scrapers as failed
      setScraperStatuses(prevStatuses => {
        const stremioAddons = stremioService.getInstalledAddons();

        return prevStatuses.map(status => {
          const isStremioAddon = stremioAddons.some(addon => addon.id === status.id || addon.name === status.name);

          // Mark both Stremio addons and local scrapers as failed
          if (isStremioAddon || !status.hasCompleted) {
            return {
              ...status,
              isLoading: false,
              hasCompleted: true,
              error: error instanceof Error ? error.message : 'Initial request failed',
              endTime: Date.now()
            };
          }
          return status;
        });
      });
    }
    // Note: This function completes when getStreams returns, not when all callbacks have fired.
    // Loading indicators should probably be managed based on callbacks completing.
  };

  const loadCast = async () => {
    if (__DEV__) logger.log('[loadCast] Starting cast fetch for:', id);
    setLoadingCast(true);
    try {
      // Check both master switch AND granular cast setting
      if (!settings.enrichMetadataWithTMDB || !settings.tmdbEnrichCast) {
        if (__DEV__) logger.log('[loadCast] TMDB cast enrichment disabled by settings');

        // Check if we have addon cast data available
        if (metadata?.addonCast && metadata.addonCast.length > 0) {
          if (__DEV__) logger.log(`[loadCast] Using addon cast data: ${metadata.addonCast.length} cast members`);
          setCast(metadata.addonCast);
          setLoadingCast(false);
          return;
        }

        if (__DEV__) logger.log('[loadCast] No addon cast data available');
        setLoadingCast(false);
        return;
      }
      // Check cache first
      const cachedCast = cacheService.getCast(id, type);
      if (cachedCast) {
        if (__DEV__) logger.log('[loadCast] Using cached cast data');
        setCast(cachedCast);
        setLoadingCast(false);
        return;
      }

      // Handle TMDB IDs
      if (id.startsWith('tmdb:')) {
        const tmdbId = id.split(':')[1];
        if (__DEV__) logger.log('[loadCast] Using TMDB ID directly:', tmdbId);
        const castData = await tmdbService.getCredits(parseInt(tmdbId), type);
        if (castData && castData.cast) {
          const formattedCast = castData.cast.map((actor: any) => ({
            id: actor.id,
            name: actor.name,
            character: actor.character,
            profile_path: actor.profile_path
          }));
          if (__DEV__) logger.log(`[loadCast] Found ${formattedCast.length} cast members from TMDB`);
          setCast(formattedCast);
          cacheService.setCast(id, type, formattedCast);
          setLoadingCast(false);
          return;
        }
      }

      // Handle IMDb IDs or convert to TMDB ID (only if enrichment is enabled)
      let tmdbId;
      if (id.startsWith('tt') && settings.enrichMetadataWithTMDB) {
        if (__DEV__) logger.log('[loadCast] Converting IMDb ID to TMDB ID');
        tmdbId = await tmdbService.findTMDBIdByIMDB(id);
      }

      if (tmdbId) {
        if (__DEV__) logger.log('[loadCast] Fetching cast using TMDB ID:', tmdbId);
        const castData = await tmdbService.getCredits(tmdbId, type);
        if (castData && castData.cast) {
          const formattedCast = castData.cast.map((actor: any) => ({
            id: actor.id,
            name: actor.name,
            character: actor.character,
            profile_path: actor.profile_path
          }));
          if (__DEV__) logger.log(`[loadCast] Found ${formattedCast.length} cast members`);
          setCast(formattedCast);
          cacheService.setCast(id, type, formattedCast);
        }
      } else {
        if (__DEV__) logger.warn('[loadCast] Could not find TMDB ID for cast fetch');
      }
    } catch (error) {
      logger.error('[loadCast] Failed to load cast:', error);
      // Don't clear existing cast data on error
    } finally {
      setLoadingCast(false);
    }
  };

  const loadMetadata = async () => {
    try {
      console.log('🔍 [useMetadata] loadMetadata started:', {
        id,
        type,
        addonId,
        loadAttempts,
        maxRetries: MAX_RETRIES,
        settingsLoaded: settingsLoaded
      });

      if (loadAttempts >= MAX_RETRIES) {
        console.log('🔍 [useMetadata] Max retries exceeded:', { loadAttempts, maxRetries: MAX_RETRIES });
        setError(`Failed to load content after ${MAX_RETRIES + 1} attempts. Please check your connection and try again.`);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setLoadAttempts(prev => prev + 1);

      // Check metadata screen cache
      const cachedScreen = cacheService.getMetadataScreen(id, type);
      if (cachedScreen) {
        console.log('🔍 [useMetadata] Using cached metadata:', {
          id,
          type,
          hasMetadata: !!cachedScreen.metadata,
          hasCast: !!cachedScreen.cast,
          hasEpisodes: !!cachedScreen.episodes,
          tmdbId: cachedScreen.tmdbId
        });
        setMetadata(cachedScreen.metadata);
        setCast(cachedScreen.cast);
        if (type === 'series' && cachedScreen.episodes) {
          setGroupedEpisodes(cachedScreen.episodes.groupedEpisodes);
          setEpisodes(cachedScreen.episodes.currentEpisodes);
          setSelectedSeason(cachedScreen.episodes.selectedSeason);
          setTmdbId(cachedScreen.tmdbId);
        }
        // Check if item is in library
        (async () => {
          const items = await catalogService.getLibraryItems();
          const isInLib = items.some(item => item.id === id);
          setInLibrary(isInLib);
        })();
        setLoading(false);
        return;
      } else {
        console.log('🔍 [useMetadata] No cached metadata found, proceeding with fresh fetch');
      }

      // Handle TMDB-specific IDs
      let actualId = id;
      if (id.startsWith('tmdb:')) {
        // Always try the original TMDB ID first - let addons decide if they support it
        console.log('🔍 [useMetadata] TMDB ID detected, trying original ID first:', { originalId: id });

        // If enrichment disabled, try original ID first, then fallback to conversion if needed
        if (!settings.enrichMetadataWithTMDB) {
          // Keep the original TMDB ID - let the addon system handle it dynamically
          actualId = id;
          console.log('🔍 [useMetadata] TMDB enrichment disabled, using original TMDB ID:', { actualId });
        } else {
          const tmdbId = id.split(':')[1];
          // For TMDB IDs, we need to handle metadata differently
          if (type === 'movie') {
            if (__DEV__) logger.log('Fetching movie details from TMDB for:', tmdbId);
            const movieDetails = await tmdbService.getMovieDetails(
              tmdbId,
              settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en'
            );
            if (movieDetails) {
              const imdbId = movieDetails.imdb_id || movieDetails.external_ids?.imdb_id;
              if (imdbId) {
                // Use the imdbId for compatibility with the rest of the app
                actualId = imdbId;
                setImdbId(imdbId);
                // Also store the TMDB ID for later use
                setTmdbId(parseInt(tmdbId));
              } else {
                // If no IMDb ID, directly call loadTMDBMovie (create this function if needed)
                const formattedMovie: StreamingContent = {
                  id: `tmdb:${tmdbId}`,
                  type: 'movie',
                  name: movieDetails.title,
                  poster: tmdbService.getImageUrl(movieDetails.poster_path) || '',
                  banner: tmdbService.getImageUrl(movieDetails.backdrop_path) || '',
                  description: movieDetails.overview || '',
                  year: movieDetails.release_date ? parseInt(movieDetails.release_date.substring(0, 4)) : undefined,
                  genres: movieDetails.genres?.map((g: { name: string }) => g.name) || [],
                  inLibrary: false,
                };

                // OPTIMIZATION: Fetch credits and logo in parallel instead of sequentially
                const preferredLanguage = settings.tmdbLanguagePreference || 'en';
                const [creditsResult, logoResult] = await Promise.allSettled([
                  tmdbService.getCredits(parseInt(tmdbId), 'movie'),
                  tmdbService.getContentLogo('movie', tmdbId, preferredLanguage)
                ]);

                // Process credits result
                if (creditsResult.status === 'fulfilled' && creditsResult.value?.crew) {
                  const credits = creditsResult.value;
                  // Extract directors
                  const directors = credits.crew
                    .filter((person: any) => person.job === 'Director')
                    .map((person: any) => person.name);

                  // Extract creators/writers
                  const writers = credits.crew
                    .filter((person: any) => ['Writer', 'Screenplay'].includes(person.job))
                    .map((person: any) => person.name);

                  // Add to formatted movie
                  if (directors.length > 0) {
                    (formattedMovie as any).directors = directors;
                    (formattedMovie as StreamingContent & { director: string }).director = directors.join(', ');
                  }

                  if (writers.length > 0) {
                    (formattedMovie as any).creators = writers;
                    (formattedMovie as any).writer = writers;
                  }
                } else if (creditsResult.status === 'rejected') {
                  logger.error('Failed to fetch credits for movie:', creditsResult.reason);
                }

                // Process logo result
                if (logoResult.status === 'fulfilled') {
                  formattedMovie.logo = logoResult.value || undefined;
                  if (__DEV__) logger.log(`Successfully fetched logo for movie ${tmdbId} from TMDB`);
                } else {
                  logger.error('Failed to fetch logo from TMDB:', logoResult.reason);
                  formattedMovie.logo = undefined;
                }

                setMetadata(formattedMovie);
                cacheService.setMetadata(id, type, formattedMovie);
                (async () => {
                  const items = await catalogService.getLibraryItems();
                  const isInLib = items.some(item => item.id === id);
                  setInLibrary(isInLib);
                })();
                setLoading(false);
                return;
              }
            }
          } else if (type === 'series') {
            // Handle TV shows with TMDB IDs
            if (__DEV__) logger.log('Fetching TV show details from TMDB for:', tmdbId);
            try {
              const showDetails = await tmdbService.getTVShowDetails(
                parseInt(tmdbId),
                settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en'
              );
              if (showDetails) {
                // OPTIMIZATION: Fetch external IDs, credits, and logo in parallel
                const preferredLanguage = settings.tmdbLanguagePreference || 'en';
                const [externalIdsResult, creditsResult, logoResult] = await Promise.allSettled([
                  tmdbService.getShowExternalIds(parseInt(tmdbId)),
                  tmdbService.getCredits(parseInt(tmdbId), 'series'),
                  tmdbService.getContentLogo('tv', tmdbId, preferredLanguage)
                ]);

                const externalIds = externalIdsResult.status === 'fulfilled' ? externalIdsResult.value : null;
                const imdbId = externalIds?.imdb_id;

                if (imdbId) {
                  // Use the imdbId for compatibility with the rest of the app
                  actualId = imdbId;
                  setImdbId(imdbId);
                  // Also store the TMDB ID for later use
                  setTmdbId(parseInt(tmdbId));
                } else {
                  // If no IMDb ID, create formatted show from TMDB data
                  const formattedShow: StreamingContent = {
                    id: `tmdb:${tmdbId}`,
                    type: 'series',
                    name: showDetails.name,
                    poster: tmdbService.getImageUrl(showDetails.poster_path) || '',
                    banner: tmdbService.getImageUrl(showDetails.backdrop_path) || '',
                    description: showDetails.overview || '',
                    year: showDetails.first_air_date ? parseInt(showDetails.first_air_date.substring(0, 4)) : undefined,
                    genres: showDetails.genres?.map((g: { name: string }) => g.name) || [],
                    inLibrary: false,
                  };

                  // Process credits result (already fetched in parallel)
                  if (creditsResult.status === 'fulfilled' && creditsResult.value?.crew) {
                    const credits = creditsResult.value;
                    // Extract creators
                    const creators = credits.crew
                      .filter((person: any) =>
                        person.job === 'Creator' ||
                        person.job === 'Series Creator' ||
                        person.department === 'Production' ||
                        person.job === 'Executive Producer'
                      )
                      .map((person: any) => person.name);

                    if (creators.length > 0) {
                      (formattedShow as any).creators = creators.slice(0, 3);
                    }
                  } else if (creditsResult.status === 'rejected') {
                    logger.error('Failed to fetch credits for TV show:', creditsResult.reason);
                  }

                  // Process logo result (already fetched in parallel)
                  if (logoResult.status === 'fulfilled') {
                    formattedShow.logo = logoResult.value || undefined;
                    if (__DEV__) logger.log(`Successfully fetched logo for TV show ${tmdbId} from TMDB`);
                  } else {
                    logger.error('Failed to fetch logo from TMDB:', (logoResult as PromiseRejectedResult).reason);
                    formattedShow.logo = undefined;
                  }

                  setMetadata(formattedShow);
                  cacheService.setMetadata(id, type, formattedShow);

                  // Load series data (episodes)
                  setTmdbId(parseInt(tmdbId));
                  loadSeriesData().catch((error) => { if (__DEV__) console.error(error); });

                  (async () => {
                    const items = await catalogService.getLibraryItems();
                    const isInLib = items.some(item => item.id === id);
                    setInLibrary(isInLib);
                  })();
                  setLoading(false);
                  return;
                }
              }
            } catch (error) {
              logger.error('Failed to fetch TV show details from TMDB:', error);
            }
          }
        }
      }

      // Load all data in parallel
      console.log('🔍 [useMetadata] Starting parallel data fetch:', { type, actualId, addonId, apiTimeout: API_TIMEOUT });
      if (__DEV__) logger.log('[loadMetadata] fetching addon metadata', { type, actualId, addonId });

      let contentResult = null;
      let lastError = null;

      // Try with original ID first
      try {
        console.log('🔍 [useMetadata] Attempting metadata fetch with original ID:', { type, actualId, addonId });
        const [content, castData] = await Promise.allSettled([
          // Load content with timeout and retry
          withRetry(async () => {
            console.log('🔍 [useMetadata] Calling catalogService.getEnhancedContentDetails:', { type, actualId, addonId });
            const result = await withTimeout(
              catalogService.getEnhancedContentDetails(type, actualId, addonId),
              API_TIMEOUT
            );
            // Store the actual ID used (could be IMDB)
            if (actualId.startsWith('tt')) {
              setImdbId(actualId);
            }
            console.log('🔍 [useMetadata] catalogService.getEnhancedContentDetails result:', {
              hasResult: Boolean(result),
              resultId: result?.id,
              resultName: result?.name,
              resultType: result?.type
            });
            if (__DEV__) logger.log('[loadMetadata] addon metadata fetched', { hasResult: Boolean(result) });
            return result;
          }),
          // Start loading cast immediately in parallel
          loadCast()
        ]);

        contentResult = content;
        if (content.status === 'fulfilled' && content.value) {
          console.log('🔍 [useMetadata] Successfully got metadata with original ID');
        } else {
          console.log('🔍 [useMetadata] Original ID failed, will try fallback conversion');
          lastError = (content as any)?.reason;
        }
      } catch (error) {
        console.log('🔍 [useMetadata] Original ID attempt failed:', { error: error instanceof Error ? error.message : String(error) });
        lastError = error;
      }

      // If original TMDB ID failed and enrichment is disabled, try ID conversion as fallback
      if (!contentResult || (contentResult.status === 'fulfilled' && !contentResult.value) || contentResult.status === 'rejected') {
        if (id.startsWith('tmdb:') && !settings.enrichMetadataWithTMDB) {
          console.log('🔍 [useMetadata] Original TMDB ID failed, trying ID conversion fallback');
          const tmdbRaw = id.split(':')[1];
          try {
            const stremioId = await catalogService.getStremioId(type === 'series' ? 'tv' : 'movie', tmdbRaw);
            if (stremioId && stremioId !== id) {
              console.log('🔍 [useMetadata] Trying converted ID:', { originalId: id, convertedId: stremioId });
              const [content, castData] = await Promise.allSettled([
                withRetry(async () => {
                  const result = await withTimeout(
                    catalogService.getEnhancedContentDetails(type, stremioId, addonId),
                    API_TIMEOUT
                  );
                  if (stremioId.startsWith('tt')) {
                    setImdbId(stremioId);
                  }
                  return result;
                }),
                loadCast()
              ]);
              contentResult = content;
            }
          } catch (e) {
            console.log('🔍 [useMetadata] ID conversion fallback also failed:', { error: e instanceof Error ? e.message : String(e) });
          }
        }
      }

      const content = contentResult || { status: 'rejected' as const, reason: lastError || new Error('No content result') };
      const castData = { status: 'fulfilled' as const, value: undefined };

      console.log('🔍 [useMetadata] Promise.allSettled results:', {
        contentStatus: content.status,
        contentFulfilled: content.status === 'fulfilled',
        hasContentValue: content.status === 'fulfilled' ? !!content.value : false,
        castStatus: castData.status,
        castFulfilled: castData.status === 'fulfilled'
      });

      if (content.status === 'fulfilled' && content.value) {
        console.log('🔍 [useMetadata] Content fetch successful:', {
          id: content.value?.id,
          type: content.value?.type,
          name: content.value?.name,
          hasDescription: !!content.value?.description,
          hasPoster: !!content.value?.poster
        });
        if (__DEV__) logger.log('[loadMetadata] addon metadata:success', { id: content.value?.id, type: content.value?.type, name: content.value?.name });

        // Start with addon metadata
        let finalMetadata = content.value as StreamingContent;

        // Store addon logo before TMDB enrichment overwrites it
        const addonLogo = (finalMetadata as any).logo;


        try {
          if (settings.enrichMetadataWithTMDB && settings.tmdbEnrichTitleDescription) {
            const tmdbSvc = TMDBService.getInstance();
            let finalTmdbId: number | null = tmdbId;
            if (!finalTmdbId) {
              finalTmdbId = await tmdbSvc.extractTMDBIdFromStremioId(actualId);
              if (finalTmdbId) setTmdbId(finalTmdbId);
            }

            if (finalTmdbId) {
              const lang = settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en';
              if (type === 'movie') {
                const localized = await tmdbSvc.getMovieDetails(String(finalTmdbId), lang);
                if (localized) {
                  const movieDetailsObj = {
                    status: localized.status,
                    releaseDate: localized.release_date,
                    runtime: localized.runtime,
                    budget: localized.budget,
                    revenue: localized.revenue,
                    originalLanguage: localized.original_language,
                    originCountry: localized.production_countries?.map((c: any) => c.iso_3166_1),
                    tagline: localized.tagline,
                  };
                  const productionInfo = Array.isArray(localized.production_companies)
                    ? localized.production_companies
                      .map((c: any) => ({ id: c?.id, name: c?.name, logo: tmdbSvc.getImageUrl(c?.logo_path, 'w185') }))
                      .filter((c: any) => c && (c.logo || c.name))
                    : [];

                  finalMetadata = {
                    ...finalMetadata,
                    name: localized.title || finalMetadata.name,
                    description: localized.overview || finalMetadata.description,
                    movieDetails: movieDetailsObj,
                    ...(productionInfo.length > 0 && { networks: productionInfo }),
                  };
                }
              } else { // 'series'
                const localized = await tmdbSvc.getTVShowDetails(Number(finalTmdbId), lang);
                if (localized) {
                  const tvDetails = {
                    status: localized.status,
                    firstAirDate: localized.first_air_date,
                    lastAirDate: localized.last_air_date,
                    numberOfSeasons: localized.number_of_seasons,
                    numberOfEpisodes: localized.number_of_episodes,
                    episodeRunTime: localized.episode_run_time,
                    type: localized.type,
                    originCountry: localized.origin_country,
                    originalLanguage: localized.original_language,
                    createdBy: localized.created_by?.map(creator => ({
                      id: creator.id,
                      name: creator.name,
                      profile_path: creator.profile_path || undefined
                    })),
                  };
                  const productionInfo = Array.isArray(localized.networks)
                    ? localized.networks
                      .map((n: any) => ({
                        id: n?.id,
                        name: n?.name,
                        logo: tmdbSvc.getImageUrl(n?.logo_path, 'w185') || undefined
                      }))
                      .filter((n: any) => n && (n.logo || n.name))
                    : [];

                  finalMetadata = {
                    ...finalMetadata,
                    name: localized.name || finalMetadata.name,
                    description: localized.overview || finalMetadata.description,
                    tvDetails,
                    ...(productionInfo.length > 0 && { networks: productionInfo }),
                  };
                }
              }
            }
          }
        } catch (e) {
          if (__DEV__) console.log('[useMetadata] failed to merge TMDB title/description', e);
        }

        // Centralized logo fetching logic
        try {
          // When TMDB enrichment AND logos are enabled, prioritize TMDB logo over addon logo
          if (settings.enrichMetadataWithTMDB && settings.tmdbEnrichLogos) {
            const tmdbService = TMDBService.getInstance();
            const preferredLanguage = settings.tmdbLanguagePreference || 'en';
            const contentType = type === 'series' ? 'tv' : 'movie';

            // Get TMDB ID
            let tmdbIdForLogo = null;
            if (tmdbId) {
              tmdbIdForLogo = String(tmdbId);
            } else if (finalMetadata.imdb_id) {
              const foundId = await tmdbService.findTMDBIdByIMDB(finalMetadata.imdb_id);
              tmdbIdForLogo = foundId ? String(foundId) : null;
            }

            if (tmdbIdForLogo) {
              const logoUrl = await tmdbService.getContentLogo(contentType, tmdbIdForLogo, preferredLanguage);
              // Use TMDB logo if found, otherwise fall back to addon logo
              finalMetadata.logo = logoUrl || addonLogo || undefined;
              if (__DEV__) {
                console.log('[useMetadata] Logo fetch result:', {
                  contentType,
                  tmdbIdForLogo,
                  preferredLanguage,
                  tmdbLogoFound: !!logoUrl,
                  usingAddonFallback: !logoUrl && !!addonLogo,
                  enrichmentEnabled: true
                });
              }
            } else {
              // No TMDB ID, fall back to addon logo
              finalMetadata.logo = addonLogo || undefined;
              if (__DEV__) console.log('[useMetadata] No TMDB ID found for logo, using addon logo');
            }
          } else {
            // When enrichment or logos is OFF, use addon logo
            finalMetadata.logo = addonLogo || finalMetadata.logo || undefined;
            if (__DEV__) {
              console.log('[useMetadata] TMDB logo enrichment disabled, using addon logo:', {
                hasAddonLogo: !!finalMetadata.logo,
                enrichmentEnabled: settings.enrichMetadataWithTMDB,
                logosEnabled: settings.tmdbEnrichLogos
              });
            }
          }
        } catch (error) {
          // Handle error silently, keep existing logo behavior
          if (__DEV__) console.error('[useMetadata] Unexpected error in logo fetch:', error);
          finalMetadata.logo = undefined;
        }

        // Commit final metadata once and cache it
        // Store addon logo as fallback if TMDB enrichment is enabled
        if (settings.enrichMetadataWithTMDB && addonLogo) {
          (finalMetadata as any).addonLogo = addonLogo;
        }

        // Clear banner field if TMDB banner enrichment is enabled to prevent flash
        if (settings.enrichMetadataWithTMDB && settings.tmdbEnrichBanners && !finalMetadata.banner) {
          finalMetadata = {
            ...finalMetadata,
            banner: undefined, // Let useMetadataAssets handle banner via TMDB
          };
        }

        // Preserve existing collection if it was set by fetchProductionInfo
        setMetadata((prev) => {
          const updated = { ...finalMetadata };
          if (prev?.collection) {
            updated.collection = prev.collection;
          }
          return updated;
        });
        cacheService.setMetadata(id, type, finalMetadata);
        (async () => {
          const items = await catalogService.getLibraryItems();
          const isInLib = items.some(item => item.id === id);
          setInLibrary(isInLib);
        })();
      } else {
        // Extract the error from the rejected promise
        const reason = (content as any)?.reason;
        const reasonMessage = reason?.message || String(reason);

        console.log('🔍 [useMetadata] Content fetch failed:', {
          status: content.status,
          reason: reasonMessage,
          fullReason: reason,
          isAxiosError: reason?.isAxiosError,
          responseStatus: reason?.response?.status,
          responseData: reason?.response?.data
        });

        if (__DEV__) {
          console.log('[loadMetadata] addon metadata:not found or failed', {
            status: content.status,
            reason: reasonMessage,
            fullReason: reason
          });
        }

        // Check if this was a network/server error rather than content not found
        if (reasonMessage && (
          reasonMessage.includes('500') ||
          reasonMessage.includes('502') ||
          reasonMessage.includes('503') ||
          reasonMessage.includes('Network Error') ||
          reasonMessage.includes('Request failed')
        )) {
          console.log('🔍 [useMetadata] Detected server/network error, preserving original error');
          // This was a server/network error, preserve the original error message
          throw reason instanceof Error ? reason : new Error(reasonMessage);
        } else {
          console.log('🔍 [useMetadata] Detected content not found error, throwing generic error');
          // This was likely a content not found error
          throw new Error('Content not found');
        }
      }
    } catch (error) {
      console.log('🔍 [useMetadata] loadMetadata caught error:', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: typeof error,
        isAxiosError: (error as any)?.isAxiosError,
        responseStatus: (error as any)?.response?.status,
        responseData: (error as any)?.response?.data,
        stack: error instanceof Error ? error.stack : undefined
      });

      if (__DEV__) {
        console.error('Failed to load metadata:', error);
        console.log('Error message being set:', error instanceof Error ? error.message : String(error));
      }

      // Preserve the original error details for better error parsing
      const errorMessage = error instanceof Error ? error.message : 'Failed to load content';
      setError(errorMessage);

      // Clear any stale data
      setMetadata(null);
      setCast([]);
      setGroupedEpisodes({});
      setEpisodes([]);
    } finally {
      console.log('🔍 [useMetadata] loadMetadata completed, setting loading to false');
      setLoading(false);
    }
  };

  const loadSeriesData = async () => {
    setLoadingSeasons(true);
    try {
      // First check if we have episode data from the addon
      const addonVideos = metadata?.videos;
      if (addonVideos && Array.isArray(addonVideos) && addonVideos.length > 0) {
        if (__DEV__) logger.log(`🎬 Found ${addonVideos.length} episodes from addon metadata for ${metadata?.name || id}`);

        // Group addon episodes by season
        const groupedAddonEpisodes: GroupedEpisodes = {};

        addonVideos.forEach((video: any) => {
          // Use season 0 for videos without season numbers (PPV-style content, specials, etc.)
          const seasonNumber = video.season || 0;
          const episodeNumber = video.episode || video.number || 1;

          if (!groupedAddonEpisodes[seasonNumber]) {
            groupedAddonEpisodes[seasonNumber] = [];
          }

          // Resolve image and description dynamically from arbitrary addons
          const imageCandidate = (
            video.thumbnail ||
            video.image ||
            video.thumb ||
            (video.images && video.images.still) ||
            null
          );
          const descriptionCandidate = (
            video.overview ||
            video.description ||
            video.plot ||
            video.synopsis ||
            ''
          );

          // Convert addon episode format to our Episode interface
          const episode: Episode = {
            id: video.id,
            name: video.name || video.title || `Episode ${episodeNumber}`,
            overview: descriptionCandidate,
            season_number: seasonNumber,
            episode_number: episodeNumber,
            air_date: video.released ? video.released.split('T')[0] : video.firstAired ? video.firstAired.split('T')[0] : '',
            still_path: imageCandidate,
            vote_average: parseFloat(video.rating) || 0,
            runtime: undefined,
            episodeString: `S${seasonNumber.toString().padStart(2, '0')}E${episodeNumber.toString().padStart(2, '0')}`,
            stremioId: video.id,
            season_poster_path: null
          };

          groupedAddonEpisodes[seasonNumber].push(episode);
        });

        // Sort episodes within each season
        Object.keys(groupedAddonEpisodes).forEach(season => {
          groupedAddonEpisodes[parseInt(season)].sort((a, b) => a.episode_number - b.episode_number);
        });

        if (__DEV__) logger.log(`📺 Processed addon episodes into ${Object.keys(groupedAddonEpisodes).length} seasons`);

        // Fetch season posters from TMDB only if enrichment AND season posters are enabled
        if (settings.enrichMetadataWithTMDB && settings.tmdbEnrichSeasonPosters) {
          try {
            const lang = settings.useTmdbLocalizedMetadata ? `${settings.tmdbLanguagePreference || 'en'}` : 'en';
            const tmdbIdToUse = tmdbId || (id.startsWith('tt') ? await tmdbService.findTMDBIdByIMDB(id) : null);
            if (tmdbIdToUse) {
              if (!tmdbId) setTmdbId(tmdbIdToUse);
              const showDetails = await tmdbService.getTVShowDetails(tmdbIdToUse, lang);
              if (showDetails?.seasons) {
                Object.keys(groupedAddonEpisodes).forEach(seasonStr => {
                  const seasonNum = parseInt(seasonStr, 10);
                  const seasonInfo = showDetails.seasons.find(s => s.season_number === seasonNum);
                  const seasonPosterPath = seasonInfo?.poster_path;
                  if (seasonPosterPath) {
                    groupedAddonEpisodes[seasonNum] = groupedAddonEpisodes[seasonNum].map(ep => ({
                      ...ep,
                      season_poster_path: seasonPosterPath,
                    }));
                  }
                });
                if (__DEV__) logger.log('🖼️ Successfully fetched and attached TMDB season posters to addon episodes.');
              }
            }
          } catch (error) {
            logger.error('Failed to fetch TMDB season posters for addon episodes:', error);
          }
        } else {
          if (__DEV__) logger.log('[loadSeriesData] TMDB season poster enrichment disabled; skipping season poster fetch');
        }

        if (settings.enrichMetadataWithTMDB && settings.tmdbEnrichEpisodes) {
          try {
            const tmdbIdToUse = tmdbId || (id.startsWith('tt') ? await tmdbService.findTMDBIdByIMDB(id) : null);
            if (tmdbIdToUse) {
              const lang = settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en';
              const seasons = Object.keys(groupedAddonEpisodes).map(Number);

              // Fetch all seasons in parallel (much faster than fetching each episode individually)
              const seasonPromises = seasons.map(async seasonNum => {
                try {
                  // getSeasonDetails returns all episodes for a season in one call
                  const seasonData = await tmdbService.getSeasonDetails(Number(tmdbIdToUse), seasonNum, undefined, lang);
                  if (seasonData && seasonData.episodes) {
                    // Create a map of episode number -> localized data for fast lookup
                    const localizedMap = new Map<number, { name: string; overview: string }>();
                    for (const ep of seasonData.episodes) {
                      localizedMap.set(ep.episode_number, { name: ep.name, overview: ep.overview });
                    }

                    // Merge localized data into addon episodes
                    groupedAddonEpisodes[seasonNum] = groupedAddonEpisodes[seasonNum].map(ep => {
                      const localized = localizedMap.get(ep.episode_number);
                      if (localized) {
                        return {
                          ...ep,
                          name: localized.name || ep.name,
                          overview: localized.overview || ep.overview,
                        };
                      }
                      return ep;
                    });
                  }
                } catch { }
              });

              await Promise.all(seasonPromises);
              if (__DEV__) logger.log('[useMetadata] merged episode names/overviews from TMDB (batch)');
            }
          } catch (e) {
            if (__DEV__) console.log('[useMetadata] failed to merge episode text from TMDB', e);
          }
        }

        setGroupedEpisodes(groupedAddonEpisodes);

        // Determine initial season only once per series
        const seasons = Object.keys(groupedAddonEpisodes).map(Number);
        const nonZeroSeasons = seasons.filter(s => s !== 0);
        const firstSeason = nonZeroSeasons.length > 0 ? Math.min(...nonZeroSeasons) : Math.min(...seasons);
        if (!initializedSeasonRef.current) {
          // Check for watch progress to auto-select season
          let selectedSeasonNumber = firstSeason;
          try {
            const allProgress = await storageService.getAllWatchProgress();
            let mostRecentEpisodeId = '';
            let mostRecentTimestamp = 0;
            Object.entries(allProgress).forEach(([key, progress]) => {
              if (key.includes(`series:${id}:`)) {
                const episodeId = key.split(`series:${id}:`)[1];
                if (progress.lastUpdated > mostRecentTimestamp && progress.currentTime > 0) {
                  mostRecentTimestamp = progress.lastUpdated;
                  mostRecentEpisodeId = episodeId;
                }
              }
            });

            if (mostRecentEpisodeId) {
              // Try to parse season from ID or find matching episode
              const parts = mostRecentEpisodeId.split(':');
              if (parts.length === 3) {
                // Format: showId:season:episode
                const watchProgressSeason = parseInt(parts[1], 10);
                if (groupedAddonEpisodes[watchProgressSeason]) {
                  selectedSeasonNumber = watchProgressSeason;
                  logger.log(`[useMetadata] Auto-selected season ${selectedSeasonNumber} based on most recent watch progress for ${mostRecentEpisodeId}`);
                }
              } else {
                // Try to find by stremioId
                const allEpisodesList = Object.values(groupedAddonEpisodes).flat();
                const episode = allEpisodesList.find(ep => ep.stremioId === mostRecentEpisodeId);
                if (episode) {
                  selectedSeasonNumber = episode.season_number;
                  logger.log(`[useMetadata] Auto-selected season ${selectedSeasonNumber} based on most recent watch progress for episode with stremioId ${mostRecentEpisodeId}`);
                }
              }
            } else {
              // No watch progress, try persistent storage
              selectedSeasonNumber = getSeason(id, firstSeason);
              logger.log(`[useMetadata] No watch progress found, using persistent season ${selectedSeasonNumber}`);
            }
          } catch (error) {
            logger.error('[useMetadata] Error checking watch progress for season selection:', error);
            selectedSeasonNumber = getSeason(id, firstSeason);
          }

          if (selectedSeason !== selectedSeasonNumber) {
            logger.log(`📺 Setting season ${selectedSeasonNumber} as selected`);
            setSelectedSeason(selectedSeasonNumber);
          }
          setEpisodes(groupedAddonEpisodes[selectedSeasonNumber] || []);
          initializedSeasonRef.current = true;
        } else {
          // Keep current selection; refresh episode list for selected season
          setEpisodes(groupedAddonEpisodes[selectedSeason] || []);
        }

        // Try to get TMDB ID for additional metadata (cast, etc.) but don't override episodes
        // Skip TMDB episode fallback if enrichment or episode enrichment is disabled
        if (!settings.enrichMetadataWithTMDB || !settings.tmdbEnrichEpisodes) {
          if (__DEV__) logger.log('[loadSeriesData] TMDB episode enrichment disabled; skipping TMDB episode fallback (preserving current episodes)');
          return;
        }
        const tmdbIdResult = await tmdbService.findTMDBIdByIMDB(id);
        if (tmdbIdResult) {
          setTmdbId(tmdbIdResult);
        }

        return; // Use addon episodes, skip TMDB loading
      }

      // Fallback to TMDB if no addon episodes
      logger.log('📺 No addon episodes found, falling back to TMDB');
      const lang = settings.useTmdbLocalizedMetadata ? `${settings.tmdbLanguagePreference || 'en'}` : 'en';
      const tmdbIdResult = await tmdbService.findTMDBIdByIMDB(id);
      if (tmdbIdResult) {
        setTmdbId(tmdbIdResult);

        const [allEpisodes, showDetails] = await Promise.all([
          tmdbService.getAllEpisodes(tmdbIdResult, lang),
          tmdbService.getTVShowDetails(tmdbIdResult, lang)
        ]);

        const transformedEpisodes: GroupedEpisodes = {};
        Object.entries(allEpisodes).forEach(([seasonStr, episodes]) => {
          const seasonNum = parseInt(seasonStr, 10);
          if (seasonNum < 1) {
            return; // Skip season 0, which often contains extras
          }

          const seasonInfo = showDetails?.seasons?.find(s => s.season_number === seasonNum);
          const seasonPosterPath = seasonInfo?.poster_path;

          transformedEpisodes[seasonNum] = episodes.map(episode => ({
            ...episode,
            episodeString: `S${episode.season_number.toString().padStart(2, '0')}E${episode.episode_number.toString().padStart(2, '0')}`,
            season_poster_path: seasonPosterPath || null
          }));
        });

        setGroupedEpisodes(transformedEpisodes);

        // Get the first available season as fallback (preferring non-zero seasons)
        const availableSeasons = Object.keys(allEpisodes).map(Number);
        const nonZeroSeasons = availableSeasons.filter(s => s !== 0);
        const firstSeason = nonZeroSeasons.length > 0 ? Math.min(...nonZeroSeasons) : Math.min(...availableSeasons);

        if (!initializedSeasonRef.current) {
          // Check for watch progress to auto-select season
          let selectedSeasonNumber = firstSeason;
          try {
            const allProgress = await storageService.getAllWatchProgress();
            let mostRecentEpisodeId = '';
            let mostRecentTimestamp = 0;
            Object.entries(allProgress).forEach(([key, progress]) => {
              if (key.includes(`series:${id}:`)) {
                const episodeId = key.split(`series:${id}:`)[1];
                if (progress.lastUpdated > mostRecentTimestamp && progress.currentTime > 0) {
                  mostRecentTimestamp = progress.lastUpdated;
                  mostRecentEpisodeId = episodeId;
                }
              }
            });
            if (mostRecentEpisodeId) {
              const parts = mostRecentEpisodeId.split(':');
              if (parts.length === 3) {
                const watchProgressSeason = parseInt(parts[1], 10);
                if (transformedEpisodes[watchProgressSeason]) {
                  selectedSeasonNumber = watchProgressSeason;
                  logger.log(`[useMetadata] Auto-selected season ${selectedSeasonNumber} based on most recent watch progress for ${mostRecentEpisodeId}`);
                }
              } else {
                const allEpisodesList = Object.values(transformedEpisodes).flat();
                const episode = allEpisodesList.find(ep => ep.stremioId === mostRecentEpisodeId);
                if (episode) {
                  selectedSeasonNumber = episode.season_number;
                  logger.log(`[useMetadata] Auto-selected season ${selectedSeasonNumber} based on most recent watch progress for episode with stremioId ${mostRecentEpisodeId}`);
                }
              }
            } else {
              selectedSeasonNumber = getSeason(id, firstSeason);
              logger.log(`[useMetadata] No watch progress found, using persistent season ${selectedSeasonNumber}`);
            }
          } catch (error) {
            logger.error('[useMetadata] Error checking watch progress for season selection:', error);
            selectedSeasonNumber = getSeason(id, firstSeason);
          }
          if (selectedSeason !== selectedSeasonNumber) {
            setSelectedSeason(selectedSeasonNumber);
          }
          setEpisodes(transformedEpisodes[selectedSeasonNumber] || []);
          initializedSeasonRef.current = true;
        } else {
          // Keep existing selection stable and only refresh episode list for it
          setEpisodes(transformedEpisodes[selectedSeason] || []);
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Failed to load episodes:', error);
    } finally {
      setLoadingSeasons(false);
    }
  };

  // Function to indicate that streams are loading without blocking UI
  const updateLoadingState = () => {
    // We set this to true initially, but we'll show results as they come in
    setLoadingStreams(true);
    // Also clear previous streams
    setGroupedStreams({});
    setError(null);
  };

  // Function to indicate that episode streams are loading without blocking UI
  const updateEpisodeLoadingState = () => {
    // We set this to true initially, but we'll show results as they come in
    setLoadingEpisodeStreams(true);
    // Also clear previous streams
    setEpisodeStreams({});
    setError(null);
  };

  // Extract embedded streams from metadata videos (used by PPV-style addons)
  const extractEmbeddedStreams = useCallback((episodeIdOverride?: string) => {
    if (!metadata?.videos) return;

    // Check if any video has embedded streams
    const videosWithStreams = (metadata.videos as any[]).filter(
      (video: any) => video.streams && Array.isArray(video.streams) && video.streams.length > 0
    );

    if (videosWithStreams.length === 0) return;

    // Get the addon info from metadata if available
    const addonId = (metadata as any).addonId || 'embedded';
    const addonName = (metadata as any).addonName || metadata.name || 'Embedded Streams';

    // 1. Extract all streams for groupedStreams (legacy/movies behavior, or flat list)
    const allEmbeddedStreams: Stream[] = [];
    for (const video of videosWithStreams) {
      for (const stream of video.streams) {
        allEmbeddedStreams.push({
          ...stream,
          name: stream.name || stream.title || video.title,
          title: stream.title || video.title,
          addonId,
          addonName,
        });
      }
    }

    if (allEmbeddedStreams.length > 0) {
      if (__DEV__) console.log(`✅ [extractEmbeddedStreams] Found ${allEmbeddedStreams.length} embedded streams from ${addonName}`);

      // Add to grouped streams
      setGroupedStreams(prevStreams => ({
        ...prevStreams,
        [addonId]: {
          addonName,
          streams: allEmbeddedStreams,
        },
      }));

      // Track addon response order
      setAddonResponseOrder(prevOrder => {
        if (!prevOrder.includes(addonId)) {
          return [...prevOrder, addonId];
        }
        return prevOrder;
      });

      // If we are not waiting for episode streams, we can stop loading
      if (!loadingEpisodeStreams) {
        setLoadingStreams(false);
      }
    }

    // 2. Extract streams specifically for the selected episode
    const episodeToUse = episodeIdOverride || selectedEpisode;
    if (episodeToUse) {
      const episodeVideo = videosWithStreams.find(
        v => v.id === episodeToUse ||
          v.id === episodeToUse.split(':').pop() || // Handle cases where ID might have prefix
          (v.season === 0 && v.episode === 1 && videosWithStreams.length === 1) // Single item PPV edge case
      );

      if (episodeVideo && episodeVideo.streams && episodeVideo.streams.length > 0) {
        if (__DEV__) console.log(`✅ [extractEmbeddedStreams] Found embedded streams for episode ${episodeToUse}`);

        const episodeStreamsList: Stream[] = episodeVideo.streams.map((stream: any) => ({
          ...stream,
          name: stream.name || stream.title || episodeVideo.title,
          title: stream.title || episodeVideo.title,
          addonId,
          addonName,
        }));

        setEpisodeStreams(prevStreams => ({
          ...prevStreams,
          [addonId]: {
            addonName,
            streams: episodeStreamsList,
          },
        }));

        setLoadingEpisodeStreams(false);
      }
    }
  }, [metadata, selectedEpisode, loadingEpisodeStreams]);

  const loadStreams = async () => {
    const startTime = Date.now();
    try {
      if (__DEV__) console.log('🚀 [loadStreams] START - Loading streams for:', id);
      updateLoadingState();

      // Reset scraper tracking
      setScraperStatuses([]);
      setActiveFetchingScrapers([]);
      setAddonResponseOrder([]); // Reset response order

      if (__DEV__) console.log('🔍 [loadStreams] Getting TMDB ID for:', id);
      let tmdbId;
      let stremioId = id;
      let effectiveStreamType: string = type;

      if (id.startsWith('tmdb:')) {
        tmdbId = id.split(':')[1];
        if (__DEV__) console.log('✅ [loadStreams] Using TMDB ID from ID:', tmdbId);

        // Try to get IMDb ID from metadata first, then convert if needed
        if (metadata?.imdb_id) {
          stremioId = metadata.imdb_id;
          if (__DEV__) console.log('✅ [loadStreams] Using IMDb ID from metadata for Stremio:', stremioId);
        } else if (imdbId) {
          stremioId = imdbId;
          if (__DEV__) console.log('✅ [loadStreams] Using stored IMDb ID for Stremio:', stremioId);
        } else {
          // Convert TMDB ID to IMDb ID for Stremio addons (they expect IMDb format)
          try {
            let externalIds = null;
            if (type === 'movie') {
              const movieDetails = await withTimeout(tmdbService.getMovieDetails(tmdbId), API_TIMEOUT);
              externalIds = movieDetails?.external_ids;
            } else if (type === 'series') {
              externalIds = await withTimeout(tmdbService.getShowExternalIds(parseInt(tmdbId)), API_TIMEOUT);
            }

            if (externalIds?.imdb_id) {
              stremioId = externalIds.imdb_id;
              if (__DEV__) console.log('✅ [loadStreams] Converted TMDB to IMDb ID for Stremio:', stremioId);
            } else {
              if (__DEV__) console.log('⚠️ [loadStreams] No IMDb ID found for TMDB ID, using original:', stremioId);
            }
          } catch (error) {
            if (__DEV__) console.log('⚠️ [loadStreams] Failed to convert TMDB to IMDb, using original ID:', error);
          }
        }
      } else if (id.startsWith('tt')) {
        // This is already an IMDB ID, perfect for Stremio
        stremioId = id;
        if (settings.enrichMetadataWithTMDB) {
          if (__DEV__) console.log('📝 [loadStreams] Converting IMDB ID to TMDB ID...');
          tmdbId = await withTimeout(tmdbService.findTMDBIdByIMDB(id), API_TIMEOUT);
          if (__DEV__) console.log('✅ [loadStreams] Converted to TMDB ID:', tmdbId);
        } else {
          if (__DEV__) console.log('📝 [loadStreams] TMDB enrichment disabled, skipping IMDB to TMDB conversion');
        }
      } else {
        tmdbId = id;
        stremioId = id;
        if (__DEV__) console.log('ℹ️ [loadStreams] Using ID as both TMDB and Stremio ID:', tmdbId);
      }

      // Initialize scraper tracking
      try {
        const allStremioAddons = await stremioService.getInstalledAddons();
        const localScrapers = await localScraperService.getInstalledScrapers();

        const requestedStreamType = type;

        const pickEligibleStreamAddons = (requestType: string) =>
          allStremioAddons.filter(addon => {
            if (!addon.resources || !Array.isArray(addon.resources)) {
              return false;
            }

            let hasStreamResource = false;
            let supportsIdPrefix = false;

            for (const resource of addon.resources) {
              if (typeof resource === 'object' && resource !== null && 'name' in resource) {
                const typedResource = resource as any;
                if (typedResource.name === 'stream' &&
                  Array.isArray(typedResource.types) &&
                  typedResource.types.includes(requestType)) {
                  hasStreamResource = true;

                  if (Array.isArray(typedResource.idPrefixes) && typedResource.idPrefixes.length > 0) {
                    supportsIdPrefix = typedResource.idPrefixes.some((p: string) => stremioId.startsWith(p));
                  } else {
                    supportsIdPrefix = true;
                  }
                  break;
                }
              } else if (typeof resource === 'string' && resource === 'stream' && addon.types) {
                if (Array.isArray(addon.types) && addon.types.includes(requestType)) {
                  hasStreamResource = true;
                  if (addon.idPrefixes && Array.isArray(addon.idPrefixes) && addon.idPrefixes.length > 0) {
                    supportsIdPrefix = addon.idPrefixes.some((p: string) => stremioId.startsWith(p));
                  } else {
                    supportsIdPrefix = true;
                  }
                  break;
                }
              }
            }

            return hasStreamResource && supportsIdPrefix;
          });

        effectiveStreamType = requestedStreamType;
        let eligibleStreamAddons = pickEligibleStreamAddons(requestedStreamType);
        
        if (eligibleStreamAddons.length === 0) {
          const fallbackTypes = ['series', 'movie'].filter(t => t !== requestedStreamType);
          for (const fallbackType of fallbackTypes) {
            const fallback = pickEligibleStreamAddons(fallbackType);
            if (fallback.length > 0) {
              effectiveStreamType = fallbackType;
              eligibleStreamAddons = fallback;
              if (__DEV__) console.log(`[useMetadata.loadStreams] No addons for '${requestedStreamType}', falling back to '${fallbackType}'`);
              break;
            }
          }
        }

        const streamAddons = eligibleStreamAddons;
        if (__DEV__) console.log('[useMetadata.loadStreams] Eligible stream addons:', streamAddons.map(a => a.id), { requestedStreamType, effectiveStreamType });

        // Initialize scraper statuses for tracking
        const initialStatuses: ScraperStatus[] = [];
        const initialActiveFetching: string[] = [];

        // Add stream-capable Stremio addons only
        streamAddons.forEach(addon => {
          initialStatuses.push({
            id: addon.id,
            name: addon.name,
            isLoading: true,
            hasCompleted: false,
            error: null,
            startTime: Date.now(),
            endTime: null
          });
          initialActiveFetching.push(addon.name);
        });

        // Add local scrapers if enabled
        const currentSettings = await mmkvStorage.getItem('app_settings');
        const enableLocalScrapersNow = currentSettings ? JSON.parse(currentSettings).enableLocalScrapers !== false : true;

        if (enableLocalScrapersNow) {
          localScrapers.filter((scraper: ScraperInfo) => scraper.enabled).forEach((scraper: ScraperInfo) => {
            initialStatuses.push({
              id: scraper.id,
              name: scraper.name,
              isLoading: true,
              hasCompleted: false,
              error: null,
              startTime: Date.now(),
              endTime: null
            });
            initialActiveFetching.push(scraper.name);
          });
        }

        setScraperStatuses(initialStatuses);
        setActiveFetchingScrapers(initialActiveFetching);

        // If no scrapers are available, stop loading immediately
        if (initialStatuses.length === 0) {
          setLoadingStreams(false);
        }
      } catch (error) {
        if (__DEV__) console.error('Failed to initialize scraper tracking:', error);
      }

      // Start Stremio request using the converted ID format
      if (__DEV__) console.log('🎬 [loadStreams] Using ID for Stremio addons:', stremioId);
      // Use the effective type we selected when building the eligible addon list.
      // This stays aligned with Stremio manifest filtering rules and avoids hard-mapping non-standard types.
      processStremioSource(effectiveStreamType, stremioId, false);

      // Also extract any embedded streams from metadata (PPV-style addons)
      extractEmbeddedStreams();

      // Monitor scraper completion status instead of using fixed timeout
      const checkScrapersCompletion = () => {
        setScraperStatuses(currentStatuses => {
          const allCompleted = currentStatuses.every(status => status.hasCompleted || status.error !== null);
          if (allCompleted && currentStatuses.length > 0) {
            setLoadingStreams(false);
            setActiveFetchingScrapers([]);
          }
          return currentStatuses;
        });
      };

      // Check completion less frequently to reduce CPU load
      const completionInterval = setInterval(checkScrapersCompletion, 2000);

      // Fallback timeout after 1 minute
      const fallbackTimeout = setTimeout(() => {
        clearInterval(completionInterval);
        setLoadingStreams(false);
        setActiveFetchingScrapers([]);
        // Mark all incomplete scrapers as failed
        setScraperStatuses(prevStatuses =>
          prevStatuses.map(status =>
            !status.hasCompleted && !status.error
              ? { ...status, isLoading: false, hasCompleted: true, error: 'Request timed out', endTime: Date.now() }
              : status
          )
        );
      }, 60000);

    } catch (error) {
      if (__DEV__) console.error('❌ [loadStreams] Failed to load streams:', error);
      // Preserve the original error details for better error parsing
      const errorMessage = error instanceof Error ? error.message : 'Failed to load streams';
      setError(errorMessage);
      setLoadingStreams(false);
    }
  };

  const loadEpisodeStreams = async (episodeId: string) => {
    const startTime = Date.now();
    try {
      if (__DEV__) console.log('🚀 [loadEpisodeStreams] START - Loading episode streams for:', episodeId);
      updateEpisodeLoadingState();

      // Reset scraper tracking for episodes
      setScraperStatuses([]);
      setActiveFetchingScrapers([]);
      setAddonResponseOrder([]); // Reset response order

      // Initialize scraper tracking for episodes
      try {
        const allStremioAddons = await stremioService.getInstalledAddons();
        const localScrapers = await localScraperService.getInstalledScrapers();

        // We don't yet know the final episode ID format here (it can be normalized later),
        // but we can still pre-filter by stream capability for the most likely types.
        const pickStreamCapableAddons = (requestType: string) =>
          allStremioAddons.filter(addon => {
            if (!addon.resources || !Array.isArray(addon.resources)) return false;

            for (const resource of addon.resources) {
              if (typeof resource === 'object' && resource !== null && 'name' in resource) {
                const typedResource = resource as any;
                if (typedResource.name === 'stream' && Array.isArray(typedResource.types) && typedResource.types.includes(requestType)) {
                  return true;
                }
              } else if (typeof resource === 'string' && resource === 'stream' && addon.types) {
                if (Array.isArray(addon.types) && addon.types.includes(requestType)) {
                  return true;
                }
              }
            }
            return false;
          });

        const requestedEpisodeType = type;
        let streamAddons = pickStreamCapableAddons(requestedEpisodeType);
        
        if (streamAddons.length === 0) {
          const fallbackTypes = ['series', 'movie'].filter(t => t !== requestedEpisodeType);
          for (const fallbackType of fallbackTypes) {
            const fallback = pickStreamCapableAddons(fallbackType);
            if (fallback.length > 0) {
              streamAddons = fallback;
              if (__DEV__) console.log(`[useMetadata.loadEpisodeStreams] No addons for '${requestedEpisodeType}', falling back to '${fallbackType}'`);
              break;
            }
          }
        }

        // Initialize scraper statuses for tracking
        const initialStatuses: ScraperStatus[] = [];
        const initialActiveFetching: string[] = [];

        // Add stream-capable Stremio addons only
        streamAddons.forEach(addon => {
          initialStatuses.push({
            id: addon.id,
            name: addon.name,
            isLoading: true,
            hasCompleted: false,
            error: null,
            startTime: Date.now(),
            endTime: null
          });
          initialActiveFetching.push(addon.name);
        });

        // Add local scrapers if enabled (read from storage to avoid stale closure)
        const currentSettings = await mmkvStorage.getItem('app_settings');
        const enableLocalScrapersNow = currentSettings ? JSON.parse(currentSettings).enableLocalScrapers !== false : true;

        if (enableLocalScrapersNow) {
          localScrapers.filter((scraper: ScraperInfo) => scraper.enabled).forEach((scraper: ScraperInfo) => {
            initialStatuses.push({
              id: scraper.id,
              name: scraper.name,
              isLoading: true,
              hasCompleted: false,
              error: null,
              startTime: Date.now(),
              endTime: null
            });
            initialActiveFetching.push(scraper.name);
          });
        }

        setScraperStatuses(initialStatuses);
        setActiveFetchingScrapers(initialActiveFetching);

        // If no scrapers are available, stop loading immediately
        if (initialStatuses.length === 0) {
          setLoadingEpisodeStreams(false);
        }
      } catch (error) {
        if (__DEV__) console.error('Failed to initialize episode scraper tracking:', error);
      }

      // Get TMDB ID for external sources and determine the correct ID for Stremio addons
      if (__DEV__) console.log('🔍 [loadEpisodeStreams] Getting TMDB ID for:', id);
      let tmdbId;
      let stremioEpisodeId = episodeId; // Default to original episode ID
      let isCollection = false;

      // Dynamically detect if this is a collection by checking addon capabilities
      const { isCollection: detectedCollection, addon: collectionAddon } = stremioService.isCollectionContent(id);
      isCollection = detectedCollection;


      // Parse season and episode numbers robustly
      let showIdStr = id;
      let seasonNum = '';
      let episodeNum = '';

      try {
        // Handle various episode ID formats
        // 1. Internal format: "series:showId:season:episode"
        // 2. Stremio/IMDb format: "tt12345:1:1"
        // 3. TMDB format: "tmdb:123:1:1"

        const cleanEpisodeId = episodeId.replace(/^series:/, '');
        const parts = cleanEpisodeId.split(':');

        if (parts.length >= 3) {
          episodeNum = parts.pop() || '';
          seasonNum = parts.pop() || '';
          showIdStr = parts.join(':');
        } else if (parts.length === 2) {
          // Edge case: maybe just id:episode? unlikely but safe fallback
          episodeNum = parts[1];
          seasonNum = '1'; // Default
          showIdStr = parts[0];
        }

        if (__DEV__) console.log(`🔍 [loadEpisodeStreams] Parsed ID: show=${showIdStr}, s=${seasonNum}, e=${episodeNum}`);
      } catch (e) {
        if (__DEV__) console.warn('⚠️ [loadEpisodeStreams] Failed to parse episode ID:', episodeId);
      }

      if (isCollection && collectionAddon) {
        if (__DEV__) console.log(`🎬 [loadEpisodeStreams] Detected collection from addon: ${collectionAddon.name}, treating episodes as individual movies`);

        // For collections, extract the individual movie ID from the episodeId
        // episodeId format for collections: "tt7888964" (IMDb ID of individual movie)
        if (episodeId.startsWith('tt')) {
          // This is an IMDb ID of an individual movie in the collection
          if (settings.enrichMetadataWithTMDB) {
            tmdbId = await withTimeout(tmdbService.findTMDBIdByIMDB(episodeId), API_TIMEOUT);
          }
          stremioEpisodeId = episodeId; // Use the IMDb ID directly for Stremio addons
          if (__DEV__) console.log('✅ [loadEpisodeStreams] Collection movie - using IMDb ID:', episodeId, 'TMDB ID:', tmdbId);
        } else {
          // Fallback: try to verify if it's a tmdb id
          const isTmdb = episodeId.startsWith('tmdb:') || !isNaN(Number(episodeId));
          if (isTmdb) {
            const cleanId = episodeId.replace('tmdb:', '');
            tmdbId = cleanId;
            stremioEpisodeId = episodeId;
          } else {
            stremioEpisodeId = episodeId;
          }
          if (__DEV__) console.log('⚠️ [loadEpisodeStreams] Collection movie - using episodeId as-is:', episodeId);
        }
      } else if (id.startsWith('tmdb:')) {
        tmdbId = id.split(':')[1];
        if (__DEV__) console.log('✅ [loadEpisodeStreams] Using TMDB ID from ID:', tmdbId);

        // Try to get IMDb ID from metadata first, then convert if needed
        if (metadata?.imdb_id) {
          // Use format: imdb_id:season:episode
          stremioEpisodeId = `${metadata.imdb_id}:${seasonNum}:${episodeNum}`;
          if (__DEV__) console.log('✅ [loadEpisodeStreams] Using IMDb ID from metadata for Stremio episode:', stremioEpisodeId);
        } else if (imdbId) {
          stremioEpisodeId = `${imdbId}:${seasonNum}:${episodeNum}`;
          if (__DEV__) console.log('✅ [loadEpisodeStreams] Using stored IMDb ID for Stremio episode:', stremioEpisodeId);
        } else {
          // Convert TMDB ID to IMDb ID for Stremio addons
          try {
            const externalIds = await withTimeout(tmdbService.getShowExternalIds(parseInt(tmdbId)), API_TIMEOUT);

            if (externalIds?.imdb_id) {
              stremioEpisodeId = `${externalIds.imdb_id}:${seasonNum}:${episodeNum}`;
              if (__DEV__) console.log('✅ [loadEpisodeStreams] Converted TMDB to IMDb ID for Stremio episode:', stremioEpisodeId);
            } else {
              // Fallback to TMDB format if conversions fail
              // e.g. tmdb:123:1:1
              stremioEpisodeId = `${id}:${seasonNum}:${episodeNum}`;
              if (__DEV__) console.log('⚠️ [loadEpisodeStreams] No IMDb ID found for TMDB ID, using TMDB episode ID:', stremioEpisodeId);
            }
          } catch (error) {
            stremioEpisodeId = `${id}:${seasonNum}:${episodeNum}`;
            if (__DEV__) console.log('⚠️ [loadEpisodeStreams] Failed to convert TMDB to IMDb, using TMDB episode ID:', error);
          }
        }
      } else if (id.startsWith('tt')) {
        // This is already an IMDB ID, perfect for Stremio
        if (settings.enrichMetadataWithTMDB) {
          if (__DEV__) console.log('📝 [loadEpisodeStreams] Converting IMDB ID to TMDB ID...');
          tmdbId = await withTimeout(tmdbService.findTMDBIdByIMDB(id), API_TIMEOUT);
        } else {
          if (__DEV__) console.log('📝 [loadEpisodeStreams] TMDB enrichment disabled, skipping IMDB to TMDB conversion');
        }
        if (__DEV__) console.log('✅ [loadEpisodeStreams] Converted to TMDB ID:', tmdbId);

        // Ensure consistent format
        // Ensure consistent format or fallback to episodeId if parsing failed
        // This handles cases where 'tt' is used for a unique episode ID directly
        if (!seasonNum && !episodeNum) {
          stremioEpisodeId = episodeId;
        } else {
          stremioEpisodeId = `${id}:${seasonNum}:${episodeNum}`;
        }
        if (__DEV__) console.log('🔧 [loadEpisodeStreams] Normalized episode ID for addons:', stremioEpisodeId);
      } else {
        tmdbId = id;
        // If season/episode parsing failed (empty strings), use the raw episode ID
        // This handles custom IDs like "ppv-event-name" that don't follow "id:s:e" format
        if (!seasonNum && !episodeNum) {
          // Remove 'series:' prefix if present to be safe, though parsing logic above usually handles it
          stremioEpisodeId = episodeId.replace(/^series:/, '');
        } else {
          stremioEpisodeId = `${id}:${seasonNum}:${episodeNum}`;
        }
        if (__DEV__) console.log('ℹ️ [loadEpisodeStreams] Using ID as both TMDB and Stremio ID:', tmdbId);
      }

      // Extract episode info from the episodeId for logging
      const episodeQuery = `?s=${seasonNum}&e=${episodeNum}`;
      if (__DEV__) console.log(`ℹ️ [loadEpisodeStreams] Episode query: ${episodeQuery}`);

      if (__DEV__) console.log('🔄 [loadEpisodeStreams] Starting stream requests');

      // Start Stremio request using the converted episode ID format
      if (__DEV__) console.log('🎬 [loadEpisodeStreams] Using episode ID for Stremio addons:', stremioEpisodeId);

      const requestedContentType = isCollection ? 'movie' : type;
      const contentType = requestedContentType;
      if (__DEV__) console.log(`🎬 [loadEpisodeStreams] Using content type: ${contentType} for ${isCollection ? 'collection' : type}`);

      processStremioSource(contentType, stremioEpisodeId, true);

      // Also extract any embedded streams from metadata for this episode
      // Also extract any embedded streams from metadata for this episode
      extractEmbeddedStreams(episodeId);

      // Monitor scraper completion status instead of using fixed timeout
      const checkEpisodeScrapersCompletion = () => {
        setScraperStatuses(currentStatuses => {
          const allCompleted = currentStatuses.every(status => status.hasCompleted || status.error !== null);
          if (allCompleted && currentStatuses.length > 0) {
            setLoadingEpisodeStreams(false);
            setActiveFetchingScrapers([]);
          }
          return currentStatuses;
        });
      };

      // Check completion less frequently to reduce CPU load
      const episodeCompletionInterval = setInterval(checkEpisodeScrapersCompletion, 3000);

      // Fallback timeout after 1 minute
      const episodeFallbackTimeout = setTimeout(() => {
        clearInterval(episodeCompletionInterval);
        setLoadingEpisodeStreams(false);
        setActiveFetchingScrapers([]);
        // Mark all incomplete scrapers as failed
        setScraperStatuses(prevStatuses =>
          prevStatuses.map(status =>
            !status.hasCompleted && !status.error
              ? { ...status, isLoading: false, hasCompleted: true, error: 'Request timed out', endTime: Date.now() }
              : status
          )
        );
      }, 60000);

    } catch (error) {
      if (__DEV__) console.error('❌ [loadEpisodeStreams] Failed to load episode streams:', error);
      // Preserve the original error details for better error parsing
      const errorMessage = error instanceof Error ? error.message : 'Failed to load episode streams';
      setError(errorMessage);
      setLoadingEpisodeStreams(false);
    }
  };

  const handleSeasonChange = useCallback((seasonNumber: number) => {
    if (selectedSeason === seasonNumber) return;

    // Update local state
    setSelectedSeason(seasonNumber);
    setEpisodes(groupedEpisodes[seasonNumber] || []);

    // Persist the selection
    saveSeason(id, seasonNumber);
  }, [selectedSeason, groupedEpisodes, saveSeason, id]);

  const toggleLibrary = useCallback(() => {
    if (!metadata) return;

    if (inLibrary) {
      catalogService.removeFromLibrary(type, id);
    } else {
      catalogService.addToLibrary(metadata);
    }

    setInLibrary(!inLibrary);
  }, [metadata, inLibrary, type, id]);

  // Reset load attempts when id or type changes
  useEffect(() => {
    setLoadAttempts(0);
    initializedSeasonRef.current = false;

    // Memory optimization: Clean up streams when content changes
    cleanupStreams();

    // Clear any pending cleanup timeouts
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, [id, type, cleanupStreams]);

  // Auto-retry on error with delay
  useEffect(() => {
    if (error && loadAttempts < MAX_RETRIES) {
      const timer = setTimeout(() => {
        loadMetadata();
      }, RETRY_DELAY * (loadAttempts + 1));

      return () => clearTimeout(timer);
    }
  }, [error, loadAttempts]);

  useEffect(() => {
    if (!settingsLoaded) return;

    // Check for cached streams immediately on mount
    const checkAndLoadCachedStreams = async () => {
      try {
        // This will be handled by the StreamsScreen component
        // The useMetadata hook focuses on metadata and episodes
      } catch (error) {
        if (__DEV__) console.log('[useMetadata] Error checking cached streams on mount:', error);
      }
    };

    loadMetadata();
  }, [id, type, settingsLoaded]);

  // Re-fetch when localization settings change to guarantee selected language at open
  useEffect(() => {
    if (!settingsLoaded) return;
    if (settings.enrichMetadataWithTMDB && settings.useTmdbLocalizedMetadata) {
      loadMetadata();
    }
  }, [settingsLoaded, settings.enrichMetadataWithTMDB, settings.useTmdbLocalizedMetadata, settings.tmdbLanguagePreference]);

  // Re-run series data loading when metadata updates with videos
  useEffect(() => {
    if (metadata && metadata.videos && metadata.videos.length > 0) {
      logger.log(`🎬 Metadata updated with ${metadata.videos.length} episodes, reloading series data`);
      loadSeriesData().catch((error) => { if (__DEV__) console.error(error); });
      // Also extract embedded streams from metadata videos (PPV-style addons)
      extractEmbeddedStreams();
    }
  }, [metadata?.videos, type, extractEmbeddedStreams]);

  const loadRecommendations = useCallback(async () => {
    if (!settings.enrichMetadataWithTMDB) {
      if (__DEV__) console.log('[useMetadata] enrichment disabled; skip recommendations');
      return;
    }
    if (!tmdbId) return;

    setLoadingRecommendations(true);
    try {
      const tmdbService = TMDBService.getInstance();
      const lang = settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en';
      const results = await tmdbService.getRecommendations(type === 'movie' ? 'movie' : 'tv', String(tmdbId), lang);

      // Convert TMDB results to StreamingContent format (simplified)
      const formattedRecommendations: StreamingContent[] = results.map((item: any) => ({
        id: `tmdb:${item.id}`,
        type: type === 'movie' ? 'movie' : 'series',
        name: item.title || item.name || 'Untitled',
        poster: tmdbService.getImageUrl(item.poster_path) || 'https://via.placeholder.com/300x450', // Provide fallback
        year: (item.release_date || item.first_air_date)?.substring(0, 4) || 'N/A', // Ensure string and provide fallback
      }));

      setRecommendations(formattedRecommendations);
    } catch (error) {
      if (__DEV__) console.error('Failed to load recommendations:', error);
      setRecommendations([]);
    } finally {
      setLoadingRecommendations(false);
    }
  }, [tmdbId, type, settings.useTmdbLocalizedMetadata, settings.tmdbLanguagePreference]);

  // Fetch TMDB ID if needed and then recommendations
  useEffect(() => {
    const fetchTmdbIdAndRecommendations = async () => {
      if (!settings.enrichMetadataWithTMDB) {
        if (__DEV__) console.log('[useMetadata] enrichment disabled; skip TMDB id extraction (extract path)');
        return;
      }
      if (metadata && !tmdbId) {
        try {
          const tmdbService = TMDBService.getInstance();
          const fetchedTmdbId = await tmdbService.extractTMDBIdFromStremioId(id);
          if (fetchedTmdbId) {
            if (__DEV__) console.log('[useMetadata] extracted TMDB id from content id', { id, fetchedTmdbId });
            setTmdbId(fetchedTmdbId);
            // Fetch certification only if granular setting is enabled
            if (settings.tmdbEnrichCertification) {
              const certification = await tmdbService.getCertification(type, fetchedTmdbId);
              if (certification) {
                if (__DEV__) console.log('[useMetadata] fetched certification via TMDB id (extract path)', { type, fetchedTmdbId, certification });
                setMetadata(prev => prev ? {
                  ...prev,
                  tmdbId: fetchedTmdbId,
                  certification
                } : null);
              } else {
                if (__DEV__) console.warn('[useMetadata] certification not returned from TMDB (extract path)', { type, fetchedTmdbId });
              }
            } else {
              // Just set the TMDB ID without certification
              setMetadata(prev => prev ? { ...prev, tmdbId: fetchedTmdbId } : null);
            }
          } else {
            if (__DEV__) console.warn('[useMetadata] Could not determine TMDB ID for recommendations / certification', { id });
          }
        } catch (error) {
          if (__DEV__) console.error('[useMetadata] Error fetching TMDB ID (extract path):', error);
        }
      }
    };

    fetchTmdbIdAndRecommendations();
  }, [metadata, id, settings.enrichMetadataWithTMDB]);

  useEffect(() => {
    if (tmdbId) {
      // Check both master switch AND granular recommendations setting
      if (settings.enrichMetadataWithTMDB && settings.tmdbEnrichRecommendations) {
        if (__DEV__) console.log('[useMetadata] tmdbId available; loading recommendations', { tmdbId });
        loadRecommendations();
      }
      // Reset recommendations when tmdbId changes
      return () => {
        setRecommendations([]);
        setLoadingRecommendations(true);
      };
    }
  }, [tmdbId, loadRecommendations, settings.enrichMetadataWithTMDB, settings.tmdbEnrichRecommendations]);

  // Load addon cast data when metadata is available and TMDB cast enrichment is disabled
  useEffect(() => {
    // Load addon cast if master switch is off OR if cast enrichment specifically is off
    if ((!settings.enrichMetadataWithTMDB || !settings.tmdbEnrichCast) && metadata?.addonCast && metadata.addonCast.length > 0) {
      if (__DEV__) logger.log('[useMetadata] Loading addon cast data after metadata loaded');
      loadCast();
    }
  }, [metadata, settings.enrichMetadataWithTMDB, settings.tmdbEnrichCast]);

  // Ensure certification is attached whenever a TMDB id is known and metadata lacks it
  useEffect(() => {
    const maybeAttachCertification = async () => {
      // Check both master switch AND granular certification setting
      if (!settings.enrichMetadataWithTMDB || !settings.tmdbEnrichCertification) {
        if (__DEV__) console.log('[useMetadata] certification enrichment disabled; skip (attach path)');
        return;
      }
      try {
        if (!metadata) {
          if (__DEV__) console.warn('[useMetadata] skip certification attach: metadata not ready');
          return;
        }
        if (!tmdbId) {
          if (__DEV__) console.warn('[useMetadata] skip certification attach: tmdbId not available yet');
          return;
        }
        if ((metadata as any).certification) {
          if (__DEV__) console.log('[useMetadata] certification already present on metadata; skipping fetch');
          return;
        }
        const tmdbSvc = TMDBService.getInstance();
        const cert = await tmdbSvc.getCertification(type, tmdbId);
        if (cert) {
          if (__DEV__) console.log('[useMetadata] fetched certification (attach path)', { type, tmdbId, cert });
          setMetadata(prev => prev ? { ...prev, tmdbId, certification: cert } : prev);
        } else {
          if (__DEV__) console.warn('[useMetadata] TMDB returned no certification (attach path)', { type, tmdbId });
        }
      } catch (err) {
        if (__DEV__) console.error('[useMetadata] error attaching certification', err);
      }
    };
    maybeAttachCertification();
  }, [tmdbId, metadata, type, settings.enrichMetadataWithTMDB, settings.tmdbEnrichCertification]);

  // Fetch TMDB networks/production companies when TMDB ID is available and enrichment is enabled
  const productionInfoFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    // Check if any of the relevant granular settings are enabled
    const anyProductionEnrichmentEnabled = settings.tmdbEnrichProductionInfo ||
      settings.tmdbEnrichTvDetails ||
      settings.tmdbEnrichMovieDetails ||
      settings.tmdbEnrichCollections;

    if (!tmdbId || !settings.enrichMetadataWithTMDB || !metadata || !anyProductionEnrichmentEnabled) {
      return;
    }

    const contentKey = `${type}-${tmdbId}`;
    if (productionInfoFetchedRef.current === contentKey) {
      return;
    }

    // Only skip if networks are set AND collection is already set (for movies)
    const hasNetworks = !!(metadata as any).networks;
    const hasCollection = !!(metadata as any).collection;
    if (hasNetworks && (type !== 'movie' || hasCollection)) {
      return;
    }

    const fetchProductionInfo = async () => {
      try {
        productionInfoFetchedRef.current = contentKey;
        const tmdbService = TMDBService.getInstance();
        let productionInfo: any[] = [];

        if (__DEV__) console.log('[useMetadata] fetchProductionInfo starting', {
          contentKey,
          type,
          tmdbId,
          useLocalized: settings.useTmdbLocalizedMetadata,
          lang: settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en',
          hasExistingNetworks: !!(metadata as any).networks,
          productionInfoEnabled: settings.tmdbEnrichProductionInfo,
          tvDetailsEnabled: settings.tmdbEnrichTvDetails,
          movieDetailsEnabled: settings.tmdbEnrichMovieDetails,
          collectionsEnabled: settings.tmdbEnrichCollections
        });

        if (type === 'series') {
          // Fetch networks and additional details for TV shows
          const lang = settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en';
          const showDetails = await tmdbService.getTVShowDetails(tmdbId, lang);
          if (showDetails) {
            if (__DEV__) console.log('[useMetadata] fetchProductionInfo got showDetails', {
              hasNetworks: !!showDetails.networks,
              networksCount: showDetails.networks?.length || 0
            });
            // Fetch networks only if production info is enabled
            if (settings.tmdbEnrichProductionInfo && showDetails.networks) {
              productionInfo = Array.isArray(showDetails.networks)
                ? showDetails.networks
                  .map((n: any) => ({
                    id: n?.id,
                    name: n?.name,
                    logo: tmdbService.getImageUrl(n?.logo_path, 'w185') || undefined,
                  }))
                  .filter((n: any) => n && (n.logo || n.name))
                : [];
            }

            // Fetch additional TV details only if TV details is enabled
            if (settings.tmdbEnrichTvDetails) {
              const tvDetails = {
                status: showDetails.status,
                firstAirDate: showDetails.first_air_date,
                lastAirDate: showDetails.last_air_date,
                numberOfSeasons: showDetails.number_of_seasons,
                numberOfEpisodes: showDetails.number_of_episodes,
                episodeRunTime: showDetails.episode_run_time,
                type: showDetails.type,
                originCountry: showDetails.origin_country,
                originalLanguage: showDetails.original_language,
                createdBy: showDetails.created_by?.map(creator => ({
                  id: creator.id,
                  name: creator.name,
                  profile_path: creator.profile_path || undefined
                })),
              };

              // Update metadata with TV details
              setMetadata((prev: any) => ({
                ...prev,
                tmdbId,
                tvDetails
              }));
            }
          }
        } else if (type === 'movie') {
          // Fetch production companies and additional details for movies
          const lang = settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en';
          const movieDetails = await tmdbService.getMovieDetails(String(tmdbId), lang);
          if (movieDetails) {
            if (__DEV__) console.log('[useMetadata] fetchProductionInfo got movieDetails', {
              hasProductionCompanies: !!movieDetails.production_companies,
              productionCompaniesCount: movieDetails.production_companies?.length || 0
            });
            // Fetch production companies only if production info is enabled
            if (settings.tmdbEnrichProductionInfo && movieDetails.production_companies) {
              productionInfo = Array.isArray(movieDetails.production_companies)
                ? movieDetails.production_companies
                  .map((c: any) => ({
                    id: c?.id,
                    name: c?.name,
                    logo: tmdbService.getImageUrl(c?.logo_path, 'w185'),
                  }))
                  .filter((c: any) => c && (c.logo || c.name))
                : [];
            }

            // Fetch additional movie details only if movie details is enabled
            if (settings.tmdbEnrichMovieDetails) {
              const movieDetailsObj = {
                status: movieDetails.status,
                releaseDate: movieDetails.release_date,
                runtime: movieDetails.runtime,
                budget: movieDetails.budget,
                revenue: movieDetails.revenue,
                originalLanguage: movieDetails.original_language,
                originCountry: movieDetails.production_countries?.map((c: any) => c.iso_3166_1),
                tagline: movieDetails.tagline,
              };

              // Update metadata with movie details
              setMetadata((prev: any) => ({
                ...prev,
                tmdbId,
                movieDetails: movieDetailsObj
              }));
            }

            // Fetch collection data if movie belongs to a collection AND collections is enabled
            if (settings.tmdbEnrichCollections && movieDetails.belongs_to_collection) {
              setLoadingCollection(true);
              try {
                const collectionDetails = await tmdbService.getCollectionDetails(
                  movieDetails.belongs_to_collection.id,
                  lang
                );

                if (collectionDetails && collectionDetails.parts) {
                  // Fetch individual movie images to get backdrops with embedded titles/logos
                  const collectionMoviesData = await Promise.all(
                    collectionDetails.parts.map(async (part: any, index: number) => {
                      let movieBackdropUrl = undefined;

                      // Try to fetch movie images with language parameter
                      try {
                        const movieImages = await tmdbService.getMovieImagesFull(part.id, lang);
                        if (movieImages && movieImages.backdrops && movieImages.backdrops.length > 0) {
                          // Filter and sort backdrops by language and quality
                          const languageBackdrops = movieImages.backdrops
                            .filter((backdrop: any) => backdrop.aspect_ratio > 1.0) // Landscape orientation
                            .sort((a: any, b: any) => {
                              // Prioritize backdrops with the requested language
                              const aHasLang = a.iso_639_1 === lang;
                              const bHasLang = b.iso_639_1 === lang;
                              if (aHasLang && !bHasLang) return -1;
                              if (!aHasLang && bHasLang) return 1;

                              // Then prioritize English if requested language not available
                              const aIsEn = a.iso_639_1 === 'en';
                              const bIsEn = b.iso_639_1 === 'en';
                              if (aIsEn && !bIsEn) return -1;
                              if (!aIsEn && bIsEn) return 1;

                              // Then sort by vote average (quality), then by resolution
                              if (a.vote_average !== b.vote_average) {
                                return b.vote_average - a.vote_average;
                              }
                              return (b.width * b.height) - (a.width * a.height);
                            });

                          if (languageBackdrops.length > 0) {
                            movieBackdropUrl = tmdbService.getImageUrl(languageBackdrops[0].file_path, 'original');
                          }
                        }
                      } catch (error) {
                        if (__DEV__) console.warn('[useMetadata] Failed to fetch movie images for:', part.id, error);
                      }

                      return {
                        id: `tmdb:${part.id}`,
                        type: 'movie',
                        name: part.title,
                        poster: part.poster_path ? tmdbService.getImageUrl(part.poster_path, 'w500') : 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image',
                        banner: movieBackdropUrl || (part.backdrop_path ? tmdbService.getImageUrl(part.backdrop_path, 'original') : undefined),
                        year: part.release_date ? new Date(part.release_date).getFullYear() : undefined,
                        description: part.overview,
                        collection: {
                          id: collectionDetails.id,
                          name: collectionDetails.name,
                          poster_path: collectionDetails.poster_path,
                          backdrop_path: collectionDetails.backdrop_path
                        }
                      };
                    })
                  ) as StreamingContent[];

                  setCollectionMovies(collectionMoviesData);

                  // Update metadata with collection info
                  setMetadata((prev: any) => ({
                    ...prev,
                    collection: {
                      id: collectionDetails.id,
                      name: collectionDetails.name,
                      poster_path: collectionDetails.poster_path,
                      backdrop_path: collectionDetails.backdrop_path
                    }
                  }));
                }
              } catch (error) {
                if (__DEV__) console.error('[useMetadata] Error fetching collection:', error);
              } finally {
                setLoadingCollection(false);
              }
            }
          }
        }

        if (productionInfo.length > 0) {
          setMetadata((prev: any) => ({ ...prev, networks: productionInfo }));
        }
      } catch (error) {
        if (__DEV__) console.error('[useMetadata] Failed to fetch production info:', error);
      }
    };

    fetchProductionInfo();
  }, [tmdbId, settings.enrichMetadataWithTMDB, metadata, type, settings.tmdbEnrichProductionInfo, settings.tmdbEnrichTvDetails, settings.tmdbEnrichMovieDetails, settings.tmdbEnrichCollections]);

  // Reset tmdbId when id changes
  useEffect(() => {
    setTmdbId(null);
  }, [id]);

  // Subscribe to library updates
  useEffect(() => {
    const unsubscribe = catalogService.subscribeToLibraryUpdates((libraryItems) => {
      const isInLib = libraryItems.some(item => item.id === id);
      // Only update state if the value actually changed to prevent unnecessary re-renders
      setInLibrary(prev => prev !== isInLib ? isInLib : prev);
    });

    return () => unsubscribe();
  }, [id]);

  // Memory optimization: Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear cleanup timeout
      if (cleanupTimeoutRef.current) {
        clearTimeout(cleanupTimeoutRef.current);
      }

      // Force cleanup
      cleanupStreams();

      // Reset production info fetch tracking
      productionInfoFetchedRef.current = null;

      if (__DEV__) console.log('[useMetadata] Component unmounted, memory cleaned up');
    };
  }, [cleanupStreams]);


  return {
    metadata,
    loading,
    error,
    cast,
    loadingCast,
    episodes,
    groupedEpisodes,
    selectedSeason,
    tmdbId,
    loadingSeasons,
    groupedStreams,
    loadingStreams,
    episodeStreams,
    loadingEpisodeStreams,
    addonResponseOrder,
    preloadedStreams,
    preloadedEpisodeStreams,
    selectedEpisode,
    inLibrary,
    loadMetadata,
    loadStreams,
    loadEpisodeStreams,
    handleSeasonChange,
    toggleLibrary,
    setSelectedEpisode,
    setEpisodeStreams,
    recommendations,
    loadingRecommendations,
    setMetadata,
    imdbId,
    scraperStatuses,
    activeFetchingScrapers,
    collectionMovies,
    loadingCollection,
  };
};
