import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Dimensions, Platform, Linking } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { RouteProp } from '@react-navigation/native';

import { RootStackParamList, RootStackNavigationProp } from '../../navigation/AppNavigator';
import { useMetadata } from '../../hooks/useMetadata';
import { useMetadataAssets } from '../../hooks/useMetadataAssets';
import { useSettings } from '../../hooks/useSettings';
import { useTheme } from '../../contexts/ThemeContext';
import { useTrailer } from '../../contexts/TrailerContext';
import { useToast } from '../../contexts/ToastContext';
import { useDominantColor } from '../../hooks/useDominantColor';
import { Stream } from '../../types/metadata';
import { stremioService } from '../../services/stremioService';
import { localScraperService } from '../../services/pluginService';
import { VideoPlayerService } from '../../services/videoPlayerService';
import { streamCacheService } from '../../services/streamCacheService';
import { tmdbService } from '../../services/tmdbService';
import { logger } from '../../utils/logger';
import { TABLET_BREAKPOINT } from './constants';
import {
  filterStreamsByQuality,
  filterStreamsByLanguage,
  getLanguageVariations,
  getQualityNumeric,
  inferVideoTypeFromUrl,
  sortStreamsByQuality,
} from './utils';
import {
  GroupedStreams,
  StreamSection,
  FilterItem,
  LoadingProviders,
  ScraperLogos,
  IMDbRatingsMap,
  TMDBEpisodeOverride,
  AlertAction,
} from './types';

// Cache for scraper logos
const scraperLogoCache = new Map<string, string>();
let scraperLogoCachePromise: Promise<void> | null = null;

export const useStreamsScreen = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'Streams'>>();
  const navigation = useNavigation<RootStackNavigationProp>();
  const { id, type, episodeId, episodeThumbnail, fromPlayer } = route.params;
  const { settings, isLoaded: settingsLoaded } = useSettings();
  const { currentTheme } = useTheme();
  const { colors } = currentTheme;
  const { pauseTrailer, resumeTrailer } = useTrailer();
  const { showSuccess, showInfo } = useToast();

  // Dimension tracking
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const prevDimensionsRef = useRef({ width: dimensions.width, height: dimensions.height });

  const deviceWidth = dimensions.width;
  const isTablet = useMemo(() => deviceWidth >= TABLET_BREAKPOINT, [deviceWidth]);

  // Refs
  const isMounted = useRef(true);
  const hasDoneInitialLoadRef = useRef(false);
  const isLoadingStreamsRef = useRef(false);
  const lastLoadedIdRef = useRef<string | null>(null);

  // Alert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<AlertAction[]>([]);

  // Loading and provider state
  const [streamsLoadStart, setStreamsLoadStart] = useState<number | null>(null);
  const [loadingProviders, setLoadingProviders] = useState<LoadingProviders>({});
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [availableProviders, setAvailableProviders] = useState<Set<string>>(new Set());
  const prevProvidersRef = useRef<Set<string>>(new Set());

  // Autoplay state
  const [autoplayTriggered, setAutoplayTriggered] = useState(false);
  const [isAutoplayWaiting, setIsAutoplayWaiting] = useState(false);

  // Sources state
  const [hasStreamProviders, setHasStreamProviders] = useState(true);
  const [hasStremioStreamProviders, setHasStremioStreamProviders] = useState(true);
  const [showNoSourcesError, setShowNoSourcesError] = useState(false);

  // Logo error state
  const [movieLogoError, setMovieLogoError] = useState(false);

  // Scraper logos
  const [scraperLogos, setScraperLogos] = useState<ScraperLogos>({});

  // TMDB episode data
  const [tmdbEpisodeOverride, setTmdbEpisodeOverride] = useState<TMDBEpisodeOverride | null>(null);
  const [imdbRatingsMap, setImdbRatingsMap] = useState<IMDbRatingsMap>({});

  // Get metadata from hook
  const {
    metadata,
    episodes,
    groupedStreams,
    loadingStreams,
    episodeStreams,
    loadingEpisodeStreams,
    selectedEpisode,
    loadStreams,
    loadEpisodeStreams,
    setSelectedEpisode,
    groupedEpisodes,
    imdbId,
    scraperStatuses,
    activeFetchingScrapers,
    addonResponseOrder,
  } = useMetadata({ id, type });

  // Get banner image
  const setMetadataStub = useCallback(() => { }, []);
  const memoizedSettings = useMemo(
    () => settings,
    [settings.logoSourcePreference, settings.tmdbLanguagePreference, settings.enrichMetadataWithTMDB]
  );
  const { bannerImage } = useMetadataAssets(metadata, id, type, imdbId, memoizedSettings, setMetadataStub);

  // Dimension listener
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const widthChanged = Math.abs(window.width - prevDimensionsRef.current.width) > 1;
      const heightChanged = Math.abs(window.height - prevDimensionsRef.current.height) > 1;

      if (widthChanged || heightChanged) {
        prevDimensionsRef.current = { width: window.width, height: window.height };
        setDimensions(window);
      }
    });
    return () => subscription?.remove();
  }, []);

  // Pause trailer on mount
  useEffect(() => {
    pauseTrailer();
    return () => resumeTrailer();
  }, [pauseTrailer, resumeTrailer]);

  // Reset movie logo error
  useEffect(() => {
    setMovieLogoError(false);
  }, [id]);

  // Preload scraper logos
  useEffect(() => {
    const preloadScraperLogos = async () => {
      if (!scraperLogoCachePromise) {
        scraperLogoCachePromise = (async () => {
          try {
            const availableScrapers = await localScraperService.getAvailableScrapers();
            const map: ScraperLogos = {};
            availableScrapers.forEach(scraper => {
              if (scraper.logo && scraper.id) {
                scraperLogoCache.set(scraper.id, scraper.logo);
                map[scraper.id] = scraper.logo;
              }
            });
            setScraperLogos(map);
          } catch (error) {
            // Silently fail
          }
        })();
      }
    };
    preloadScraperLogos();
  }, []);

  // Open alert helper
  const openAlert = useCallback(
    (title: string, message: string, actions?: AlertAction[]) => {
      if (!isMounted.current) return;

      try {
        setAlertTitle(title);
        setAlertMessage(message);
        setAlertActions(actions && actions.length > 0 ? actions : [{ label: 'OK', onPress: () => { } }]);
        setAlertVisible(true);
      } catch (error) {
        console.warn('[StreamsScreen] Error showing alert:', error);
      }
    },
    []
  );

  const closeAlert = useCallback(() => setAlertVisible(false), []);

  // Navigation handlers
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      (navigation as any).navigate('MainTabs');
    }
  }, [navigation]);

  const handleProviderChange = useCallback((provider: string) => {
    setSelectedProvider(provider);
  }, []);

  // Quality and language filtering callbacks
  const filterByQuality = useCallback(
    (streams: Stream[]) => filterStreamsByQuality(streams, settings.excludedQualities || []),
    [settings.excludedQualities]
  );

  const filterByLanguage = useCallback(
    (streams: Stream[]) => filterStreamsByLanguage(streams, settings.excludedLanguages || []),
    [settings.excludedLanguages]
  );

  // Get best stream for autoplay
  const getBestStream = useCallback(
    (streamsData: GroupedStreams): Stream | null => {
      if (!streamsData || Object.keys(streamsData).length === 0) {
        return null;
      }

      const getProviderPriority = (addonId: string): number => {
        const installedAddons = stremioService.getInstalledAddons();
        const addonIndex = installedAddons.findIndex(addon => addon.id === addonId);
        if (addonIndex !== -1) {
          return 50 - addonIndex;
        }
        return 0;
      };

      const allStreams: Array<{ stream: Stream; quality: number; providerPriority: number; originalIndex: number }> = [];

      Object.entries(streamsData).forEach(([addonId, { streams }]) => {
        const qualityFiltered = filterByQuality(streams);
        const filteredStreams = filterByLanguage(qualityFiltered);

        filteredStreams.forEach((stream, index) => {
          const quality = getQualityNumeric(stream.name || stream.title);
          const providerPriority = getProviderPriority(addonId);
          allStreams.push({ stream, quality, providerPriority, originalIndex: index });
        });
      });

      if (allStreams.length === 0) return null;

      // Map preferred quality to numeric value
      const targetQuality = settings.autoplayPreferredQuality === '4K' ? 2160 : parseInt(settings.autoplayPreferredQuality, 10) || 1080;
      const preferredLanguage = settings.autoplayPreferredLanguage;

      // 1. Try to find streams matching preferred language
      let languageMatchedStreams = allStreams;
      if (preferredLanguage && preferredLanguage !== 'Any') {
        languageMatchedStreams = allStreams.filter(item => {
          const streamName = (item.stream.name || '').toLowerCase();
          const streamTitle = (item.stream.title || '').toLowerCase();
          const streamDesc = (item.stream.description || '').toLowerCase();
          const streamLang = (item.stream.lang || '').toLowerCase();
          
          const variations = getLanguageVariations(preferredLanguage);
          
          return variations.some(variant => {
            const variantLower = variant.toLowerCase();
            return streamLang === variantLower || 
                   streamName.includes(variantLower) ||
                   streamTitle.includes(variantLower) ||
                   streamDesc.includes(variantLower);
          });
        });
      }

      // 2. If no language match (and language wasn't 'Any'), just play the "first" stream
      if (languageMatchedStreams.length === 0 && allStreams.length > 0) {
        // Sort by provider priority and original index to find the "first" one
        const sortedByPriority = [...allStreams].sort((a, b) => {
          if (a.providerPriority !== b.providerPriority) return b.providerPriority - a.providerPriority;
          return a.originalIndex - b.originalIndex;
        });
        logger.log(`🎯 Autoplay: No language match for ${preferredLanguage}, playing first available stream.`);
        return sortedByPriority[0].stream;
      }

      if (languageMatchedStreams.length === 0) return null;

      // 3. Among language-matched streams, find the one closest to target quality
      // Sort primarily by how close the stream quality is to the preferred quality
      // If quality is identical, sort by provider priority and then addon's internal order
      languageMatchedStreams.sort((a, b) => {
        // Calculate absolute difference from target quality
        // Note: 0 quality (unknown/auto) is treated as being far from any specific target
        const qualityA = a.quality === 0 ? 0 : a.quality;
        const qualityB = b.quality === 0 ? 0 : b.quality;

        const diffA = Math.abs(qualityA - targetQuality);
        const diffB = Math.abs(qualityB - targetQuality);

        if (diffA !== diffB) return diffA - diffB;

        // Tie-break: if both are equally close (e.g. 720p and 1440p to 1080p)
        // prefer the higher quality one
        if (qualityA !== qualityB) return qualityB - qualityA;

        if (a.providerPriority !== b.providerPriority) return b.providerPriority - a.providerPriority;
        return a.originalIndex - b.originalIndex;
      });

      const selected = languageMatchedStreams[0];
      logger.log(
        `🎯 Best stream selected: ${selected.stream.name || selected.stream.title} (Lang: ${selected.stream.lang || 'unknown'}, Quality: ${selected.quality}p, Target: ${targetQuality}p)`
      );

      return selected.stream;
    },
    [filterByQuality, filterByLanguage, settings.autoplayPreferredQuality, settings.autoplayPreferredLanguage]
  );

  // Current episode
  const currentEpisode = useMemo(() => {
    if (!selectedEpisode) return null;
    const allEpisodes = Object.values(groupedEpisodes).flat();
    return allEpisodes.find(
      ep => ep.stremioId === selectedEpisode || `${id}:${ep.season_number}:${ep.episode_number}` === selectedEpisode
    );
  }, [selectedEpisode, groupedEpisodes, id]);

  // TMDB hydration for episode
  useEffect(() => {
    const hydrateEpisodeFromTmdb = async () => {
      try {
        setTmdbEpisodeOverride(null);
        if (type !== 'series' || !currentEpisode || !id) return;

        const needsHydration =
          !(currentEpisode as any).runtime ||
          !(currentEpisode as any).vote_average ||
          !currentEpisode.still_path;
        if (!needsHydration) return;

        let tmdbShowId: number | null = null;
        if (id.startsWith('tmdb:')) {
          tmdbShowId = parseInt(id.split(':')[1], 10);
        } else if (id.startsWith('tt')) {
          tmdbShowId = await tmdbService.findTMDBIdByIMDB(id);
        }
        if (!tmdbShowId) return;

        const allEpisodes: Record<string, any[]> = (await tmdbService.getAllEpisodes(tmdbShowId)) as any;
        const seasonKey = String(currentEpisode.season_number);
        const seasonList: any[] = (allEpisodes && (allEpisodes as any)[seasonKey]) || [];
        const ep = seasonList.find((e: any) => e.episode_number === currentEpisode.episode_number);
        if (ep) {
          setTmdbEpisodeOverride({
            vote_average: ep.vote_average,
            runtime: ep.runtime,
            still_path: ep.still_path,
          });
        }
      } catch (e) {
        logger.warn('[StreamsScreen] TMDB hydration failed:', e);
      }
    };

    hydrateEpisodeFromTmdb();
  }, [type, id, currentEpisode?.season_number, currentEpisode?.episode_number]);

  // Fetch IMDb ratings
  useEffect(() => {
    const fetchIMDbRatings = async () => {
      try {
        if (type !== 'series' && type !== 'other') return;
        if (!id || !currentEpisode) return;

        let tmdbShowId: number | null = null;
        if (id.startsWith('tmdb:')) {
          tmdbShowId = parseInt(id.split(':')[1], 10);
        } else if (id.startsWith('tt')) {
          tmdbShowId = await tmdbService.findTMDBIdByIMDB(id);
        }
        if (!tmdbShowId) return;

        const ratings = await tmdbService.getIMDbRatings(tmdbShowId);

        if (ratings) {
          const ratingsMap: IMDbRatingsMap = {};
          ratings.forEach(season => {
            if (season.episodes) {
              season.episodes.forEach(episode => {
                const key = `${episode.season_number}:${episode.episode_number}`;
                if (episode.vote_average) {
                  ratingsMap[key] = episode.vote_average;
                }
              });
            }
          });
          setImdbRatingsMap(ratingsMap);
        }
      } catch (err) {
        logger.error('[StreamsScreen] Failed to fetch IMDb ratings:', err);
      }
    };

    fetchIMDbRatings();
  }, [type, id, currentEpisode?.season_number, currentEpisode?.episode_number]);

  // Navigate to player
  const navigateToPlayer = useCallback(
    async (stream: Stream, options?: { headers?: Record<string, string> }) => {
      const optionHeaders = options?.headers;
      const streamHeaders = (stream.headers as any) as Record<string, string> | undefined;
      const proxyHeaders = ((stream as any)?.behaviorHints?.proxyHeaders?.request || undefined) as
        | Record<string, string>
        | undefined;
      const streamProvider = stream.addonId || (stream as any).addonName || stream.name;
      const finalHeaders = optionHeaders || streamHeaders || proxyHeaders;

      const streamsToPass = selectedEpisode ? episodeStreams : groupedStreams;
      const streamName = stream.name || stream.title || 'Unnamed Stream';
      const resolvedStreamProvider = streamProvider;

      // Save stream to cache
      try {
        const epId = (type === 'series' || type === 'other') && selectedEpisode ? selectedEpisode : undefined;
        const season = (type === 'series' || type === 'other') ? currentEpisode?.season_number : undefined;
        const episode = (type === 'series' || type === 'other') ? currentEpisode?.episode_number : undefined;
        const episodeTitle = (type === 'series' || type === 'other') ? currentEpisode?.name : undefined;

        await streamCacheService.saveStreamToCache(
          id,
          type,
          stream,
          metadata,
          epId,
          season,
          episode,
          episodeTitle,
          imdbId || undefined,
          settings.streamCacheTTL
        );
      } catch (error) {
        logger.warn('[StreamsScreen] Failed to save stream to cache:', error);
      }

      let videoType = inferVideoTypeFromUrl(stream.url);
      try {
        const providerId = stream.addonId || (stream as any).addon || '';
        if (!videoType && /xprime/i.test(providerId)) {
          videoType = 'm3u8';
        }
      } catch { }

      if (__DEV__) {
        const finalHeaderKeys = Object.keys(finalHeaders || {});

        logger.log('[StreamsScreen][navigateToPlayer] stream selection', {
          url: typeof stream.url === 'string' ? stream.url.slice(0, 240) : stream.url,
          addonId: stream.addonId,
          addonName: (stream as any).addonName,
          name: stream.name,
          title: stream.title,
          inferredVideoType: videoType,
          optionHeadersKeys: Object.keys(optionHeaders || {}),
          streamHeadersKeys: Object.keys(streamHeaders || {}),
          finalHeadersKeys: finalHeaderKeys,
        });
      }

      const playerRoute = Platform.OS === 'ios' ? 'PlayerIOS' : 'PlayerAndroid';

      navigation.navigate(playerRoute as any, {
        uri: stream.url as any,
        title: metadata?.name || '',
        episodeTitle: (type === 'series' || type === 'other') ? currentEpisode?.name : undefined,
        season: (type === 'series' || type === 'other') ? currentEpisode?.season_number : undefined,
        episode: (type === 'series' || type === 'other') ? currentEpisode?.episode_number : undefined,
        quality: (stream.title?.match(/(\d+)p/) || [])[1] || undefined,
        year: metadata?.year,
        streamProvider: resolvedStreamProvider,
        streamName,
        headers: finalHeaders,
        id,
        type,
        episodeId: (type === 'series' || type === 'other') && selectedEpisode ? selectedEpisode : undefined,
        imdbId: imdbId || undefined,
        availableStreams: streamsToPass,
        backdrop: metadata?.banner || bannerImage,
        videoType,
      } as any);
    },
    [metadata, type, currentEpisode, navigation, id, selectedEpisode, imdbId, episodeStreams, groupedStreams, bannerImage, settings.streamCacheTTL]
  );

  // Handle stream press
  const handleStreamPress = useCallback(
    async (stream: Stream) => {
      try {
        if (!stream.url) return;

        if (__DEV__) {
          const streamHeaders = (stream.headers as any) as Record<string, string> | undefined;
          const proxyHeaders = ((stream as any)?.behaviorHints?.proxyHeaders?.request || undefined) as
            | Record<string, string>
            | undefined;

          logger.log('[StreamsScreen][handleStreamPress] pressed stream', {
            url: typeof stream.url === 'string' ? stream.url.slice(0, 240) : stream.url,
            addonId: stream.addonId,
            addonName: (stream as any).addonName,
            name: stream.name,
            title: stream.title,
            streamHeadersKeys: Object.keys(streamHeaders || {}),
            proxyHeadersKeys: Object.keys(proxyHeaders || {}),
            inferredVideoType: inferVideoTypeFromUrl(stream.url),
          });
        }

        // Block magnet links
        if (typeof stream.url === 'string' && stream.url.startsWith('magnet:')) {
          openAlert('Not supported', 'Torrent streaming is not supported yet.');
          return;
        }

        // iOS external player
        if (Platform.OS === 'ios' && settings.preferredPlayer !== 'internal') {
          try {
            const streamUrl = encodeURIComponent(stream.url);
            let externalPlayerUrls: string[] = [];

            switch (settings.preferredPlayer) {
              case 'vlc':
                externalPlayerUrls = [
                  `vlc://${stream.url}`,
                  `vlc-x-callback://x-callback-url/stream?url=${streamUrl}`,
                  `vlc://${streamUrl}`,
                ];
                break;
              case 'outplayer':
                externalPlayerUrls = [
                  `outplayer://${stream.url}`,
                  `outplayer://${streamUrl}`,
                  `outplayer://play?url=${streamUrl}`,
                ];
                break;
              case 'infuse':
                externalPlayerUrls = [
                  `infuse://x-callback-url/play?url=${streamUrl}`,
                  `infuse://play?url=${streamUrl}`,
                  `infuse://${streamUrl}`,
                ];
                break;
              case 'vidhub':
                externalPlayerUrls = [`vidhub://play?url=${streamUrl}`, `vidhub://${streamUrl}`];
                break;
              default:
                navigateToPlayer(stream);
                return;
            }

            const tryNextUrl = (index: number) => {
              if (index >= externalPlayerUrls.length) {
                Linking.openURL(stream.url!)
                  .catch(() => navigateToPlayer(stream));
                return;
              }
              Linking.openURL(externalPlayerUrls[index])
                .catch(() => tryNextUrl(index + 1));
            };

            tryNextUrl(0);
          } catch {
            navigateToPlayer(stream);
          }
        }
        // Android external player
        else if (Platform.OS === 'android' && settings.useExternalPlayer) {
          try {
            const isMagnet = typeof stream.url === 'string' && stream.url.startsWith('magnet:');
            if (isMagnet) {
              Linking.openURL(stream.url).catch(() => navigateToPlayer(stream));
            } else {
              const success = await VideoPlayerService.playVideo(stream.url, {
                useExternalPlayer: true,
                title: metadata?.name || 'Video',
                episodeTitle: (type === 'series' || type === 'other') ? currentEpisode?.name : undefined,
                episodeNumber:
                  (type === 'series' || type === 'other') && currentEpisode
                    ? `S${currentEpisode.season_number}E${currentEpisode.episode_number}`
                    : undefined,
              });
              if (!success) navigateToPlayer(stream);
            }
          } catch {
            navigateToPlayer(stream);
          }
        } else {
          navigateToPlayer(stream);
        }
      } catch {
        navigateToPlayer(stream);
      }
    },
    [settings.preferredPlayer, settings.useExternalPlayer, navigateToPlayer, openAlert, metadata, type, currentEpisode]
  );

  // Update providers when streams change
  useEffect(() => {
    if (!isMounted.current) return;

    const currentStreamsData = selectedEpisode ? episodeStreams : groupedStreams;

    const providersWithStreams = Object.entries(currentStreamsData)
      .filter(([_, data]) => data.streams && data.streams.length > 0)
      .map(([providerId]) => providerId);

    if (providersWithStreams.length > 0) {
      const hasNewProviders = providersWithStreams.some(provider => !prevProvidersRef.current.has(provider));

      if (hasNewProviders) {
        setAvailableProviders(prevProviders => {
          const newProviders = new Set([...prevProviders, ...providersWithStreams]);
          prevProvidersRef.current = newProviders;
          return newProviders;
        });
      }
    }

    // Update loading states
    const expectedProviders = ['stremio'];
    setLoadingProviders(prevLoading => {
      const nextLoading = { ...prevLoading };
      let changed = false;
      expectedProviders.forEach(providerId => {
        const providerExists = currentStreamsData[providerId];
        const shouldStopLoading = providerExists || !(loadingStreams || loadingEpisodeStreams);
        const value = !shouldStopLoading;
        if (nextLoading[providerId] !== value) {
          nextLoading[providerId] = value;
          changed = true;
        }
      });
      return changed ? nextLoading : prevLoading;
    });
  }, [loadingStreams, loadingEpisodeStreams, groupedStreams, episodeStreams, type, metadata, selectedEpisode]);

  // Reset autoplay on episode change
  useEffect(() => {
    setAutoplayTriggered(false);
  }, [selectedEpisode]);

  // Initialize autoplay waiting state when settings are loaded
  // This runs after settings are fully loaded to avoid race conditions
  useEffect(() => {
    if (!settingsLoaded) return; // Wait for settings to load

    if (settings.autoplayBestStream && !fromPlayer && !autoplayTriggered) {
      setIsAutoplayWaiting(true);
    }
  }, [settingsLoaded, settings.autoplayBestStream, fromPlayer, autoplayTriggered]);

  // Reset provider if no longer available
  useEffect(() => {
    const isSpecialFilter =
      selectedProvider === 'all' ||
      selectedProvider === 'grouped-plugins' ||
      selectedProvider.startsWith('repo-');

    if (isSpecialFilter) return;

    const currentStreamsData = selectedEpisode ? episodeStreams : groupedStreams;
    const hasStreamsForProvider =
      currentStreamsData[selectedProvider] &&
      currentStreamsData[selectedProvider].streams &&
      currentStreamsData[selectedProvider].streams.length > 0;
    const isAvailableProvider = availableProviders.has(selectedProvider);

    if (!isAvailableProvider && !hasStreamsForProvider) {
      setSelectedProvider('all');
    }
  }, [selectedProvider, availableProviders, episodeStreams, groupedStreams, type, metadata, selectedEpisode]);

  // Check providers and load streams
  useEffect(() => {
    // Build a unique key for the current content
    const currentKey = `${id}:${type}:${episodeId || ''}`;

    // Reset refs if content changed
    if (lastLoadedIdRef.current !== currentKey) {
      hasDoneInitialLoadRef.current = false;
      isLoadingStreamsRef.current = false;
      lastLoadedIdRef.current = currentKey;
    }

    // Only proceed if we haven't done the initial load for this content
    if (hasDoneInitialLoadRef.current) return;

    const checkProviders = async () => {
      if (isLoadingStreamsRef.current) return;
      isLoadingStreamsRef.current = true;
      hasDoneInitialLoadRef.current = true;

      try {
        const stremioType = type === 'tv' ? 'series' : type;
        const hasStremioProviders = await stremioService.hasStreamProviders(stremioType);
        const hasLocalScrapers = settings.enableLocalScrapers && (await localScraperService.hasScrapers());
        const hasProviders = hasStremioProviders || hasLocalScrapers;

        if (!isMounted.current) return;

        setHasStreamProviders(hasProviders);
        setHasStremioStreamProviders(hasStremioProviders);

        if (!hasProviders) {
          const timer = setTimeout(() => {
            if (isMounted.current) setShowNoSourcesError(true);
          }, 500);
          return () => clearTimeout(timer);
        } else {
          if (episodeId) {
            setLoadingProviders({ stremio: true });
            setSelectedEpisode(episodeId);
            setStreamsLoadStart(Date.now());
            loadEpisodeStreams(episodeId);
          } else if (type === 'movie' || type === 'tv') {
            setStreamsLoadStart(Date.now());
            if (type === 'tv') setLoadingProviders({ stremio: true });
            loadStreams();
          } else {
            setLoadingProviders({ stremio: true });
            setStreamsLoadStart(Date.now());
            loadStreams();
          }

          setAutoplayTriggered(false);
          // Note: isAutoplayWaiting is now handled by a separate effect that waits for settings to load
        }
      } finally {
        isLoadingStreamsRef.current = false;
      }
    };

    checkProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id, episodeId, settings.autoplayBestStream, fromPlayer, settings.enableLocalScrapers]);

  // Autoplay effect
  useEffect(() => {
    if (settings.autoplayBestStream && !autoplayTriggered && isAutoplayWaiting) {
      const streams = selectedEpisode ? episodeStreams : groupedStreams;
      const hasLoadingStarted = streamsLoadStart !== null;
      const isStillLoading = !hasLoadingStarted || loadingStreams || loadingEpisodeStreams || activeFetchingScrapers.length > 0;

      if (Object.keys(streams).length > 0) {
        const bestStream = getBestStream(streams);

        if (bestStream) {
          logger.log('🚀 Autoplay: Best stream found, starting playback...');
          setAutoplayTriggered(true);
          setIsAutoplayWaiting(false);
          handleStreamPress(bestStream);
        } else if (!isStillLoading) {
          setIsAutoplayWaiting(false);
        }
      } else if (!isStillLoading) {
        setIsAutoplayWaiting(false);
      }
    }
  }, [
    settings.autoplayBestStream,
    autoplayTriggered,
    isAutoplayWaiting,
    type,
    episodeStreams,
    groupedStreams,
    getBestStream,
    handleStreamPress,
    metadata,
    selectedEpisode,
    loadingStreams,
    loadingEpisodeStreams,
    activeFetchingScrapers.length,
    streamsLoadStart,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      scraperLogoCache.clear();
      scraperLogoCachePromise = null;
    };
  }, []);

  // Filter items for provider selector
  const filterItems = useMemo((): FilterItem[] => {
    const installedAddons = stremioService.getInstalledAddons();
    const streams = selectedEpisode ? episodeStreams : groupedStreams;

    const providersWithStreams = Object.keys(streams).filter(key => {
      const providerData = streams[key];
      return providerData && providerData.streams && providerData.streams.length > 0;
    });

    const allProviders = new Set([
      ...Array.from(availableProviders).filter(
        (provider: string) => streams[provider] && streams[provider].streams && streams[provider].streams.length > 0
      ),
      ...providersWithStreams,
    ]);

    if (settings.streamDisplayMode === 'grouped') {
      const addonProviders: string[] = [];
      const pluginProviders: string[] = [];

      Array.from(allProviders).forEach(provider => {
        const isInstalledAddon = installedAddons.some(addon => addon.installationId === provider || addon.id === provider);
        if (isInstalledAddon) {
          addonProviders.push(provider);
        } else {
          pluginProviders.push(provider);
        }
      });

      const filterChips: FilterItem[] = [{ id: 'all', name: 'All Providers' }];

      addonProviders
        .sort((a, b) => {
          const indexA = installedAddons.findIndex(addon => addon.installationId === a || addon.id === a);
          const indexB = installedAddons.findIndex(addon => addon.installationId === b || addon.id === b);
          return indexA - indexB;
        })
        .forEach(provider => {
          const installedAddon = installedAddons.find(addon => addon.installationId === provider || addon.id === provider);
          // For multiple installations of same addon, show URL to differentiate
          const sameAddonInstallations = installedAddons.filter(a => installedAddon && a.id === installedAddon.id);
          const hasMultiple = sameAddonInstallations.length > 1;
          const installationNumber = hasMultiple ? sameAddonInstallations.findIndex(a => a.installationId === installedAddon?.installationId) + 1 : 0;
          const displayName = hasMultiple && installationNumber > 0
            ? `${installedAddon?.name} #${installationNumber}`
            : (installedAddon?.name || provider);
          filterChips.push({ id: provider, name: displayName });
        });

      // Group plugins by repository
      if (pluginProviders.length > 0) {
        const repoMap = new Map<string, { id: string; name: string }>();

        pluginProviders.forEach(providerId => {
          const repoInfo = localScraperService.getScraperRepository(providerId);
          if (repoInfo) {
            if (!repoMap.has(repoInfo.id)) {
              repoMap.set(repoInfo.id, { id: repoInfo.id, name: repoInfo.name });
            }
          }
        });

        // Add a chip for each repository that has plugins with streams
        repoMap.forEach(repo => {
          filterChips.push({ id: `repo-${repo.id}`, name: repo.name });
        });
      }

      return filterChips;
    }

    return [
      { id: 'all', name: 'All Providers' },
      ...Array.from(allProviders)
        .sort((a, b) => {
          const indexA = installedAddons.findIndex(addon => addon.installationId === a || addon.id === a);
          const indexB = installedAddons.findIndex(addon => addon.installationId === b || addon.id === b);
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return 0;
        })
        .map(provider => {
          const addonInfo = streams[provider];
          const installedAddon = installedAddons.find(addon => addon.installationId === provider || addon.id === provider);
          let displayName = provider;
          if (installedAddon) {
            // For multiple installations of same addon, show # to differentiate
            const sameAddonInstallations = installedAddons.filter(a => a.id === installedAddon.id);
            const hasMultiple = sameAddonInstallations.length > 1;
            const installationNumber = hasMultiple ? sameAddonInstallations.findIndex(a => a.installationId === installedAddon.installationId) + 1 : 0;
            displayName = hasMultiple && installationNumber > 0
              ? `${installedAddon.name} #${installationNumber}`
              : installedAddon.name;
          }
          else if (addonInfo?.addonName) displayName = addonInfo.addonName;
          return { id: provider, name: displayName };
        }),
    ];
  }, [availableProviders, type, episodeStreams, groupedStreams, settings.streamDisplayMode, metadata, selectedEpisode]);

  // Sections for stream list
  const sections = useMemo((): StreamSection[] => {
    const streams = selectedEpisode ? episodeStreams : groupedStreams;
    const installedAddons = stremioService.getInstalledAddons();

    const filteredEntries = Object.entries(streams).filter(([key]) => {
      if (selectedProvider === 'all') return true;

      // Handle repository-based filtering (repo-{repoId})
      if (settings.streamDisplayMode === 'grouped' && selectedProvider && selectedProvider.startsWith('repo-')) {
        const repoId = selectedProvider.replace('repo-', '');
        if (!repoId) return false;

        const isInstalledAddon = installedAddons.some(addon => addon.installationId === key || addon.id === key);
        if (isInstalledAddon) return false; // Not a plugin

        // Check if this plugin belongs to the selected repository
        const repoInfo = localScraperService.getScraperRepository(key);
        return !!(repoInfo && (repoInfo.id === repoId || repoInfo.id?.toLowerCase() === repoId?.toLowerCase()));
      }

      // Legacy: handle old grouped-plugins filter (fallback)
      if (settings.streamDisplayMode === 'grouped' && selectedProvider === 'grouped-plugins') {
        const isInstalledAddon = installedAddons.some(addon => addon.installationId === key || addon.id === key);
        return !isInstalledAddon;
      }

      return key === selectedProvider;
    });

    // Sort entries: installed addons first (in their installation order), then plugins
    const sortedEntries = filteredEntries.sort(([keyA], [keyB]) => {
      const isAddonA = installedAddons.some(addon => addon.installationId === keyA || addon.id === keyA);
      const isAddonB = installedAddons.some(addon => addon.installationId === keyB || addon.id === keyB);

      // Addons always come before plugins
      if (isAddonA && !isAddonB) return -1;
      if (!isAddonA && isAddonB) return 1;

      // Both are addons - sort by installation order
      if (isAddonA && isAddonB) {
        const indexA = installedAddons.findIndex(addon => addon.installationId === keyA || addon.id === keyA);
        const indexB = installedAddons.findIndex(addon => addon.installationId === keyB || addon.id === keyB);
        return indexA - indexB;
      }

      // Both are plugins - sort by response order
      const responseIndexA = addonResponseOrder.indexOf(keyA);
      const responseIndexB = addonResponseOrder.indexOf(keyB);
      if (responseIndexA !== -1 && responseIndexB !== -1) return responseIndexA - responseIndexB;
      if (responseIndexA !== -1) return -1;
      if (responseIndexB !== -1) return 1;
      return 0;
    });

    if (settings.streamDisplayMode === 'grouped') {
      const addonStreams: Stream[] = [];
      const pluginStreams: Stream[] = [];

      sortedEntries.forEach(([key, { streams: providerStreams }]) => {
        const isInstalledAddon = installedAddons.some(addon => addon.installationId === key || addon.id === key);

        if (isInstalledAddon) {
          addonStreams.push(...providerStreams);
        } else {
          const qualityFiltered = filterByQuality(providerStreams);
          const filteredStreams = filterByLanguage(qualityFiltered);
          if (filteredStreams.length > 0) {
            pluginStreams.push(...filteredStreams);
          }
        }
      });

      let combinedStreams = [...addonStreams];

      if (settings.streamSortMode === 'quality-then-scraper' && pluginStreams.length > 0) {
        combinedStreams.push(...sortStreamsByQuality(pluginStreams));
      } else {
        combinedStreams.push(...pluginStreams);
      }

      let sectionId = 'grouped-all';
      let sectionTitle = 'Available Streams';

      if (selectedProvider && selectedProvider.startsWith('repo-')) {
        const repoId = selectedProvider.replace('repo-', '');
        const repo = localScraperService.getRepository(repoId);
        if (repo) {
          sectionTitle = `Streams from ${repo.name}`;
          sectionId = `grouped-${repoId}`;
        }
      }

      if (combinedStreams.length === 0) return [];

      return [
        {
          title: sectionTitle,
          addonId: sectionId,
          data: combinedStreams,
          isEmptyDueToQualityFilter: false,
        },
      ];
    }

    return sortedEntries
      .map(([key, { addonName, streams: providerStreams }]) => {
        const isInstalledAddon = installedAddons.some(addon => addon.installationId === key || addon.id === key);
        const installedAddon = installedAddons.find(addon => addon.installationId === key || addon.id === key);
        let filteredStreams = providerStreams;

        if (!isInstalledAddon) {
          const qualityFiltered = filterByQuality(providerStreams);
          filteredStreams = filterByLanguage(qualityFiltered);
        }

        if (filteredStreams.length === 0) return null;

        let processedStreams = filteredStreams;
        if (!isInstalledAddon && settings.streamSortMode === 'quality-then-scraper') {
          processedStreams = sortStreamsByQuality(filteredStreams);
        }

        // For multiple installations of same addon, add # to section title
        let sectionTitle = addonName;
        if (installedAddon) {
          const sameAddonInstallations = installedAddons.filter(a => a.id === installedAddon.id);
          const hasMultiple = sameAddonInstallations.length > 1;
          const installationNumber = hasMultiple ? sameAddonInstallations.findIndex(a => a.installationId === installedAddon.installationId) + 1 : 0;
          sectionTitle = hasMultiple && installationNumber > 0
            ? `${addonName} #${installationNumber}`
            : addonName;
        }

        return {
          title: sectionTitle,
          addonId: key,
          data: processedStreams,
          isEmptyDueToQualityFilter: false,
        };
      })
      .filter(Boolean) as StreamSection[];
  }, [
    selectedProvider,
    type,
    episodeStreams,
    groupedStreams,
    settings.streamDisplayMode,
    filterByQuality,
    filterByLanguage,
    addonResponseOrder,
    settings.streamSortMode,
    selectedEpisode,
    metadata,
  ]);

  // Episode image
  const episodeImage = useMemo(() => {
    if (episodeThumbnail) {
      if (episodeThumbnail.startsWith('http')) return episodeThumbnail;
      return tmdbService.getImageUrl(episodeThumbnail, 'original');
    }
    if (!currentEpisode) return null;
    const hydratedStill = tmdbEpisodeOverride?.still_path;
    if (currentEpisode.still_path || hydratedStill) {
      if (currentEpisode.still_path.startsWith('http')) return currentEpisode.still_path;
      const path = currentEpisode.still_path || hydratedStill || '';
      return tmdbService.getImageUrl(path, 'original');
    }
    return null;
  }, [currentEpisode, episodeThumbnail, tmdbEpisodeOverride?.still_path]);

  // IMDb rating helper
  const getIMDbRating = useCallback(
    (seasonNumber: number, episodeNumber: number): number | null => {
      const key = `${seasonNumber}:${episodeNumber}`;
      return imdbRatingsMap[key] ?? null;
    },
    [imdbRatingsMap]
  );

  // Effective episode rating
  const effectiveEpisodeVote = useMemo(() => {
    if (!currentEpisode) return 0;
    const imdbRating = getIMDbRating(currentEpisode.season_number, currentEpisode.episode_number);
    if (imdbRating !== null) return imdbRating;
    const v = (tmdbEpisodeOverride?.vote_average ?? currentEpisode.vote_average) || 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }, [currentEpisode, tmdbEpisodeOverride?.vote_average, getIMDbRating]);

  // Check if has IMDb rating
  const hasIMDbRating = useMemo(() => {
    if (!currentEpisode) return false;
    return getIMDbRating(currentEpisode.season_number, currentEpisode.episode_number) !== null;
  }, [currentEpisode, getIMDbRating]);

  // Effective runtime
  const effectiveEpisodeRuntime = useMemo(() => {
    if (!currentEpisode) return undefined;
    return (tmdbEpisodeOverride?.runtime ?? (currentEpisode as any).runtime) as number | undefined;
  }, [currentEpisode, tmdbEpisodeOverride?.runtime]);

  // Mobile backdrop source
  const mobileBackdropSource = useMemo(() => {
    if (type === 'series' || (type === 'other' && selectedEpisode)) {
      if (episodeImage) return episodeImage;
      if (bannerImage) return bannerImage;
    }
    if (type === 'movie') {
      if (bannerImage) return bannerImage;
    }
    return bannerImage || episodeImage;
  }, [type, selectedEpisode, episodeImage, bannerImage]);

  // Color extraction source
  const colorExtractionSource = useMemo(() => {
    if (!settings.enableStreamsBackdrop) return null;
    if (type === 'series' || (type === 'other' && selectedEpisode)) {
      return episodeImage || null;
    }
    return null;
  }, [type, selectedEpisode, episodeImage, settings.enableStreamsBackdrop]);

  // Dominant color
  const { dominantColor } = useDominantColor(colorExtractionSource);

  // Gradient colors
  const createGradientColors = useCallback(
    (baseColor: string | null): [string, string, string, string, string] => {
      if (settings.enableStreamsBackdrop) {
        return ['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.95)'];
      }

      const themeBg = colors.darkBackground;
      if (themeBg.startsWith('#')) {
        const r = parseInt(themeBg.substr(1, 2), 16);
        const g = parseInt(themeBg.substr(3, 2), 16);
        const b = parseInt(themeBg.substr(5, 2), 16);
        return [
          `rgba(${r},${g},${b},0)`,
          `rgba(${r},${g},${b},0.3)`,
          `rgba(${r},${g},${b},0.6)`,
          `rgba(${r},${g},${b},0.85)`,
          `rgba(${r},${g},${b},0.95)`,
        ];
      }

      if (!baseColor || baseColor === '#1a1a1a') {
        return ['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.95)'];
      }

      const r = parseInt(baseColor.substr(1, 2), 16);
      const g = parseInt(baseColor.substr(3, 2), 16);
      const b = parseInt(baseColor.substr(5, 2), 16);

      return [
        `rgba(${r},${g},${b},0)`,
        `rgba(${r},${g},${b},0.3)`,
        `rgba(${r},${g},${b},0.6)`,
        `rgba(${r},${g},${b},0.85)`,
        `rgba(${r},${g},${b},0.95)`,
      ];
    },
    [settings.enableStreamsBackdrop, colors.darkBackground]
  );

  const gradientColors = useMemo(() => createGradientColors(dominantColor), [dominantColor, createGradientColors]);

  // Loading states
  // Loading states
  const isLoading = selectedEpisode ? loadingEpisodeStreams : loadingStreams;
  const streams = selectedEpisode ? episodeStreams : groupedStreams;

  const streamsEmpty =
    Object.keys(streams).length === 0 ||
    Object.values(streams).every(provider => !provider.streams || provider.streams.length === 0);
  const loadElapsed = streamsLoadStart ? Date.now() - streamsLoadStart : 0;
  const isActuallyLoading = isLoading || activeFetchingScrapers.length > 0;
  const showInitialLoading = streamsEmpty && isActuallyLoading && (streamsLoadStart === null || loadElapsed < 10000);
  const showStillFetching = streamsEmpty && isActuallyLoading && loadElapsed >= 10000;

  return {
    // Route params
    id,
    type,
    episodeId,
    episodeThumbnail,
    fromPlayer,

    // Theme
    currentTheme,
    colors,
    settings,

    // Navigation
    navigation,
    handleBack,

    // Tablet
    isTablet,

    // Alert
    alertVisible,
    alertTitle,
    alertMessage,
    alertActions,
    openAlert,
    closeAlert,

    // Metadata
    metadata,
    imdbId,
    bannerImage,
    currentEpisode,
    groupedEpisodes,

    // Streams
    streams,
    groupedStreams,
    episodeStreams,
    sections,
    filterItems,
    selectedProvider,
    handleProviderChange,
    handleStreamPress,

    // Loading states
    isLoading,
    loadingStreams,
    loadingEpisodeStreams,
    loadingProviders,
    streamsEmpty,
    showInitialLoading,
    showStillFetching,
    showNoSourcesError,
    hasStremioStreamProviders,

    // Autoplay
    isAutoplayWaiting,
    autoplayTriggered,

    // Scrapers
    activeFetchingScrapers,
    scraperLogos,

    // Movie
    movieLogoError,
    setMovieLogoError,

    // Episode
    episodeImage,
    effectiveEpisodeVote,
    effectiveEpisodeRuntime,
    hasIMDbRating,
    tmdbEpisodeOverride,
    selectedEpisode,

    // Backdrop
    mobileBackdropSource,
    gradientColors,
    dominantColor,
  };
};
