/**
 * SubtitleSyncModal - Visual subtitle sync adjustment UI
 * Two-sided layout: subtitles on left, controls on right
 * Smooth animations for subtitle transitions (no spring)
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    useWindowDimensions,
    StatusBar,
    BackHandler,
    Platform,
} from 'react-native';
import { BlurView as ExpoBlurView } from 'expo-blur';

// Dynamically import community blur for Android
let AndroidBlurView: any = null;
if (Platform.OS === 'android') {
    try {
        AndroidBlurView = require('@react-native-community/blur').BlurView;
    } catch (e) {
        AndroidBlurView = null;
    }
}
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import Animated, {
    FadeIn,
    FadeOut,
    SlideInUp,
    SlideOutUp,
    SlideInDown,
    SlideOutDown,
    withTiming,
    useAnimatedStyle,
    useSharedValue,
    interpolateColor,
    Layout,
} from 'react-native-reanimated';
import { SubtitleCue } from '../utils/playerTypes';
import i18n from '../../../i18n';

interface SubtitleSyncModalProps {
    visible: boolean;
    onClose: () => void;
    onConfirm: (offset: number) => void;
    currentOffset: number;
    currentTime: number;
    subtitles: SubtitleCue[];
    primaryColor?: string;
}

// Safe haptic feedback
const triggerHaptic = async (style: 'light' | 'medium' = 'medium') => {
    try {
        const Haptics = require('expo-haptics');
        if (Haptics?.impactAsync) {
            const feedbackStyle = style === 'light'
                ? Haptics.ImpactFeedbackStyle.Light
                : Haptics.ImpactFeedbackStyle.Medium;
            await Haptics.impactAsync(feedbackStyle);
        }
    } catch (e) { }
};

// Get subtitles around the current time for display
const getVisibleSubtitles = (
    subtitles: SubtitleCue[],
    currentTime: number,
    offset: number,
    count: number = 7
): { cue: SubtitleCue; isCurrent: boolean; position: number }[] => {
    if (!subtitles || subtitles.length === 0) return [];

    const adjustedTime = currentTime + offset;

    let currentIndex = subtitles.findIndex(
        cue => adjustedTime >= cue.start && adjustedTime <= cue.end
    );

    if (currentIndex === -1) {
        currentIndex = subtitles.findIndex(cue => cue.start > adjustedTime);
        if (currentIndex === -1) currentIndex = subtitles.length - 1;
        if (currentIndex > 0) currentIndex--;
    }

    const halfCount = Math.floor(count / 2);
    const startIndex = Math.max(0, currentIndex - halfCount);
    const endIndex = Math.min(subtitles.length, startIndex + count);

    const visible: { cue: SubtitleCue; isCurrent: boolean; position: number }[] = [];

    for (let i = startIndex; i < endIndex; i++) {
        const cue = subtitles[i];
        const isCurrent = adjustedTime >= cue.start && adjustedTime <= cue.end;
        visible.push({ cue, isCurrent, position: i - currentIndex });
    }

    return visible;
};

// Animated subtitle row component
const SubtitleRow = React.memo(({
    cue,
    isCurrent,
    position,
    primaryColor
}: {
    cue: SubtitleCue;
    isCurrent: boolean;
    position: number;
    primaryColor: string;
}) => {
    const opacity = useSharedValue(0);
    const scale = useSharedValue(isCurrent ? 1.1 : 0.95);
    const colorWeight = useSharedValue(isCurrent ? 1 : 0);

    useEffect(() => {
        opacity.value = withTiming(
            isCurrent ? 1 : Math.max(0.3, 0.8 - Math.abs(position) * 0.2),
            { duration: 200 }
        );
        scale.value = withTiming(isCurrent ? 1.1 : 0.95, { duration: 200 });
        colorWeight.value = withTiming(isCurrent ? 1 : 0, { duration: 200 });
    }, [isCurrent, position]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));

    const animatedTextStyle = useAnimatedStyle(() => {
        const textColor = interpolateColor(
            colorWeight.value,
            [0, 1],
            ['rgba(255,255,255,0.6)', '#ffffff']
        );

        const shadowColor = interpolateColor(
            colorWeight.value,
            [0, 1],
            ['rgba(0,0,0,0)', primaryColor]
        );

        return {
            color: textColor,
            textShadowColor: shadowColor,
            textShadowRadius: colorWeight.value * 10,
            textShadowOffset: { width: 0, height: 0 },
            fontWeight: colorWeight.value > 0.5 ? '700' : '500',
        };
    });

    return (
        <Animated.View
            layout={Layout.duration(200)}
            style={styles.subtitleRow}
        >
            <Animated.View style={animatedStyle}>
                <Animated.Text
                    style={[
                        styles.subtitleText,
                        animatedTextStyle,
                    ]}
                    numberOfLines={2}
                >
                    {cue.text}
                </Animated.Text>
            </Animated.View>
        </Animated.View>
    );
});

export const SubtitleSyncModal: React.FC<SubtitleSyncModalProps> = ({
    visible,
    onClose,
    onConfirm,
    currentOffset,
    currentTime,
    subtitles,
    primaryColor = '#007AFF',
}) => {
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const isLargeScreen = width >= 768;
    const rightPanelWidth = isLargeScreen ? 400 : 320;

    const [tempOffset, setTempOffset] = useState(currentOffset);
    const [zeroHapticTriggered, setZeroHapticTriggered] = useState(false);

    useEffect(() => {
        if (visible) {
            setTempOffset(currentOffset);
            setZeroHapticTriggered(false);
        }
    }, [visible, currentOffset]);

    const visibleSubtitles = useMemo(() => {
        return getVisibleSubtitles(subtitles, currentTime, tempOffset, isLargeScreen ? 9 : 7);
    }, [subtitles, currentTime, tempOffset, isLargeScreen]);

    const handleSliderChange = useCallback((value: number) => {
        const rounded = Math.round(value * 10) / 10;
        setTempOffset(rounded);

        if (Math.abs(rounded) < 0.05 && !zeroHapticTriggered) {
            triggerHaptic('medium');
            setZeroHapticTriggered(true);
        } else if (Math.abs(rounded) >= 0.05) {
            setZeroHapticTriggered(false);
        }
    }, [zeroHapticTriggered]);

    const handleReset = useCallback(() => {
        triggerHaptic('medium');
        setTempOffset(0);
        setZeroHapticTriggered(false);
    }, []);

    const handleConfirm = useCallback(() => {
        triggerHaptic('light');
        onConfirm(tempOffset);
        onClose();
    }, [tempOffset, onConfirm, onClose]);

    const formatOffset = (value: number) => {
        if (value === 0) return '0.0s';
        return `${value > 0 ? '+' : ''}${value.toFixed(1)}s`;
    };

    useEffect(() => {
        const onBackPress = () => {
            if (visible) {
                onClose();
                return true;
            }
            return false;
        };

        const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => backHandler.remove();
    }, [visible, onClose]);

    if (!visible) return null;

    return (
        <Animated.View
            style={[styles.container, StyleSheet.absoluteFill, { zIndex: 9999 }]}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
        >
            <StatusBar hidden />
            {/* Two-sided layout */}
            <View style={[styles.content, { paddingLeft: insets.left, paddingRight: insets.right }]}>

                {/* Left side - Subtitles */}
                <View style={styles.leftPanel}>
                    <View style={styles.subtitleArea}>
                        {visibleSubtitles.length > 0 ? (
                            visibleSubtitles.map(({ cue, isCurrent, position }, index) => (
                                <SubtitleRow
                                    key={`${cue.start}-${cue.text.substring(0, 20)}`}
                                    cue={cue}
                                    isCurrent={isCurrent}
                                    position={position}
                                    primaryColor={primaryColor}
                                />
                            ))
                        ) : (
                            <Text style={[styles.noSubtitles, isLargeScreen && styles.noSubtitlesLarge]}>
                                No subtitles near current position
                            </Text>
                        )}
                    </View>
                </View>

                {/* Right side - Controls with blur background */}
                {Platform.OS === 'android' && AndroidBlurView ? (
                    <View style={[
                        styles.rightPanel,
                        styles.androidRightPanelContainer,
                        {
                            width: rightPanelWidth,
                            paddingBottom: Math.max(insets.bottom, isLargeScreen ? 48 : 16),
                            paddingTop: isLargeScreen ? 48 : 32,
                        }
                    ]}>
                        <AndroidBlurView
                            blurType="dark"
                            blurAmount={15}
                            blurRadius={8}
                            style={StyleSheet.absoluteFill}
                        />
                        {/* Offset display */}
                        <View style={styles.offsetContainer}>
                            <Text style={[styles.offsetLabel, isLargeScreen && styles.offsetLabelLarge]}>{i18n.t('components.delay')}</Text>
                            <Text style={[
                                styles.offsetValue,
                                { color: primaryColor },
                                isLargeScreen && styles.offsetValueLarge
                            ]}>
                                {formatOffset(tempOffset)}
                            </Text>
                        </View>

                        {/* Slider - horizontal with buttons */}
                        <View style={styles.sliderContainer}>
                            <View style={styles.sliderRow}>
                                <TouchableOpacity
                                    onPress={() => handleSliderChange(tempOffset - 0.1)}
                                    style={[styles.nudgeBtn, isLargeScreen && styles.nudgeBtnLarge]}
                                >
                                    <MaterialIcons name="remove" size={isLargeScreen ? 28 : 20} color="#fff" />
                                </TouchableOpacity>

                                <Slider
                                    style={styles.slider}
                                    minimumValue={-10}
                                    maximumValue={10}
                                    step={0.1}
                                    value={tempOffset}
                                    onValueChange={handleSliderChange}
                                    minimumTrackTintColor={primaryColor}
                                    maximumTrackTintColor="rgba(255,255,255,0.25)"
                                    thumbTintColor={primaryColor}
                                />

                                <TouchableOpacity
                                    onPress={() => handleSliderChange(tempOffset + 0.1)}
                                    style={[styles.nudgeBtn, isLargeScreen && styles.nudgeBtnLarge]}
                                >
                                    <MaterialIcons name="add" size={isLargeScreen ? 28 : 20} color="#fff" />
                                </TouchableOpacity>
                            </View>
                            <View style={styles.sliderLabels}>
                                <Text style={styles.sliderLabel}>-10s</Text>
                                <Text style={styles.sliderLabel}>+10s</Text>
                            </View>
                        </View>

                        {/* Reset Button */}
                        <View style={styles.resetBtnContainer}>
                            <TouchableOpacity
                                onPress={handleReset}
                                style={[
                                    styles.resetBtn,
                                    isLargeScreen && styles.resetBtnLarge
                                ]}
                                activeOpacity={0.7}
                            >
                                <MaterialIcons name="refresh" size={isLargeScreen ? 16 : 14} color="#fff" style={{ marginRight: 4 }} />
                                <Text style={[styles.resetBtnText, isLargeScreen && styles.resetBtnTextLarge]}>{i18n.t('components.reset')}</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Buttons - stacked vertically */}
                        <View style={[styles.buttons, isLargeScreen && { gap: 16 }]}>
                            <TouchableOpacity
                                style={[
                                    styles.okBtn,
                                    { backgroundColor: primaryColor },
                                    isLargeScreen && styles.btnLarge
                                ]}
                                onPress={handleConfirm}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.okBtnText, isLargeScreen && styles.btnTextLarge]}>OK</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[
                                    styles.cancelBtn,
                                    isLargeScreen && styles.btnLarge
                                ]}
                                onPress={onClose}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.cancelBtnText, isLargeScreen && styles.btnTextLarge]}>{i18n.t('components.cancel_upper')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <ExpoBlurView
                        intensity={80}
                        tint="dark"
                        style={[
                            styles.rightPanel,
                            {
                                width: rightPanelWidth,
                                paddingBottom: Math.max(insets.bottom, isLargeScreen ? 48 : 16),
                                paddingTop: isLargeScreen ? 48 : 32,
                                overflow: 'hidden',
                            }
                        ]}
                    >
                        {/* Offset display */}
                        <View style={styles.offsetContainer}>
                            <Text style={[styles.offsetLabel, isLargeScreen && styles.offsetLabelLarge]}>{i18n.t('components.delay')}</Text>
                            <Text style={[
                                styles.offsetValue,
                                { color: primaryColor },
                                isLargeScreen && styles.offsetValueLarge
                            ]}>
                                {formatOffset(tempOffset)}
                            </Text>
                        </View>

                        {/* Slider - horizontal with buttons */}
                        <View style={styles.sliderContainer}>
                            <View style={styles.sliderRow}>
                                <TouchableOpacity
                                    onPress={() => handleSliderChange(tempOffset - 0.1)}
                                    style={[styles.nudgeBtn, isLargeScreen && styles.nudgeBtnLarge]}
                                >
                                    <MaterialIcons name="remove" size={isLargeScreen ? 28 : 20} color="#fff" />
                                </TouchableOpacity>

                                <Slider
                                    style={styles.slider}
                                    minimumValue={-10}
                                    maximumValue={10}
                                    step={0.1}
                                    value={tempOffset}
                                    onValueChange={handleSliderChange}
                                    minimumTrackTintColor={primaryColor}
                                    maximumTrackTintColor="rgba(255,255,255,0.25)"
                                    thumbTintColor={primaryColor}
                                />

                                <TouchableOpacity
                                    onPress={() => handleSliderChange(tempOffset + 0.1)}
                                    style={[styles.nudgeBtn, isLargeScreen && styles.nudgeBtnLarge]}
                                >
                                    <MaterialIcons name="add" size={isLargeScreen ? 28 : 20} color="#fff" />
                                </TouchableOpacity>
                            </View>
                            <View style={styles.sliderLabels}>
                                <Text style={styles.sliderLabel}>-10s</Text>
                                <Text style={styles.sliderLabel}>+10s</Text>
                            </View>
                        </View>

                        {/* Reset Button */}
                        <View style={styles.resetBtnContainer}>
                            <TouchableOpacity
                                onPress={handleReset}
                                style={[
                                    styles.resetBtn,
                                    isLargeScreen && styles.resetBtnLarge
                                ]}
                                activeOpacity={0.7}
                            >
                                <MaterialIcons name="refresh" size={isLargeScreen ? 16 : 14} color="#fff" style={{ marginRight: 4 }} />
                                <Text style={[styles.resetBtnText, isLargeScreen && styles.resetBtnTextLarge]}>{i18n.t('components.reset')}</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Buttons - stacked vertically */}
                        <View style={[styles.buttons, isLargeScreen && { gap: 16 }]}>
                            <TouchableOpacity
                                style={[
                                    styles.okBtn,
                                    { backgroundColor: primaryColor },
                                    isLargeScreen && styles.btnLarge
                                ]}
                                onPress={handleConfirm}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.okBtnText, isLargeScreen && styles.btnTextLarge]}>OK</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[
                                    styles.cancelBtn,
                                    isLargeScreen && styles.btnLarge
                                ]}
                                onPress={onClose}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.cancelBtnText, isLargeScreen && styles.btnTextLarge]}>{i18n.t('components.cancel_upper')}</Text>
                            </TouchableOpacity>
                        </View>
                    </ExpoBlurView>
                )}
            </View>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.92)',
    },
    content: {
        flex: 1,
        flexDirection: 'row',
    },
    leftPanel: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    rightPanel: {
        width: 320,
        paddingHorizontal: 24,
        paddingVertical: 32,
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    androidRightPanelContainer: {
        backgroundColor: 'rgba(20,20,20,0.85)',
        overflow: 'hidden',
    },
    subtitleArea: {
        alignItems: 'center',
        width: '100%',
    },
    subtitleRow: {
        marginVertical: 6,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 10,
        maxWidth: '100%',
    },
    currentSubtitleRow: {
        // Removed card styling
    },
    subtitleText: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 18,
        textAlign: 'center',
        fontWeight: '500',
        lineHeight: 26,
    },
    // Large screen styles
    noSubtitles: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 15,
        textAlign: 'center',
    },
    noSubtitlesLarge: {
        fontSize: 20,
    },
    offsetContainer: {
        alignItems: 'center',
    },
    offsetLabel: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 13,
        marginBottom: 4,
    },
    offsetLabelLarge: {
        fontSize: 16,
        marginBottom: 8,
    },
    offsetValue: {
        fontSize: 28,
        fontWeight: '700',
    },
    offsetValueLarge: {
        fontSize: 42,
    },
    sliderContainer: {
        width: '100%',
        marginVertical: 16,
    },
    slider: {
        flex: 1,
        height: 40,
    },
    sliderLabel: {
        color: 'rgba(255,255,255,0.4)',
        fontSize: 10,
        textAlign: 'center',
    },
    buttons: {
        width: '100%',
        gap: 10,
    },
    cancelBtn: {
        height: 44,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelBtnText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 14,
        fontWeight: '600',
    },
    okBtn: {
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    okBtnText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    // Button variants for large screens
    btnLarge: {
        height: 56,
        borderRadius: 12,
    },
    btnTextLarge: {
        fontSize: 18,
    },
    sliderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    sliderLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 34, // Align with slider track roughly
        marginTop: 4,
    },
    nudgeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    nudgeBtnLarge: {
        width: 44,
        height: 44,
        borderRadius: 22,
    },
    resetBtnContainer: {
        width: '100%',
        alignItems: 'flex-end',
        marginBottom: 8,
    },
    resetBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    resetBtnLarge: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 10,
    },
    resetBtnText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    resetBtnTextLarge: {
        fontSize: 14,
    },
});

export default SubtitleSyncModal;
