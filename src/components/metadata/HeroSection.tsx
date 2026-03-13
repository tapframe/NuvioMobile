import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Platform,
  InteractionManager,
  AppState,
  Image,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';

import { MaterialIcons, Entypo, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
// Replaced FastImage with standard Image for logos
import { BlurView as ExpoBlurView } from 'expo-blur';
import { BlurView as CommunityBlurView } from '@react-native-community/blur';

// Optional iOS Glass effect (expo-glass-effect) with safe fallback for HeroSection
let GlassViewComp: any = null;
let liquidGlassAvailable = false;
if (Platform.OS === 'ios') {
  try {
    // Dynamically require so app still runs if the package isn't installed yet
    const glass = require('expo-glass-effect');
    GlassViewComp = glass.GlassView;
    liquidGlassAvailable = typeof glass.isLiquidGlassAvailable === 'function' ? glass.isLiquidGlassAvailable() : false;
  } catch {
    GlassViewComp = null;
    liquidGlassAvailable = false;
  }
}
import Constants, { ExecutionEnvironment } from 'expo-constants';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolate,
  useSharedValue,
  withTiming,
  runOnJS,
  withRepeat,
  FadeIn,
  runOnUI,
  useDerivedValue,
  SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { useTraktContext } from '../../contexts/TraktContext';
import { useSettings } from '../../hooks/useSettings';
import { useTrailer } from '../../contexts/TrailerContext';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { TMDBService } from '../../services/tmdbService';
import TrailerService, { TrailerPlaybackSource } from '../../services/trailerService';
import TrailerPlayer from '../video/TrailerPlayer';
import { HERO_HEIGHT, SCREEN_WIDTH as width, IS_TABLET as isTablet } from '../../constants/dimensions';

const { height } = Dimensions.get('window');

// Ultra-optimized animation constants
const SCALE_FACTOR = 1.02;
const FADE_THRESHOLD = 200;

// Types - streamlined
interface HeroSectionProps {
  metadata: any;
  bannerImage: string | null;
  loadingBanner: boolean;
  scrollY: SharedValue<number>;
  heroHeight: SharedValue<number>;
  heroOpacity: SharedValue<number>;
  logoOpacity: SharedValue<number>;
  buttonsOpacity: SharedValue<number>;
  buttonsTranslateY: SharedValue<number>;
  watchProgressOpacity: SharedValue<number>;
  watchProgressWidth: SharedValue<number>;
  watchProgress: {
    currentTime: number;
    duration: number;
    lastUpdated: number;
    episodeId?: string;
    traktSynced?: boolean;
    traktProgress?: number;
  } | null;
  onStableLogoUriChange?: (logoUri: string | null) => void;
  type: 'movie' | 'series';
  getEpisodeDetails: (episodeId: string) => { seasonNumber: string; episodeNumber: string; episodeName: string } | null;
  handleShowStreams: () => void;
  handleToggleLibrary: () => void;
  inLibrary: boolean;
  id: string;
  navigation: any;
  getPlayButtonText: () => string;
  setBannerImage: (bannerImage: string | null) => void;
  groupedEpisodes?: { [seasonNumber: number]: any[] };
  // Trakt integration props
  isAuthenticated?: boolean;
  isInWatchlist?: boolean;
  isInCollection?: boolean;
  onToggleWatchlist?: () => void;
  onToggleCollection?: () => void;
  dynamicBackgroundColor?: string;
  handleBack: () => void;
  tmdbId?: number | null;
}

// Ultra-optimized ActionButtons Component - minimal re-renders
const ActionButtons = memo(({
  handleShowStreams,
  toggleLibrary,
  inLibrary,
  type,
  id,
  navigation,
  playButtonText,
  animatedStyle,
  isWatched,
  watchProgress,
  groupedEpisodes,
  metadata,
  settings,
  // Trakt integration props
  isAuthenticated,
  isInWatchlist,
  isInCollection,
  onToggleWatchlist,
  onToggleCollection
}: {
  handleShowStreams: () => void;
  toggleLibrary: () => void;
  inLibrary: boolean;
  type: 'movie' | 'series';
  id: string;
  navigation: any;
  playButtonText: string;
  animatedStyle: any;
  isWatched: boolean;
  watchProgress: any;
  groupedEpisodes?: { [seasonNumber: number]: any[] };
  metadata: any;
  settings: any;
  // Trakt integration props
  isAuthenticated?: boolean;
  isInWatchlist?: boolean;
  isInCollection?: boolean;
  onToggleWatchlist?: () => void;
  onToggleCollection?: () => void;
}) => {
  const { currentTheme } = useTheme();
  const { t } = useTranslation();
  const { showSaved, showTraktSaved, showRemoved, showTraktRemoved, showSuccess, showInfo } = useToast();

  // Performance optimization: Cache theme colors
  const themeColors = useMemo(() => ({
    white: currentTheme.colors.white,
    black: '#000',
    primary: currentTheme.colors.primary
  }), [currentTheme.colors.white, currentTheme.colors.primary]);

  // Optimized navigation handler with useCallback
  const handleRatingsPress = useCallback(async () => {
    // Early return if no ID
    if (!id) return;

    let finalTmdbId: number | null = null;

    if (id.startsWith('tmdb:')) {
      const numericPart = id.split(':')[1];
      const parsedId = parseInt(numericPart, 10);
      if (!isNaN(parsedId)) {
        finalTmdbId = parsedId;
      }
    } else if (id.startsWith('tt') && settings.enrichMetadataWithTMDB) {
      try {
        const tmdbService = TMDBService.getInstance();
        const convertedId = await tmdbService.findTMDBIdByIMDB(id);
        if (convertedId) {
          finalTmdbId = convertedId;
        }
      } catch (error) {
        logger.error(`[HeroSection] Error converting IMDb ID ${id}:`, error);
      }
    } else {
      const parsedId = parseInt(id, 10);
      if (!isNaN(parsedId)) {
        finalTmdbId = parsedId;
      }
    }

    if (finalTmdbId !== null) {
      // Use requestAnimationFrame for smoother navigation
      requestAnimationFrame(() => {
        navigation.navigate('ShowRatings', { showId: finalTmdbId });
      });
    }
  }, [id, navigation, settings.enrichMetadataWithTMDB]);

  // Enhanced save handler that combines local library + Trakt watchlist
  const handleSaveAction = useCallback(async () => {
    const wasInLibrary = inLibrary;

    // Always toggle local library first
    toggleLibrary();

    // If authenticated, also toggle Trakt watchlist
    if (isAuthenticated && onToggleWatchlist) {
      await onToggleWatchlist();
    }

    // Show appropriate toast
    if (isAuthenticated) {
      if (wasInLibrary) {
        showTraktRemoved();
      } else {
        showTraktSaved();
      }
    } else {
      if (wasInLibrary) {
        showRemoved();
      } else {
        showSaved();
      }
    }
  }, [toggleLibrary, isAuthenticated, onToggleWatchlist, inLibrary, showSaved, showTraktSaved, showRemoved, showTraktRemoved]);

  // Enhanced collection handler with toast notifications
  const handleCollectionAction = useCallback(async () => {
    const wasInCollection = isInCollection;

    // Toggle collection
    if (onToggleCollection) {
      await onToggleCollection();
    }

    // Show appropriate toast
    if (wasInCollection) {
      showInfo(t('metadata.removed_from_collection_hero'), t('metadata.removed_from_collection_desc_hero'));
    } else {
      showSuccess(t('metadata.added_to_collection_hero'), t('metadata.added_to_collection_desc_hero'));
    }
  }, [onToggleCollection, isInCollection, showSuccess, showInfo]);

  // Optimized play button style calculation
  const playButtonStyle = useMemo(() => {
    if (isWatched && type === 'movie') {
      // Only movies get the dark watched style for "Watch Again"
      return [styles.actionButton, styles.playButton, styles.watchedPlayButton];
    }
    // All other buttons (Resume, Play SxxEyy, regular Play) get white background
    return [styles.actionButton, styles.playButton];
  }, [isWatched, type]);

  const playButtonTextStyle = useMemo(() => {
    if (isWatched && type === 'movie') {
      // Only movies get white text for "Watch Again"
      return [styles.playButtonText, styles.watchedPlayButtonText];
    }
    // All other buttons get black text
    return styles.playButtonText;
  }, [isWatched, type]);

  const finalPlayButtonText = useMemo(() => {
    // For movies, handle watched state
    if (type === 'movie') {
      return isWatched ? t('metadata.watch_again') : playButtonText;
    }

    // For series, validate next episode existence for both watched and resume cases
    if (type === 'series' && watchProgress?.episodeId && groupedEpisodes) {
      let seasonNum: number | null = null;
      let episodeNum: number | null = null;

      const parts = watchProgress.episodeId.split(':');

      if (parts.length === 3) {
        // Format: showId:season:episode
        seasonNum = parseInt(parts[1], 10);
        episodeNum = parseInt(parts[2], 10);
      } else if (parts.length === 2) {
        // Format: season:episode (no show id)
        seasonNum = parseInt(parts[0], 10);
        episodeNum = parseInt(parts[1], 10);
      } else {
        // Try pattern s1e2
        const match = watchProgress.episodeId.match(/s(\d+)e(\d+)/i);
        if (match) {
          seasonNum = parseInt(match[1], 10);
          episodeNum = parseInt(match[2], 10);
        }
      }

      if (seasonNum !== null && episodeNum !== null && !isNaN(seasonNum) && !isNaN(episodeNum)) {
        if (isWatched) {
          // For watched episodes, check if next episode exists
          const nextEpisode = episodeNum + 1;
          const currentSeasonEpisodes = groupedEpisodes[seasonNum] || [];
          const nextEpisodeExists = currentSeasonEpisodes.some(ep =>
            ep.episode_number === nextEpisode
          );

          if (nextEpisodeExists) {
            // Show the NEXT episode number only if it exists
            const seasonStr = seasonNum.toString().padStart(2, '0');
            const episodeStr = nextEpisode.toString().padStart(2, '0');
            return `Play S${seasonStr}E${episodeStr}`;
          } else {
            // If next episode doesn't exist, show generic text
            return t('metadata.completed');
          }
        } else {
          // For non-watched episodes, check if current episode exists
          const currentSeasonEpisodes = groupedEpisodes[seasonNum] || [];
          const currentEpisodeExists = currentSeasonEpisodes.some(ep =>
            ep.episode_number === episodeNum
          );

          if (currentEpisodeExists) {
            // Current episode exists, use original button text
            return playButtonText;
          } else {
            // Current episode doesn't exist, fallback to generic play
            return t('metadata.play');
          }
        }
      }

      // Fallback label if parsing fails
      return isWatched ? t('metadata.play_next_episode') : playButtonText;
    }

    // Default fallback for non-series or missing data
    return isWatched ? t('metadata.play') : playButtonText;
  }, [isWatched, playButtonText, type, watchProgress, groupedEpisodes]);

  // Count additional buttons (AI Chat removed - now in top right corner)
  const hasTraktCollection = isAuthenticated;
  const hasRatings = type === 'series';

  // Count additional buttons (AI Chat removed - now in top right corner)
  const additionalButtonCount = (hasTraktCollection ? 1 : 0) + (hasRatings ? 1 : 0);

  return (
    <Animated.View style={[isTablet ? styles.tabletActionButtons : styles.actionButtons, animatedStyle]}>
      {/* Single Row Layout - Play, Save, and optionally Collection/Ratings */}
      <View style={styles.singleRowLayout}>
        <TouchableOpacity
          style={[
            playButtonStyle,
            isTablet && styles.tabletPlayButton,
            additionalButtonCount === 0 ? styles.singleRowPlayButtonFullWidth : styles.primaryActionButton
          ]}
          onPress={handleShowStreams}
          activeOpacity={0.85}
        >
          <MaterialIcons
            name={(() => {
              if (isWatched) {
                return type === 'movie' ? 'replay' : 'play-arrow';
              }
              return playButtonText === 'Resume' ? 'play-circle-outline' : 'play-arrow';
            })()}
            size={isTablet ? 28 : 24}
            color={isWatched && type === 'movie' ? "#fff" : "#000"}
          />
          <Text style={[playButtonTextStyle, isTablet && styles.tabletPlayButtonText]}>{finalPlayButtonText}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.infoButton,
            isTablet && styles.tabletInfoButton,
            additionalButtonCount === 0 ? styles.singleRowSaveButtonFullWidth : styles.primaryActionButton
          ]}
          onPress={handleSaveAction}
          activeOpacity={0.85}
        >
          {Platform.OS === 'ios' ? (
            GlassViewComp && liquidGlassAvailable ? (
              <GlassViewComp
                style={styles.blurBackground}
                glassEffectStyle="regular"
              />
            ) : (
              <ExpoBlurView intensity={80} style={styles.blurBackground} tint="dark" />
            )
          ) : (
            <View style={styles.androidFallbackBlur} />
          )}
          <MaterialIcons
            name={inLibrary ? "bookmark" : "bookmark-outline"}
            size={isTablet ? 28 : 24}
            color={inLibrary ? (isAuthenticated && isInWatchlist ? "#E74C3C" : currentTheme.colors.white) : currentTheme.colors.white}
          />
          <Text style={[styles.infoButtonText, isTablet && styles.tabletInfoButtonText]}>
            {inLibrary ? t('metadata.saved') : t('metadata.save')}
          </Text>
        </TouchableOpacity>

        {/* Trakt Collection Button */}
        {hasTraktCollection && (
          <TouchableOpacity
            style={[styles.iconButton, isTablet && styles.tabletIconButton, styles.singleRowIconButton]}
            onPress={handleCollectionAction}
            activeOpacity={0.85}
          >
            {Platform.OS === 'ios' ? (
              GlassViewComp && liquidGlassAvailable ? (
                <GlassViewComp
                  style={styles.blurBackgroundRound}
                  glassEffectStyle="regular"
                />
              ) : (
                <ExpoBlurView intensity={80} style={styles.blurBackgroundRound} tint="dark" />
              )
            ) : (
              <View style={styles.androidFallbackBlurRound} />
            )}
            <MaterialIcons
              name={isInCollection ? "video-library" : "video-library"}
              size={isTablet ? 28 : 24}
              color={isInCollection ? "#3498DB" : currentTheme.colors.white}
            />
          </TouchableOpacity>
        )}

        {/* Ratings Button (for series) */}
        {hasRatings && (
          <TouchableOpacity
            style={[styles.iconButton, isTablet && styles.tabletIconButton, styles.singleRowIconButton]}
            onPress={handleRatingsPress}
            activeOpacity={0.85}
          >
            {Platform.OS === 'ios' ? (
              GlassViewComp && liquidGlassAvailable ? (
                <GlassViewComp
                  style={styles.blurBackgroundRound}
                  glassEffectStyle="regular"
                />
              ) : (
                <ExpoBlurView intensity={80} style={styles.blurBackgroundRound} tint="dark" />
              )
            ) : (
              <View style={styles.androidFallbackBlurRound} />
            )}
            <MaterialIcons
              name="assessment"
              size={isTablet ? 28 : 24}
              color={currentTheme.colors.white}
            />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
});

// Enhanced WatchProgress Component with Trakt integration and watched status
const WatchProgressDisplay = memo(({
  watchProgress,
  type,
  getEpisodeDetails,
  animatedStyle,
  isWatched,
  isTrailerPlaying,
  trailerMuted,
  trailerReady
}: {
  watchProgress: {
    currentTime: number;
    duration: number;
    lastUpdated: number;
    episodeId?: string;
    traktSynced?: boolean;
    traktProgress?: number;
  } | null;
  type: 'movie' | 'series';
  getEpisodeDetails: (episodeId: string) => { seasonNumber: string; episodeNumber: string; episodeName: string } | null;
  animatedStyle: any;
  isWatched: boolean;
  isTrailerPlaying: boolean;
  trailerMuted: boolean;
  trailerReady: boolean;
}) => {
  const { currentTheme } = useTheme();
  const { t } = useTranslation();
  const { isAuthenticated: isTraktAuthenticated, forceSyncTraktProgress } = useTraktContext();

  // State to trigger refresh after manual sync
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Animated values for enhanced effects
  const completionGlow = useSharedValue(0);
  const celebrationScale = useSharedValue(1);
  const progressPulse = useSharedValue(1);
  const progressBoxOpacity = useSharedValue(0);
  const progressBoxScale = useSharedValue(0.8);
  const progressBoxTranslateY = useSharedValue(20);
  const syncRotation = useSharedValue(0);

  // Animate the sync icon when syncing
  useEffect(() => {
    if (isSyncing) {
      syncRotation.value = withRepeat(
        withTiming(360, { duration: 1000 }),
        -1, // Infinite repeats
        false // No reverse
      );
    } else {
      syncRotation.value = 0;
    }
  }, [isSyncing, syncRotation]);

  // Handle manual Trakt sync
  const handleTraktSync = useMemo(() => async () => {
    if (isTraktAuthenticated && forceSyncTraktProgress) {
      logger.log('[HeroSection] Manual Trakt sync requested');
      setIsSyncing(true);
      try {
        const success = await forceSyncTraktProgress();
        logger.log(`[HeroSection] Manual Trakt sync ${success ? 'successful' : 'failed'}`);

        // Force component to re-render after a short delay to update sync status
        if (success) {
          setTimeout(() => {
            setRefreshTrigger(prev => prev + 1);
            setIsSyncing(false);
          }, 500);
        } else {
          setIsSyncing(false);
        }
      } catch (error) {
        logger.error('[HeroSection] Manual Trakt sync error:', error);
        setIsSyncing(false);
      }
    }
  }, [isTraktAuthenticated, forceSyncTraktProgress, setRefreshTrigger]);

  // Sync rotation animation style
  const syncIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${syncRotation.value}deg` }],
  }));

  // Memoized progress calculation with Trakt integration
  const progressData = useMemo(() => {
    // If content is fully watched, show watched status instead of progress
    if (isWatched) {
      let episodeInfo = '';
      if (type === 'series' && watchProgress?.episodeId) {
        const details = getEpisodeDetails(watchProgress.episodeId);
        if (details) {
          episodeInfo = ` • S${details.seasonNumber}:E${details.episodeNumber}${details.episodeName ? ` - ${details.episodeName}` : ''}`;
        }
      }

      const watchedDate = watchProgress?.lastUpdated
        ? new Date(watchProgress.lastUpdated).toLocaleDateString('en-US')
        : new Date().toLocaleDateString('en-US');

      // Determine if watched via Trakt or local
      const watchedViaTrakt = isTraktAuthenticated &&
        watchProgress?.traktProgress !== undefined &&
        watchProgress.traktProgress >= 95;

      return {
        progressPercent: 100,
        formattedTime: watchedDate,
        episodeInfo,
        displayText: watchedViaTrakt ? t('metadata.watched_on_trakt') : t('metadata.watched'),
        syncStatus: isTraktAuthenticated && watchProgress?.traktSynced ? '' : '', // Clean look for watched
        isTraktSynced: watchProgress?.traktSynced && isTraktAuthenticated,
        isWatched: true
      };
    }

    if (!watchProgress || watchProgress.duration === 0) return null;

    // Determine which progress to show - prioritize Trakt if available and authenticated
    let progressPercent;
    let isUsingTraktProgress = false;

    if (isTraktAuthenticated && watchProgress.traktProgress !== undefined) {
      progressPercent = watchProgress.traktProgress;
      isUsingTraktProgress = true;
    } else {
      progressPercent = (watchProgress.currentTime / watchProgress.duration) * 100;
    }
    const formattedTime = new Date(watchProgress.lastUpdated).toLocaleDateString('en-US');
    let episodeInfo = '';

    if (type === 'series' && watchProgress.episodeId) {
      const details = getEpisodeDetails(watchProgress.episodeId);
      if (details) {
        episodeInfo = ` • S${details.seasonNumber}:E${details.episodeNumber}${details.episodeName ? ` - ${details.episodeName}` : ''}`;
      }
    }

    // Enhanced display text with Trakt integration
    let displayText = progressPercent >= 85 ? t('metadata.watched') : t('metadata.percent_watched', { percent: Math.round(progressPercent) });
    let syncStatus = '';

    // Show Trakt sync status if user is authenticated
    if (isTraktAuthenticated) {
      if (isUsingTraktProgress) {
        syncStatus = ' • ' + t('metadata.using_trakt_progress');
        if (watchProgress.traktSynced) {
          syncStatus = ' • ' + t('metadata.synced_with_trakt_progress');
        }
      } else if (watchProgress.traktSynced) {
        syncStatus = ' • ' + t('metadata.synced_with_trakt_progress');
        // If we have specific Trakt progress that differs from local, mention it
        if (watchProgress.traktProgress !== undefined &&
          Math.abs(progressPercent - watchProgress.traktProgress) > 5) {
          displayText = t('metadata.percent_watched_trakt', { percent: Math.round(progressPercent), traktPercent: Math.round(watchProgress.traktProgress) });
        }
      } else {
        // Do not show "Sync pending" label anymore; leave status empty.
        syncStatus = '';
      }
    }

    return {
      progressPercent,
      formattedTime,
      episodeInfo,
      displayText,
      syncStatus,
      isTraktSynced: watchProgress.traktSynced && isTraktAuthenticated,
      isWatched: false
    };
  }, [watchProgress, type, getEpisodeDetails, isTraktAuthenticated, isWatched, refreshTrigger]);

  // Trigger appearance and completion animations
  useEffect(() => {
    if (progressData) {
      // Smooth entrance animation for the glassmorphic box
      progressBoxOpacity.value = withTiming(1, { duration: 400 });
      progressBoxScale.value = withTiming(1, { duration: 400 });
      progressBoxTranslateY.value = withTiming(0, { duration: 400 });

      if (progressData.isWatched || (progressData.progressPercent && progressData.progressPercent >= 85)) {
        // Celebration animation sequence
        celebrationScale.value = withRepeat(
          withTiming(1.05, { duration: 200 }),
          2,
          true
        );

        // Glow effect
        completionGlow.value = withRepeat(
          withTiming(1, { duration: 1500 }),
          -1,
          true
        );
      } else {
        // Subtle progress pulse for ongoing content
        progressPulse.value = withRepeat(
          withTiming(1.02, { duration: 2000 }),
          -1,
          true
        );
      }
    } else {
      // Hide animation when no progress data
      progressBoxOpacity.value = withTiming(0, { duration: 300 });
      progressBoxScale.value = withTiming(0.8, { duration: 300 });
      progressBoxTranslateY.value = withTiming(20, { duration: 300 });
    }
  }, [progressData]);

  // Animated styles for enhanced effects
  const celebrationAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: celebrationScale.value }],
  }));

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(completionGlow.value, [0, 1], [0.3, 0.8], Extrapolate.CLAMP),
  }));

  const progressPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: progressPulse.value }],
  }));

  const progressBoxAnimatedStyle = useAnimatedStyle(() => ({
    opacity: progressBoxOpacity.value,
    transform: [
      { scale: progressBoxScale.value },
      { translateY: progressBoxTranslateY.value }
    ],
  }));

  // Determine visibility; if not visible, don't render to avoid fixed blank space
  const isVisible = !!progressData && !(isTrailerPlaying && !trailerMuted && trailerReady);
  if (!isVisible) return null;

  const isCompleted = progressData.isWatched || progressData.progressPercent >= 85;

  return (
    <Animated.View style={[isTablet ? styles.tabletWatchProgressContainer : styles.watchProgressContainer, animatedStyle]}>
      {/* Glass morphism background with entrance animation */}
      <Animated.View style={[isTablet ? styles.tabletProgressGlassBackground : styles.progressGlassBackground, progressBoxAnimatedStyle]}>
        {Platform.OS === 'ios' ? (
          GlassViewComp && liquidGlassAvailable ? (
            <GlassViewComp
              style={styles.blurBackground}
              glassEffectStyle="regular"
            />
          ) : (
            <ExpoBlurView intensity={20} style={styles.blurBackground} tint="dark" />
          )
        ) : (
          <View style={styles.androidProgressBlur} />
        )}

        {/* Enhanced progress bar with glow effects */}
        <Animated.View style={[styles.watchProgressBarContainer, celebrationAnimatedStyle]}>
          <View style={styles.watchProgressBar}>
            {/* Background glow for completed content */}
            {isCompleted && (
              <Animated.View style={[styles.completionGlow, glowAnimatedStyle]} />
            )}

            <Animated.View
              style={[
                styles.watchProgressFill,
                !isCompleted && progressPulseStyle,
                {
                  width: `${progressData.progressPercent}%`,
                  backgroundColor: isCompleted
                    ? '#00ff88' // Bright green for completed
                    : progressData.isTraktSynced
                      ? '#E50914' // Netflix red for Trakt synced content
                      : currentTheme.colors.primary,
                  // Add gradient effect for completed content
                  ...(isCompleted && {
                    background: 'linear-gradient(90deg, #00ff88, #00cc6a)',
                  })
                }
              ]}
            />

            {/* Shimmer effect for active progress */}
            {!isCompleted && progressData.progressPercent > 0 && (
              <View style={styles.progressShimmer} />
            )}
          </View>
        </Animated.View>

        {/* Enhanced text container with better typography */}
        <View style={styles.watchProgressTextContainer}>
          <View style={styles.progressInfoMain}>
            <Text style={[isTablet ? styles.tabletWatchProgressMainText : styles.watchProgressMainText, {
              color: isCompleted ? '#00ff88' : currentTheme.colors.white,
              fontSize: isCompleted ? (isTablet ? 15 : 13) : (isTablet ? 14 : 12),
              fontWeight: isCompleted ? '700' : '600'
            }]}>
              {progressData.displayText}
            </Text>

          </View>

          {/* Only show episode info for series */}
          {progressData.episodeInfo && (
            <Text style={[isTablet ? styles.tabletWatchProgressSubText : styles.watchProgressSubText, {
              color: isCompleted ? 'rgba(0,255,136,0.7)' : currentTheme.colors.textMuted,
            }]}>
              {progressData.episodeInfo}
            </Text>
          )}

          {/* Trakt sync status with enhanced styling */}
          {progressData.syncStatus && (
            <View style={styles.syncStatusContainer}>
              <MaterialIcons
                name={progressData.isTraktSynced ? "sync" : "sync-problem"}
                size={12}
                color={progressData.isTraktSynced ? "#E50914" : "rgba(255,255,255,0.6)"}
              />
              <Text style={[styles.syncStatusText, {
                color: progressData.isTraktSynced ? "#E50914" : "rgba(255,255,255,0.6)"
              }]}>
                {progressData.syncStatus}
              </Text>

              {/* Enhanced manual Trakt sync button - moved inline */}
              {isTraktAuthenticated && forceSyncTraktProgress && (
                <TouchableOpacity
                  style={styles.traktSyncButtonInline}
                  onPress={handleTraktSync}
                  activeOpacity={0.7}
                  disabled={isSyncing}
                >
                  <LinearGradient
                    colors={['#E50914', '#B8070F']}
                    style={styles.syncButtonGradientInline}
                  >
                    <Animated.View style={syncIconStyle}>
                      <MaterialIcons
                        name={isSyncing ? "sync" : "refresh"}
                        size={12}
                        color="#fff"
                      />
                    </Animated.View>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
});

/**
 * HeroSection Component - Performance Optimized
 * 
 * Optimizations Applied:
 * - Component memoization with React.memo
 * - Lazy loading system using InteractionManager
 * - Optimized image loading with useCallback handlers
 * - Cached theme colors to reduce re-renders
 * - Conditional rendering based on shouldLoadSecondaryData
 * - Memory management with cleanup on unmount
 * - Development-mode performance monitoring
 * - Optimized animated styles and memoized calculations
 * - Reduced re-renders through strategic memoization
 * - runOnUI for animation performance
 */
const HeroSection: React.FC<HeroSectionProps> = memo(({
  metadata,
  bannerImage,
  loadingBanner,
  scrollY,
  heroHeight,
  heroOpacity,
  logoOpacity,
  buttonsOpacity,
  buttonsTranslateY,
  watchProgressOpacity,
  watchProgress,
  onStableLogoUriChange,
  type,
  getEpisodeDetails,
  handleShowStreams,
  handleToggleLibrary,
  inLibrary,
  id,
  navigation,
  getPlayButtonText,
  setBannerImage,
  groupedEpisodes,
  dynamicBackgroundColor,
  handleBack,
  tmdbId,
  // Trakt integration props
  isAuthenticated,
  isInWatchlist,
  isInCollection,
  onToggleWatchlist,
  onToggleCollection
}) => {
  const { currentTheme } = useTheme();
  const { isAuthenticated: isTraktAuthenticated } = useTraktContext();
  const { settings, updateSetting } = useSettings();
  const { isTrailerPlaying: globalTrailerPlaying, setTrailerPlaying } = useTrailer();
  const isFocused = useIsFocused();

  // Performance optimization: Refs for avoiding re-renders
  const interactionComplete = useRef(false);
  const [shouldLoadSecondaryData, setShouldLoadSecondaryData] = useState(false);
  const appState = useRef(AppState.currentState);

  // Image loading state with optimized management
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [trailerSource, setTrailerSource] = useState<TrailerPlaybackSource | null>(null);
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerError, setTrailerError] = useState(false);
  // Use persistent setting instead of local state
  const trailerMuted = settings.trailerMuted;
  const [trailerReady, setTrailerReady] = useState(false);
  const [trailerPreloaded, setTrailerPreloaded] = useState(false);
  const trailerVideoRef = useRef<any>(null);
  const imageOpacity = useSharedValue(1);
  const imageLoadOpacity = useSharedValue(0);
  // Shimmer overlay removed
  const trailerOpacity = useSharedValue(0);
  const thumbnailOpacity = useSharedValue(1);
  // Scroll-based pause/resume control
  const pausedByScrollSV = useSharedValue(0);
  const scrollGuardEnabledSV = useSharedValue(0);
  const isPlayingSV = useSharedValue(0);
  const isFocusedSV = useSharedValue(0);
  // Guards to avoid repeated auto-starts
  const startedOnFocusRef = useRef(false);
  const startedOnReadyRef = useRef(false);

  // Animation values for trailer unmute effects
  const actionButtonsOpacity = useSharedValue(1);
  const titleCardTranslateY = useSharedValue(0);
  const genreOpacity = useSharedValue(1);

  // Ultra-optimized theme colors with stable references
  const themeColors = useMemo(() => ({
    black: currentTheme.colors.black,
    darkBackground: currentTheme.colors.darkBackground,
    highEmphasis: currentTheme.colors.highEmphasis,
    text: currentTheme.colors.text
  }), [currentTheme.colors.black, currentTheme.colors.darkBackground, currentTheme.colors.highEmphasis, currentTheme.colors.text]);

  // Pre-calculated style objects for better performance
  const staticStyles = useMemo(() => ({
    heroWrapper: styles.heroWrapper,
    heroSection: styles.heroSection,
    absoluteFill: styles.absoluteFill,
    thumbnailContainer: styles.thumbnailContainer,
    thumbnailImage: styles.thumbnailImage,
  }), []);

  // Handle trailer preload completion
  const handleTrailerPreloaded = useCallback(() => {
    setTrailerPreloaded(true);
    // logger.info('HeroSection', 'Trailer preloaded successfully');
  }, []);

  // Handle smooth transition when trailer is ready to play
  const handleTrailerReady = useCallback(() => {
    if (!isFocused) return;
    if (!trailerPreloaded) {
      setTrailerPreloaded(true);
    }
    setTrailerReady(true);

    // Smooth transition: fade out thumbnail, fade in trailer
    thumbnailOpacity.value = withTiming(0, { duration: 500 });
    trailerOpacity.value = withTiming(1, { duration: 500 });
    // Enable scroll guard after a brief delay to avoid immediate pause on entry
    scrollGuardEnabledSV.value = 0;
    setTimeout(() => { scrollGuardEnabledSV.value = 1; }, 1000);
  }, [thumbnailOpacity, trailerOpacity, trailerPreloaded, isFocused]);

  // Auto-start trailer when ready on initial entry if enabled
  useEffect(() => {
    if (trailerReady && settings?.showTrailers && isFocused && !globalTrailerPlaying && !startedOnReadyRef.current) {
      // Check scroll position - only auto-start if user hasn't scrolled past the hero section
      try {
        const y = (scrollY as any).value || 0;
        const pauseThreshold = heroHeight.value * 0.7;

        if (y < pauseThreshold) {
          startedOnReadyRef.current = true;
          logger.info('HeroSection', 'Trailer ready - auto-starting playback');
          setTrailerPlaying(true);
          isPlayingSV.value = 1;
        } else {
          logger.info('HeroSection', 'Trailer ready but user scrolled past - not auto-starting');
          // Mark as started to prevent retry
          startedOnReadyRef.current = true;
        }
      } catch (_e) {
        // Fallback if scroll position unavailable - don't auto-start to be safe
        logger.info('HeroSection', 'Trailer ready but scroll position unavailable - not auto-starting');
        startedOnReadyRef.current = true;
      }
    }
  }, [trailerReady, settings?.showTrailers, isFocused, globalTrailerPlaying, setTrailerPlaying, scrollY, heroHeight]);

  // Handle fullscreen toggle
  const handleFullscreenToggle = useCallback(async () => {
    try {
      logger.info('HeroSection', 'Fullscreen button pressed');
      if (trailerVideoRef.current) {
        // Use the native fullscreen player
        await trailerVideoRef.current.presentFullscreenPlayer();
      } else {
        logger.warn('HeroSection', 'Trailer video ref not available');
      }
    } catch (error) {
      logger.error('HeroSection', 'Error toggling fullscreen:', error);
    }
  }, []);

  // Handle trailer error - fade back to thumbnail
  const handleTrailerError = useCallback(() => {
    setTrailerError(true);
    setTrailerReady(false);
    setTrailerPlaying(false);

    // Fade back to thumbnail
    trailerOpacity.value = withTiming(0, { duration: 300 });
    thumbnailOpacity.value = withTiming(1, { duration: 300 });
  }, [trailerOpacity, thumbnailOpacity]);

  // Handle trailer end - seamless transition back to thumbnail
  const handleTrailerEnd = useCallback(async () => {
    logger.info('HeroSection', 'Trailer ended - transitioning back to thumbnail');
    setTrailerPlaying(false);

    // Reset trailer state to prevent auto-restart
    setTrailerReady(false);
    setTrailerPreloaded(false);

    // If trailer is in fullscreen, dismiss it first
    try {
      if (trailerVideoRef.current) {
        await trailerVideoRef.current.dismissFullscreenPlayer();
        logger.info('HeroSection', 'Dismissed fullscreen player after trailer ended');
      }
    } catch (error) {
      logger.warn('HeroSection', 'Error dismissing fullscreen player:', error);
    }

    // Smooth fade transition: trailer out, thumbnail in
    trailerOpacity.value = withTiming(0, { duration: 500 });
    thumbnailOpacity.value = withTiming(1, { duration: 500 });

    // Show UI elements again
    actionButtonsOpacity.value = withTiming(1, { duration: 500 });
    genreOpacity.value = withTiming(1, { duration: 500 });
    titleCardTranslateY.value = withTiming(0, { duration: 500 });
    watchProgressOpacity.value = withTiming(1, { duration: 500 });
  }, [trailerOpacity, thumbnailOpacity, actionButtonsOpacity, genreOpacity, titleCardTranslateY, watchProgressOpacity, setTrailerPlaying]);

  // Memoized image source
  const imageSource = useMemo(() =>
    bannerImage || metadata.banner || metadata.poster
    , [bannerImage, metadata.banner, metadata.poster]);

  // Use the logo provided by metadata (already enriched by useMetadataAssets based on settings)
  const logoUri = useMemo(() => {
    return metadata?.logo as string | undefined;
  }, [metadata?.logo]);

  // Stable logo state management - prevent flickering between logo and text
  const [stableLogoUri, setStableLogoUri] = useState<string | null>(metadata?.logo || null);
  const [logoHasLoadedSuccessfully, setLogoHasLoadedSuccessfully] = useState(false);
  // Smooth fade-in for logo when it finishes loading
  const logoLoadOpacity = useSharedValue(0);
  // Grace delay before showing text fallback to avoid flashing when logo arrives late
  const [shouldShowTextFallback, setShouldShowTextFallback] = useState<boolean>(!metadata?.logo);
  const logoWaitTimerRef = useRef<any>(null);
  // Ref to track the last synced logo to break circular dependency with error handling
  const lastSyncedLogoRef = useRef<string | undefined>(metadata?.logo);

  // Update stable logo URI when metadata logo changes
  useEffect(() => {
    // Check if metadata logo has actually changed from what we last processed
    const currentMetadataLogo = metadata?.logo;

    if (currentMetadataLogo !== lastSyncedLogoRef.current) {
      lastSyncedLogoRef.current = currentMetadataLogo;

      // Reset text fallback and timers on logo updates
      if (logoWaitTimerRef.current) {
        try { clearTimeout(logoWaitTimerRef.current); } catch (_e) { }
        logoWaitTimerRef.current = null;
      }

      if (currentMetadataLogo) {
        setStableLogoUri(currentMetadataLogo);
        onStableLogoUriChange?.(currentMetadataLogo);
        setLogoHasLoadedSuccessfully(false); // Reset for new logo
        logoLoadOpacity.value = 0; // reset fade for new logo
        setShouldShowTextFallback(false);
      } else {
        // Clear logo if metadata no longer has one
        setStableLogoUri(null);
        onStableLogoUriChange?.(null);
        setLogoHasLoadedSuccessfully(false);
        // Start a short grace period before showing text fallback
        setShouldShowTextFallback(false);
        logoWaitTimerRef.current = setTimeout(() => {
          setShouldShowTextFallback(true);
        }, 600);
      }
    }

    return () => {
      if (logoWaitTimerRef.current) {
        try { clearTimeout(logoWaitTimerRef.current); } catch (_e) { }
        logoWaitTimerRef.current = null;
      }
    };
  }, [metadata?.logo]); // Removed stableLogoUri from dependencies to prevent circular updates on error

  // Handle logo load success - once loaded successfully, keep it stable
  const handleLogoLoad = useCallback(() => {
    setLogoHasLoadedSuccessfully(true);
    // Fade in smoothly once the image reports loaded
    logoLoadOpacity.value = withTiming(1, { duration: 300 });
  }, []);

  // Handle logo load error - implement three-level fallback: TMDB logo → addon logo → text
  const handleLogoError = useCallback(() => {
    if (!logoHasLoadedSuccessfully) {
      // Try addon logo as fallback if TMDB logo fails
      const addonLogo = (metadata as any)?.addonLogo;
      if (addonLogo && stableLogoUri !== addonLogo) {
        // TMDB logo failed, try addon logo
        setStableLogoUri(addonLogo);
        setLogoHasLoadedSuccessfully(false); // Reset to allow addon logo to try
        logoLoadOpacity.value = 0; // Reset fade for new logo attempt
      } else {
        // No addon logo available, remove logo to show text
        setStableLogoUri(null);
      }
    }
    // If logo loaded successfully before, keep showing it even if it fails later
  }, [logoHasLoadedSuccessfully, stableLogoUri, metadata, logoLoadOpacity]);

  // Performance optimization: Lazy loading setup
  useEffect(() => {
    const timer = InteractionManager.runAfterInteractions(() => {
      if (!interactionComplete.current) {
        interactionComplete.current = true;
        setShouldLoadSecondaryData(true);
      }
    });

    return () => timer.cancel();
  }, []);

  // Fetch trailer URL when component mounts (only if trailers are enabled)
  useEffect(() => {
    let alive = true as boolean;
    let timerId: any = null;

    const fetchTrailer = async () => {
      if (!metadata?.name || !settings?.showTrailers || !isFocused) return;

      // Need a TMDB ID to look up the YouTube video ID
      const resolvedTmdbId = tmdbId ? String(tmdbId) : undefined;
      if (!resolvedTmdbId) {
        logger.info('HeroSection', `No TMDB ID for ${metadata.name} - skipping trailer`);
        return;
      }

      setTrailerLoading(true);
      setTrailerError(false);
      setTrailerReady(false);
      setTrailerPreloaded(false);
      startedOnReadyRef.current = false;

      // Small delay to avoid blocking the UI render
      timerId = setTimeout(async () => {
        if (!alive) return;

        try {
          const contentType = type === 'series' ? 'tv' : 'movie';

          logger.info('HeroSection', `Fetching TMDB videos for ${metadata.name} (tmdbId: ${resolvedTmdbId})`);

          // Fetch video list from TMDB to get the YouTube video ID
          const tmdbApiKey = await TMDBService.getInstance().getApiKey();
          const videosRes = await fetch(
            `https://api.themoviedb.org/3/${contentType}/${resolvedTmdbId}/videos?api_key=${tmdbApiKey}`
          );

          if (!alive) return;

          if (!videosRes.ok) {
            logger.warn('HeroSection', `TMDB videos fetch failed: ${videosRes.status} for ${metadata.name}`);
            setTrailerLoading(false);
            return;
          }

          const videosData = await videosRes.json();
          const results: any[] = videosData.results ?? [];

          // Pick best YouTube trailer: any trailer > teaser > any YouTube video
          const pick =
            results.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
            results.find((v) => v.site === 'YouTube' && v.type === 'Teaser') ??
            results.find((v) => v.site === 'YouTube');

          if (!alive) return;

          if (!pick) {
            logger.info('HeroSection', `No YouTube video found for ${metadata.name}`);
            setTrailerLoading(false);
            return;
          }

          logger.info('HeroSection', `Extracting stream for videoId: ${pick.key} (${metadata.name})`);

          const source = await TrailerService.getTrailerPlaybackSourceFromVideoId(pick.key, metadata.name);

          if (!alive) return;

          if (source) {
            setTrailerSource(source);
            logger.info('HeroSection', `Trailer loaded for ${metadata.name}`);
          } else {
            logger.info('HeroSection', `No stream extracted for ${metadata.name}`);
          }
        } catch (error) {
          if (!alive) return;
          logger.error('HeroSection', 'Error fetching trailer:', error);
          setTrailerError(true);
        } finally {
          if (alive) setTrailerLoading(false);
        }
      }, 100);
    };

    fetchTrailer();
    return () => {
      alive = false;
      try { if (timerId) clearTimeout(timerId); } catch (_e) { }
    };
  }, [metadata?.name, tmdbId, settings?.showTrailers, isFocused]);

  // Shimmer animation removed

  // Optimized loading state reset when image source changes
  useEffect(() => {
    if (imageSource) {
      setImageLoaded(false);
      imageLoadOpacity.value = 0;
    }
  }, [imageSource]);

  // Optimized image handlers with useCallback
  const handleImageError = useCallback(() => {
    if (!shouldLoadSecondaryData) return;

    runOnUI(() => {
      imageOpacity.value = withTiming(0.6, { duration: 150 });
      imageLoadOpacity.value = withTiming(0, { duration: 150 });
    })();

    setImageError(true);
    setImageLoaded(false);

    // Three-level fallback: TMDB → addon banner → poster
    if (bannerImage !== metadata.banner && metadata.banner) {
      // Try addon banner if not already on it and it exists
      setBannerImage(metadata.banner);
    } else if (bannerImage !== metadata.poster && metadata.poster) {
      // Only use poster if addon banner also failed/missing
      setBannerImage(metadata.poster);
    }
  }, [shouldLoadSecondaryData, bannerImage, metadata.banner, metadata.poster, setBannerImage]);

  const handleImageLoad = useCallback(() => {
    runOnUI(() => {
      imageOpacity.value = withTiming(1, { duration: 150 });
      imageLoadOpacity.value = withTiming(1, { duration: 400 });
    })();

    setImageError(false);
    setImageLoaded(true);
  }, []);

  // Ultra-optimized animated styles - single calculations
  const heroAnimatedStyle = useAnimatedStyle(() => ({
    height: heroHeight.value,
    opacity: heroOpacity.value,
  }), []);

  const logoAnimatedStyle = useAnimatedStyle(() => {
    // Determine if progress bar should be shown
    const hasProgress = watchProgress && watchProgress.duration > 0;

    // Scale down logo when progress bar is present
    const logoScale = hasProgress ? 0.85 : 1;

    return {
      opacity: logoOpacity.value,
      transform: [
        // Keep logo stable by not applying translateY based on scroll
        { scale: withTiming(logoScale, { duration: 300 }) }
      ]
    };
  }, [watchProgress]);

  // Logo fade style applies only to the image to avoid affecting layout
  const logoFadeStyle = useAnimatedStyle(() => ({
    opacity: logoLoadOpacity.value,
  }));

  const watchProgressAnimatedStyle = useAnimatedStyle(() => ({
    opacity: watchProgressOpacity.value,
  }), []);

  // Ultra-optimized backdrop with cached calculations and minimal worklet overhead
  const backdropImageStyle = useAnimatedStyle(() => {
    'worklet';
    const scrollYValue = scrollY.value;

    // Pre-calculated constants for better performance
    const DEFAULT_ZOOM = 1.1;
    const SCROLL_UP_MULTIPLIER = 0.002;
    const SCROLL_DOWN_MULTIPLIER = 0.0001;
    const MAX_SCALE = 1.4;
    const PARALLAX_FACTOR = 0.3;

    // Optimized scale calculation with minimal branching
    const scrollUpScale = DEFAULT_ZOOM + Math.abs(scrollYValue) * SCROLL_UP_MULTIPLIER;
    const scrollDownScale = DEFAULT_ZOOM + scrollYValue * SCROLL_DOWN_MULTIPLIER;
    const scale = Math.min(scrollYValue < 0 ? scrollUpScale : scrollDownScale, MAX_SCALE);

    // Single parallax calculation
    const parallaxOffset = scrollYValue * PARALLAX_FACTOR;

    return {
      opacity: imageOpacity.value * imageLoadOpacity.value,
      transform: [
        { scale },
        { translateY: parallaxOffset }
      ],
    };
  }, []);

  // Simplified buttons animation
  const buttonsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: buttonsOpacity.value * actionButtonsOpacity.value,
    transform: [{
      translateY: interpolate(
        buttonsTranslateY.value,
        [0, 20],
        [0, 20],
        Extrapolate.CLAMP
      )
    }]
  }), []);

  // Title card animation for lowering position when trailer is unmuted
  const titleCardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: titleCardTranslateY.value }]
  }), []);

  // Genre animation for hiding when trailer is unmuted
  const genreAnimatedStyle = useAnimatedStyle(() => ({
    opacity: genreOpacity.value
  }), []);

  // Ultra-optimized trailer parallax with cached calculations
  const trailerParallaxStyle = useAnimatedStyle(() => {
    'worklet';
    const scrollYValue = scrollY.value;

    // Pre-calculated constants for better performance
    const DEFAULT_ZOOM = 1.0;
    const SCROLL_UP_MULTIPLIER = 0.0015;
    const SCROLL_DOWN_MULTIPLIER = 0.0001;
    const MAX_SCALE = 1.25;
    const PARALLAX_FACTOR = 0.2;

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
  }, []);

  // Optimized genre rendering with lazy loading and memory management
  const genreElements = useMemo(() => {
    if (!shouldLoadSecondaryData || !metadata?.genres?.length) return null;

    const genresToDisplay = metadata.genres.slice(0, 3); // Reduced to 3 for performance
    const elements: React.ReactNode[] = [];

    genresToDisplay.forEach((genreName: string, index: number) => {
      // Add genre text
      elements.push(
        <Text
          key={`genre-${index}`}
          style={[isTablet ? styles.tabletGenreText : styles.genreText, { color: themeColors.text }]}
        >
          {genreName}
        </Text>
      );

      // Add dot separator if not the last element
      if (index < genresToDisplay.length - 1) {
        elements.push(
          <Text
            key={`dot-${index}`}
            style={[isTablet ? styles.tabletGenreDot : styles.genreDot, { color: themeColors.text }]}
          >
            •
          </Text>
        );
      }
    });

    return (
      <Animated.View
        entering={FadeIn.duration(400).delay(200)}
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        {elements}
      </Animated.View>
    );
  }, [metadata.genres, themeColors.text, shouldLoadSecondaryData, isTablet]);

  // Memoized play button text
  const playButtonText = useMemo(() => getPlayButtonText(), [getPlayButtonText]);

  // Calculate if content is watched (>=85% progress) - check both local and Trakt progress
  const isWatched = useMemo(() => {
    if (!watchProgress) return false;

    // Check Trakt progress first if available and user is authenticated
    if (isTraktAuthenticated && watchProgress.traktProgress !== undefined) {
      const traktWatched = watchProgress.traktProgress >= 95;
      // Removed excessive logging for Trakt progress
      return traktWatched;
    }

    // Fall back to local progress
    if (watchProgress.duration === 0) return false;
    const progressPercent = (watchProgress.currentTime / watchProgress.duration) * 100;
    const localWatched = progressPercent >= 85;
    // Removed excessive logging for local progress
    return localWatched;
  }, [watchProgress, isTraktAuthenticated]);

  // App state management to prevent background ANR
  useEffect(() => {
    const handleAppStateChange = (nextAppState: any) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App came to foreground
        logger.info('HeroSection', 'App came to foreground');
        // Don't automatically resume trailer - let TrailerPlayer handle it
      } else if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App going to background - only pause if trailer is actually playing
        logger.info('HeroSection', 'App going to background - pausing operations');
        // Only pause if trailer is currently playing to avoid unnecessary state changes
        if (globalTrailerPlaying) {
          setTrailerPlaying(false);
        }
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [setTrailerPlaying, globalTrailerPlaying]);

  // Navigation focus effect - conservative approach to prevent unwanted trailer resumption
  useFocusEffect(
    useCallback(() => {
      // Screen is focused - only resume trailer if it was previously playing and got interrupted
      logger.info('HeroSection', 'Screen focused');
      // If trailers are enabled and not playing, start playback (unless scrolled past resume threshold)
      if (settings?.showTrailers) {
        setTimeout(() => {
          try {
            const y = (scrollY as any).value || 0;
            const resumeThreshold = heroHeight.value * 0.4;
            if (y < resumeThreshold && !startedOnFocusRef.current && isPlayingSV.value === 0) {
              setTrailerPlaying(true);
              isPlayingSV.value = 1;
              startedOnFocusRef.current = true;
            }
          } catch (_e) {
            if (!startedOnFocusRef.current && isPlayingSV.value === 0) {
              setTrailerPlaying(true);
              isPlayingSV.value = 1;
              startedOnFocusRef.current = true;
            }
          }
        }, 50);
      }

      return () => {
        // Stop trailer when leaving this screen to prevent background playback/heat
        logger.info('HeroSection', 'Screen unfocused - stopping trailer playback');
        setTrailerPlaying(false);
        isPlayingSV.value = 0;
        startedOnFocusRef.current = false;
        startedOnReadyRef.current = false;
      };
    }, [setTrailerPlaying, settings?.showTrailers])
  );

  // Mirror playing state to shared value to use inside worklets
  useEffect(() => {
    isPlayingSV.value = globalTrailerPlaying ? 1 : 0;
  }, [globalTrailerPlaying]);

  // Mirror focus state to shared value for worklets and enforce pause when unfocused
  useEffect(() => {
    isFocusedSV.value = isFocused ? 1 : 0;
    if (!isFocused) {
      // Ensure trailer is not playing when screen loses focus
      setTrailerPlaying(false);
      isPlayingSV.value = 0;
      startedOnFocusRef.current = false;
      startedOnReadyRef.current = false;
      // Also reset trailer state to prevent background start
      try {
        setTrailerReady(false);
        setTrailerPreloaded(false);
        setTrailerSource(null);
        trailerOpacity.value = 0;
        thumbnailOpacity.value = 1;
      } catch (_e) { }
    }
  }, [isFocused, setTrailerPlaying]);

  // Ultra-optimized scroll-based pause/resume with cached calculations
  useDerivedValue(() => {
    'worklet';
    try {
      if (!scrollGuardEnabledSV.value || isFocusedSV.value === 0) return;

      // Pre-calculate thresholds for better performance
      const pauseThreshold = heroHeight.value * 0.7;
      const resumeThreshold = heroHeight.value * 0.4;
      const y = scrollY.value;
      const isPlaying = isPlayingSV.value === 1;
      const isPausedByScroll = pausedByScrollSV.value === 1;

      // Optimized pause/resume logic with minimal branching
      if (y > pauseThreshold && isPlaying && !isPausedByScroll) {
        pausedByScrollSV.value = 1;
        runOnJS(setTrailerPlaying)(false);
        isPlayingSV.value = 0;
      } else if (y < resumeThreshold && isPausedByScroll) {
        pausedByScrollSV.value = 0;
        runOnJS(setTrailerPlaying)(true);
        isPlayingSV.value = 1;
      }
    } catch (e) {
      // Silent error handling for performance
    }
  });

  // Memory management and cleanup
  useEffect(() => {
    return () => {
      // Don't stop trailer playback when component unmounts
      // Let the new hero section (if any) take control of trailer state
      // This prevents the trailer from stopping when navigating between screens

      // Reset animation values on unmount to prevent memory leaks
      try {
        imageOpacity.value = 1;
        imageLoadOpacity.value = 0;
        // shimmer removed
        trailerOpacity.value = 0;
        thumbnailOpacity.value = 1;
        actionButtonsOpacity.value = 1;
        titleCardTranslateY.value = 0;
        genreOpacity.value = 1;
        watchProgressOpacity.value = 1;
        buttonsOpacity.value = 1;
        buttonsTranslateY.value = 0;
        logoOpacity.value = 1;
        heroOpacity.value = 1;
        heroHeight.value = HERO_HEIGHT;
      } catch (error) {
        logger.error('HeroSection', 'Error cleaning up animation values:', error);
      }

      interactionComplete.current = false;
    };
  }, [imageOpacity, imageLoadOpacity, trailerOpacity, thumbnailOpacity, actionButtonsOpacity, titleCardTranslateY, genreOpacity, watchProgressOpacity, buttonsOpacity, buttonsTranslateY, logoOpacity, heroOpacity, heroHeight]);

  // Disabled performance monitoring to reduce CPU overhead in production
  // useEffect(() => {
  //   if (__DEV__) {
  //     const startTime = Date.now();
  //     const timer = setTimeout(() => {
  //       const renderTime = Date.now() - startTime;
  //       if (renderTime > 100) {
  //         console.warn(`[HeroSection] Slow render detected: ${renderTime}ms`);
  //       }
  //     }, 0);
  //     return () => clearTimeout(timer);
  //   }
  // });



  return (
    <View style={staticStyles.heroWrapper}>
      <Animated.View style={[staticStyles.heroSection, heroAnimatedStyle]}>
        {/* Optimized Background */}
        <View style={[staticStyles.absoluteFill, { backgroundColor: themeColors.black }]} />

        {/* Shimmer loading effect removed */}

        {/* Background thumbnail image - always rendered when available with parallax */}
        {shouldLoadSecondaryData && imageSource && !loadingBanner && (
          <Animated.View style={[staticStyles.thumbnailContainer, {
            opacity: thumbnailOpacity
          }]}>
            <Animated.Image
              source={{ uri: imageSource }}
              style={[staticStyles.thumbnailImage, backdropImageStyle]}
              resizeMode="cover"
              onError={handleImageError}
              onLoad={handleImageLoad}
            />
          </Animated.View>
        )}

        {/* Single trailer player - starts hidden (opacity 0), fades in when ready */}
        {shouldLoadSecondaryData && settings?.showTrailers && trailerSource?.videoUrl && !trailerLoading && !trailerError && (
          <Animated.View style={[staticStyles.absoluteFill, {
            opacity: trailerOpacity
          }, trailerParallaxStyle]}>
            <TrailerPlayer
              key={`trailer-${trailerSource.videoUrl}-${trailerSource.audioUrl ?? 'no-audio'}`}
              ref={trailerVideoRef}
              trailerUrl={trailerSource.videoUrl}
              audioUrl={trailerSource.audioUrl}
              autoPlay={globalTrailerPlaying}
              muted={trailerMuted}
              style={staticStyles.absoluteFill}
              hideLoadingSpinner={true}
              hideControls={true}
              onFullscreenToggle={handleFullscreenToggle}
              onLoad={handleTrailerReady}
              onError={handleTrailerError}
              onEnd={handleTrailerEnd}
              onPlaybackStatusUpdate={(status) => {
                if (status.isLoaded && !trailerReady) {
                  handleTrailerReady();
                }
              }}
            />
          </Animated.View>
        )}

        {/* Trailer control buttons (unmute and fullscreen) */}
        {settings?.showTrailers && trailerReady && trailerSource?.videoUrl && (
          <Animated.View style={{
            position: 'absolute',
            top: Platform.OS === 'android' ? 40 : 50,
            right: width >= 768 ? 32 : 16,
            zIndex: 1000,
            opacity: trailerOpacity,
            flexDirection: 'row',
            gap: 8,
          }}>
            {/* Fullscreen button */}
            <TouchableOpacity
              onPress={handleFullscreenToggle}
              activeOpacity={0.7}
              onPressIn={(e) => e.stopPropagation()}
              onPressOut={(e) => e.stopPropagation()}
              style={{
                padding: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
              onPress={() => {
                logger.info('HeroSection', 'Mute toggle button pressed, current muted state:', trailerMuted);
                updateSetting('trailerMuted', !trailerMuted);
                if (trailerMuted) {
                  // When unmuting, hide action buttons, genre, title card, and watch progress
                  actionButtonsOpacity.value = withTiming(0, { duration: 300 });
                  genreOpacity.value = withTiming(0, { duration: 300 });
                  titleCardTranslateY.value = withTiming(100, { duration: 300 }); // Increased from 60 to 120 for further down movement
                  watchProgressOpacity.value = withTiming(0, { duration: 300 });
                } else {
                  // When muting, show action buttons, genre, title card, and watch progress
                  actionButtonsOpacity.value = withTiming(1, { duration: 300 });
                  genreOpacity.value = withTiming(1, { duration: 300 });
                  titleCardTranslateY.value = withTiming(0, { duration: 300 });
                  watchProgressOpacity.value = withTiming(1, { duration: 300 });
                }
              }}
              activeOpacity={0.7}
              onPressIn={(e) => e.stopPropagation()}
              onPressOut={(e) => e.stopPropagation()}
              style={{
                padding: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                borderRadius: 20,
              }}
            >
              <Entypo
                name={trailerMuted ? 'sound-mute' : 'sound'}
                size={24}
                color="white"
              />
            </TouchableOpacity>

            {/* AI Chat button */}
            {settings?.aiChatEnabled && (
              <TouchableOpacity
                onPress={() => {
                  // Extract episode info if it's a series
                  let episodeData = null;
                  if (type === 'series' && watchProgress && watchProgress.episodeId) {
                    const parts = watchProgress.episodeId.split(':');
                    if (parts.length >= 3) {
                      episodeData = {
                        seasonNumber: parseInt(parts[1], 10),
                        episodeNumber: parseInt(parts[2], 10)
                      };
                    }
                  }

                  navigation.navigate('AIChat', {
                    contentId: id,
                    contentType: type,
                    episodeId: episodeData && watchProgress ? watchProgress.episodeId : undefined,
                    seasonNumber: episodeData?.seasonNumber,
                    episodeNumber: episodeData?.episodeNumber,
                    title: metadata?.name || metadata?.title || 'Unknown'
                  });
                }}
                activeOpacity={0.7}
                onPressIn={(e) => e.stopPropagation()}
                onPressOut={(e) => e.stopPropagation()}
                style={{
                  padding: 8,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  borderRadius: 20,
                }}
              >
                <MaterialIcons
                  name="smart-toy"
                  size={24}
                  color="white"
                />
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* AI Chat button (when trailers are disabled) */}
        {settings?.aiChatEnabled && !(settings?.showTrailers && trailerReady && trailerSource?.videoUrl) && (
          <Animated.View style={{
            position: 'absolute',
            top: Platform.OS === 'android' ? 40 : 50,
            right: width >= 768 ? 32 : 16,
            zIndex: 1000,
          }}>
            <TouchableOpacity
              onPress={() => {
                // Extract episode info if it's a series
                let episodeData = null;
                if (type === 'series' && watchProgress && watchProgress.episodeId) {
                  const parts = watchProgress.episodeId.split(':');
                  if (parts.length >= 3) {
                    episodeData = {
                      seasonNumber: parseInt(parts[1], 10),
                      episodeNumber: parseInt(parts[2], 10)
                    };
                  }
                }

                navigation.navigate('AIChat', {
                  contentId: id,
                  contentType: type,
                  episodeId: episodeData && watchProgress ? watchProgress.episodeId : undefined,
                  seasonNumber: episodeData?.seasonNumber,
                  episodeNumber: episodeData?.episodeNumber,
                  title: metadata?.name || metadata?.title || 'Unknown'
                });
              }}
              activeOpacity={0.7}
              style={{
                padding: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                borderRadius: 20,
              }}
            >
              <MaterialIcons
                name="smart-toy"
                size={24}
                color="white"
              />
            </TouchableOpacity>
          </Animated.View>
        )}

        <Animated.View style={styles.backButtonContainer}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <MaterialIcons
              name="arrow-back"
              size={28}
              color="#fff"
              style={styles.backButtonIcon}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Ultra-light Gradient with subtle dynamic background blend */}
        <LinearGradient
          colors={[
            'rgba(0,0,0,0)',
            'rgba(0,0,0,0.05)',
            'rgba(0,0,0,0.15)',
            'rgba(0,0,0,0.35)',
            'rgba(0,0,0,0.65)',
            dynamicBackgroundColor || themeColors.darkBackground
          ]}
          locations={[0, 0.3, 0.55, 0.75, 0.9, 1]}
          style={styles.heroGradient}
        >
          {/* Enhanced bottom fade with stronger gradient */}
          <LinearGradient
            colors={[
              'transparent',
              `${dynamicBackgroundColor || themeColors.darkBackground}10`,
              `${dynamicBackgroundColor || themeColors.darkBackground}25`,
              `${dynamicBackgroundColor || themeColors.darkBackground}45`,
              `${dynamicBackgroundColor || themeColors.darkBackground}65`,
              `${dynamicBackgroundColor || themeColors.darkBackground}85`,
              `${dynamicBackgroundColor || themeColors.darkBackground}95`,
              dynamicBackgroundColor || themeColors.darkBackground
            ]}
            locations={[0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1]}
            style={styles.bottomFadeGradient}
            pointerEvents="none"
          />
          <View style={[styles.heroContent, isTablet && { maxWidth: 800, alignSelf: 'center' }]}>
            {/* Optimized Title/Logo - Show logo immediately when available */}
            <Animated.View style={[styles.logoContainer, titleCardAnimatedStyle]}>
              <Animated.View style={[styles.titleLogoContainer, logoAnimatedStyle]}>
                {metadata?.logo ? (
                  <Animated.Image
                    source={{ uri: stableLogoUri || (metadata?.logo as string) }}
                    style={[isTablet ? styles.tabletTitleLogo : styles.titleLogo, logoFadeStyle]}
                    resizeMode={'contain'}
                    onLoad={handleLogoLoad}
                    onError={handleLogoError}
                  />
                ) : shouldShowTextFallback ? (
                  <Text style={[isTablet ? styles.tabletHeroTitle : styles.heroTitle, { color: themeColors.highEmphasis }]}>
                    {metadata.name}
                  </Text>
                ) : (
                  // Reserve space to prevent layout jump while waiting briefly for logo
                  <View style={isTablet ? styles.tabletTitleLogo : styles.titleLogo} />
                )}
              </Animated.View>
            </Animated.View>

            {/* Enhanced Watch Progress with Trakt integration */}
            <WatchProgressDisplay
              watchProgress={watchProgress}
              type={type}
              getEpisodeDetails={getEpisodeDetails}
              animatedStyle={watchProgressAnimatedStyle}
              isWatched={isWatched}
              isTrailerPlaying={globalTrailerPlaying}
              trailerMuted={trailerMuted}
              trailerReady={trailerReady}
            />

            {/* Optimized genre display with lazy loading; no fixed blank space */}
            {shouldLoadSecondaryData && genreElements && (
              <Animated.View style={[isTablet ? styles.tabletGenreContainer : styles.genreContainer, genreAnimatedStyle]}>
                {genreElements}
              </Animated.View>
            )}


            {/* Optimized Action Buttons */}
            <ActionButtons
              handleShowStreams={handleShowStreams}
                toggleLibrary={handleToggleLibrary}
                inLibrary={inLibrary}
                type={type}
                id={id}
                navigation={navigation}
                playButtonText={playButtonText}
                animatedStyle={buttonsAnimatedStyle}
                isWatched={isWatched}
                watchProgress={watchProgress}
                groupedEpisodes={groupedEpisodes}
                metadata={metadata}
                settings={settings}
                // Trakt integration props
                isAuthenticated={isAuthenticated}
                isInWatchlist={isInWatchlist}
                isInCollection={isInCollection}
                onToggleWatchlist={onToggleWatchlist}
                onToggleCollection={onToggleCollection}
              />
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
});

// Ultra-optimized styles
const styles = StyleSheet.create({
  heroWrapper: {
    width: '100%',
    marginTop: -150, // Extend wrapper 150px above to accommodate thumbnail overflow
    paddingTop: 150, // Add padding to maintain proper positioning
    overflow: 'hidden', // This will clip the thumbnail overflow when scrolling
  },
  heroSection: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'visible', // Allow thumbnail to extend within the wrapper
  },

  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  thumbnailContainer: {
    position: 'absolute',
    top: 0, // Now positioned at the top of the wrapper (which extends 150px above)
    left: 0,
    right: 0,
    bottom: 0,
  },
  thumbnailImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backButtonContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 40 : 50,
    left: isTablet ? 32 : 16,
    zIndex: 10,
  },
  backButton: {
    padding: 8,
  },
  backButtonIcon: {
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },

  heroGradient: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 20,
  },
  bottomFadeGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 400,
    zIndex: 1,
  },
  heroContent: {
    padding: isTablet ? 32 : 16,
    paddingTop: isTablet ? 16 : 8,
    paddingBottom: isTablet ? 16 : 8,
    position: 'relative',
    zIndex: 2,
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 4,
    flex: 0,
    display: 'flex',
    maxWidth: isTablet ? 600 : '100%',
    alignSelf: 'center',
  },
  titleLogoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    flex: 0,
    display: 'flex',
    maxWidth: isTablet ? 600 : '100%',
    alignSelf: 'center',
  },
  titleLogo: {
    width: width * 0.75,
    height: 90,
    alignSelf: 'center',
    textAlign: 'center',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  genreContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
    gap: 0,
    maxWidth: isTablet ? 600 : '100%',
    alignSelf: 'center',
  },
  genreText: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.9,
    marginLeft: 0,
    paddingLeft: 0,
    marginRight: 0,
    paddingRight: 0,
    marginVertical: 0,
    paddingVertical: 0,
  },
  genreDot: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.6,
    marginHorizontal: 4,
    paddingHorizontal: 0,
    marginVertical: 0,
    paddingVertical: 0,
  },
  actionButtons: {
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
    maxWidth: isTablet ? 600 : '100%',
    alignSelf: 'center',
  },
  singleRowLayout: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: isTablet ? 600 : '100%',
    alignSelf: 'center',
  },
  singleRowPlayButton: {
    flex: 2,
    maxWidth: isTablet ? 200 : 150,
  },
  singleRowSaveButton: {
    flex: 2,
    maxWidth: isTablet ? 200 : 150,
  },
  singleRowIconButton: {
    width: isTablet ? 50 : 44,
    height: isTablet ? 50 : 44,
    borderRadius: isTablet ? 25 : 22,
    flex: 0,
  },
  singleRowPlayButtonFullWidth: {
    flex: 1,
  },
  singleRowSaveButtonFullWidth: {
    flex: 1,
  },
  primaryActionRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  primaryActionButton: {
    flex: 1,
    maxWidth: '48%',
  },
  playButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  secondaryActionRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    flexWrap: 'wrap',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 26,
  },
  playButton: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  infoButton: {
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    overflow: 'hidden',
  },
  iconButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  traktButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playButtonText: {
    color: '#000',
    fontWeight: '700',
    marginLeft: 6,
    fontSize: 15,
  },
  infoButtonText: {
    color: '#fff',
    marginLeft: 6,
    fontWeight: '600',
    fontSize: 15,
  },
  watchProgressContainer: {
    marginTop: 4,
    marginBottom: 4,
    width: '100%',
    alignItems: 'center',
    minHeight: 36,
    position: 'relative',
    maxWidth: isTablet ? 600 : '100%',
    alignSelf: 'center',
  },
  progressGlassBackground: {
    width: '75%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  androidProgressBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  watchProgressBarContainer: {
    position: 'relative',
    marginBottom: 6,
  },
  watchProgressBar: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 1.5,
    overflow: 'hidden',
    position: 'relative',
  },
  watchProgressFill: {
    height: '100%',
    borderRadius: 1.25,
  },
  traktSyncIndicator: {
    position: 'absolute',
    right: 2,
    top: -2,
    bottom: -2,
    width: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  traktSyncIndicatorEnhanced: {
    position: 'absolute',
    right: 4,
    top: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  watchedProgressIndicator: {
    position: 'absolute',
    right: 2,
    top: -1,
    bottom: -1,
    width: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchProgressTextContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  watchProgressText: {
    fontSize: 11,
    textAlign: 'center',
    opacity: 0.85,
    letterSpacing: 0.1,
    flex: 1,
  },
  traktSyncButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  blurBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
  },
  androidFallbackBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  blurBackgroundRound: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 25,
  },
  androidFallbackBlurRound: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  watchedIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchedPlayButton: {
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  watchedPlayButtonText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 6,
    fontSize: 15,
  },
  // Enhanced progress indicator styles
  progressShimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  completionGlow: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,255,136,0.2)',
  },
  completionIndicator: {
    position: 'absolute',
    right: 4,
    top: -6,
    bottom: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionGradient: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleContainer: {
    position: 'absolute',
    top: -10,
    left: 0,
    right: 0,
    bottom: -10,
    borderRadius: 2,
  },
  sparkle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressInfoMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  watchProgressMainText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  watchProgressSubText: {
    fontSize: 9,
    textAlign: 'center',
    opacity: 0.8,
    marginBottom: 1,
  },
  syncStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    width: '100%',
    flexWrap: 'wrap',
  },
  syncStatusText: {
    fontSize: 9,
    marginLeft: 4,
    fontWeight: '500',
  },
  traktSyncButtonEnhanced: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  traktSyncButtonInline: {
    marginLeft: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    overflow: 'hidden',
  },
  syncButtonGradient: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncButtonGradientInline: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  traktIndicatorGradient: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tablet-specific styles
  tabletActionButtons: {
    flexDirection: 'column',
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
    maxWidth: 600,
    alignSelf: 'center',
  },
  tabletPlayButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 32,
    minWidth: 180,
  },
  tabletPlayButtonText: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  tabletInfoButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 28,
    minWidth: 140,
  },
  tabletInfoButtonText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  tabletIconButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  tabletTraktButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  tabletHeroTitle: {
    fontSize: 36,
    fontWeight: '900',
    marginBottom: 12,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    letterSpacing: -0.5,
    textAlign: 'center',
    lineHeight: 42,
  },
  tabletTitleLogo: {
    width: width * 0.5,
    height: 120,
    alignSelf: 'center',
    maxWidth: 400,
    textAlign: 'center',
  },
  tabletGenreContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
    gap: 0,
  },
  tabletGenreText: {
    fontSize: 16,
    fontWeight: '500',
    opacity: 0.9,
    marginLeft: 0,
    paddingLeft: 0,
    marginRight: 0,
    paddingRight: 0,
    marginVertical: 0,
    paddingVertical: 0,
  },
  tabletGenreDot: {
    fontSize: 16,
    fontWeight: '500',
    opacity: 0.6,
    marginHorizontal: 6,
    paddingHorizontal: 0,
    marginVertical: 0,
    paddingVertical: 0,
  },
  tabletWatchProgressContainer: {
    marginTop: 8,
    marginBottom: 8,
    width: '100%',
    alignItems: 'center',
    minHeight: 44,
    position: 'relative',
    maxWidth: 800,
    alignSelf: 'center',
  },
  tabletProgressGlassBackground: {
    width: width * 0.7,
    maxWidth: 700,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    alignSelf: 'center',
  },
  tabletWatchProgressMainText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  tabletWatchProgressSubText: {
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.8,
    marginBottom: 1,
  },
});

export default HeroSection;
