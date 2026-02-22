import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, Animated, ActivityIndicator, StyleSheet, Image, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  withDelay
} from 'react-native-reanimated';
import { styles } from '../utils/playerStyles';

interface LoadingOverlayProps {
  visible: boolean;
  backdrop: string | null | undefined;
  hasLogo: boolean;
  logo: string | null | undefined;
  loadingTitle?: string;
  loadingProgress?: number;
  backgroundFadeAnim: Animated.Value;
  backdropImageOpacityAnim: Animated.Value;
  onClose: () => void;
  width: number | string;
  height: number | string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  backdrop,
  hasLogo,
  logo,
  loadingTitle,
  loadingProgress = 0,
  backgroundFadeAnim,
  backdropImageOpacityAnim,
  onClose,
  width,
  height,
}) => {
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(1);
  const titleScale = useSharedValue(1);
  const titleOpacity = useSharedValue(1);
  const [titleWidth, setTitleWidth] = useState(0);

  useEffect(() => {
    if (visible && hasLogo && logo) {
      // Reset
      logoOpacity.value = 0;
      logoScale.value = 1;

      // Start animations after 1 second delay
      logoOpacity.value = withDelay(
        1000,
        withTiming(1, {
          duration: 800,
          easing: Easing.out(Easing.cubic),
        })
      );

      logoScale.value = withDelay(
        1000,
        withRepeat(
          withSequence(
            withTiming(1.04, {
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
            }),
            withTiming(1, {
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
            })
          ),
          -1,
          false
        )
      );
    }
  }, [visible, hasLogo, logo]);

  useEffect(() => {
    if (!visible) return;

    titleScale.value = 1;
    titleOpacity.value = 0.9;

    titleScale.value = withRepeat(
      withSequence(
        withTiming(1.03, {
          duration: 900,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(1, {
          duration: 900,
          easing: Easing.inOut(Easing.ease),
        })
      ),
      -1,
      false
    );

    titleOpacity.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.75, { duration: 900, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [visible]);

  const logoAnimatedStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  const titleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ scale: titleScale.value }],
  }));

  if (!visible) return null;

  const clampedProgress = Math.max(0, Math.min(1, loadingProgress));
  const progressPercent = `${Math.round(clampedProgress * 100)}%` as `${number}%`;
  const progressWidth = titleWidth > 0 ? titleWidth * clampedProgress : 0;

  return (
    <Animated.View
      style={[
        styles.openingOverlay,
        {
          opacity: backgroundFadeAnim,
          zIndex: 3000,
        },
        { width: '100%', height: '100%' },
      ]}
    >
      {backdrop && (
        <Animated.View style={[
          StyleSheet.absoluteFill,
          {
            opacity: backdropImageOpacityAnim
          }
        ]}>
          <Image
            source={{ uri: backdrop }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
        </Animated.View>
      )}
      <LinearGradient
        colors={[
          'rgba(0,0,0,0.3)',
          'rgba(0,0,0,0.6)',
          'rgba(0,0,0,0.8)',
          'rgba(0,0,0,0.9)'
        ]}
        locations={[0, 0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      <TouchableOpacity
        style={styles.loadingCloseButton}
        onPress={onClose}
        activeOpacity={0.7}
      >
        <MaterialIcons name="close" size={24} color="#ffffff" />
      </TouchableOpacity>

      <View style={styles.openingContent}>
        {loadingTitle ? (
          <Reanimated.View style={[localStyles.titleLoaderContainer, titleAnimatedStyle]}>
            <View style={[localStyles.titleTrack, titleWidth > 0 ? { width: titleWidth } : null]}>
              <Text
                numberOfLines={1}
                style={localStyles.titleGhostText}
                onLayout={event => setTitleWidth(event.nativeEvent.layout.width)}
              >
                {loadingTitle}
              </Text>
              <View style={[localStyles.titleFillMask, { width: progressWidth }]}>
                <Text numberOfLines={1} style={[localStyles.titleFillText, titleWidth > 0 ? { width: titleWidth } : null]}>
                  {loadingTitle}
                </Text>
              </View>
            </View>
            <View style={localStyles.progressTrack}>
              <View style={[localStyles.progressFill, { width: progressPercent }]} />
            </View>
          </Reanimated.View>
        ) : hasLogo && logo ? (
          <Reanimated.View style={[
            {
              alignItems: 'center',
            },
            logoAnimatedStyle
          ]}>
            <Image
              source={{ uri: logo }}
              style={{
                width: 300,
                height: 180,
              }}
              resizeMode="contain"
            />
          </Reanimated.View>
        ) : (
          <ActivityIndicator size="large" color="#E50914" />
        )}
      </View>
    </Animated.View>
  );
};

const localStyles = StyleSheet.create({
  titleLoaderContainer: {
    width: '82%',
    maxWidth: 680,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTrack: {
    width: '100%',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleGhostText: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 1.1,
    textAlign: 'center',
  },
  titleFillMask: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  titleFillText: {
    color: 'rgba(255,255,255,0.98)',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 1.1,
    textAlign: 'center',
    width: '100%',
  },
  progressTrack: {
    width: '78%',
    marginTop: 18,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.24)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
});

export default LoadingOverlay;
