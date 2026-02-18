import React from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet, Platform, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Feather from 'react-native-vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { useTranslation } from 'react-i18next';
import { styles } from '../utils/playerStyles'; // Updated styles
import { getTrackDisplayName } from '../utils/playerUtils';
import { useTheme } from '../../../contexts/ThemeContext';
import { useSettings } from '../../../hooks/useSettings';

import { introService } from '../../../services/introService';
import { toastService } from '../../../services/toastService';
import PlayerAspectRatioIcon from '../../../../assets/player-icons/ic_player_aspect_ratio.svg';
import PlayerAudioFilledIcon from '../../../../assets/player-icons/ic_player_audio_filled.svg';
import PlayerAudioOutlineIcon from '../../../../assets/player-icons/ic_player_audio_outline.svg';
import PlayerEpisodesIcon from '../../../../assets/player-icons/ic_player_episodes.svg';
import PlayerPauseIcon from '../../../../assets/player-icons/ic_player_pause.svg';
import PlayerPlayIcon from '../../../../assets/player-icons/ic_player_play.svg';
import PlayerSourceIcon from '../../../../assets/player-icons/ic_player_source.svg';
import PlayerSubtitlesIcon from '../../../../assets/player-icons/ic_player_subtitles.svg';

interface PlayerControlsProps {
  showControls: boolean;
  fadeAnim: Animated.Value;
  paused: boolean;
  title: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  quality?: string;
  year?: number;
  streamProvider?: string;
  streamName?: string;
  currentTime: number;
  duration: number;
  zoomScale: number;
  currentResizeMode?: string;
  ksAudioTracks: Array<{ id: number, name: string, language?: string }>;
  selectedAudioTrack: number | null;
  availableStreams?: { [providerId: string]: { streams: any[]; addonName: string } };
  togglePlayback: () => void;
  skip: (seconds: number) => void;
  handleClose: () => void;
  cycleAspectRatio: () => void;
  cyclePlaybackSpeed: () => void;
  currentPlaybackSpeed: number;
  setShowAudioModal: (show: boolean) => void;
  setShowSubtitleModal: (show: boolean) => void;
  setShowSpeedModal: (show: boolean) => void;
  setShowSubmitIntroModal: (show: boolean) => void;
  isSubtitleModalOpen?: boolean;
  setShowSourcesModal?: (show: boolean) => void;
  setShowEpisodesModal?: (show: boolean) => void;
  // Slider-specific props
  onSliderValueChange: (value: number) => void;
  onSlidingStart: () => void;
  onSlidingComplete: (value: number) => void;
  buffered: number;
  formatTime: (seconds: number) => string;
  playerBackend?: string;
  // AirPlay props
  isAirPlayActive?: boolean;
  allowsAirPlay?: boolean;
  onAirPlayPress?: () => void;
  // MPV Switch (Android only)
  onSwitchToMPV?: () => void;
  useExoPlayer?: boolean;
  isBuffering?: boolean;
  imdbId?: string;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  showControls,
  fadeAnim,
  paused,
  title,
  episodeTitle,
  season,
  episode,
  quality,
  year,
  streamProvider,
  streamName,
  currentTime,
  duration,
  zoomScale,
  currentResizeMode,
  ksAudioTracks,
  selectedAudioTrack,
  availableStreams,
  togglePlayback,
  skip,
  handleClose,
  cycleAspectRatio,
  cyclePlaybackSpeed,
  currentPlaybackSpeed,
  setShowAudioModal,
  setShowSubtitleModal,
  setShowSpeedModal,
  setShowSubmitIntroModal,
  isSubtitleModalOpen,
  setShowSourcesModal,
  setShowEpisodesModal,
  onSliderValueChange,
  onSlidingStart,
  onSlidingComplete,
  buffered,
  formatTime,
  playerBackend,
  isAirPlayActive,
  allowsAirPlay,
  onAirPlayPress,
  onSwitchToMPV,
  useExoPlayer,
  isBuffering = false,
  imdbId,
}) => {
  const { currentTheme } = useTheme();
  const { settings } = useSettings();
  const { t } = useTranslation();

  // --- Intro Submission Logic ---
  const handleIntroPress = () => {
    setShowSubmitIntroModal(true);
  };


  /* Responsive Spacing */
  const screenWidth = Dimensions.get('window').width;
  const buttonSpacing = screenWidth * 0.10; // Reduced from 15% to 10%

  const playButtonSize = screenWidth * 0.08; // 8% of screen width (reduced from 12%)
  const playIconSizeCalculated = playButtonSize * 0.6; // 60% of button size
  const seekButtonSize = screenWidth * 0.07; // 7% of screen width (reduced from 11%)
  const seekIconSize = seekButtonSize * 0.75; // 75% of button size
  const seekNumberSize = seekButtonSize * 0.25; // 25% of button size
  const arcBorderWidth = seekButtonSize * 0.05; // 5% of button size

  /* Animations - State & Refs */
  const [showBackwardSign, setShowBackwardSign] = React.useState(false);
  const [showForwardSign, setShowForwardSign] = React.useState(false);
  const [previewTime, setPreviewTime] = React.useState(currentTime);
  const isSlidingRef = React.useRef(false);
  React.useEffect(() => {
    if (!isSlidingRef.current) {
      setPreviewTime(currentTime);
    }
  }, [currentTime]);

  /* Separate Animations for Each Button */
  const backwardPressAnim = React.useRef(new Animated.Value(0)).current;
  const backwardSlideAnim = React.useRef(new Animated.Value(0)).current;
  const backwardScaleAnim = React.useRef(new Animated.Value(1)).current;
  const backwardArcOpacity = React.useRef(new Animated.Value(0)).current;
  const backwardArcRotation = React.useRef(new Animated.Value(0)).current;

  const forwardPressAnim = React.useRef(new Animated.Value(0)).current;
  const forwardSlideAnim = React.useRef(new Animated.Value(0)).current;
  const forwardScaleAnim = React.useRef(new Animated.Value(1)).current;
  const forwardArcOpacity = React.useRef(new Animated.Value(0)).current;
  const forwardArcRotation = React.useRef(new Animated.Value(0)).current;

  const playPressAnim = React.useRef(new Animated.Value(0)).current;
  const playIconScale = React.useRef(new Animated.Value(1)).current;
  const playIconOpacity = React.useRef(new Animated.Value(1)).current;

  /* Handle Seek with Animation */
  const handleSeekWithAnimation = (seconds: number) => {
    const isForward = seconds > 0;

    if (isForward) {
      setShowForwardSign(true);
    } else {
      setShowBackwardSign(true);
    }

    const pressAnim = isForward ? forwardPressAnim : backwardPressAnim;
    const slideAnim = isForward ? forwardSlideAnim : backwardSlideAnim;
    const scaleAnim = isForward ? forwardScaleAnim : backwardScaleAnim;
    const arcOpacity = isForward ? forwardArcOpacity : backwardArcOpacity;
    const arcRotation = isForward ? forwardArcRotation : backwardArcRotation;

    Animated.parallel([
      // Button press effect (circle flash)
      Animated.sequence([
        Animated.timing(pressAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(pressAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      // Number slide out
      Animated.sequence([
        Animated.timing(slideAnim, {
          toValue: isForward ? (seekButtonSize * 0.75) : -(seekButtonSize * 0.75),
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
      ]),
      // Button scale pulse
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.15,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
      // Arc sweep animation
      Animated.parallel([
        Animated.timing(arcOpacity, {
          toValue: 1,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(arcRotation, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      if (isForward) {
        setShowForwardSign(false);
      } else {
        setShowBackwardSign(false);
      }
      arcOpacity.setValue(0);
      arcRotation.setValue(0);
    });

    skip(seconds);
  };

  /* Handle Play/Pause with Animation */
  const handlePlayPauseWithAnimation = () => {
    Animated.sequence([
      Animated.timing(playPressAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(playPressAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.sequence([
      Animated.timing(playIconScale, {
        toValue: 0.85,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(playIconScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    togglePlayback();
  };




  const deviceWidth = Dimensions.get('window').width;
  const BREAKPOINTS = { phone: 0, tablet: 768, largeTablet: 1024, tv: 1440 } as const;
  const getDeviceType = (w: number) => {
    if (w >= BREAKPOINTS.tv) return 'tv';
    if (w >= BREAKPOINTS.largeTablet) return 'largeTablet';
    if (w >= BREAKPOINTS.tablet) return 'tablet';
    return 'phone';
  };
  const deviceType = getDeviceType(deviceWidth);
  const isTablet = deviceType === 'tablet';
  const isLargeTablet = deviceType === 'largeTablet';
  const isTV = deviceType === 'tv';

  const closeIconSize = isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20;
  const skipIconSize = isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20;
  const playIconSize = isTV ? 48 : isLargeTablet ? 40 : isTablet ? 36 : 32;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: fadeAnim, zIndex: 20 }]}
      pointerEvents={showControls ? 'box-none' : 'none'}
    >
      {/* Progress slider with native iOS slider */}
      <View style={styles.sliderContainer}>
        <Slider
          style={{
            width: '100%',
            height: 40,
            marginHorizontal: 0,
          }}
          minimumValue={0}
          maximumValue={duration || 1}

          value={previewTime}

          onValueChange={(v) => setPreviewTime(v)}

          onSlidingStart={() => {
            isSlidingRef.current = true;
            onSlidingStart();
          }}

          onSlidingComplete={(v) => {
            isSlidingRef.current = false;
            setPreviewTime(v);
            onSlidingComplete(v);
          }}

          minimumTrackTintColor={currentTheme.colors.primary}
          maximumTrackTintColor={currentTheme.colors.mediumEmphasis}
          thumbTintColor={Platform.OS === 'android' ? currentTheme.colors.white : undefined}
          tapToSeek={Platform.OS === 'ios'}
        />
        <View style={[styles.timeDisplay, { paddingHorizontal: 14 }]}>
          <View style={styles.timeContainer}>
            <Text style={styles.duration}>{formatTime(previewTime)}</Text>
          </View>
          <View style={styles.timeContainer}>
            <Text style={styles.duration}>{formatTime(duration)}</Text>
          </View>
        </View>
      </View>

      {/* Controls Overlay */}
      <View style={styles.controlsContainer}>
        {/* Top Gradient & Header */}
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'transparent']}
          style={styles.topGradient}
        >
          <View style={styles.header}>
            {/* Title Section - Enhanced with metadata */}
            <View style={styles.titleSection}>
              <Text style={styles.title}>{title}</Text>
              {/* Show season and episode for series */}
              {season && episode && (
                <Text style={styles.episodeInfo}>
                  S{season}E{episode} {episodeTitle && `• ${episodeTitle}`}
                </Text>
              )}
              {/* Show year and provider (quality chip removed) */}
              <View style={styles.metadataRow}>
                {year && <Text style={styles.metadataText}>{year}</Text>}
                {streamName && <Text style={styles.providerText}>{t('player_ui.via', { name: streamName })}</Text>}
              </View>
              {playerBackend && (
                <View style={styles.metadataRow}>
                  <Text style={[styles.providerText, { fontSize: 11, opacity: 0.9 }]}>{playerBackend}</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* AirPlay Button - iOS only, KSAVPlayer only */}
              {Platform.OS === 'ios' && onAirPlayPress && playerBackend === 'KSAVPlayer' && (
                <TouchableOpacity
                  style={{ padding: 8 }}
                  onPress={onAirPlayPress}
                >
                  <Feather
                    name="airplay"
                    size={closeIconSize}
                    color={isAirPlayActive ? currentTheme.colors.primary : "white"}
                  />
                </TouchableOpacity>
              )}
              {/* Switch to MPV Button - Android only, when using ExoPlayer */}
              {Platform.OS === 'android' && onSwitchToMPV && useExoPlayer && (
                <TouchableOpacity
                  style={{ padding: 8 }}
                  onPress={onSwitchToMPV}
                >
                  <Ionicons
                    name="swap-horizontal"
                    size={closeIconSize}
                    color="white"
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
                <Ionicons name="close" size={closeIconSize} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>


        {/* Center Controls - CloudStream Style */}
        <View style={[styles.controls, {
          transform: [{ translateY: -(playButtonSize / 2) }]
        }]} pointerEvents="box-none">

          {/* Backward Seek Button (-10s) */}
          <TouchableOpacity
            onPress={() => handleSeekWithAnimation(-10)}
            activeOpacity={0.7}
          >
            <Animated.View style={[
              styles.seekButtonContainer,
              {
                width: seekButtonSize,
                height: seekButtonSize,
                transform: [{ scale: backwardScaleAnim }]
              }
            ]}>
              <View style={{ transform: [{ scaleX: -1 }] }}>
                <Ionicons
                  name="reload-outline"
                  size={seekIconSize}
                  color="white"
                />
              </View>
              <Animated.View style={[
                styles.buttonCircle,
                {
                  opacity: backwardPressAnim,
                  width: seekButtonSize * 0.6,
                  height: seekButtonSize * 0.6,
                  borderRadius: (seekButtonSize * 0.6) / 2,
                }
              ]} />
              <View style={[styles.seekNumberContainer, {
                width: seekButtonSize,
                height: seekButtonSize,
              }]}>
                <Animated.Text style={[
                  styles.seekNumber,
                  {
                    fontSize: seekNumberSize,
                    marginLeft: 7,
                    transform: [{ translateX: backwardSlideAnim }]
                  }
                ]}>
                  {showBackwardSign ? '-10' : '10'}
                </Animated.Text>
              </View>
            </Animated.View>
            <Animated.View style={[
              styles.arcContainer,
              {
                width: seekButtonSize,
                height: seekButtonSize,
                opacity: backwardArcOpacity,
                transform: [{
                  rotate: backwardArcRotation.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['90deg', '-90deg']
                  })
                }]
              }
            ]}>
              <View style={[
                styles.arcLeft,
                {
                  width: seekButtonSize,
                  height: seekButtonSize,
                  borderRadius: seekButtonSize / 2,
                  borderWidth: arcBorderWidth,
                }
              ]} />
            </Animated.View>
          </TouchableOpacity>

          {/* Play/Pause Button */}
          <TouchableOpacity
            onPress={handlePlayPauseWithAnimation}
            activeOpacity={0.7}
            disabled={isBuffering}
          >
            <View style={[styles.playButtonCircle, { width: playButtonSize, height: playButtonSize }]}>
              <Animated.View style={[
                styles.playPressCircle,
                {
                  opacity: playPressAnim,
                  width: playButtonSize * 0.85,
                  height: playButtonSize * 0.85,
                  borderRadius: (playButtonSize * 0.85) / 2,
                }
              ]} />
              <Animated.View style={{
                transform: [{ scale: playIconScale }],
                opacity: playIconOpacity
              }}>
                {isBuffering ? (
                  <ActivityIndicator size="large" color="#FFFFFF" />
                ) : (
                  paused ? (
                    <PlayerPlayIcon width={playIconSizeCalculated} height={playIconSizeCalculated} />
                  ) : (
                    <PlayerPauseIcon width={playIconSizeCalculated} height={playIconSizeCalculated} />
                  )
                )}
              </Animated.View>
            </View>
          </TouchableOpacity>

          {/* Forward Seek Button (+10s) */}
          <TouchableOpacity
            onPress={() => handleSeekWithAnimation(10)}
            activeOpacity={0.7}
          >
            <Animated.View style={[
              styles.seekButtonContainer,
              {
                width: seekButtonSize,
                height: seekButtonSize,
                transform: [{ scale: forwardScaleAnim }]
              }
            ]}>
              <Ionicons
                name="reload-outline"
                size={seekIconSize}
                color="white"
              />
              <Animated.View style={[
                styles.buttonCircle,
                {
                  opacity: forwardPressAnim,
                  width: seekButtonSize * 0.6,
                  height: seekButtonSize * 0.6,
                  borderRadius: (seekButtonSize * 0.6) / 2,
                }
              ]} />
              <View style={[styles.seekNumberContainer, {
                width: seekButtonSize,
                height: seekButtonSize,
              }]}>
                <Animated.Text style={[
                  styles.seekNumber,
                  {
                    fontSize: seekNumberSize,
                    transform: [{ translateX: forwardSlideAnim }]
                  }
                ]}>
                  {showForwardSign ? '+10' : '10'}
                </Animated.Text>
              </View>
              <Animated.View style={[
                styles.arcContainer,
                {
                  width: seekButtonSize,
                  height: seekButtonSize,
                },
                {
                  opacity: forwardArcOpacity,
                  transform: [{
                    rotate: forwardArcRotation.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['-90deg', '90deg']
                    })
                  }]
                }
              ]}>
                <View style={[
                  styles.arcRight,
                  {
                    width: seekButtonSize,
                    height: seekButtonSize,
                    borderRadius: seekButtonSize / 2,
                    borderWidth: arcBorderWidth,
                  }
                ]} />
              </Animated.View>
            </Animated.View>
          </TouchableOpacity>
        </View>





        {/* Bottom Gradient */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={styles.bottomGradient}
          pointerEvents="box-none"
        >
          <View style={styles.bottomControls} pointerEvents="box-none">
            {/* Center Buttons Container with rounded background - wraps all buttons */}
            <View style={styles.centerControlsContainer} pointerEvents="box-none">
              {/* Left Side: Aspect Ratio Button */}
              <TouchableOpacity style={styles.iconButton} onPress={cycleAspectRatio}>
                <PlayerAspectRatioIcon width={24} height={24} />
              </TouchableOpacity>

              {/* Subtitle Button */}
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setShowSubtitleModal(!isSubtitleModalOpen)}
              >
                <PlayerSubtitlesIcon width={24} height={24} />
              </TouchableOpacity>

              {/* Change Source Button */}
              {setShowSourcesModal && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => setShowSourcesModal(true)}
                >
                  <PlayerSourceIcon width={24} height={24} />
                </TouchableOpacity>
              )}

              {/* Playback Speed Button */}
              <TouchableOpacity style={styles.iconButton} onPress={() => setShowSpeedModal(true)}>
                <Ionicons name="speedometer-outline" size={24} color="white" />
              </TouchableOpacity>

              {/* Audio Button */}
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setShowAudioModal(true)}
                disabled={ksAudioTracks.length <= 1}
              >
                {ksAudioTracks.length <= 1 ? (
                  <PlayerAudioOutlineIcon width={24} height={24} opacity={0.55} />
                ) : (
                  <PlayerAudioFilledIcon width={24} height={24} />
                )}
              </TouchableOpacity>

              {/* Submit Intro Button */}
              {season !== undefined && episode !== undefined && settings.introSubmitEnabled && settings.introDbApiKey && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={handleIntroPress}
                >
                  <Ionicons
                    name="flag-outline"
                    size={24}
                    color="white"
                  />
                </TouchableOpacity>
              )}

              {/* Right Side: Episodes Button */}
              {setShowEpisodesModal && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => setShowEpisodesModal(true)}
                >
                  <PlayerEpisodesIcon width={24} height={24} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </LinearGradient>
      </View>
    </Animated.View>
  );
};

export default PlayerControls;
