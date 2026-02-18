import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, Platform } from 'react-native';
import { Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { logger } from '../../../utils/logger';
import { LinearGradient } from 'expo-linear-gradient';
import { SkipInterval } from '../../../services/introService';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface NextEpisodeLike {
  season_number: number;
  episode_number: number;
  name?: string;
  thumbnailUrl?: string; // Added thumbnailUrl to NextEpisodeLike
}

interface UpNextButtonProps {
  type: string | undefined;
  nextEpisode: NextEpisodeLike | null | undefined;
  currentTime: number;
  duration: number;
  insets: Insets;
  isLoading: boolean;
  nextLoadingProvider?: string | null;
  nextLoadingQuality?: string | null;
  nextLoadingTitle?: string | null;
  onPress: () => void;
  metadata?: { poster?: string; id?: string }; // Added metadata prop
  controlsVisible?: boolean;
  controlsFixedOffset?: number;
  outroSegment?: SkipInterval | null;
}

const UpNextButton: React.FC<UpNextButtonProps> = ({
  type,
  nextEpisode,
  currentTime,
  duration,
  insets,
  isLoading,
  nextLoadingProvider,
  nextLoadingQuality,
  nextLoadingTitle,
  onPress,
  metadata,
  controlsVisible = false,
  controlsFixedOffset = 100,
  outroSegment,
}) => {
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Derive thumbnail similar to EpisodeCard
  let imageUri: string | null = null;
  const anyEpisode: any = nextEpisode as any;
  if (anyEpisode?.still_path) {
    if (typeof anyEpisode.still_path === 'string') {
      if (anyEpisode.still_path.startsWith('http')) {
        imageUri = anyEpisode.still_path;
      } else {
        try {
          const { tmdbService } = require('../../../services/tmdbService');
          const url = tmdbService.getImageUrl(anyEpisode.still_path, 'w500');
          if (url) imageUri = url;
        } catch { }
      }
    }
  }
  if (!imageUri && nextEpisode?.thumbnailUrl) imageUri = nextEpisode.thumbnailUrl;
  if (!imageUri && metadata?.poster) imageUri = metadata.poster || null;

  const shouldShow = useMemo(() => {
    if (!nextEpisode || duration <= 0) return false;

    // 1. Determine if we have a valid ending outro (within last 5 mins)
    const hasValidEndingOutro = outroSegment && (duration - outroSegment.endTime < 300);

    if (hasValidEndingOutro) {
      // If we have a valid outro, ONLY show after it finishes
      // This prevents the 60s fallback from "jumping the gun"
      return currentTime >= outroSegment.endTime;
    }

    // 2. Standard Fallback (only if no valid ending outro was found)
    const timeRemaining = duration - currentTime;
    return timeRemaining < 61 && timeRemaining > 0;
  }, [nextEpisode, duration, currentTime, outroSegment]);

  // Debug logging removed to reduce console noise
  // The state is computed in shouldShow useMemo above

  useEffect(() => {
    if (shouldShow && !visible) {
      try { logger.log('[UpNextButton] showing with animation'); } catch { }
      setVisible(true);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, tension: 100, friction: 8, useNativeDriver: true }),
      ]).start();
    } else if (!shouldShow && visible) {
      try { logger.log('[UpNextButton] hiding with animation'); } catch { }
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.8, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setVisible(false);
      });
    }
  }, [shouldShow, visible, opacity, scale]);

  // Animate vertical offset based on controls visibility
  useEffect(() => {
    // Android needs more offset to clear the slider
    const androidOffset = controlsFixedOffset - 8;
    const iosOffset = controlsFixedOffset / 2;
    const target = controlsVisible ? -(Platform.OS === 'android' ? androidOffset : iosOffset) : 0;
    Animated.timing(translateY, {
      toValue: target,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [controlsVisible, controlsFixedOffset, translateY]);

  if (!visible || !nextEpisode) return null;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: 24 + insets.bottom,
        right: (Platform.OS === 'android' ? 12 : 4) + insets.right,
        opacity,
        transform: [{ scale }, { translateY }],
        zIndex: 50,
        // Square compact card (bigger)
        width: 200,
        height: 140,
        borderRadius: 18,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 10,
        backgroundColor: '#1b1b1b',
      }}
    >
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={onPress}
        activeOpacity={0.85}
      >
        {/* Thumbnail fills card */}
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2a2a2a' }}>
            <MaterialIcons name="movie" size={44} color="#9aa0a6" />
          </View>
        )}

        {/* Bottom overlay text */}
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.65)", "rgba(0,0,0,0.98)"]}
          locations={[0, 0.5, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 10,
            paddingVertical: 8,
            height: '60%',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
            {isLoading ? (
              <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6, transform: [{ scale: 0.85 }] }} />
            ) : (
              <MaterialIcons name="skip-next" size={18} color="#ffffff" style={{ marginRight: 6 }} />
            )}
            <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700', opacity: 0.9 }} numberOfLines={1}>
              {isLoading ? 'Loading next…' : 'Up next'}
            </Text>
          </View>
          <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }} numberOfLines={2}>
            S{nextEpisode.season_number}E{nextEpisode.episode_number}
            {nextEpisode.name ? `: ${nextEpisode.name}` : ''}
          </Text>
          {isLoading && (
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }} numberOfLines={1}>
              {nextLoadingProvider ? `${nextLoadingProvider}` : 'Finding source…'}
              {nextLoadingQuality ? ` • ${nextLoadingQuality}p` : ''}
              {nextLoadingTitle ? ` • ${nextLoadingTitle}` : ''}
            </Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default UpNextButton;


