import React, { useCallback, useState, useEffect, useMemo, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  InteractionManager,
  BackHandler,
  Platform,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../contexts/ThemeContext';
import { useTraktContext } from '../contexts/TraktContext';
import { useMetadata } from '../hooks/useMetadata';
import { useDominantColor, preloadDominantColor } from '../hooks/useDominantColor';
import { CastSection } from '../components/metadata/CastSection';
import { CastDetailsModal } from '../components/metadata/CastDetailsModal';
import { SeriesContent } from '../components/metadata/SeriesContent';
import { MovieContent } from '../components/metadata/MovieContent';
import { MoreLikeThisSection } from '../components/metadata/MoreLikeThisSection';
import { RatingsSection } from '../components/metadata/RatingsSection';
import { CommentsSection, CommentBottomSheet } from '../components/metadata/CommentsSection';
import TrailersSection from '../components/metadata/TrailersSection';
import CollectionSection from '../components/metadata/CollectionSection';
import { RouteParams, Episode } from '../types/metadata';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolate,
  useSharedValue,
  withTiming,
  runOnJS,
  runOnUI,
  Easing,
  interpolateColor,
  withSpring,
  createAnimatedComponent,
} from 'react-native-reanimated';

// Create animated version of SafeAreaView for use with Reanimated styles
const AnimatedSafeAreaView = createAnimatedComponent(SafeAreaView);
import { RouteProp } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useSettings } from '../hooks/useSettings';
import { MetadataLoadingScreen, MetadataLoadingScreenRef } from '../components/loading/MetadataLoadingScreen';
import { useTrailer } from '../contexts/TrailerContext';
import FastImage from '@d11/react-native-fast-image';

// Import our optimized components and hooks
import HeroSection from '../components/metadata/HeroSection';
import FloatingHeader from '../components/metadata/FloatingHeader';
import MetadataDetails from '../components/metadata/MetadataDetails';
import { useMetadataAnimations } from '../hooks/useMetadataAnimations';
import { useMetadataAssets } from '../hooks/useMetadataAssets';
import { useWatchProgress } from '../hooks/useWatchProgress';
import { TraktService, TraktPlaybackItem } from '../services/traktService';
import { tmdbService } from '../services/tmdbService';
import { catalogService } from '../services/catalogService';

const { height } = Dimensions.get('window');

// Memoized components for better performance
const MemoizedCastSection = memo(CastSection);
const MemoizedSeriesContent = memo(SeriesContent);
const MemoizedMovieContent = memo(MovieContent);
const MemoizedMoreLikeThisSection = memo(MoreLikeThisSection);
// Enhanced responsive breakpoints for Metadata Screen
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

const MemoizedRatingsSection = memo(RatingsSection);
const MemoizedCommentsSection = memo(CommentsSection);
const MemoizedCastDetailsModal = memo(CastDetailsModal);

const MetadataScreen: React.FC = () => {
  const route = useRoute<RouteProp<Record<string, RouteParams & { episodeId?: string; addonId?: string }>, string>>();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { id, type, episodeId, addonId } = route.params;
  const { t } = useTranslation();

  // Log route parameters for debugging
  React.useEffect(() => {
    console.log('🔍 [MetadataScreen] Route params:', { id, type, episodeId, addonId });
  }, [id, type, episodeId, addonId]);

  // Consolidated hooks for better performance
  const { settings } = useSettings();
  const { currentTheme } = useTheme();
  const { top: safeAreaTop } = useSafeAreaInsets();
  const { pauseTrailer } = useTrailer();

  // Trakt integration
  const { isAuthenticated, isInWatchlist, isInCollection, addToWatchlist, removeFromWatchlist, addToCollection, removeFromCollection } = useTraktContext();

  // Enhanced responsive sizing for tablets and TV screens
  const deviceWidth = Dimensions.get('window').width;
  const deviceHeight = Dimensions.get('window').height;

  // Determine device type based on width
  const getDeviceType = useCallback(() => {
    if (deviceWidth >= BREAKPOINTS.tv) return 'tv';
    if (deviceWidth >= BREAKPOINTS.largeTablet) return 'largeTablet';
    if (deviceWidth >= BREAKPOINTS.tablet) return 'tablet';
    return 'phone';
  }, [deviceWidth]);

  const deviceType = getDeviceType();
  const isTablet = deviceType === 'tablet';
  const isLargeTablet = deviceType === 'largeTablet';
  const isTV = deviceType === 'tv';
  const isLargeScreen = isTablet || isLargeTablet || isTV;

  // Enhanced spacing and padding for production sections
  const horizontalPadding = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 32;
      case 'largeTablet':
        return 28;
      case 'tablet':
        return 24;
      default:
        return 16; // phone
    }
  }, [deviceType]);

  // Optimized state management - reduced state variables
  const [isContentReady, setIsContentReady] = useState(false);
  const [showCastModal, setShowCastModal] = useState(false);
  const [selectedCastMember, setSelectedCastMember] = useState<any>(null);
  const [shouldLoadSecondaryData, setShouldLoadSecondaryData] = useState(false);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  // Source switching removed
  const transitionOpacity = useSharedValue(1);
  const interactionComplete = useRef(false);

  // Animation values for network/production sections
  const networkSectionOpacity = useSharedValue(0);
  const productionSectionOpacity = useSharedValue(0);

  // Comment bottom sheet state
  const [commentBottomSheetVisible, setCommentBottomSheetVisible] = useState(false);
  const [selectedComment, setSelectedComment] = useState<any>(null);
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(new Set());
  const loadingScreenRef = useRef<MetadataLoadingScreenRef>(null);
  const [loadingScreenExited, setLoadingScreenExited] = useState(false);
  // Delay flag to show sections 800ms after cast is rendered (if present)
  const [postCastDelayDone, setPostCastDelayDone] = useState(false);


  // Debug state changes
  React.useEffect(() => {
    console.log('MetadataScreen: commentBottomSheetVisible changed to:', commentBottomSheetVisible);
  }, [commentBottomSheetVisible]);

  React.useEffect(() => {
    console.log('MetadataScreen: selectedComment changed to:', selectedComment?.id);
  }, [selectedComment]);

  const {
    metadata,
    loading,
    error: metadataError,
    cast,
    loadingCast,
    episodes,
    selectedSeason,
    loadingSeasons,
    loadMetadata,
    handleSeasonChange,
    toggleLibrary,
    inLibrary,
    groupedEpisodes,
    recommendations,
    loadingRecommendations,
    setMetadata,
    imdbId,
    tmdbId,
    collectionMovies,
    loadingCollection,
  } = useMetadata({ id, type, addonId });


  // Log useMetadata hook state changes for debugging
  React.useEffect(() => {
    console.log('🔍 [MetadataScreen] useMetadata state:', {
      loading,
      hasMetadata: !!metadata,
      metadataId: metadata?.id,
      metadataName: metadata?.name,
      error: metadataError,
      hasCast: cast.length > 0,
      hasEpisodes: episodes.length > 0,
      seasonsCount: Object.keys(groupedEpisodes).length,
      imdbId,
      tmdbId,
      hasNetworks: !!(metadata as any)?.networks,
      networksCount: metadata?.networks ? metadata.networks.length : 0
    });
  }, [loading, metadata, metadataError, cast.length, episodes.length, Object.keys(groupedEpisodes).length, imdbId, tmdbId]);

  // Animate network section when data becomes available (for series)
  useEffect(() => {
    const hasNetworks = metadata?.networks && metadata.networks.length > 0;
    const hasDescription = !!metadata?.description;
    const isSeries = Object.keys(groupedEpisodes).length > 0;
    // Defer showing until cast (if any) has finished fetching and 800ms delay elapsed
    const shouldShow = shouldLoadSecondaryData && postCastDelayDone && hasNetworks && hasDescription && isSeries;

    if (shouldShow && networkSectionOpacity.value === 0) {
      networkSectionOpacity.value = withTiming(1, { duration: 400 });
    }
  }, [metadata?.networks, metadata?.description, Object.keys(groupedEpisodes).length, shouldLoadSecondaryData, postCastDelayDone, networkSectionOpacity]);

  // Animate production section when data becomes available (for movies)
  useEffect(() => {
    const hasNetworks = metadata?.networks && metadata.networks.length > 0;
    const hasDescription = !!metadata?.description;
    const isMovie = Object.keys(groupedEpisodes).length === 0;
    // Defer showing until cast (if any) has finished fetching and 800ms delay elapsed
    const shouldShow = shouldLoadSecondaryData && postCastDelayDone && hasNetworks && hasDescription && isMovie;

    if (shouldShow && productionSectionOpacity.value === 0) {
      productionSectionOpacity.value = withTiming(1, { duration: 400 });
    }
  }, [metadata?.networks, metadata?.description, Object.keys(groupedEpisodes).length, shouldLoadSecondaryData, postCastDelayDone, productionSectionOpacity]);

  // Manage 800ms delay after cast finishes loading (only if cast is present)
  useEffect(() => {
    if (!shouldLoadSecondaryData) {
      setPostCastDelayDone(false);
      return;
    }

    if (!loadingCast) {
      if (cast && cast.length > 0) {
        setPostCastDelayDone(false);
        const t = setTimeout(() => setPostCastDelayDone(true), 200);
        return () => clearTimeout(t);
      } else {
        // If no cast present, no need to delay
        setPostCastDelayDone(true);
      }
    } else {
      // Reset while cast is loading
      setPostCastDelayDone(false);
    }
  }, [loadingCast, cast.length, shouldLoadSecondaryData]);

  // Optimized hooks with memoization and conditional loading
  const watchProgressData = useWatchProgress(id, Object.keys(groupedEpisodes).length > 0 ? 'series' : type as 'movie' | 'series', episodeId, episodes);
  const assetData = useMetadataAssets(metadata, id, type, imdbId, settings, setMetadata);
  const animations = useMetadataAnimations(safeAreaTop, watchProgressData.watchProgress);

  // Stable logo URI from HeroSection
  const [stableLogoUri, setStableLogoUri] = React.useState<string | null>(null);

  // Extract dominant color from hero image for dynamic background
  const heroImageUri = useMemo(() => {
    if (!settings.useDominantBackgroundColor) return null;
    if (!metadata) return null;
    return assetData.bannerImage || metadata.banner || metadata.poster || null;
  }, [settings.useDominantBackgroundColor, metadata, assetData.bannerImage]);

  // Preload color extraction as soon as we have the URI
  useEffect(() => {
    if (heroImageUri) {
      InteractionManager.runAfterInteractions(() => {
        preloadDominantColor(heroImageUri);
      });
    }
  }, [heroImageUri]);

  const { dominantColor, loading: colorLoading } = useDominantColor(heroImageUri);

  // Create shared values for smooth color interpolation
  const bgFromColor = useSharedValue(currentTheme.colors.darkBackground);
  const bgToColor = useSharedValue(currentTheme.colors.darkBackground);
  const bgProgress = useSharedValue(1);

  // Update the shared value when dominant color changes
  const hasAnimatedInitialColorRef = useRef(false);
  useEffect(() => {
    const base = currentTheme.colors.darkBackground;
    const target = (settings.useDominantBackgroundColor && dominantColor && dominantColor !== '#1a1a1a' && dominantColor !== null)
      ? dominantColor
      : base;

    if (!hasAnimatedInitialColorRef.current) {
      // Initial: animate from base to target smoothly
      bgFromColor.value = base as any;
      bgToColor.value = target as any;
      bgProgress.value = 0;
      bgProgress.value = withSpring(1, {
        damping: 30,
        stiffness: 90,
      });
      hasAnimatedInitialColorRef.current = true;
      return;
    }

    // Subsequent updates: retarget smoothly from the current on-screen color
    runOnUI(() => {
      'worklet';
      const current = interpolateColor(
        bgProgress.value,
        [0, 1],
        [bgFromColor.value as any, bgToColor.value as any]
      );
      bgFromColor.value = current as any;
      bgToColor.value = target as any;
      bgProgress.value = 0;
      bgProgress.value = withSpring(1, {
        damping: 30,
        stiffness: 90,
      });
    })();
  }, [dominantColor, currentTheme.colors.darkBackground, settings.useDominantBackgroundColor]);

  // Create an animated style for the background color
  const animatedBackgroundStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      bgProgress.value,
      [0, 1],
      [bgFromColor.value as any, bgToColor.value as any]
    );
    return { backgroundColor: color as any };
  });

  // Animated styles for network and production sections
  const networkSectionAnimatedStyle = useAnimatedStyle(() => ({
    opacity: networkSectionOpacity.value,
  }));

  const productionSectionAnimatedStyle = useAnimatedStyle(() => ({
    opacity: productionSectionOpacity.value,
  }));

  // For compatibility with existing code, maintain the static value as well
  const dynamicBackgroundColor = useMemo(() => {
    if (settings.useDominantBackgroundColor && dominantColor && dominantColor !== '#1a1a1a' && dominantColor !== null && dominantColor !== currentTheme.colors.darkBackground) {
      return dominantColor;
    }
    return currentTheme.colors.darkBackground;
  }, [dominantColor, currentTheme.colors.darkBackground, settings.useDominantBackgroundColor]);

  // Debug logging for color extraction timing
  useEffect(() => {
    if (__DEV__ && heroImageUri && dominantColor) {
      if (__DEV__) console.log('[MetadataScreen] Dynamic background color:', {
        dominantColor,
        fallback: currentTheme.colors.darkBackground,
        finalColor: dynamicBackgroundColor,
        heroImageUri
      });
    }
  }, [dominantColor, dynamicBackgroundColor, heroImageUri, currentTheme.colors.darkBackground]);

  // Focus effect for performance optimization
  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);

      // Delay secondary data loading until interactions are complete
      const timer = setTimeout(() => {
        if (!interactionComplete.current) {
          InteractionManager.runAfterInteractions(() => {
            setShouldLoadSecondaryData(true);
            interactionComplete.current = true;
          });
        }
      }, 50);

      return () => {
        setIsScreenFocused(false);
        clearTimeout(timer);
      };
    }, [])
  );

  // Handle back button press - close modal if open, otherwise navigate back
  useFocusEffect(
    useCallback(() => {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (showCastModal) {
          setShowCastModal(false);
          return true; // Prevent default back behavior
        }
        return false; // Allow default back behavior (navigate back)
      });

      return () => backHandler.remove();
    }, [showCastModal])
  );

  // Optimize secondary data loading
  useEffect(() => {
    if (metadata && isScreenFocused && !shouldLoadSecondaryData) {
      const timer = setTimeout(() => {
        setShouldLoadSecondaryData(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [metadata, isScreenFocused, shouldLoadSecondaryData]);

  // Optimized Trakt progress fetching - only when secondary data should load
  const fetchTraktProgress = useCallback(async () => {
    if (!shouldLoadSecondaryData || !metadata || !id) return;

    try {
      const traktService = TraktService.getInstance();
      const isAuthenticated = await traktService.isAuthenticated();

      if (!isAuthenticated) {
        if (__DEV__) console.log(`[MetadataScreen] Not authenticated with Trakt`);
        return;
      }

      // Get all playback progress from Trakt (cached)
      const allProgress = await traktService.getPlaybackProgress();

      if (allProgress.length === 0) return;

      // Filter progress for current content
      let relevantProgress: TraktPlaybackItem[] = [];

      if (type === 'movie') {
        relevantProgress = allProgress.filter(item =>
          item.type === 'movie' &&
          item.movie?.ids.imdb === id.replace('tt', '')
        );
      } else if (Object.keys(groupedEpisodes).length > 0) {
        relevantProgress = allProgress.filter(item =>
          item.type === 'episode' &&
          item.show?.ids.imdb === id.replace('tt', '')
        );
      }

      if (relevantProgress.length === 0) return;

      // Log only essential progress information for performance
      if (__DEV__) console.log(`[MetadataScreen] Found ${relevantProgress.length} Trakt progress items for ${type}`);

      // Find most recent progress if multiple episodes
      if (Object.keys(groupedEpisodes).length > 0 && relevantProgress.length > 1) {
        const mostRecent = relevantProgress.sort((a, b) =>
          new Date(b.paused_at).getTime() - new Date(a.paused_at).getTime()
        )[0];

        if (mostRecent.episode && mostRecent.show) {
          if (__DEV__) console.log(`[MetadataScreen] Most recent: S${mostRecent.episode.season}E${mostRecent.episode.number} - ${mostRecent.progress.toFixed(1)}%`);
        }
      }

    } catch (error) {
      if (__DEV__) console.error(`[MetadataScreen] Failed to fetch Trakt progress:`, error);
    }
  }, [shouldLoadSecondaryData, metadata, id, type]);

  // Debounced Trakt progress fetching
  useEffect(() => {
    if (shouldLoadSecondaryData && metadata && id) {
      const timer = setTimeout(fetchTraktProgress, 100);
      return () => clearTimeout(timer);
    }
  }, [shouldLoadSecondaryData, metadata, id, fetchTraktProgress]);

  // Memory management and cleanup
  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (transitionOpacity.value !== 0) {
        transitionOpacity.value = 0;
      }
      // Reset secondary data loading state
      setShouldLoadSecondaryData(false);
      interactionComplete.current = false;
    };
  }, []);

  // Performance monitoring (development only)
  useEffect(() => {
    if (__DEV__ && metadata) {
      const startTime = Date.now();
      const timer = setTimeout(() => {
        const renderTime = Date.now() - startTime;
        if (renderTime > 100) {
          if (__DEV__) console.warn(`[MetadataScreen] Slow render detected: ${renderTime}ms for ${metadata.name}`);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [metadata]);

  // Memory monitoring and cleanup
  useEffect(() => {
    if (__DEV__) {
      const memoryMonitor = () => {
        // Check if we have access to memory info
        if (performance && (performance as any).memory) {
          const memory = (performance as any).memory;
          const usedMB = Math.round(memory.usedJSHeapSize / 1048576);
          const totalMB = Math.round(memory.totalJSHeapSize / 1048576);
          const limitMB = Math.round(memory.jsHeapSizeLimit / 1048576);

          if (__DEV__) console.log(`[MetadataScreen] Memory usage: ${usedMB}MB / ${totalMB}MB (limit: ${limitMB}MB)`);

          // Trigger cleanup if memory usage is high
          if (usedMB > limitMB * 0.8) {
            if (__DEV__) console.warn(`[MetadataScreen] High memory usage detected (${usedMB}MB), triggering cleanup`);
            // Force garbage collection if available
            if (global.gc) {
              global.gc();
            }
          }
        }
      };

      // Monitor memory every 10 seconds
      const interval = setInterval(memoryMonitor, 10000);

      return () => clearInterval(interval);
    }
  }, []);

  // Memoized derived values for performance
  const isReady = useMemo(() => !loading && metadata && !metadataError, [loading, metadata, metadataError]);

  // Log readiness state for debugging
  React.useEffect(() => {
    console.log('🔍 [MetadataScreen] Readiness state:', {
      isReady,
      loading,
      hasMetadata: !!metadata,
      hasError: !!metadataError,
      errorMessage: metadataError
    });
  }, [isReady, loading, metadata, metadataError]);

  // Optimized content ready state management
  useEffect(() => {
    if (isReady && isScreenFocused) {
      setIsContentReady(true);
      transitionOpacity.value = withTiming(1, { duration: 50 });
    } else if (!isReady && isContentReady) {
      setIsContentReady(false);
      transitionOpacity.value = 0;
      setLoadingScreenExited(false); // Reset for next load
    }
  }, [isReady, isContentReady, isScreenFocused]);

  // Trigger loading screen exit animation when content is ready
  useEffect(() => {
    if (isReady && isContentReady && !loadingScreenExited && loadingScreenRef.current) {
      loadingScreenRef.current.exit();
    }
  }, [isReady, isContentReady, loadingScreenExited]);

  // Optimized callback functions with reduced dependencies and haptics throttling
  const handleToggleLibrary = useCallback(() => {
    if (isScreenFocused) {
      Haptics.impactAsync(inLibrary ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
    }
    toggleLibrary();
  }, [inLibrary, toggleLibrary, isScreenFocused]);

  const handleSeasonChangeWithHaptics = useCallback((seasonNumber: number) => {
    if (isScreenFocused) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    handleSeasonChange(seasonNumber);
  }, [handleSeasonChange, isScreenFocused]);

  const handleShowStreams = useCallback(() => {
    const { watchProgress } = watchProgressData;
    const isImdb = id.startsWith('tt');

    // Ensure trailer stops immediately before navigating to Streams
    try { pauseTrailer(); } catch { }

    // Helper to build episodeId from episode object
    const buildEpisodeId = (ep: any): string => {
      if (ep.stremioId) return ep.stremioId;
      return isImdb 
        ? `${id}:${ep.season_number}:${ep.episode_number}`
        : `${id}:${ep.episode_number}`;
    };

    if (Object.keys(groupedEpisodes).length > 0) {
      // Determine if current episode is finished
      let progressPercent = 0;
      if (watchProgress && watchProgress.duration > 0) {
        progressPercent = (watchProgress.currentTime / watchProgress.duration) * 100;
      }

      let targetEpisodeId: string | undefined;

      if (progressPercent >= 85 && watchProgress?.episodeId) {
        // Try to navigate to next episode – support multiple episodeId formats
        let currentSeason: number | null = null;
        let currentEpisode: number | null = null;

        const parts = watchProgress.episodeId.split(':');

        if (isImdb) {
          if (parts.length === 3) {
            currentSeason = parseInt(parts[1], 10);
            currentEpisode = parseInt(parts[2], 10);
          } else if (parts.length === 2) {
            currentEpisode = parseInt(parts[1], 10);
          }
        } else {
          currentEpisode = parts.length === 3 ? parseInt(parts[2], 10) : null;
        }

        if (currentEpisode !== null) {
          const nextEpisodeId = isImdb
            ? `${id}:${currentSeason || episodes[0]?.season_number || 1}:${currentEpisode + 1}`
            : `${id}:${currentEpisode + 1}`;
          if (__DEV__) console.log(`[MetadataScreen] Created next episode ID: ${nextEpisodeId}`);

          const nextEpisodeExists = episodes.some(ep => ep.episode_number === (currentEpisode + 1));
          if (nextEpisodeExists) {
            if (__DEV__) console.log(`[MetadataScreen] Verified next episode exists`);
          } else {
            if (__DEV__) console.log(`[MetadataScreen] Warning: Next episode not found`);
          }

          targetEpisodeId = nextEpisodeId;
        }
      }

      // Fallback logic: if not finished or nextEp not found
      if (!targetEpisodeId) {
        targetEpisodeId = watchProgress?.episodeId || episodeId || (episodes.length > 0 ? buildEpisodeId(episodes[0]) : undefined);
        if (__DEV__) console.log(`[MetadataScreen] Using fallback episode ID: ${targetEpisodeId}`);
      }

      if (targetEpisodeId) {
        // Ensure the episodeId has showId prefix (id:season:episode or id:episode)
        const epParts = targetEpisodeId.split(':');
        let normalizedEpisodeId = targetEpisodeId;
        
        if (epParts.length === 2 && !isImdb) {
          normalizedEpisodeId = `${id}:${epParts[1]}`;
        }
        else if (epParts.length === 2 && isImdb) {
          normalizedEpisodeId = `${id}:${epParts[0]}:${epParts[1]}`;
        }
        if (__DEV__) console.log(`[MetadataScreen] Navigating to streams with episodeId: ${normalizedEpisodeId}`);
        navigation.navigate('Streams', { id, type, episodeId: normalizedEpisodeId });
        return;
      }
    }

    // Normalize fallback episodeId too
    let fallbackEpisodeId = episodeId;
    if (episodeId && episodeId.split(':').length === 2) {
      const p = episodeId.split(':');
      if (!p[0].startsWith('tt')) {
        fallbackEpisodeId = isImdb ? `${id}:${p[0]}:${p[1]}` : `${id}:${p[1]}`;
      }
    }
    if (__DEV__) console.log(`[MetadataScreen] Navigating with fallback episodeId: ${fallbackEpisodeId}`);
    navigation.navigate('Streams', { id, type, episodeId: fallbackEpisodeId });
  }, [navigation, id, type, episodes, episodeId, watchProgressData.watchProgress]);

  const handleEpisodeSelect = useCallback((episode: Episode) => {
    if (!isScreenFocused) return;

    if (__DEV__) console.log('[MetadataScreen] Selected Episode:', episode.episode_number, episode.season_number);
    
    let episodeId: string;
    if (episode.stremioId) {
      episodeId = episode.stremioId;
    } else {
      const isImdb = id.startsWith('tt');
      episodeId = isImdb 
        ? `${id}:${episode.season_number}:${episode.episode_number}`
        : `${id}:${episode.episode_number}`;
    }

    // Optimize navigation with requestAnimationFrame
    requestAnimationFrame(() => {
      // Ensure trailer stops immediately before navigating to Streams
      try { pauseTrailer(); } catch { }
      navigation.navigate('Streams', {
        id,
        type,
        episodeId,
        episodeThumbnail: episode.still_path || undefined
      });
    });
  }, [navigation, id, type, isScreenFocused, pauseTrailer]);

  const handleBack = useCallback(() => {
    if (isScreenFocused) {
      navigation.goBack();
    }
  }, [navigation, isScreenFocused]);

  const handleSelectCastMember = useCallback((castMember: any) => {
    if (!isScreenFocused) return;
    setSelectedCastMember(castMember);
    setShowCastModal(true);
  }, [isScreenFocused]);

  const handleCommentPress = useCallback((comment: any) => {
    console.log('MetadataScreen: handleCommentPress called with comment:', comment?.id);
    if (!isScreenFocused) {
      console.log('MetadataScreen: Screen not focused, ignoring');
      return;
    }
    console.log('MetadataScreen: Setting selected comment and opening bottomsheet');
    setSelectedComment(comment);
    setCommentBottomSheetVisible(true);
    console.log('MetadataScreen: State should be updated now');
  }, [isScreenFocused]);

  const handleCommentBottomSheetClose = useCallback(() => {
    setCommentBottomSheetVisible(false);
    setSelectedComment(null);
  }, []);

  const handleSpoilerPress = useCallback((comment: any) => {
    Alert.alert(
      t('metadata.spoiler_warning'),
      t('metadata.spoiler_warning_desc'),
      [
        {
          text: t('metadata.cancel'),
          style: 'cancel',
        },
        {
          text: t('metadata.reveal_spoilers'),
          style: 'destructive',
          onPress: () => {
            setRevealedSpoilers(prev => new Set([...prev, comment.id.toString()]));
          },
        },
      ]
    );
  }, [t]);

  // Source switching removed

  // Ultra-optimized animated styles - minimal calculations with conditional updates
  const containerStyle = useAnimatedStyle(() => ({
    opacity: isScreenFocused ? animations.screenOpacity.value : 0.8,
  }), [isScreenFocused]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: animations.contentOpacity.value,
    transform: [{ translateY: animations.uiElementsTranslateY.value }]
  }), []);

  const transitionStyle = useAnimatedStyle(() => ({
    opacity: transitionOpacity.value,
  }), []);

  // Improved error component with user-friendly messages and error codes
  const ErrorComponent = useMemo(() => {
    if (!metadataError) return null;

    // Parse error to extract code and user-friendly message
    const parseError = (error: string) => {
      console.log('🔍 Parsing error in MetadataScreen:', error);

      // Check for HTTP status codes - handle multiple formats
      // Match patterns like: "status code 500", "status": 500, "Request failed with status code 500"
      const statusCodeMatch = error.match(/status code (\d+)/) ||
        error.match(/"status":\s*(\d+)/) ||
        error.match(/Request failed with status code (\d+)/) ||
        error.match(/\b(\d{3})\b/); // Match any 3-digit number (last resort)

      if (statusCodeMatch) {
        const code = parseInt(statusCodeMatch[1]);
        console.log('✅ Found status code:', code);
        switch (code) {
          case 404:
            return { code: '404', message: t('metadata.content_not_found'), userMessage: t('metadata.content_not_found_desc') };
          case 500:
            return { code: '500', message: t('metadata.server_error'), userMessage: t('metadata.server_error_desc') };
          case 502:
            return { code: '502', message: t('metadata.bad_gateway'), userMessage: t('metadata.bad_gateway_desc') };
          case 503:
            return { code: '503', message: t('metadata.service_unavailable'), userMessage: t('metadata.service_unavailable_desc') };
          case 429:
            return { code: '429', message: t('metadata.too_many_requests'), userMessage: t('metadata.too_many_requests_desc') };
          case 408:
            return { code: '408', message: t('metadata.request_timeout'), userMessage: t('metadata.request_timeout_desc') };
          default:
            return { code: code.toString(), message: `Error ${code}`, userMessage: t('metadata.something_went_wrong') };
        }
      }

      // Check for network/Axios errors
      if (error.includes('Network Error') ||
        error.includes('ERR_BAD_RESPONSE') ||
        error.includes('Request failed') ||
        error.includes('ERR_NETWORK')) {
        return { code: 'NETWORK', message: t('metadata.network_error'), userMessage: t('metadata.network_error_desc') };
      }

      // Check for timeout errors
      if (error.includes('timeout') ||
        error.includes('timed out') ||
        error.includes('ECONNABORTED') ||
        error.includes('ETIMEDOUT')) {
        return { code: 'TIMEOUT', message: t('metadata.request_timeout'), userMessage: t('metadata.request_timeout_desc') };
      }

      // Check for authentication errors
      if (error.includes('401') || error.includes('Unauthorized') || error.includes('authentication')) {
        return { code: '401', message: t('metadata.auth_error'), userMessage: t('metadata.auth_error_desc') };
      }

      // Check for permission errors
      if (error.includes('403') || error.includes('Forbidden') || error.includes('permission')) {
        return { code: '403', message: t('metadata.access_denied'), userMessage: t('metadata.access_denied_desc') };
      }

      // Check for "not found" errors - but only if no status code was found
      if (!statusCodeMatch && (error.includes('Content not found') || error.includes('not found'))) {
        return { code: '404', message: t('metadata.content_not_found'), userMessage: t('metadata.content_not_found_desc') };
      }

      // Check for retry/attempt errors
      if (error.includes('attempts') || error.includes('Please check your connection')) {
        return { code: 'CONNECTION', message: t('metadata.connection_error'), userMessage: t('metadata.network_error_desc') };
      }

      // Check for streams-related errors
      if (error.includes('streams') || error.includes('Failed to load streams')) {
        return { code: 'STREAMS', message: t('metadata.streams_unavailable'), userMessage: t('metadata.streams_unavailable_desc') };
      }

      // Default case
      return { code: 'UNKNOWN', message: t('metadata.unknown_error'), userMessage: t('metadata.something_went_wrong') };
    };

    const errorInfo = parseError(metadataError);

    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: dynamicBackgroundColor }]}
        edges={[]}
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={64} color={currentTheme.colors.error || '#FF6B6B'} />
          <Text style={[styles.errorTitle, { color: currentTheme.colors.highEmphasis }]}>
            {t('metadata.unable_to_load')}
          </Text>
          <Text style={[styles.errorCode, { color: currentTheme.colors.textMuted }]}>
            {t('metadata.error_code', { code: errorInfo.code })}
          </Text>
          <Text style={[styles.errorMessage, { color: currentTheme.colors.highEmphasis }]}>
            {errorInfo.userMessage}
          </Text>
          {__DEV__ && (
            <Text style={[styles.errorDetails, { color: currentTheme.colors.textMuted }]}>
              {metadataError}
            </Text>
          )}
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: currentTheme.colors.primary }]}
            onPress={loadMetadata}
          >
            <MaterialIcons name="refresh" size={20} color={currentTheme.colors.white} style={{ marginRight: 8 }} />
            <Text style={styles.retryButtonText}>{t('common.try_again')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.backButton, { borderColor: currentTheme.colors.primary }]}
            onPress={handleBack}
          >
            <Text style={[styles.backButtonText, { color: currentTheme.colors.primary }]}>{t('common.go_back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }, [metadataError, currentTheme, loadMetadata, handleBack]);

  // Show error if exists
  if (metadataError || (!loading && !metadata)) {
    console.log('🔍 [MetadataScreen] Showing error component:', {
      hasError: !!metadataError,
      errorMessage: metadataError,
      isLoading: loading,
      hasMetadata: !!metadata,
      loadingState: loading
    });
    return ErrorComponent;
  }

  // Show loading screen if metadata is not yet available or exit animation hasn't completed
  if (loading || !isContentReady || !loadingScreenExited) {
    console.log('🔍 [MetadataScreen] Showing loading screen:', {
      isLoading: loading,
      isContentReady,
      loadingScreenExited,
      hasMetadata: !!metadata,
      errorMessage: metadataError
    });
    return (
      <MetadataLoadingScreen
        ref={loadingScreenRef}
        type={Object.keys(groupedEpisodes).length > 0 ? 'series' : type as 'movie' | 'series'}
        onExitComplete={() => setLoadingScreenExited(true)}
      />
    );
  }

  return (
    <Animated.View style={[animatedBackgroundStyle, { flex: 1 }]}>
      <AnimatedSafeAreaView
        style={[containerStyle, styles.container]}
        edges={[]}
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" animated />

        {metadata && (
          <>
            {/* Floating Header - Optimized */}
            <FloatingHeader
              metadata={metadata}
              logoLoadError={assetData.logoLoadError}
              handleBack={handleBack}
              handleToggleLibrary={handleToggleLibrary}
              headerElementsY={animations.headerElementsY}
              inLibrary={inLibrary}
              headerOpacity={animations.headerOpacity}
              headerElementsOpacity={animations.headerElementsOpacity}
              safeAreaTop={safeAreaTop}
              setLogoLoadError={assetData.setLogoLoadError}
              stableLogoUri={stableLogoUri}
            />

            <Animated.ScrollView
              style={styles.scrollView}
              showsVerticalScrollIndicator={false}
              onScroll={animations.scrollHandler}
              scrollEventThrottle={16}
              bounces={Platform.OS === 'ios'}
              overScrollMode={Platform.OS === 'android' ? 'always' : 'always'}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {/* Hero Section - Optimized */}
              <HeroSection
                metadata={metadata}
                bannerImage={assetData.bannerImage}
                loadingBanner={assetData.loadingBanner}
                scrollY={animations.scrollY}
                heroHeight={animations.heroHeight}
                heroOpacity={animations.heroOpacity}
                logoOpacity={animations.logoOpacity}
                buttonsOpacity={animations.buttonsOpacity}
                buttonsTranslateY={animations.buttonsTranslateY}
                watchProgressOpacity={animations.watchProgressOpacity}
                watchProgressWidth={animations.watchProgressWidth}
                watchProgress={watchProgressData.watchProgress}
                onStableLogoUriChange={setStableLogoUri}
                type={Object.keys(groupedEpisodes).length > 0 ? 'series' : type as 'movie' | 'series'}
                getEpisodeDetails={watchProgressData.getEpisodeDetails}
                handleShowStreams={handleShowStreams}
                handleToggleLibrary={handleToggleLibrary}
                inLibrary={inLibrary}
                id={id}
                navigation={navigation}
                getPlayButtonText={watchProgressData.getPlayButtonText}
                setBannerImage={assetData.setBannerImage}
                groupedEpisodes={groupedEpisodes}
                // Trakt integration props
                isAuthenticated={isAuthenticated}
                isInWatchlist={isInWatchlist(id, type as 'movie' | 'show')}
                isInCollection={isInCollection(id, type as 'movie' | 'show')}
                onToggleWatchlist={async () => {
                  if (isInWatchlist(id, type as 'movie' | 'show')) {
                    await removeFromWatchlist(id, type as 'movie' | 'show');
                  } else {
                    await addToWatchlist(id, type as 'movie' | 'show');
                  }
                }}
                onToggleCollection={async () => {
                  if (isInCollection(id, type as 'movie' | 'show')) {
                    await removeFromCollection(id, type as 'movie' | 'show');
                  } else {
                    await addToCollection(id, type as 'movie' | 'show');
                  }
                }}
                dynamicBackgroundColor={dynamicBackgroundColor}
                handleBack={handleBack}
                tmdbId={tmdbId}
              />

              {/* Main Content - Optimized */}
              <Animated.View style={contentStyle}>
                <MetadataDetails
                  metadata={metadata}
                  imdbId={imdbId}
                  type={Object.keys(groupedEpisodes).length > 0 ? 'series' : type as 'movie' | 'series'}
                  contentId={id}
                  loadingMetadata={false}
                  renderRatings={() => imdbId && shouldLoadSecondaryData ? (
                    <MemoizedRatingsSection imdbId={imdbId} type={Object.keys(groupedEpisodes).length > 0 ? 'show' : 'movie'} />
                  ) : null}
                />

                {/* Production info row — shown below description and above cast for series */}
                {shouldLoadSecondaryData && Object.keys(groupedEpisodes).length > 0 && metadata?.networks && metadata.networks.length > 0 && metadata?.description && (
                  <Animated.View style={[
                    styles.productionContainer,
                    networkSectionAnimatedStyle,
                    { paddingHorizontal: horizontalPadding }
                  ]}>
                    <Text style={[
                      styles.productionHeader,
                      {
                        fontSize: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 17 : 16,
                        marginBottom: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                      }
                    ]}>{t('metadata.network')}</Text>
                    <View style={[
                      styles.productionRow,
                      {
                        gap: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8
                      }
                    ]}>
                      {metadata.networks.slice(0, 6).map((net) => (
                        <View key={String(net.id || net.name)} style={[
                          styles.productionChip,
                          {
                            paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8,
                            paddingHorizontal: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
                            minHeight: isTV ? 48 : isLargeTablet ? 44 : isTablet ? 40 : 36,
                            borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                          }
                        ]}>
                          {net.logo ? (
                            <FastImage
                              source={{ uri: net.logo }}
                              style={[
                                styles.productionLogo,
                                {
                                  width: isTV ? 80 : isLargeTablet ? 72 : isTablet ? 64 : 64,
                                  height: isTV ? 28 : isLargeTablet ? 26 : isTablet ? 24 : 22
                                }
                              ]}
                              resizeMode={FastImage.resizeMode.contain}
                            />
                          ) : (
                            <Text style={[
                              styles.productionText,
                              {
                                fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 12
                              }
                            ]}>{net.name}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  </Animated.View>
                )}

                {/* Cast Section with skeleton when loading - Lazy loaded */}
                {shouldLoadSecondaryData && (
                  <MemoizedCastSection
                    cast={cast}
                    loadingCast={loadingCast}
                    onSelectCastMember={handleSelectCastMember}
                    isTmdbEnrichmentEnabled={settings.enrichMetadataWithTMDB}
                  />
                )}

                {/* Production info row — only render companies with logos */}
                {shouldLoadSecondaryData &&
                  Object.keys(groupedEpisodes).length === 0 &&
                  metadata?.networks && Array.isArray(metadata.networks) &&
                  metadata.networks.some((n: any) => !!n?.logo) &&
                  metadata?.description && (
                    <Animated.View style={[
                      styles.productionContainer,
                      productionSectionAnimatedStyle,
                      { paddingHorizontal: horizontalPadding }
                    ]}>
                      <Text style={[
                        styles.productionHeader,
                        {
                          fontSize: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 17 : 16,
                          marginBottom: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                        }
                      ]}>{t('metadata.production')}</Text>
                      <View style={[
                        styles.productionRow,
                        {
                          gap: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8
                        }
                      ]}>
                        {metadata.networks
                          .filter((net: any) => !!net?.logo)
                          .slice(0, 6)
                          .map((net: any) => (
                            <View key={String(net.id || net.name)} style={[
                              styles.productionChip,
                              {
                                paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8,
                                paddingHorizontal: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
                                minHeight: isTV ? 48 : isLargeTablet ? 44 : isTablet ? 40 : 36,
                                borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                              }
                            ]}>
                              <FastImage
                                source={{ uri: net.logo }}
                                style={[
                                  styles.productionLogo,
                                  {
                                    width: isTV ? 80 : isLargeTablet ? 72 : isTablet ? 64 : 64,
                                    height: isTV ? 28 : isLargeTablet ? 26 : isTablet ? 24 : 22
                                  }
                                ]}
                                resizeMode={FastImage.resizeMode.contain}
                              />
                            </View>
                          ))}
                      </View>
                    </Animated.View>
                  )}

                {/* Trailers Section - Lazy loaded */}
                {shouldLoadSecondaryData && tmdbId && settings.enrichMetadataWithTMDB && (
                  <TrailersSection
                    tmdbId={tmdbId}
                    type={Object.keys(groupedEpisodes).length > 0 ? 'tv' : 'movie'}
                    contentId={id}
                    contentTitle={metadata?.name || (metadata as any)?.title || 'Unknown'}
                  />
                )}

                {/* Comments Section - Lazy loaded */}
                {shouldLoadSecondaryData && imdbId && (
                  <MemoizedCommentsSection
                    imdbId={imdbId}
                    type={Object.keys(groupedEpisodes).length > 0 ? 'show' : 'movie'}
                    onCommentPress={handleCommentPress}
                  />
                )}

                {/* Movie Details section - shown above recommendations for movies when TMDB enrichment is ON */}
                {shouldLoadSecondaryData && Object.keys(groupedEpisodes).length === 0 && metadata?.movieDetails && (
                  <View style={[
                    styles.tvDetailsContainer,
                    { paddingHorizontal: horizontalPadding }
                  ]}>
                    <Text style={[
                      styles.tvDetailsHeader,
                      {
                        fontSize: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 17 : 16,
                        marginBottom: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                      }
                    ]}>{t('metadata.movie_details')}</Text>

                    {metadata.movieDetails.tagline && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.tagline')}</Text>
                        <Text style={[styles.tvDetailValue, { fontStyle: 'italic', fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          "{metadata.movieDetails.tagline}"
                        </Text>
                      </View>
                    )}

                    {metadata.movieDetails.status && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.status')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.movieDetails.status}</Text>
                      </View>
                    )}

                    {metadata.movieDetails.releaseDate && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.release_date')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          {new Date(metadata.movieDetails.releaseDate).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </Text>
                      </View>
                    )}

                    {metadata.movieDetails.runtime && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.runtime')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          {Math.floor(metadata.movieDetails.runtime / 60)}h {metadata.movieDetails.runtime % 60}m
                        </Text>
                      </View>
                    )}

                    {metadata.movieDetails.budget && metadata.movieDetails.budget > 0 && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.budget')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          ${metadata.movieDetails.budget.toLocaleString()}
                        </Text>
                      </View>
                    )}

                    {metadata.movieDetails.revenue && metadata.movieDetails.revenue > 0 && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.revenue')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          ${metadata.movieDetails.revenue.toLocaleString()}
                        </Text>
                      </View>
                    )}

                    {metadata.movieDetails.originCountry && metadata.movieDetails.originCountry.length > 0 && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.origin_country')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.movieDetails.originCountry.join(', ')}</Text>
                      </View>
                    )}

                    {metadata.movieDetails.originalLanguage && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.original_language')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.movieDetails.originalLanguage.toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Backdrop Gallery section - shown after movie details for movies when TMDB ID is available and enrichment is enabled */}
                {shouldLoadSecondaryData && Object.keys(groupedEpisodes).length === 0 && metadata?.tmdbId && settings.enrichMetadataWithTMDB && (
                  <View style={styles.backdropGalleryContainer}>
                    <TouchableOpacity
                      style={styles.backdropGalleryButton}
                      onPress={() => navigation.navigate('BackdropGallery' as any, {
                        tmdbId: metadata.tmdbId,
                        type: 'movie',
                        title: metadata.name || 'Gallery'
                      })}
                    >
                      <Text style={[styles.backdropGalleryText, { color: currentTheme.colors.highEmphasis }]}>{t('metadata.backdrop_gallery')}</Text>
                      <MaterialIcons name="chevron-right" size={24} color={currentTheme.colors.highEmphasis} />
                    </TouchableOpacity>
                  </View>
                )}

                {/* Collection Section - Lazy loaded */}
                {shouldLoadSecondaryData &&
                  Object.keys(groupedEpisodes).length === 0 &&
                  metadata?.collection &&
                  settings.enrichMetadataWithTMDB && (
                    <CollectionSection
                      collectionName={metadata.collection.name}
                      collectionMovies={collectionMovies}
                      loadingCollection={loadingCollection}
                    />
                  )}

                {/* Series/Movie Content with episode skeleton when loading */}
                {Object.keys(groupedEpisodes).length > 0 ? (
                  <MemoizedSeriesContent
                    episodes={Object.values(groupedEpisodes).flat()}
                    selectedSeason={selectedSeason}
                    loadingSeasons={loadingSeasons}
                    onSeasonChange={handleSeasonChangeWithHaptics}
                    onSelectEpisode={handleEpisodeSelect}
                    groupedEpisodes={groupedEpisodes}
                    metadata={metadata || undefined}
                    imdbId={imdbId || undefined}
                  />
                ) : (
                  metadata && <MemoizedMovieContent metadata={metadata} />
                )}

                {/* TV Details section - shown after episodes for series when TMDB enrichment is ON */}
                {shouldLoadSecondaryData && Object.keys(groupedEpisodes).length > 0 && metadata?.tvDetails && (
                  <View style={[
                    styles.tvDetailsContainer,
                    { paddingHorizontal: horizontalPadding }
                  ]}>
                    <Text style={[
                      styles.tvDetailsHeader,
                      {
                        fontSize: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 17 : 16,
                        marginBottom: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                      }
                    ]}>{t('metadata.show_details')}</Text>

                    {metadata.tvDetails.status && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.status')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.tvDetails.status}</Text>
                      </View>
                    )}

                    {metadata.tvDetails.firstAirDate && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.first_air_date')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          {new Date(metadata.tvDetails.firstAirDate).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </Text>
                      </View>
                    )}

                    {metadata.tvDetails.lastAirDate && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.last_air_date')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          {new Date(metadata.tvDetails.lastAirDate).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </Text>
                      </View>
                    )}

                    {metadata.tvDetails.numberOfSeasons && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.seasons')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.tvDetails.numberOfSeasons}</Text>
                      </View>
                    )}

                    {metadata.tvDetails.numberOfEpisodes && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.total_episodes')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.tvDetails.numberOfEpisodes}</Text>
                      </View>
                    )}

                    {metadata.tvDetails.episodeRunTime && metadata.tvDetails.episodeRunTime.length > 0 && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.episode_runtime')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          {metadata.tvDetails.episodeRunTime.join(' - ')} min
                        </Text>
                      </View>
                    )}

                    {metadata.tvDetails.originCountry && metadata.tvDetails.originCountry.length > 0 && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.origin_country')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.tvDetails.originCountry.join(', ')}</Text>
                      </View>
                    )}

                    {metadata.tvDetails.originalLanguage && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.original_language')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{metadata.tvDetails.originalLanguage.toUpperCase()}</Text>
                      </View>
                    )}

                    {metadata.tvDetails.createdBy && metadata.tvDetails.createdBy.length > 0 && (
                      <View style={[styles.tvDetailRow, { paddingVertical: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8 }]}>
                        <Text style={[styles.tvDetailLabel, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>{t('metadata.created_by')}</Text>
                        <Text style={[styles.tvDetailValue, { fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 14 }]}>
                          {metadata.tvDetails.createdBy.map(creator => creator.name).join(', ')}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Backdrop Gallery section - shown after show details for TV shows when TMDB ID is available and enrichment is enabled */}
                {shouldLoadSecondaryData && Object.keys(groupedEpisodes).length > 0 && metadata?.tmdbId && settings.enrichMetadataWithTMDB && (
                  <View style={styles.backdropGalleryContainer}>
                    <TouchableOpacity
                      style={styles.backdropGalleryButton}
                      onPress={() => navigation.navigate('BackdropGallery' as any, {
                        tmdbId: metadata.tmdbId,
                        type: 'tv',
                        title: metadata.name || 'Gallery'
                      })}
                    >
                      <Text style={[styles.backdropGalleryText, { color: currentTheme.colors.highEmphasis }]}>{t('metadata.backdrop_gallery')}</Text>
                      <MaterialIcons name="chevron-right" size={24} color={currentTheme.colors.highEmphasis} />
                    </TouchableOpacity>
                  </View>
                )}

                {/* Recommendations Section with skeleton when loading - Shown at bottom for shows */}
                {shouldLoadSecondaryData && (
                  <MemoizedMoreLikeThisSection
                    recommendations={recommendations}
                    loadingRecommendations={loadingRecommendations}
                  />
                )}
              </Animated.View>
            </Animated.ScrollView>
          </>
        )}

        {/* Cast Details Modal - Memoized */}
        {showCastModal && (
          <MemoizedCastDetailsModal
            visible={showCastModal}
            onClose={() => setShowCastModal(false)}
            castMember={selectedCastMember}
          />
        )}

        {/* Comment Bottom Sheet - Memoized */}
        <CommentBottomSheet
          comment={selectedComment}
          visible={commentBottomSheetVisible}
          onClose={handleCommentBottomSheetClose}
          theme={currentTheme}
          isSpoilerRevealed={selectedComment ? revealedSpoilers.has(selectedComment.id.toString()) : false}
          onSpoilerPress={() => selectedComment && handleSpoilerPress(selectedComment)}
        />
      </AnimatedSafeAreaView>
    </Animated.View>
  );
};

// Optimized styles with minimal properties
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  errorCode: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  errorMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  errorDetails: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
    padding: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    fontFamily: 'monospace',
  },
  errorText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginBottom: 16,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 2,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Skeleton loading styles
  skeletonSection: {
    padding: 16,
    marginBottom: 24,
  },
  skeletonTitle: {
    width: 150,
    height: 20,
    borderRadius: 4,
    marginBottom: 16,
  },
  skeletonCastRow: {
    flexDirection: 'row',
    gap: 12,
  },
  skeletonCastItem: {
    width: 80,
    height: 120,
    borderRadius: 8,
  },
  skeletonRecommendationsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  skeletonRecommendationItem: {
    width: 120,
    height: 180,
    borderRadius: 8,
  },
  skeletonEpisodesContainer: {
    gap: 12,
  },
  skeletonEpisodeItem: {
    width: '100%',
    height: 80,
    borderRadius: 8,
    marginBottom: 8,
  },
  productionContainer: {
    marginTop: 0,
    marginBottom: 20,
  },
  productionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  productionChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(245,245,245,0.9)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  productionLogo: {
    width: 64,
    height: 22,
  },
  productionText: {
    color: '#333',
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.9,
  },
  productionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.9,
  },
  tvDetailsContainer: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  tvDetailsHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.9,
  },
  tvDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  tvDetailLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    opacity: 0.8,
  },
  tvDetailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
    opacity: 0.9,
    textAlign: 'right',
    flex: 1,
  },
  backdropGalleryContainer: {
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
  },
  backdropGalleryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backdropGalleryText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    opacity: 0.9,
  },
});



export default MetadataScreen;