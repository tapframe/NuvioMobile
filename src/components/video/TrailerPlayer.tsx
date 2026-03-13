import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Video, { VideoRef, OnLoadData, OnProgressData } from 'react-native-video';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '../../contexts/ThemeContext';
import { useTrailer } from '../../contexts/TrailerContext';
import { logger } from '../../utils/logger';

const { width, height } = Dimensions.get('window');
const isTablet = width >= 768;

interface TrailerPlayerProps {
  trailerUrl: string;
  audioUrl?: string | null;
  autoPlay?: boolean;
  muted?: boolean;
  onLoadStart?: () => void;
  onLoad?: () => void;
  onError?: (error: string) => void;
  onProgress?: (data: OnProgressData) => void;
  onPlaybackStatusUpdate?: (status: { isLoaded: boolean; didJustFinish: boolean }) => void;
  onEnd?: () => void;
  style?: any;
  hideLoadingSpinner?: boolean;
  onFullscreenToggle?: () => void;
  hideControls?: boolean;
  contentType?: 'movie' | 'series';
  paused?: boolean; // External control to pause/play
}

const TrailerPlayer = React.forwardRef<any, TrailerPlayerProps>(({
  trailerUrl,
  audioUrl,
  autoPlay = true,
  muted = true,
  onLoadStart,
  onLoad,
  onError,
  onProgress,
  onPlaybackStatusUpdate,
  onEnd,
  style,
  hideLoadingSpinner = false,
  onFullscreenToggle,
  hideControls = false,
  contentType = 'movie',
  paused,
}, ref) => {
  const { currentTheme } = useTheme();
  const { isTrailerPlaying: globalTrailerPlaying } = useTrailer();
  const videoRef = useRef<VideoRef>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(muted);
  const [hasError, setHasError] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isComponentMounted, setIsComponentMounted] = useState(true);

  // FIX: Track whether this player has ever been in a playing state.
  // This prevents the globalTrailerPlaying effect from suppressing the
  // very first play attempt before the global state has been set to true.
  const hasBeenPlayingRef = useRef(false);

  // Animated values
  const controlsOpacity = useSharedValue(0);
  const loadingOpacity = useSharedValue(1);
  const playButtonScale = useSharedValue(1);

  // Auto-hide controls after 3 seconds
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const appState = useRef(AppState.currentState);

  // Cleanup function to stop video and reset state
  const cleanupVideo = useCallback(() => {
    try {
      if (videoRef.current) {
        // Pause the video
        setIsPlaying(false);

        // Seek to beginning to stop any background processing
        videoRef.current.seek(0);

        // Clear any pending timeouts
        if (hideControlsTimeout.current) {
          clearTimeout(hideControlsTimeout.current);
          hideControlsTimeout.current = null;
        }

        logger.info('TrailerPlayer', 'Video cleanup completed');
      }
    } catch (error) {
      logger.error('TrailerPlayer', 'Error during video cleanup:', error);
    }
  }, []);

  // Handle app state changes to pause video when app goes to background
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appState.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App going to background - pause video
        logger.info('TrailerPlayer', 'App going to background - pausing video');
        setIsPlaying(false);
      } else if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App coming to foreground - resume if it was playing and autoPlay is enabled
        logger.info('TrailerPlayer', 'App coming to foreground');
        // Only resume if autoPlay is true and component is still mounted
        // Add a small delay to ensure the app is fully active
        if (autoPlay && isComponentMounted) {
          setTimeout(() => {
            if (isComponentMounted) {
              logger.info('TrailerPlayer', 'Resuming video after app foreground');
              setIsPlaying(true);
            }
          }, 200);
        }
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [autoPlay, isComponentMounted]);

  // Component mount/unmount tracking
  useEffect(() => {
    setIsComponentMounted(true);

    return () => {
      setIsComponentMounted(false);
      cleanupVideo();
    };
  }, [cleanupVideo]);

  // Handle autoPlay prop changes to keep internal state synchronized
  // But only if no external paused prop is provided
  useEffect(() => {
    if (isComponentMounted && paused === undefined) {
      setIsPlaying(autoPlay);
      if (autoPlay) hasBeenPlayingRef.current = true;
    }
  }, [autoPlay, isComponentMounted, paused]);

  // Handle muted prop changes to keep internal state synchronized
  useEffect(() => {
    if (isComponentMounted) {
      setIsMuted(muted);
    }
  }, [muted, isComponentMounted]);

  // Handle external paused prop to override playing state (highest priority)
  useEffect(() => {
    if (paused !== undefined) {
      const shouldPlay = !paused;
      setIsPlaying(shouldPlay);
      if (shouldPlay) hasBeenPlayingRef.current = true;
      logger.info('TrailerPlayer', `External paused prop changed: ${paused}, setting isPlaying to ${shouldPlay}`);
    }
  }, [paused]);

  // Respond to global trailer state changes (e.g., when modal opens)
  // Only apply if no external paused prop is controlling this.
  // FIX: Only pause if this player has previously been in a playing state.
  // This avoids the race condition where globalTrailerPlaying is still false
  // at mount time (before the parent has called setTrailerPlaying(true)),
  // which was causing the trailer to be immediately paused on every load.
  useEffect(() => {
    if (isComponentMounted && paused === undefined) {
      if (!globalTrailerPlaying && hasBeenPlayingRef.current) {
        // Only suppress if the player was previously playing — not on initial mount
        logger.info('TrailerPlayer', 'Global trailer paused - pausing this trailer');
        setIsPlaying(false);
      }
      // Don't automatically resume from global state
      // Each trailer should manage its own resume logic based on its screen focus
    }
  }, [globalTrailerPlaying, isComponentMounted, paused]);

  const showControlsWithTimeout = useCallback(() => {
    if (!isComponentMounted) return;

    setShowControls(true);
    controlsOpacity.value = withTiming(1, { duration: 200 });

    // Clear existing timeout
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }

    // Set new timeout to hide controls
    hideControlsTimeout.current = setTimeout(() => {
      if (isComponentMounted) {
        setShowControls(false);
        controlsOpacity.value = withTiming(0, { duration: 200 });
      }
    }, 3000);
  }, [controlsOpacity, isComponentMounted]);

  const handleVideoPress = useCallback(() => {
    if (!isComponentMounted) return;

    if (showControls) {
      // If controls are visible, toggle play/pause
      handlePlayPause();
    } else {
      // If controls are hidden, show them
      showControlsWithTimeout();
    }
  }, [showControls, showControlsWithTimeout, isComponentMounted]);

  const handlePlayPause = useCallback(async () => {
    try {
      if (!videoRef.current || !isComponentMounted) return;

      playButtonScale.value = withTiming(0.8, { duration: 100 }, () => {
        if (isComponentMounted) {
          playButtonScale.value = withTiming(1, { duration: 100 });
        }
      });

      setIsPlaying(!isPlaying);

      showControlsWithTimeout();
    } catch (error) {
      logger.error('TrailerPlayer', 'Error toggling playback:', error);
    }
  }, [isPlaying, playButtonScale, showControlsWithTimeout, isComponentMounted]);

  const handleMuteToggle = useCallback(async () => {
    try {
      if (!videoRef.current || !isComponentMounted) return;

      setIsMuted(!isMuted);
      showControlsWithTimeout();
    } catch (error) {
      logger.error('TrailerPlayer', 'Error toggling mute:', error);
    }
  }, [isMuted, showControlsWithTimeout, isComponentMounted]);

  const handleLoadStart = useCallback(() => {
    if (!isComponentMounted) return;

    setIsLoading(true);
    setHasError(false);
    // Only show loading spinner if not hidden
    loadingOpacity.value = hideLoadingSpinner ? 0 : 1;
    onLoadStart?.();
    // logger.info('TrailerPlayer', 'Video load started');
  }, [loadingOpacity, onLoadStart, hideLoadingSpinner, isComponentMounted]);

  const handleLoad = useCallback((data: OnLoadData) => {
    if (!isComponentMounted) return;

    setIsLoading(false);
    loadingOpacity.value = withTiming(0, { duration: 300 });
    setDuration(data.duration * 1000); // Convert to milliseconds
    onLoad?.();
    // logger.info('TrailerPlayer', 'Video loaded successfully');
  }, [loadingOpacity, onLoad, isComponentMounted]);

  const handleError = useCallback((error: any) => {
    if (!isComponentMounted) return;

    setIsLoading(false);
    setHasError(true);
    loadingOpacity.value = withTiming(0, { duration: 300 });
    const message = typeof error === 'string' ? error : (error?.errorString || error?.error?.string || error?.error?.message || JSON.stringify(error));
    onError?.(message);
    logger.error('TrailerPlayer', 'Video error details:', error);
  }, [loadingOpacity, onError, isComponentMounted]);

  const handleProgress = useCallback((data: OnProgressData) => {
    if (!isComponentMounted) return;

    setPosition(data.currentTime * 1000); // Convert to milliseconds
    onProgress?.(data);

    if (onPlaybackStatusUpdate) {
      onPlaybackStatusUpdate({
        isLoaded: data.currentTime > 0,
        didJustFinish: false
      });
    }
  }, [onProgress, onPlaybackStatusUpdate, isComponentMounted]);

  // Sync internal muted state with prop
  useEffect(() => {
    if (isComponentMounted) {
      setIsMuted(muted);
    }
  }, [muted, isComponentMounted]);

  // Cleanup timeout and animated values on unmount
  useEffect(() => {
    return () => {
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
        hideControlsTimeout.current = null;
      }

      // Reset all animated values to prevent memory leaks
      try {
        controlsOpacity.value = 0;
        loadingOpacity.value = 0;
        playButtonScale.value = 1;
      } catch (error) {
        logger.error('TrailerPlayer', 'Error cleaning up animation values:', error);
      }

      // Ensure video is stopped
      cleanupVideo();
    };
  }, [controlsOpacity, loadingOpacity, playButtonScale, cleanupVideo]);

  // Forward the ref to the video element
  React.useImperativeHandle(ref, () => ({
    presentFullscreenPlayer: () => {
      if (videoRef.current && isComponentMounted) {
        return videoRef.current.presentFullscreenPlayer();
      }
    },
    dismissFullscreenPlayer: () => {
      if (videoRef.current && isComponentMounted) {
        return videoRef.current.dismissFullscreenPlayer();
      }
    }
  }));

  // Animated styles
  const controlsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const loadingAnimatedStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
  }));

  const playButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: playButtonScale.value }],
  }));

  const progressPercentage = duration > 0 ? (position / duration) * 100 : 0;

  if (hasError) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color={currentTheme.colors.error} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Video
        ref={videoRef}
        source={(() => {
          const lower = (trailerUrl || '').toLowerCase();
          const looksLikeHls = /\.m3u8(\b|$)/.test(lower) || /hls|applehlsencryption|playlist|m3u/.test(lower);
          if (Platform.OS === 'android') {
            const androidHeaders = { 'User-Agent': 'Nuvio/1.0 (Android)' };
            if (looksLikeHls) {
              return { uri: trailerUrl, type: 'm3u8', headers: androidHeaders } as any;
            }
            return {
              uri: trailerUrl,
              headers: androidHeaders,
              ...(audioUrl ? { audioUri: audioUrl } : null),
            } as any;
          }
          return {
            uri: trailerUrl,
            ...(audioUrl ? { audioUri: audioUrl } : null),
          } as any;
        })()}
        style={styles.video}
        resizeMode="cover"
        paused={!isPlaying}
        repeat={false}
        muted={isMuted}
        volume={isMuted ? 0 : 1}
        mixWithOthers="duck"
        ignoreSilentSwitch="ignore"
        /* TextureView can cause rendering issues with complex overlays on Android */
        useTextureView={Platform.OS === 'android' ? false : undefined}
        playInBackground={false}
        playWhenInactive={false}
        onEnd={() => {
          // Stop playback when trailer finishes to avoid continuous GPU/decoder use
          if (isComponentMounted) {
            setIsPlaying(false);
            // Notify parent component that trailer has ended
            if (onEnd) {
              onEnd();
            }
          }
        }}
        onFullscreenPlayerWillPresent={() => setIsFullscreen(true)}
        onFullscreenPlayerDidDismiss={() => setIsFullscreen(false)}
        onLoadStart={handleLoadStart}
        onLoad={handleLoad}
        onError={(error: any) => handleError(error)}
        onProgress={handleProgress}
        controls={Platform.OS === 'android' ? isFullscreen : false}
      />

      {/* Loading indicator - hidden during smooth transitions */}
      {!hideLoadingSpinner && (
        <Animated.View style={[styles.loadingContainer, loadingAnimatedStyle]}>
          <ActivityIndicator size="large" color={currentTheme.colors.primary} />
        </Animated.View>
      )}

      {/* Video controls overlay */}
      {!hideControls && (
        <TouchableOpacity
          style={styles.videoOverlay}
          onPress={handleVideoPress}
          activeOpacity={1}
        >
          <Animated.View style={[styles.controlsContainer, controlsAnimatedStyle]}>
            {/* Top gradient */}
            <LinearGradient
              colors={['rgba(0,0,0,0.6)', 'transparent']}
              style={styles.topGradient}
              pointerEvents="none"
            />

            {/* Center play/pause button */}
            <View style={styles.centerControls}>
              <Animated.View style={playButtonAnimatedStyle}>
                <TouchableOpacity style={styles.playButton} onPress={handlePlayPause}>
                  <MaterialIcons
                    name={isPlaying ? 'pause' : 'play-arrow'}
                    size={isTablet ? 64 : 48}
                    color="white"
                  />
                </TouchableOpacity>
              </Animated.View>
            </View>

            {/* Bottom controls */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              style={styles.bottomGradient}
            >
              <View style={styles.bottomControls}>
                {/* Progress bar */}
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View
                      style={[styles.progressFill, { width: `${progressPercentage}%` }]}
                    />
                  </View>
                </View>

                {/* Control buttons */}
                <View style={styles.controlButtons}>
                  <TouchableOpacity style={styles.controlButton} onPress={handlePlayPause}>
                    <MaterialIcons
                      name={isPlaying ? 'pause' : 'play-arrow'}
                      size={isTablet ? 32 : 24}
                      color="white"
                    />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.controlButton} onPress={handleMuteToggle}>
                    <MaterialIcons
                      name={isMuted ? 'volume-off' : 'volume-up'}
                      size={isTablet ? 32 : 24}
                      color="white"
                    />
                  </TouchableOpacity>

                  {onFullscreenToggle && (
                    <TouchableOpacity style={styles.controlButton} onPress={onFullscreenToggle}>
                      <MaterialIcons
                        name="fullscreen"
                        size={isTablet ? 32 : 24}
                        color="white"
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </LinearGradient>
          </Animated.View>
        </TouchableOpacity>
      )}
    </View>
  );
});



const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  controlsContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topGradient: {
    height: 100,
    width: '100%',
  },
  centerControls: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: isTablet ? 100 : 80,
    height: isTablet ? 100 : 80,
    borderRadius: isTablet ? 50 : 40,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  bottomGradient: {
    paddingBottom: Platform.OS === 'ios' ? 20 : 16,
    paddingTop: 20,
  },
  bottomControls: {
    paddingHorizontal: isTablet ? 32 : 16,
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBar: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 1.5,
  },
  controlButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  controlButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
});

export default TrailerPlayer;
