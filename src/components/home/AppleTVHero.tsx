import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
  ViewStyle,
  TextStyle,
  StatusBar,
  Image,
} from 'react-native';
import { NavigationProp, useNavigation, useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { LinearGradient } from 'expo-linear-gradient';
import FastImage from '@d11/react-native-fast-image';
import { MaterialIcons, Entypo } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  withDelay,
  runOnJS,
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
  SharedValue,
  useAnimatedReaction,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StreamingContent } from '../../services/catalogService';
import { useTheme } from '../../contexts/ThemeContext';
import { logger } from '../../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../../hooks/useSettings';
import { useTrailer } from '../../contexts/TrailerContext';
import TrailerService from '../../services/trailerService';
import TrailerPlayer from '../video/TrailerPlayer';
import { useLibrary } from '../../hooks/useLibrary';
import { useToast } from '../../contexts/ToastContext';
import { useTraktContext } from '../../contexts/TraktContext';
import { BlurView as ExpoBlurView } from 'expo-blur';
import { useWatchProgress } from '../../hooks/useWatchProgress';
import { streamCacheService } from '../../services/streamCacheService';

interface AppleTVHeroProps {
  featuredContent: StreamingContent | null;
  allFeaturedContent?: StreamingContent[];
  loading?: boolean;
  onRetry?: () => void;
  scrollY?: SharedValue<number>; // Optional scroll position for parallax
}

const { width, height } = Dimensions.get('window');

// Get status bar height
const STATUS_BAR_HEIGHT = StatusBar.currentHeight || 0;

// Calculate hero height - 85% of screen height
const HERO_HEIGHT = height * 0.85;

// Animated Pagination Dot Component
const PaginationDot: React.FC<{
  isActive: boolean;
  isNext: boolean;
  dragProgress: SharedValue<number>;
  onPress: () => void;
}> = React.memo(
  ({ isActive, isNext, dragProgress, onPress }) => {
    const animatedStyle = useAnimatedStyle(() => {
      // Base values
      const activeWidth = 32;
      const inactiveWidth = 8;
      const activeOpacity = 0.9;
      const inactiveOpacity = 0.3;

      // Calculate target width and opacity based on state
      let targetWidth = isActive ? activeWidth : inactiveWidth;
      let targetOpacity = isActive ? activeOpacity : inactiveOpacity;

      // If this is the next dot during drag, interpolate between inactive and active
      if (isNext && dragProgress.value > 0) {
        targetWidth = interpolate(
          dragProgress.value,
          [0, 1],
          [inactiveWidth, activeWidth],
          Extrapolation.CLAMP
        );
        targetOpacity = interpolate(
          dragProgress.value,
          [0, 1],
          [inactiveOpacity, activeOpacity],
          Extrapolation.CLAMP
        );
      }

      // If this is the current active dot during drag, interpolate from active to inactive
      if (isActive && dragProgress.value > 0) {
        targetWidth = interpolate(
          dragProgress.value,
          [0, 1],
          [activeWidth, inactiveWidth],
          Extrapolation.CLAMP
        );
        targetOpacity = interpolate(
          dragProgress.value,
          [0, 1],
          [activeOpacity, inactiveOpacity],
          Extrapolation.CLAMP
        );
      }

      return {
        width: withTiming(targetWidth, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        }),
        opacity: withTiming(targetOpacity, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        }),
      };
    });

    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Animated.View style={[styles.paginationDot, animatedStyle]} />
      </TouchableOpacity>
    );
  }
);

const AppleTVHero: React.FC<AppleTVHeroProps> = ({
  featuredContent,
  allFeaturedContent,
  loading,
  onRetry,
  scrollY: externalScrollY,
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const { isTrailerPlaying: globalTrailerPlaying, setTrailerPlaying } = useTrailer();
  const { toggleLibrary, isInLibrary: checkIsInLibrary } = useLibrary();
  const { showSaved, showTraktSaved, showRemoved, showTraktRemoved } = useToast();
  const { isAuthenticated: isTraktAuthenticated } = useTraktContext();

  // Library and watch state
  const [inLibrary, setInLibrary] = useState(false);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [isWatched, setIsWatched] = useState(false);
  const [shouldResume, setShouldResume] = useState(false);
  const [type, setType] = useState<'movie' | 'series'>('movie');

  // Shared value for scroll position (for parallax effects)
  const internalScrollY = useSharedValue(0);
  const scrollY = externalScrollY || internalScrollY;

  const [isOutOfView, setIsOutOfView] = useState(false);

  // Track if hero is in view
  useAnimatedReaction(
    () => scrollY.value,
    (currentScrollY) => {
      // If hero is more than 80% scrolled out of view, consider it out of view
      const outOfView = currentScrollY > HERO_HEIGHT * 0.8;
      if (outOfView !== isOutOfView) {
        runOnJS(setIsOutOfView)(outOfView);
      }
    },
    [isOutOfView]
  );

  // Determine items to display
  const items = useMemo(() => {
    if (allFeaturedContent && allFeaturedContent.length > 0) {
      return allFeaturedContent.slice(0, 8); // Limit to 8 items for performance
    }
    return featuredContent ? [featuredContent] : [];
  }, [allFeaturedContent, featuredContent]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [bannerLoaded, setBannerLoaded] = useState<Record<number, boolean>>({});
  const [logoLoaded, setLogoLoaded] = useState<Record<number, boolean>>({});
  const [logoError, setLogoError] = useState<Record<number, boolean>>({});
  const [logoHeights, setLogoHeights] = useState<Record<number, number>>({});
  const autoPlayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  // Trailer state
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerError, setTrailerError] = useState(false);
  const [trailerReady, setTrailerReady] = useState(false);
  const [trailerPreloaded, setTrailerPreloaded] = useState(false);
  const [trailerShouldBePaused, setTrailerShouldBePaused] = useState(false);
  const trailerVideoRef = useRef<any>(null);

  // Use ref to avoid re-fetching trailer when trailerMuted changes
  const showTrailersEnabled = useRef(settings?.showTrailers ?? false);

  // Update ref when showTrailers setting changes
  useEffect(() => {
    showTrailersEnabled.current = settings?.showTrailers ?? false;
  }, [settings?.showTrailers]);

  const currentItem = items[currentIndex] || null;

  // Use watch progress hook
  const {
    watchProgress,
    getPlayButtonText: getProgressPlayButtonText,
    loadWatchProgress
  } = useWatchProgress(
    currentItem?.id || '',
    type,
    undefined,
    [] // Pass episodes if you have them for series
  );

  // Animation values
  const dragProgress = useSharedValue(0);
  const dragDirection = useSharedValue(0); // -1 for left, 1 for right
  const isDragging = useSharedValue(0); // 1 when dragging, 0 when not
  const logoOpacity = useSharedValue(1);
  const [nextIndex, setNextIndex] = useState(currentIndex);
  const thumbnailOpacity = useSharedValue(1);
  const trailerOpacity = useSharedValue(0);
  const trailerMuted = settings?.trailerMuted ?? true;
  // Initialize to 0 for smooth fade-in
  const heroOpacity = useSharedValue(0);

  // Handler for trailer end
  const handleTrailerEnd = useCallback(() => {
    logger.info('[AppleTVHero] Trailer ended');
    setTrailerPlaying(false);
    // Fade back to thumbnail
    trailerOpacity.value = withTiming(0, { duration: 300 });
    thumbnailOpacity.value = withTiming(1, { duration: 300 });
  }, [setTrailerPlaying, trailerOpacity, thumbnailOpacity]);

  // Animated style for trailer container - 60% height with zoom
  const trailerContainerStyle = useAnimatedStyle(() => {
    // Faster fade out during drag - complete fade by 0.3 progress instead of 1.0
    const dragFade = interpolate(
      dragProgress.value,
      [0, 0.05, 0.1, 0.15, 0.2, 0.3],
      [1, 0.85, 0.65, 0.4, 0.15, 0],
      Extrapolation.CLAMP
    );

    return {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: HERO_HEIGHT * 0.9, // 90% of hero height
      overflow: 'hidden',
      opacity: trailerOpacity.value * dragFade,
    };
  });

  // Animated style for trailer video - zoomed in 5%
  const trailerVideoStyle = useAnimatedStyle(() => {
    return {
      width: '100%',
      height: '100%',
      transform: [{ scale: 1.05 }], // 5% zoom
    };
  });

  // Parallax style for background images - disabled during drag
  const backgroundParallaxStyle = useAnimatedStyle(() => {
    'worklet';
    const scrollYValue = scrollY.value;

    // Keep parallax active during drag to prevent jumps
    // if (isDragging.value > 0) { ... }

    // Pre-calculated constants - start at 1.0 for normal size
    const DEFAULT_ZOOM = 1.0;
    const SCROLL_UP_MULTIPLIER = 0.002;
    const SCROLL_DOWN_MULTIPLIER = 0.0001;
    const MAX_SCALE = 1.3;
    const PARALLAX_FACTOR = 0.3;

    // Optimized scale calculation with minimal branching
    const scrollUpScale = DEFAULT_ZOOM + Math.abs(scrollYValue) * SCROLL_UP_MULTIPLIER;
    const scrollDownScale = DEFAULT_ZOOM + scrollYValue * SCROLL_DOWN_MULTIPLIER;
    const scale = Math.min(scrollYValue < 0 ? scrollUpScale : scrollDownScale, MAX_SCALE);

    // Single parallax calculation
    const parallaxOffset = scrollYValue * PARALLAX_FACTOR;

    return {
      transform: [
        { scale },
        { translateY: parallaxOffset }
      ],
    };
  });

  // Parallax style for trailer - disabled during drag
  const trailerParallaxStyle = useAnimatedStyle(() => {
    'worklet';
    const scrollYValue = scrollY.value;

    // Keep parallax active during drag to prevent jumps
    // if (isDragging.value > 0) { ... }

    // Pre-calculated constants - start at 1.0 for normal size
    const DEFAULT_ZOOM = 1.0;
    const SCROLL_UP_MULTIPLIER = 0.0015;
    const SCROLL_DOWN_MULTIPLIER = 0.0001;
    const MAX_SCALE = 1.2;
    const PARALLAX_FACTOR = 0.2; // Slower than background for depth

    // Optimized scale calculation with minimal branching
    const scrollUpScale = DEFAULT_ZOOM + Math.abs(scrollYValue) * SCROLL_UP_MULTIPLIER;
    const scrollDownScale = DEFAULT_ZOOM + scrollYValue * SCROLL_DOWN_MULTIPLIER;
    const scale = Math.min(scrollYValue < 0 ? scrollUpScale : scrollDownScale, MAX_SCALE);

    // Single parallax calculation
    const parallaxOffset = scrollYValue * PARALLAX_FACTOR;

    return {
      transform: [
        { scale },
        { translateY: parallaxOffset }
      ],
    };
  });

  // Reset loaded states when items change
  useEffect(() => {
    setBannerLoaded({});
    setLogoLoaded({});
    setLogoError({});
    setLogoHeights({});
  }, [items.length]);

  // Mark initial load as complete after a short delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setInitialLoadComplete(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Smooth fade-in when content loads
  useEffect(() => {
    if (currentItem && !loading) {
      heroOpacity.value = withTiming(1, {
        duration: 800,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [currentItem, loading, heroOpacity]);

  // Stop trailer when screen loses focus or scrolled out of view
  useEffect(() => {
    if (!isFocused || isOutOfView) {
      // Pause this screen's trailer
      setTrailerShouldBePaused(true);
      setTrailerPlaying(false);

      // Fade out trailer
      trailerOpacity.value = withTiming(0, { duration: 300 });
      thumbnailOpacity.value = withTiming(1, { duration: 300 });

      if (!isFocused) {
        logger.info('[AppleTVHero] Screen lost focus - pausing trailer');
      } else {
        logger.info('[AppleTVHero] Scrolled out of view - pausing trailer');
      }
    } else {
      // Screen gained focus and is in view - allow trailer to resume if it was ready
      setTrailerShouldBePaused(false);

      // If trailer was ready and loaded, restore the video opacity
      if (trailerReady && trailerUrl) {
        logger.info('[AppleTVHero] Screen in focus and in view - restoring trailer');
        thumbnailOpacity.value = withTiming(0, { duration: 800 });
        trailerOpacity.value = withTiming(1, { duration: 800 });
        setTrailerPlaying(true);
      }
    }
  }, [isFocused, isOutOfView, setTrailerPlaying, trailerOpacity, thumbnailOpacity, trailerReady, trailerUrl]);

  // Listen to navigation events to stop trailer when navigating to other screens
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      // Screen is blurred (navigated away)
      setTrailerPlaying(false);
      trailerOpacity.value = withTiming(0, { duration: 300 });
      thumbnailOpacity.value = withTiming(1, { duration: 300 });
      logger.info('[AppleTVHero] Navigation blur event - stopping trailer');
    });

    return () => {
      unsubscribe();
      // Stop trailer when component unmounts
      setTrailerPlaying(false);
      logger.info('[AppleTVHero] Component unmounting - stopping trailer');
    };
  }, [navigation, setTrailerPlaying, trailerOpacity, thumbnailOpacity]);

  // Fetch trailer URL when current item changes
  useEffect(() => {
    let alive = true;

    const fetchTrailer = async () => {
      if (!currentItem || !showTrailersEnabled.current) {
        setTrailerUrl(null);
        return;
      }

      // Reset trailer state when item changes
      setTrailerLoading(true);
      setTrailerError(false);
      setTrailerReady(false);
      setTrailerPreloaded(false);
      setTrailerPlaying(false);

      // Fade out any existing trailer
      trailerOpacity.value = withTiming(0, { duration: 300 });
      thumbnailOpacity.value = withTiming(1, { duration: 300 });

      try {
        // Extract year from metadata
        const year = currentItem.releaseInfo
          ? parseInt(currentItem.releaseInfo.split('-')[0], 10)
          : new Date().getFullYear();

        // Extract TMDB ID if available
        const tmdbId = currentItem.id?.startsWith('tmdb:')
          ? currentItem.id.replace('tmdb:', '')
          : undefined;

        const contentType = currentItem.type === 'series' ? 'tv' : 'movie';

        logger.info('[AppleTVHero] Fetching trailer for:', currentItem.name, year, tmdbId);

        const url = await TrailerService.getTrailerUrl(
          currentItem.name,
          year,
          tmdbId,
          contentType
        );

        if (!alive) return;

        if (url) {
          const bestUrl = TrailerService.getBestFormatUrl(url);
          setTrailerUrl(bestUrl);
          // logger.info('[AppleTVHero] Trailer URL loaded:', bestUrl);
        } else {
          logger.info('[AppleTVHero] No trailer found for:', currentItem.name);
          setTrailerUrl(null);
        }
      } catch (error) {
        if (!alive) return;
        logger.error('[AppleTVHero] Error fetching trailer:', error);
        setTrailerError(true);
        setTrailerUrl(null);
      } finally {
        if (alive) {
          setTrailerLoading(false);
        }
      }
    };

    fetchTrailer();

    return () => {
      alive = false;
    };
  }, [currentItem, currentIndex]); // Removed settings?.showTrailers from dependencies

  // Handle trailer preloaded
  const handleTrailerPreloaded = useCallback(() => {
    setTrailerPreloaded(true);
    logger.info('[AppleTVHero] Trailer preloaded successfully');
  }, []);

  // Handle trailer ready to play
  const handleTrailerReady = useCallback(() => {
    setTrailerReady(true);

    // Smooth crossfade: thumbnail out, trailer in
    thumbnailOpacity.value = withTiming(0, { duration: 800 });
    trailerOpacity.value = withTiming(1, { duration: 800 });

    logger.info('[AppleTVHero] Trailer ready - starting playback');

    // Auto-start trailer
    setTrailerPlaying(true);
  }, [thumbnailOpacity, trailerOpacity, setTrailerPlaying]);

  // Handle trailer error
  const handleTrailerError = useCallback(() => {
    setTrailerError(true);
    setTrailerReady(false);
    setTrailerPlaying(false);

    // Fade back to thumbnail
    trailerOpacity.value = withTiming(0, { duration: 300 });
    thumbnailOpacity.value = withTiming(1, { duration: 300 });

    logger.error('[AppleTVHero] Trailer playback error');
  }, [trailerOpacity, thumbnailOpacity, setTrailerPlaying]);

  // Update state when current item changes and load watch progress
  useEffect(() => {
    if (currentItem) {
      setType(currentItem.type as 'movie' | 'series');
      checkItemStatus(currentItem.id);
      loadWatchProgress();
    }
  }, [currentItem, loadWatchProgress]);

  // Update play button text and watched state when watch progress changes
  useEffect(() => {
    if (currentItem) {
      const buttonText = getProgressPlayButtonText();
      // Use internal state for resume logic instead of string comparison
      setShouldResume(buttonText === 'Resume');

      // Update watched state based on progress
      if (watchProgress) {
        const progressPercent = (watchProgress.currentTime / watchProgress.duration) * 100;
        setIsWatched(progressPercent >= 85); // Consider watched if 85% or more completed
      } else {
        setIsWatched(false);
      }
    }
  }, [watchProgress, getProgressPlayButtonText, currentItem]);

  // Function to check item status
  const checkItemStatus = useCallback(async (itemId: string) => {
    try {
      // Check if item is in library
      const libraryStatus = checkIsInLibrary(itemId);
      setInLibrary(libraryStatus);

      // TODO: Check Trakt watchlist status if authenticated
      if (isTraktAuthenticated) {
        // await traktService.isInWatchlist(itemId);
        setIsInWatchlist(Math.random() > 0.5); // Replace with actual Trakt call
      }
    } catch (error) {
      logger.error('[AppleTVHero] Error checking item status:', error);
    }
  }, [checkIsInLibrary, isTraktAuthenticated]);

  // Update the handleSaveAction function:
  const handleSaveAction = useCallback(async (e?: any) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    if (!currentItem) return;

    const wasInLibrary = inLibrary;
    const wasInWatchlist = isInWatchlist;

    // Update local state immediately for responsiveness
    setInLibrary(!wasInLibrary);

    try {
      // Toggle library using the useLibrary hook
      const success = await toggleLibrary(currentItem);

      if (success) {
        logger.info('[AppleTVHero] Successfully toggled library:', currentItem.name);
      } else {
        logger.warn('[AppleTVHero] Library toggle returned false');
      }

      // If authenticated with Trakt, also toggle Trakt watchlist
      if (isTraktAuthenticated) {
        setIsInWatchlist(!wasInWatchlist);

        // TODO: Replace with your actual Trakt service call
        // await traktService.toggleWatchlist(currentItem.id, !wasInWatchlist);
        logger.info('[AppleTVHero] Toggled Trakt watchlist');
      }

    } catch (error) {
      logger.error('[AppleTVHero] Error toggling library:', error);
      // Revert state on error
      setInLibrary(wasInLibrary);
      if (isTraktAuthenticated) {
        setIsInWatchlist(wasInWatchlist);
      }
    }
  }, [currentItem, inLibrary, isInWatchlist, isTraktAuthenticated, toggleLibrary, showSaved, showTraktSaved, showRemoved, showTraktRemoved]);

  // Play button handler - navigates to Streams screen with progress data if available
  const handlePlayAction = useCallback(async () => {
    logger.info('[AppleTVHero] Play button pressed for:', currentItem?.name);
    if (!currentItem) return;

    // Stop any playing trailer
    try {
      setTrailerPlaying(false);
    } catch { }

    // Check if we should resume based on watch progress
    const shouldResume = watchProgress &&
      watchProgress.currentTime > 0 &&
      (watchProgress.currentTime / watchProgress.duration) < 0.85;

    logger.info('[AppleTVHero] Should resume:', shouldResume, watchProgress);

    try {
      // Check if we have a cached stream for this content
      const episodeId = currentItem.type === 'series' && watchProgress?.episodeId
        ? watchProgress.episodeId
        : undefined;

      logger.info('[AppleTVHero] Looking for cached stream with episodeId:', episodeId);

      const cachedStream = await streamCacheService.getCachedStream(currentItem.id, currentItem.type, episodeId);

      if (cachedStream && cachedStream.stream?.url) {
        // We have a valid cached stream, navigate directly to player
        logger.info('[AppleTVHero] Using cached stream for:', currentItem.name);

        // Determine the player route based on platform
        const playerRoute = Platform.OS === 'ios' ? 'PlayerIOS' : 'PlayerAndroid';

        // Navigate directly to player with cached stream data AND RESUME DATA
        navigation.navigate(playerRoute as any, {
          uri: cachedStream.stream.url,
          title: cachedStream.metadata?.name || currentItem.name,
          episodeTitle: cachedStream.episodeTitle,
          season: cachedStream.season,
          episode: cachedStream.episode,
          quality: (cachedStream.stream.title?.match(/(\d+)p/) || [])[1] || undefined,
          year: cachedStream.metadata?.year || currentItem.year,
          streamProvider: cachedStream.stream.addonId || cachedStream.stream.addonName || cachedStream.stream.name,
          streamName: cachedStream.stream.name || cachedStream.stream.title || 'Unnamed Stream',
          headers: cachedStream.stream.headers || undefined,
          id: currentItem.id,
          type: currentItem.type,
          episodeId: episodeId,
          imdbId: cachedStream.imdbId || cachedStream.metadata?.imdbId || currentItem.imdb_id,
          backdrop: cachedStream.metadata?.backdrop || currentItem.banner,
          videoType: undefined, // Let player auto-detect
          // ADD RESUME DATA if we should resume
          ...(shouldResume && watchProgress && {
            resumeTime: watchProgress.currentTime,
            duration: watchProgress.duration
          })
        } as any);

        return;
      }

      // No cached stream, navigate to Streams screen with resume data
      logger.info('[AppleTVHero] No cached stream, navigating to StreamsScreen for:', currentItem.name);

      const navigationParams: any = {
        id: currentItem.id,
        type: currentItem.type,
        title: currentItem.name,
        addonId: currentItem.addonId,
        metadata: {
          poster: currentItem.poster,
          banner: currentItem.banner,
          releaseInfo: currentItem.releaseInfo,
          genres: currentItem.genres
        }
      };

      // Add resume data if we have progress that's not near completion
      if (shouldResume && watchProgress) {
        navigationParams.resumeTime = watchProgress.currentTime;
        navigationParams.duration = watchProgress.duration;
        navigationParams.episodeId = watchProgress.episodeId;
        logger.info('[AppleTVHero] Passing resume data to Streams:', watchProgress.currentTime, watchProgress.duration);
      }

      navigation.navigate('Streams', navigationParams);

    } catch (error) {
      logger.error('[AppleTVHero] Error handling play action:', error);
      // Fallback to StreamsScreen on any error
      navigation.navigate('Streams', {
        id: currentItem.id,
        type: currentItem.type,
        title: currentItem.name,
        addonId: currentItem.addonId,
        metadata: {
          poster: currentItem.poster,
          banner: currentItem.banner,
          releaseInfo: currentItem.releaseInfo,
          genres: currentItem.genres
        }
      });
    }
  }, [currentItem, navigation, setTrailerPlaying, watchProgress]);

  // Handle fullscreen toggle
  const handleFullscreenToggle = useCallback(async () => {
    try {
      logger.info('[AppleTVHero] Fullscreen button pressed');
      if (trailerVideoRef.current) {
        await trailerVideoRef.current.presentFullscreenPlayer();
      }
    } catch (error) {
      logger.error('[AppleTVHero] Error toggling fullscreen:', error);
    }
  }, []);

  // Handle mute toggle
  const handleMuteToggle = useCallback(() => {
    logger.info('[AppleTVHero] Mute toggle pressed, current:', trailerMuted);
    updateSetting('trailerMuted', !trailerMuted);
  }, [trailerMuted, updateSetting]);

  // Auto-advance timer - PAUSE when trailer is playing or out of view
  const startAutoPlay = useCallback(() => {
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
    }

    if (items.length <= 1) return;

    // Don't auto-advance if trailer is playing or out of view
    if ((globalTrailerPlaying && trailerReady) || isOutOfView) {
      if (isOutOfView) {
        logger.info('[AppleTVHero] Auto-rotation paused - out of view');
      } else {
        logger.info('[AppleTVHero] Auto-rotation paused - trailer is playing');
      }
      return;
    }

    autoPlayTimerRef.current = setTimeout(() => {
      const timeSinceInteraction = Date.now() - lastInteractionRef.current;
      // Only auto-advance if user hasn't interacted recently (5 seconds) and no trailer playing
      if (timeSinceInteraction >= 5000 && (!globalTrailerPlaying || !trailerReady) && !isOutOfView) {
        // Set next index preview for crossfade
        const nextIdx = (currentIndex + 1) % items.length;
        setNextIndex(nextIdx);

        // Set drag direction for slide animation (left/next)
        dragDirection.value = -1;

        // Animate crossfade before changing index
        dragProgress.value = withTiming(
          1,
          {
            duration: 500,
            easing: Easing.out(Easing.cubic),
          },
          (finished) => {
            if (finished) {
              runOnJS(setCurrentIndex)(nextIdx);
            }
          }
        );
      } else {
        // Retry after remaining time
        startAutoPlay();
      }
    }, 25000); // Auto-advance every 25 seconds
  }, [items.length, globalTrailerPlaying, trailerReady, currentIndex, dragDirection, dragProgress, isOutOfView]);

  useEffect(() => {
    startAutoPlay();
    return () => {
      if (autoPlayTimerRef.current) {
        clearTimeout(autoPlayTimerRef.current);
      }
    };
  }, [startAutoPlay, currentIndex, globalTrailerPlaying, trailerReady]);

  // Reset drag progress and animate logo when index changes
  useEffect(() => {
    // Instant reset - no extra fade animation
    dragProgress.value = 0;
    setNextIndex(currentIndex);

    // Immediately hide trailer and show thumbnail when index changes
    trailerOpacity.value = 0;
    thumbnailOpacity.value = 1;
    setTrailerPlaying(false);

    // Faster logo fade
    logoOpacity.value = 0;
    logoOpacity.value = withDelay(
      80,
      withTiming(1, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      })
    );
  }, [currentIndex, setTrailerPlaying, trailerOpacity, thumbnailOpacity]);

  // Callback for updating interaction time
  const updateInteractionTime = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  // Callback for navigating to previous item
  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
  }, [items.length]);

  // Callback for navigating to next item
  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % items.length);
  }, [items.length]);

  // Callback for setting next preview index
  const setPreviewIndex = useCallback((index: number) => {
    setNextIndex(index);
  }, []);

  // Callback to hide trailer when drag starts
  const hideTrailerOnDrag = useCallback(() => {
    setTrailerPlaying(false);
  }, [setTrailerPlaying]);

  // Swipe gesture handler with live preview - only horizontal
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-5, 5]) // Smaller activation area - more sensitive
        .failOffsetY([-15, 15]) // Fail if vertical movement is detected
        .onStart(() => {
          // Mark as dragging to disable parallax
          isDragging.value = 1;

          // Determine which direction and set preview
          runOnJS(updateInteractionTime)();
          // Immediately stop trailer playback when drag starts
          runOnJS(hideTrailerOnDrag)();
        })
        .onUpdate((event) => {
          const translationX = event.translationX;
          // Use larger width multiplier for smoother visual feedback on small swipes
          const progress = Math.abs(translationX) / (width * 1.2);

          // Update drag progress (0 to 1) with eased curve
          dragProgress.value = Math.min(progress, 1);

          // Track drag direction: positive = right (previous), negative = left (next)
          if (translationX > 0) {
            dragDirection.value = 1; // Swiping right - show previous
          } else if (translationX < 0) {
            dragDirection.value = -1; // Swiping left - show next
          }

          // Determine preview index based on direction
          if (translationX > 0) {
            // Swiping right - show previous
            const prevIdx = (currentIndex - 1 + items.length) % items.length;
            runOnJS(setPreviewIndex)(prevIdx);
          } else if (translationX < 0) {
            // Swiping left - show next
            const nextIdx = (currentIndex + 1) % items.length;
            runOnJS(setPreviewIndex)(nextIdx);
          }
        })
        .onEnd((event) => {
          const velocity = event.velocityX;
          const translationX = event.translationX;
          const swipeThreshold = width * 0.16; // 16% threshold for swipe detection

          if (Math.abs(translationX) > swipeThreshold || Math.abs(velocity) > 300) {
            // Complete the swipe - animate to full opacity before navigation
            dragProgress.value = withTiming(
              1,
              {
                duration: 300,
                easing: Easing.out(Easing.cubic),
              },
              (finished) => {
                if (finished) {
                  // Re-enable parallax after navigation completes
                  isDragging.value = withTiming(0, { duration: 200 });

                  if (translationX > 0) {
                    runOnJS(goToPrevious)();
                  } else {
                    runOnJS(goToNext)();
                  }
                }
              }
            );
          } else {
            // Cancel the swipe - animate back with smooth ease
            dragProgress.value = withTiming(0, {
              duration: 450,
              easing: Easing.bezier(0.25, 0.1, 0.25, 1), // Custom ease-out for buttery smooth return
            });

            // Re-enable parallax immediately on cancel
            isDragging.value = withTiming(0, { duration: 200 });
          }
        }),
    [goToPrevious, goToNext, updateInteractionTime, setPreviewIndex, hideTrailerOnDrag, currentIndex, items.length]
  );

  // Animated styles for next image only - smooth crossfade + slide during drag
  const nextImageStyle = useAnimatedStyle(() => {
    // Silky-smooth 10-point ease curve for cinematic crossfade
    const opacity = interpolate(
      dragProgress.value,
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1],
      [0, 0.05, 0.12, 0.22, 0.35, 0.5, 0.65, 0.78, 0.92, 1],
      Extrapolation.CLAMP
    );

    // Ultra-subtle slide effect with smooth ease-out curve
    const slideDistance = 6; // Even more subtle 6px movement
    const slideProgress = interpolate(
      dragProgress.value,
      [0, 0.2, 0.4, 0.6, 0.8, 1], // 6-point for ultra-smooth acceleration
      [
        -slideDistance * dragDirection.value,
        -slideDistance * 0.8 * dragDirection.value,
        -slideDistance * 0.6 * dragDirection.value,
        -slideDistance * 0.35 * dragDirection.value,
        -slideDistance * 0.12 * dragDirection.value,
        0
      ],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ translateX: slideProgress }],
    };
  });

  // Animated style for logo/title only - fades during drag with smoother curve
  const logoAnimatedStyle = useAnimatedStyle(() => {
    const dragFade = interpolate(
      dragProgress.value,
      [0, 0.2, 0.4],
      [1, 0.5, 0],
      Extrapolation.CLAMP
    );

    return {
      opacity: dragFade * logoOpacity.value,
    };
  });

  // Animated style for hero container - smooth fade-in on load
  const heroContainerStyle = useAnimatedStyle(() => {
    return {
      opacity: heroOpacity.value,
    };
  });

  const handleDotPress = useCallback((index: number) => {
    lastInteractionRef.current = Date.now();
    setCurrentIndex(index);
  }, []);

  if (loading && !currentItem) {
    return (
      <View style={[styles.container, { height: HERO_HEIGHT, marginTop: -insets.top }]}>
        <View style={styles.skeletonContainer}>
          <LinearGradient
            colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.05)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
      </View>
    );
  }

  if (!currentItem || items.length === 0) {
    return (
      <View style={[styles.container, { height: HERO_HEIGHT, marginTop: -insets.top }]}>
        <View style={styles.noContentContainer}>
          <MaterialIcons name="theaters" size={48} color="rgba(255,255,255,0.5)" />
          <Text style={styles.noContentText}>{t('home.no_featured_available')}</Text>
          {onRetry && (
            <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.7}>
              <Text style={styles.retryButtonText}>{t('home.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  const bannerUrl = currentItem.banner || currentItem.poster;
  const nextItem = items[nextIndex];
  const nextBannerUrl = nextItem ? (nextItem.banner || nextItem.poster) : bannerUrl;

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[styles.container, heroContainerStyle, { height: HERO_HEIGHT, marginTop: -insets.top, backgroundColor: currentTheme.colors.darkBackground }]}
      >
        {/* Background Images with Crossfade */}
        <View style={styles.backgroundContainer}>
          {/* Current Image - Always visible as base */}
          <Animated.View style={[styles.imageWrapper, backgroundParallaxStyle, { opacity: thumbnailOpacity }]}>
            <FastImage
              source={{
                uri: bannerUrl,
                priority: FastImage.priority.high,
                cache: FastImage.cacheControl.immutable,
              }}
              style={styles.backgroundImage}
              resizeMode={FastImage.resizeMode.cover}
              onLoad={() => setBannerLoaded((prev) => ({ ...prev, [currentIndex]: true }))}
            />
          </Animated.View>

          {/* Next/Preview Image - Animated overlay during drag */}
          {nextIndex !== currentIndex && (
            <Animated.View style={[styles.imageWrapperAbsolute, backgroundParallaxStyle]}>
              <Animated.View style={[StyleSheet.absoluteFill, nextImageStyle]}>
                <FastImage
                  source={{
                    uri: nextBannerUrl,
                    priority: FastImage.priority.high,
                    cache: FastImage.cacheControl.immutable,
                  }}
                  style={styles.backgroundImage}
                  resizeMode={FastImage.resizeMode.cover}
                  onLoad={() => setBannerLoaded((prev) => ({ ...prev, [nextIndex]: true }))}
                />
              </Animated.View>
            </Animated.View>
          )}

          {/* Hidden preload trailer player */}
          {settings?.showTrailers && trailerUrl && !trailerLoading && !trailerError && !trailerPreloaded && (
            <View style={[StyleSheet.absoluteFillObject, { opacity: 0, pointerEvents: 'none' }]}>
              <TrailerPlayer
                key={`preload-${trailerUrl}`}
                trailerUrl={trailerUrl}
                autoPlay={false}
                muted={true}
                style={StyleSheet.absoluteFillObject}
                hideLoadingSpinner={true}
                onLoad={handleTrailerPreloaded}
                onError={handleTrailerError}
                contentType={currentItem.type as 'movie' | 'series'}
                paused={true}
              />
            </View>
          )}

          {/* Visible trailer player - 60% height with 5% zoom and smooth fade */}
          {settings?.showTrailers && trailerUrl && !trailerLoading && !trailerError && trailerPreloaded && (
            <Animated.View style={[trailerContainerStyle, trailerParallaxStyle]}>
              <Animated.View style={trailerVideoStyle}>
                <TrailerPlayer
                  key={`visible-${trailerUrl}`}
                  ref={trailerVideoRef}
                  trailerUrl={trailerUrl}
                  autoPlay={globalTrailerPlaying}
                  muted={trailerMuted}
                  style={StyleSheet.absoluteFillObject}
                  hideLoadingSpinner={true}
                  hideControls={true}
                  onFullscreenToggle={handleFullscreenToggle}
                  onLoad={handleTrailerReady}
                  onError={handleTrailerError}
                  onEnd={handleTrailerEnd}
                  contentType={currentItem.type as 'movie' | 'series'}
                  paused={trailerShouldBePaused}
                  onPlaybackStatusUpdate={(status) => {
                    if (status.isLoaded && !trailerReady) {
                      handleTrailerReady();
                    }
                  }}
                />
              </Animated.View>
              {/* Gradient blend at bottom of trailer */}
              <LinearGradient
                colors={['transparent', currentTheme.colors.darkBackground]}
                locations={[0, 1]}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 60,
                }}
                pointerEvents="none"
              />
            </Animated.View>
          )}

          {/* Gradient Overlay - darker at bottom for text readability */}
          <LinearGradient
            colors={[
              'transparent',
              'rgba(0,0,0,0.2)',
              'rgba(0,0,0,0.5)',
              'rgba(0,0,0,0.8)',
              'rgba(0,0,0,0.95)',
            ]}
            locations={[0, 0.3, 0.6, 0.85, 1]}
            style={styles.gradientOverlay}
          />
        </View>

        {/* Trailer control buttons (unmute and fullscreen) */}
        {settings?.showTrailers && trailerReady && trailerUrl && (
          <Animated.View style={{
            position: 'absolute',
            top: (Platform.OS === 'android' ? 60 : 70) + insets.top,
            right: 24,
            zIndex: 1000,
            opacity: trailerOpacity,
            flexDirection: 'row',
            gap: 8,
          }}>
            {/* Fullscreen button */}
            <TouchableOpacity
              onPress={(e) => {
                e?.stopPropagation();
                handleFullscreenToggle();
              }}
              activeOpacity={0.7}
              onPressIn={(e) => e?.stopPropagation()}
              onPressOut={(e) => e?.stopPropagation()}
              style={{
                padding: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderRadius: 20,
              }}
            >
              <MaterialIcons
                name="fullscreen"
                size={24}
                color="white"
              />
            </TouchableOpacity>

            {/* Unmute button */}
            <TouchableOpacity
              onPress={(e) => {
                e?.stopPropagation();
                handleMuteToggle();
              }}
              activeOpacity={0.7}
              onPressIn={(e) => e?.stopPropagation()}
              onPressOut={(e) => e?.stopPropagation()}
              style={{
                padding: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderRadius: 20,
              }}
            >
              <Entypo
                name={trailerMuted ? 'sound-mute' : 'sound'}
                size={24}
                color="white"
              />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Content Overlay */}
        <View style={[styles.contentContainer, { paddingBottom: 0 + insets.bottom }]}>
          {/* Logo or Title with Fade Animation */}
          <Animated.View
            key={`logo-${currentIndex}`}
            style={logoAnimatedStyle}
          >
            {currentItem.logo && !logoError[currentIndex] ? (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  if (currentItem) {
                    navigation.navigate('Metadata', {
                      id: currentItem.id,
                      type: currentItem.type,
                      addonId: currentItem.addonId,
                    });
                  }
                }}
              >
                <View
                  style={[
                    styles.logoContainer,
                    logoHeights[currentIndex] && logoHeights[currentIndex] < 80
                      ? { marginBottom: 4 } // Minimal spacing for small logos
                      : { marginBottom: 8 } // Small spacing for normal logos
                  ]}
                  onLayout={(event) => {
                    const { height } = event.nativeEvent.layout;
                    setLogoHeights((prev) => ({ ...prev, [currentIndex]: height }));
                  }}
                >
                  <Image
                    source={{ uri: currentItem.logo }}
                    style={styles.logo}
                    resizeMode="contain"
                    onLoad={() => setLogoLoaded((prev) => ({ ...prev, [currentIndex]: true }))}
                    onError={() => {
                      setLogoError((prev) => ({ ...prev, [currentIndex]: true }));
                      logger.warn('[AppleTVHero] Logo load failed:', currentItem.logo);
                    }}
                  />
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  if (currentItem) {
                    navigation.navigate('Metadata', {
                      id: currentItem.id,
                      type: currentItem.type,
                      addonId: currentItem.addonId,
                    });
                  }
                }}
              >
                <View style={styles.titleContainer}>
                  <Text style={styles.title} numberOfLines={2}>
                    {currentItem.name}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </Animated.View>

          {/* Metadata Badge - Always Visible */}
          <View style={styles.metadataContainer}>
            <View style={styles.metadataBadge}>
              <MaterialIcons name="tv" size={16} color="#fff" />
              <Text style={styles.metadataText}>
                {currentItem.type === 'series' ? t('home.tv_show') : t('home.movie')}
              </Text>
              {currentItem.genres && currentItem.genres.length > 0 && (
                <>
                  <Text style={styles.metadataDot}>•</Text>
                  <Text style={styles.metadataText}>{currentItem.genres[0]}</Text>
                </>
              )}
            </View>
          </View>

          {/* Action Buttons - Play and Save buttons */}
          <View style={styles.buttonsContainer}>
            {/* Play Button */}
            <TouchableOpacity
              style={[styles.playButton]}
              onPress={handlePlayAction}
              activeOpacity={0.85}
            >
              <MaterialIcons
                name={shouldResume ? "replay" : "play-arrow"}
                size={24}
                color="#000"
              />
              <Text style={styles.playButtonText}>{shouldResume ? t('home.resume') : t('home.play')}</Text>
            </TouchableOpacity>

            {/* Save Button */}
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSaveAction}
              activeOpacity={0.85}
            >
              <MaterialIcons
                name={inLibrary ? "bookmark" : "bookmark-outline"}
                size={24}
                color="white"
              />
            </TouchableOpacity>
          </View>

          {/* Pagination Dots */}
          {items.length > 1 && (
            <View style={styles.paginationContainer}>
              {items.map((_, index) => (
                <PaginationDot
                  key={index}
                  isActive={index === currentIndex}
                  isNext={index === nextIndex && nextIndex !== currentIndex}
                  dragProgress={dragProgress}
                  onPress={() => handleDotPress(index)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Bottom blend to home screen background */}
        <LinearGradient
          colors={['transparent', currentTheme.colors.darkBackground]}
          locations={[0, 1]}
          style={styles.bottomBlend}
          pointerEvents="none"
        />
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    marginBottom: 0, // Remove margin to go full height
    overflow: 'hidden', // Ensure trailer stays within bounds
  },
  backgroundContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  imageWrapper: {
    position: 'absolute',
    top: 0,
    left: -50, // Extend 50px to left
    right: -50, // Extend 50px to right
    bottom: 0,
  },
  imageWrapperAbsolute: {
    position: 'absolute',
    top: 0,
    left: -50, // Extend 50px to left
    right: -50, // Extend 50px to right
    bottom: 0,
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 20, // Above background and trailer
    // paddingBottom will be set dynamically with insets
  },
  logoContainer: {
    width: width * 0.6,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  titleContainer: {
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  metadataContainer: {
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metadataBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  metadataText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  metadataDot: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
  },
  buttonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingVertical: 11,
    paddingHorizontal: 32,
    borderRadius: 40,
    gap: 8,
    minWidth: 130,
  },
  playButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
  },
  saveButton: {
    width: 52,
    height: 52,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  paginationDot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  bottomBlend: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 400, // Increased to cover action buttons with dark background
    pointerEvents: 'none',
  },
  // Loading & Empty States
  skeletonContainer: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  noContentContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  noContentText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default React.memo(AppleTVHero);
