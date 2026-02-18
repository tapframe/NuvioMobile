import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Text, TouchableOpacity, StyleSheet, Platform, View } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withSpring,
    Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { SkipInterval } from '../../../services/introService';
import { useTheme } from '../../../contexts/ThemeContext';
import { logger } from '../../../utils/logger';
import { useSettings } from '../../../hooks/useSettings';
import { useSkipSegments } from '../hooks/useSkipSegments';

interface SkipIntroButtonProps {
    imdbId: string | undefined;
    type: 'movie' | 'series' | string;
    season?: number;
    episode?: number;
    malId?: string;
    kitsuId?: string;
    skipIntervals?: SkipInterval[] | null;
    currentTime: number;
    onSkip: (endTime: number) => void;
    controlsVisible?: boolean;
    controlsFixedOffset?: number;
}

export const SkipIntroButton: React.FC<SkipIntroButtonProps> = ({
    imdbId,
    type,
    season,
    episode,
    malId,
    kitsuId,
    skipIntervals: externalSkipIntervals,
    currentTime,
    onSkip,
    controlsVisible = false,
    controlsFixedOffset = 100,
}) => {
    const { currentTheme } = useTheme();
    const { settings } = useSettings();
    const insets = useSafeAreaInsets();

    const skipIntroEnabled = settings.skipIntroEnabled;

    const { segments: fetchedSkipIntervals } = useSkipSegments({
        imdbId,
        type,
        season,
        episode,
        malId,
        kitsuId,
        // Allow parent components to provide pre-fetched intervals to avoid duplicate requests.
        enabled: skipIntroEnabled && !externalSkipIntervals
    });
    const skipIntervals = externalSkipIntervals ?? fetchedSkipIntervals;

    // State
    const [currentInterval, setCurrentInterval] = useState<SkipInterval | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [hasSkippedCurrent, setHasSkippedCurrent] = useState(false);
    const [autoHidden, setAutoHidden] = useState(false);

    // Refs
    const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Animation values
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.8);
    const translateY = useSharedValue(0);

    // Reset skipped state when episode changes
    useEffect(() => {
        setHasSkippedCurrent(false);
        setAutoHidden(false);
    }, [imdbId, season, episode, malId, kitsuId]);

    // Determine active interval based on current playback position
    useEffect(() => {
        if (skipIntervals.length === 0) {
            setCurrentInterval(null);
            return;
        }

        // Find an interval that contains the current time
        const active = skipIntervals.find(
            interval => currentTime >= interval.startTime && currentTime < (interval.endTime - 0.5)
        );

        if (active) {
            // If we found a new active interval that is different from the previous one
            if (!currentInterval ||
                active.startTime !== currentInterval.startTime ||
                active.type !== currentInterval.type) {
                logger.log(`[SkipIntroButton] Entering interval: ${active.type} (${active.startTime}-${active.endTime})`);
                setCurrentInterval(active);
                setHasSkippedCurrent(false); // Reset skipped state for new interval
                setAutoHidden(false); // Reset auto-hide for new interval
            }
        } else {
            // No active interval
            if (currentInterval) {
                logger.log('[SkipIntroButton] Exiting interval');
                setCurrentInterval(null);
            }
        }
    }, [currentTime, skipIntervals]);

    // Determine if button should show
    const shouldShowButton = useCallback(() => {
        if (!currentInterval || hasSkippedCurrent) return false;

        // If auto-hidden, only show when controls are visible
        if (autoHidden && !controlsVisible) return false;

        return true;
    }, [currentInterval, hasSkippedCurrent, autoHidden, controlsVisible]);

    // Handle visibility animations
    useEffect(() => {
        const shouldShow = shouldShowButton();

        if (shouldShow && !isVisible) {
            setIsVisible(true);
            opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
            scale.value = withSpring(1, { damping: 15, stiffness: 150 });

            // Start 15-second auto-hide timer
            if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
            autoHideTimerRef.current = setTimeout(() => {
                if (!hasSkippedCurrent) {
                    setAutoHidden(true);
                    opacity.value = withTiming(0, { duration: 200 });
                    scale.value = withTiming(0.8, { duration: 200 });
                    setTimeout(() => setIsVisible(false), 250);
                }
            }, 15000);
        } else if (!shouldShow && isVisible) {
            if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
            opacity.value = withTiming(0, { duration: 200 });
            scale.value = withTiming(0.8, { duration: 200 });
            // Delay hiding to allow animation to complete
            setTimeout(() => setIsVisible(false), 250);
        }
    }, [shouldShowButton, isVisible, hasSkippedCurrent]);

    // Re-show when controls become visible (if still in interval and was auto-hidden)
    useEffect(() => {
        if (controlsVisible && autoHidden && currentInterval && !hasSkippedCurrent) {
            setAutoHidden(false);
        }
    }, [controlsVisible, autoHidden, currentInterval, hasSkippedCurrent]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
        };
    }, []);

    // Animate position based on controls visibility
    useEffect(() => {
        // Android needs more offset to clear the slider
        const androidOffset = controlsFixedOffset - 8;
        const iosOffset = controlsFixedOffset / 2;
        const target = controlsVisible ? -(Platform.OS === 'android' ? androidOffset : iosOffset) : 0;
        translateY.value = withTiming(target, { duration: 220, easing: Easing.out(Easing.cubic) });
    }, [controlsVisible, controlsFixedOffset]);

    // Handle skip action
    const handleSkip = useCallback(() => {
        if (!currentInterval) return;

        logger.log(`[SkipIntroButton] User pressed Skip - seeking to ${currentInterval.endTime}s`);
        setHasSkippedCurrent(true);
        onSkip(currentInterval.endTime);
    }, [currentInterval, onSkip]);

    // Get display text based on skip type
    const getButtonText = () => {
        if (!currentInterval) return 'Skip';

        switch (currentInterval.type) {
            case 'op':
            case 'mixed-op':
            case 'intro':
                return 'Skip Intro';
            case 'ed':
            case 'mixed-ed':
            case 'outro':
                return 'Skip Ending';
            case 'recap':
                return 'Skip Recap';
            default:
                return 'Skip';
        }
    };

    // Animated styles
    const containerStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }, { translateY: translateY.value }],
    }));

    if (!skipIntroEnabled) {
        return null;
    }

    // Don't render if not visible
    if (!isVisible) {
        return null;
    }

    return (
        <Animated.View
            style={[
                styles.container,
                containerStyle,
                {
                    bottom: 24 + insets.bottom,
                    left: (Platform.OS === 'android' ? 12 : 4) + insets.left,
                },
            ]}
            pointerEvents="box-none"
        >
            <TouchableOpacity
                style={styles.button}
                onPress={handleSkip}
                activeOpacity={0.85}
            >
                <BlurView
                    intensity={60}
                    tint="dark"
                    style={styles.blurContainer}
                >
                    <MaterialIcons
                        name="skip-next"
                        size={20}
                        color="#FFFFFF"
                        style={styles.icon}
                    />
                    <Text style={styles.text}>{getButtonText()}</Text>
                    <View
                        style={[
                            styles.accentBar,
                            { backgroundColor: currentTheme.colors.primary }
                        ]}
                    />
                </BlurView>
            </TouchableOpacity>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        zIndex: 55,
    },
    button: {
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    blurContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 18,
        backgroundColor: 'rgba(30, 30, 30, 0.7)',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    accentBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 2,
    },
});

export default SkipIntroButton;
