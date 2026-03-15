import React, { useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import {
    TapGestureHandler,
    PanGestureHandler,
    LongPressGestureHandler,
    State
} from 'react-native-gesture-handler';
import { MaterialIcons } from '@expo/vector-icons';
import { styles as localStyles } from '../utils/playerStyles';

interface GestureControlsProps {
    screenDimensions: { width: number, height: number };
    gestureControls: any;
    onLongPressActivated: () => void;
    onLongPressEnd: () => void;
    onLongPressStateChange: (event: any) => void;
    toggleControls: () => void;
    showControls: boolean;
    hideControls: () => void;
    volume: number;
    brightness?: number;
    controlsTimeout: React.MutableRefObject<NodeJS.Timeout | null>;
    resizeMode?: string;
    // New props for double-tap skip and horizontal seek
    skip?: (seconds: number) => void;
    currentTime?: number;
    duration?: number;
    seekToTime?: (seconds: number) => void;
    formatTime?: (seconds: number) => string;
}

export const GestureControls: React.FC<GestureControlsProps> = ({
    screenDimensions,
    gestureControls,
    onLongPressActivated,
    onLongPressEnd,
    onLongPressStateChange,
    toggleControls,
    showControls,
    hideControls,
    volume,
    brightness = 0.5,
    controlsTimeout,
    resizeMode = 'contain',
    skip,
    currentTime,
    duration,
    seekToTime,
    formatTime,
}) => {

    const getVolumeIcon = (value: number) => {
        if (value === 0) return 'volume-off';
        if (value < 0.3) return 'volume-mute';
        if (value < 0.6) return 'volume-down';
        return 'volume-up';
    };

    const getBrightnessIcon = (value: number) => {
        if (value < 0.3) return 'brightness-low';
        if (value < 0.7) return 'brightness-medium';
        return 'brightness-high';
    };

    // Refs for gesture handlers
    const leftDoubleTapRef = React.useRef(null);
    const rightDoubleTapRef = React.useRef(null);
    const horizontalSeekPanRef = React.useRef(null);
    const leftVerticalPanRef = React.useRef(null);
    const rightVerticalPanRef = React.useRef(null);

    // State for double-tap skip overlays
    const [showSkipForwardOverlay, setShowSkipForwardOverlay] = useState(false);
    const [showSkipBackwardOverlay, setShowSkipBackwardOverlay] = useState(false);
    const [skipAmount, setSkipAmount] = useState(10);

    // State for horizontal seek
    const [isHorizontalSeeking, setIsHorizontalSeeking] = useState(false);
    const [seekPreviewTime, setSeekPreviewTime] = useState(0);
    const [seekStartTime, setSeekStartTime] = useState(0);

    // Refs for overlay timeouts
    const skipForwardTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
    const skipBackwardTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    // Cleanup timeouts on unmount
    React.useEffect(() => {
        return () => {
            if (skipForwardTimeoutRef.current) clearTimeout(skipForwardTimeoutRef.current);
            if (skipBackwardTimeoutRef.current) clearTimeout(skipBackwardTimeoutRef.current);
        };
    }, []);

    // Refs for tracking rapid seek state
    const seekBaselineTime = React.useRef<number | null>(null);
    const gestureSkipAmount = React.useRef(0);

    // Double-tap handlers
    const handleLeftDoubleTap = () => {
        if (seekToTime && currentTime !== undefined) {
            // If overlay is not visible, this is a new seek sequence
            if (!showSkipBackwardOverlay) {
                seekBaselineTime.current = currentTime;
                gestureSkipAmount.current = 0;
            }

            // Increment skip amount
            gestureSkipAmount.current += 10;
            const currentSkip = gestureSkipAmount.current;

            // Calculate target time based on locked baseline
            const baseTime = seekBaselineTime.current !== null ? seekBaselineTime.current : currentTime;
            const targetTime = Math.max(0, baseTime - currentSkip);

            // Execute seek
            seekToTime(targetTime);

            // Update UI state
            setSkipAmount(currentSkip);
            setShowSkipBackwardOverlay(true);

            if (skipBackwardTimeoutRef.current) {
                clearTimeout(skipBackwardTimeoutRef.current);
            }
            skipBackwardTimeoutRef.current = setTimeout(() => {
                setShowSkipBackwardOverlay(false);
                setSkipAmount(10);
                gestureSkipAmount.current = 0;
                seekBaselineTime.current = null;
            }, 800);
        } else if (skip) {
            // Fallback if seekToTime not available
            skip(-10);
        }
    };

    const handleRightDoubleTap = () => {
        if (seekToTime && currentTime !== undefined) {
            // If overlay is not visible, this is a new seek sequence
            if (!showSkipForwardOverlay) {
                seekBaselineTime.current = currentTime;
                gestureSkipAmount.current = 0;
            }

            // Increment skip amount
            gestureSkipAmount.current += 10;
            const currentSkip = gestureSkipAmount.current;

            // Calculate target time based on locked baseline
            const baseTime = seekBaselineTime.current !== null ? seekBaselineTime.current : currentTime;
            const targetTime = baseTime + currentSkip;
            // Note: duration check happens in seekToTime

            // Execute seek
            seekToTime(targetTime);

            // Update UI state
            setSkipAmount(currentSkip);
            setShowSkipForwardOverlay(true);

            if (skipForwardTimeoutRef.current) {
                clearTimeout(skipForwardTimeoutRef.current);
            }
            skipForwardTimeoutRef.current = setTimeout(() => {
                setShowSkipForwardOverlay(false);
                setSkipAmount(10);
                gestureSkipAmount.current = 0;
                seekBaselineTime.current = null;
            }, 800);
        } else if (skip) {
            // Fallback
            skip(10);
        }
    };

    // Shared styles for gesture areas (relative to parent container)
    const leftSideStyle = {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        width: screenDimensions.width * 0.4,
        height: '100%' as const,
    };

    const rightSideStyle = {
        position: 'absolute' as const,
        top: 0,
        right: 0,
        width: screenDimensions.width * 0.4,
        height: '100%' as const,
    };

    // Full gesture area style covering the entire video
    const gestureAreaStyle = {
        ...StyleSheet.absoluteFillObject,
        zIndex: 10,
    };

    return (
        <>
            {/* Horizontal seek gesture - OUTERMOST wrapper, fails on vertical movement */}
            <PanGestureHandler
                ref={horizontalSeekPanRef}
                onGestureEvent={(event: any) => {
                    const { translationX, state } = event.nativeEvent;

                    if (state === State.ACTIVE) {
                        if (!isHorizontalSeeking && currentTime !== undefined) {
                            setIsHorizontalSeeking(true);
                            setSeekStartTime(currentTime);
                        }

                        if (duration && duration > 0) {
                            const sensitivityFactor = duration > 3600 ? 120 : duration > 1800 ? 90 : 60;
                            const seekDelta = (translationX / screenDimensions.width) * sensitivityFactor;
                            const newTime = Math.max(0, Math.min(duration, seekStartTime + seekDelta));
                            setSeekPreviewTime(newTime);
                        }
                    }
                }}
                onHandlerStateChange={(event: any) => {
                    const { state } = event.nativeEvent;

                    if (state === State.END || state === State.CANCELLED) {
                        if (isHorizontalSeeking && seekToTime) {
                            seekToTime(seekPreviewTime);
                        }
                        setIsHorizontalSeeking(false);
                    }
                }}
                activeOffsetX={[-30, 30]}
                failOffsetY={[-20, 20]}
                maxPointers={1}
            >
                <LongPressGestureHandler
                    onActivated={onLongPressActivated}
                    onEnded={onLongPressEnd}
                    onHandlerStateChange={onLongPressStateChange}
                    minDurationMs={500}
                    maxDist={100000}
                >
                    <View style={gestureAreaStyle}>
                        {/* Left side gestures */}
                        <TapGestureHandler
                            ref={leftDoubleTapRef}
                            numberOfTaps={2}
                            onActivated={handleLeftDoubleTap}
                        >
                            <View style={leftSideStyle}>
                                <PanGestureHandler
                                    ref={leftVerticalPanRef}
                                    onGestureEvent={gestureControls.onBrightnessGestureEvent}
                                    activeOffsetY={[-10, 10]}
                                    failOffsetX={[-20, 20]}
                                    maxPointers={1}
                                >
                                    <View style={StyleSheet.absoluteFill}>
                                        <TapGestureHandler
                                            waitFor={leftDoubleTapRef}
                                            onActivated={toggleControls}
                                        >
                                            <View style={StyleSheet.absoluteFill} />
                                        </TapGestureHandler>
                                    </View>
                                </PanGestureHandler>
                            </View>
                        </TapGestureHandler>

                    {/* Center area tap handler */}
                    <TapGestureHandler
                        onActivated={() => {
                            if (showControls) {
                                const timeoutId = setTimeout(() => {
                                    hideControls();
                                }, 0);
                                if (controlsTimeout.current) {
                                    clearTimeout(controlsTimeout.current);
                                }
                                controlsTimeout.current = timeoutId;
                            } else {
                                toggleControls();
                            }
                        }}
                    >
                        <View style={{
                            position: 'absolute',
                            top: 0,
                            left: screenDimensions.width * 0.4,
                            width: screenDimensions.width * 0.2,
                            height: '100%',
                        }} />
                    </TapGestureHandler>

                        {/* Right side gestures */}
                        <TapGestureHandler
                            ref={rightDoubleTapRef}
                            numberOfTaps={2}
                            onActivated={handleRightDoubleTap}
                        >
                            <View style={rightSideStyle}>
                                <PanGestureHandler
                                    ref={rightVerticalPanRef}
                                    onGestureEvent={gestureControls.onVolumeGestureEvent}
                                    activeOffsetY={[-10, 10]}
                                    failOffsetX={[-20, 20]}
                                    maxPointers={1}
                                >
                                    <View style={StyleSheet.absoluteFill}>
                                        <TapGestureHandler
                                            waitFor={rightDoubleTapRef}
                                            onActivated={toggleControls}
                                        >
                                            <View style={StyleSheet.absoluteFill} />
                                        </TapGestureHandler>
                                    </View>
                                </PanGestureHandler>
                            </View>
                        </TapGestureHandler>
                    </View>
                </LongPressGestureHandler>
            </PanGestureHandler>

            {/* Volume/Brightness Pill Overlay */}
            {(gestureControls.showVolumeOverlay || gestureControls.showBrightnessOverlay) && (
                <View style={localStyles.gestureIndicatorContainer}>
                    <View style={[
                        localStyles.gestureIndicatorPill,
                        gestureControls.showVolumeOverlay && volume === 0 && {
                            backgroundColor: 'rgba(96, 20, 16, 0.85)'
                        }
                    ]}>
                        <View
                            style={[
                                localStyles.iconWrapper,
                                gestureControls.showVolumeOverlay && volume === 0 && {
                                    backgroundColor: 'rgba(242, 184, 181, 0.3)'
                                }
                            ]}
                        >
                            <MaterialIcons
                                name={
                                    gestureControls.showVolumeOverlay
                                        ? getVolumeIcon(volume)
                                        : getBrightnessIcon(brightness)
                                }
                                size={18}
                                color={
                                    gestureControls.showVolumeOverlay && volume === 0
                                        ? 'rgba(242, 184, 181, 1)'
                                        : 'rgba(255, 255, 255, 0.9)'
                                }
                            />
                        </View>

                        <Text
                            style={[
                                localStyles.gestureText,
                                gestureControls.showVolumeOverlay && volume === 0 && { color: 'rgba(242, 184, 181, 1)' }
                            ]}
                        >
                            {gestureControls.showVolumeOverlay && volume === 0
                                ? "Muted"
                                : `${Math.round((gestureControls.showVolumeOverlay ? volume : brightness) * 100)}%`
                            }
                        </Text>
                    </View>
                </View>
            )}

            {gestureControls.showResizeModeOverlay && (
                <View style={localStyles.gestureIndicatorContainer}>
                    <Animated.View
                        style={[
                            localStyles.gestureIndicatorPill,
                            { opacity: gestureControls.resizeModeOverlayOpacity }
                        ]}
                    >
                        <View style={localStyles.iconWrapper}>
                            <MaterialIcons
                                name="aspect-ratio"
                                size={18}
                                color={'rgba(255, 255, 255, 0.9)'}
                            />
                        </View>

                        <Text style={localStyles.gestureText}>
                            {resizeMode.charAt(0).toUpperCase() + resizeMode.slice(1)}
                        </Text>
                    </Animated.View>
                </View>
            )}

            {/* Skip Forward Overlay - Right side */}
            {showSkipForwardOverlay && (
                <View style={localStyles.gestureIndicatorContainer}>
                    <View style={localStyles.gestureIndicatorPill}>
                        <View style={localStyles.iconWrapper}>
                            <MaterialIcons name="fast-forward" size={18} color="rgba(255, 255, 255, 0.9)" />
                        </View>
                        <Text style={localStyles.gestureText}>
                            +{skipAmount}s
                        </Text>
                    </View>
                </View>
            )}

            {/* Skip Backward Overlay - Left side */}
            {showSkipBackwardOverlay && (
                <View style={localStyles.gestureIndicatorContainer}>
                    <View style={localStyles.gestureIndicatorPill}>
                        <View style={localStyles.iconWrapper}>
                            <MaterialIcons name="fast-rewind" size={18} color="rgba(255, 255, 255, 0.9)" />
                        </View>
                        <Text style={localStyles.gestureText}>
                            -{skipAmount}s
                        </Text>
                    </View>
                </View>
            )}

            {/* Horizontal Seek Preview Overlay */}
            {isHorizontalSeeking && formatTime && (
                <View style={localStyles.gestureIndicatorContainer}>
                    <View style={localStyles.gestureIndicatorPill}>
                        <View style={[localStyles.iconWrapper, { backgroundColor: 'rgba(59, 59, 59)' }]}>
                            <MaterialIcons
                                name={seekPreviewTime > (currentTime || 0) ? "fast-forward" : "fast-rewind"}
                                size={18}
                                color="rgba(255, 255, 255, 0.9)"
                            />
                        </View>
                        <Text style={localStyles.gestureText}>
                            {formatTime(seekPreviewTime)}
                        </Text>
                        <Text style={{
                            color: seekPreviewTime > (currentTime || 0) ? '#4CAF50' : '#FF5722',
                            fontSize: 12,
                            fontWeight: '600',
                            marginLeft: 4,
                        }}>
                            {seekPreviewTime > (currentTime || 0) ? '+' : ''}
                            {Math.round(seekPreviewTime - (currentTime || 0))}s
                        </Text>
                    </View>
                </View>
            )}
        </>
    );
};
