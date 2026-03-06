import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withDelay,
    Easing,
    SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parentalGuideService } from '../../../services/parentalGuideService';
import { logger } from '../../../utils/logger';
import { useTheme } from '../../../contexts/ThemeContext';

interface ParentalGuideOverlayProps {
    imdbId: string | undefined;
    type: 'movie' | 'series';
    season?: number;
    episode?: number;
    shouldShow: boolean;
}

interface WarningItem {
    label: string;
    severity: string;
    rawSeverity: string;
}

// Row height for calculating line animation
const ROW_HEIGHT = 18;

// Separate component for each warning item
const WarningItemView: React.FC<{
    item: WarningItem;
    opacity: SharedValue<number>;
    fontSize: number;
}> = ({ item, opacity, fontSize }) => {
    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    return (
        <Animated.View style={[styles.warningItem, animatedStyle]}>
            <Text style={[styles.label, { fontSize }]}>{item.label}</Text>
            <Text style={[styles.separator, { fontSize }]}>·</Text>
            <Text style={[styles.severity, { fontSize }]}>{item.severity}</Text>
        </Animated.View>
    );
};

export const ParentalGuideOverlay: React.FC<ParentalGuideOverlayProps> = ({
    imdbId,
    type,
    season,
    episode,
    shouldShow,
}) => {
    const { t } = useTranslation();
    const { currentTheme } = useTheme();
    const insets = useSafeAreaInsets();
    const screenWidth = Dimensions.get('window').width;
    const [warnings, setWarnings] = useState<WarningItem[]>([]);
    const [isVisible, setIsVisible] = useState(false);
    const hasShownRef = useRef(false);
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const prevShouldShowRef = useRef<boolean>(false);

    // Animation values
    const lineHeight = useSharedValue(0);
    const containerOpacity = useSharedValue(0);
    const itemOpacity0 = useSharedValue(0);
    const itemOpacity1 = useSharedValue(0);
    const itemOpacity2 = useSharedValue(0);
    const itemOpacity3 = useSharedValue(0);
    const itemOpacity4 = useSharedValue(0);

    const itemOpacities = [itemOpacity0, itemOpacity1, itemOpacity2, itemOpacity3, itemOpacity4];

    // Fetch parental guide data
    useEffect(() => {
      const fetchData = async () => {
        if (!imdbId) return;

        try {
          let data;
          if (type === "movie") {
            data = await parentalGuideService.getMovieGuide(imdbId);
          } else if (type === "series" && season && episode) {
            data = await parentalGuideService.getTVGuide(
              imdbId,
              season,
              episode,
            );
          }

          if (data && data.parentalGuide) {
            const guide = data.parentalGuide;
            const items: WarningItem[] = [];

            Object.entries(guide).forEach(([key, severity]) => {
              const lowSeverity = severity?.toLowerCase();
              if (lowSeverity && lowSeverity !== "none") {
                items.push({
                  label: t(`parentalGuide.labels.${key}`, {
                    defaultValue: key,
                  }),
                  severity: t(`parentalGuide.severity.${lowSeverity}`, {
                    defaultValue: severity,
                  }),
                  rawSeverity: lowSeverity,
                });
              }
            });

            const severityOrder = { severe: 0, moderate: 1, mild: 2, none: 3 };
            items.sort((a, b) => {
              // @ts-ignore - fallback to 3 if severity is unrecognized
              const orderA = severityOrder[a.rawSeverity] ?? 3;
              // @ts-ignore
              const orderB = severityOrder[b.rawSeverity] ?? 3;
              return orderA - orderB;
            });

            setWarnings(items.slice(0, 5));
          }
        } catch (error) {
          logger.error("[ParentalGuideOverlay] Error fetching guide:", error);
        }
      };

      fetchData();
    }, [imdbId, type, season, episode, t]);

    // Handle show/hide based on shouldShow (controls visibility)
    useEffect(() => {
        // When controls are shown (shouldShow becomes false), immediately hide overlay
        if (!shouldShow && isVisible) {
            // Clear any pending timeouts
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
                hideTimeoutRef.current = null;
            }
            if (fadeTimeoutRef.current) {
                clearTimeout(fadeTimeoutRef.current);
                fadeTimeoutRef.current = null;
            }

            // Immediately hide overlay with quick fade out
            const count = warnings.length;
            // FADE OUT: Items fade out in reverse order (bottom to top)
            for (let i = count - 1; i >= 0; i--) {
                const reverseDelay = (count - 1 - i) * 40;
                itemOpacities[i].value = withDelay(
                    reverseDelay,
                    withTiming(0, { duration: 100 })
                );
            }

            // Line shrinks after items are gone
            const lineDelay = count * 40 + 50;
            lineHeight.value = withDelay(lineDelay, withTiming(0, {
                duration: 200,
                easing: Easing.in(Easing.cubic),
            }));

            // Container fades out last
            containerOpacity.value = withDelay(lineDelay + 100, withTiming(0, { duration: 150 }));

            // Set invisible after all animations complete
            fadeTimeoutRef.current = setTimeout(() => {
                setIsVisible(false);
                // Don't reset hasShownRef here - only reset on content change
            }, lineDelay + 300);
        }
        
        // When controls are hidden (shouldShow becomes true), show overlay if not already shown for this content
        // Only show if transitioning from false to true (controls just hidden)
        if (shouldShow && !prevShouldShowRef.current && warnings.length > 0 && !hasShownRef.current) {
            hasShownRef.current = true;
            setIsVisible(true);

            const count = warnings.length;
            // Line height = (row height * count) + (gap * (count - 1))
            const gap = 2; // matches styles.itemsContainer gap
            const totalLineHeight = (count * ROW_HEIGHT) + ((count - 1) * gap);

            // Container fade in
            containerOpacity.value = withTiming(1, { duration: 300 });

            // FADE IN: Line grows from top to bottom first
            lineHeight.value = withTiming(totalLineHeight, {
                duration: 400,
                easing: Easing.out(Easing.cubic),
            });

            // Then each item fades in one by one (after line animation)
            for (let i = 0; i < count; i++) {
                itemOpacities[i].value = withDelay(
                    400 + i * 80, // Start after line, stagger each
                    withTiming(1, { duration: 200 })
                );
            }

            // Auto-hide after 5 seconds
            hideTimeoutRef.current = setTimeout(() => {
                // FADE OUT: Items fade out in reverse order (bottom to top)
                for (let i = count - 1; i >= 0; i--) {
                    const reverseDelay = (count - 1 - i) * 60;
                    itemOpacities[i].value = withDelay(
                        reverseDelay,
                        withTiming(0, { duration: 150 })
                    );
                }

                // Line shrinks after items are gone
                const lineDelay = count * 60 + 100;
                lineHeight.value = withDelay(lineDelay, withTiming(0, {
                    duration: 300,
                    easing: Easing.in(Easing.cubic),
                }));

                // Container fades out last
                containerOpacity.value = withDelay(lineDelay + 200, withTiming(0, { duration: 200 }));

                // Set invisible after all animations complete
                fadeTimeoutRef.current = setTimeout(() => {
                    setIsVisible(false);
                    // Don't reset hasShownRef - only reset on content change
                }, lineDelay + 500);
            }, 5000);
        }

        // Update previous shouldShow value
        prevShouldShowRef.current = shouldShow;
    }, [shouldShow, isVisible, warnings.length]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
            if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
        };
    }, []);

    // Reset when content changes
    useEffect(() => {
        hasShownRef.current = false;
        prevShouldShowRef.current = false;
        setWarnings([]);
        setIsVisible(false);
        lineHeight.value = 0;
        containerOpacity.value = 0;
        for (let i = 0; i < 5; i++) {
            itemOpacities[i].value = 0;
        }

        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
            hideTimeoutRef.current = null;
        }
        if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current);
            fadeTimeoutRef.current = null;
        }
    }, [imdbId, season, episode]);

    const containerStyle = useAnimatedStyle(() => ({
        opacity: containerOpacity.value,
    }));

    const lineStyle = useAnimatedStyle(() => ({
        height: lineHeight.value,
    }));

    if (!isVisible || warnings.length === 0) {
        return null;
    }

    // Responsive sizing
    const fontSize = Math.min(11, screenWidth * 0.014);
    const lineWidth = Math.min(3, screenWidth * 0.0038);
    const containerPadding = Math.min(20, screenWidth * 0.025);

    // Use left inset for landscape notches, top inset for portrait
    const safeLeftOffset = insets.left + containerPadding;
    const safeTopOffset = containerPadding;

    return (
        <Animated.View style={[styles.container, { left: safeLeftOffset, top: safeTopOffset }]} pointerEvents="none">
            {/* Vertical line - animates height */}
            <Animated.View style={[styles.line, lineStyle, { backgroundColor: currentTheme.colors.primary, width: lineWidth }]} />

            {/* Warning items */}
            <View style={styles.itemsContainer}>
                {warnings.map((item, index) => (
                    <WarningItemView
                        key={item.label}
                        item={item}
                        opacity={itemOpacities[index]}
                        fontSize={fontSize}
                    />
                ))}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'flex-start',
        zIndex: 100,
    },
    line: {
        borderRadius: 1,
        marginRight: 10,
    },
    itemsContainer: {
        gap: 2,
    },
    warningItem: {
        flexDirection: 'row',
        alignItems: 'center',
        height: ROW_HEIGHT,
    },
    label: {
        color: 'rgba(255, 255, 255, 0.85)',
        fontSize: 11,
        fontWeight: '600',
    },
    separator: {
        color: 'rgba(255, 255, 255, 0.4)',
        fontSize: 11,
        marginHorizontal: 5,
    },
    severity: {
        color: 'rgba(255, 255, 255, 0.5)',
        fontSize: 11,
        fontWeight: '400',
    },
});

export default ParentalGuideOverlay;
