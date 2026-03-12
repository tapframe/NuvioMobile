import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Animated, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import FastImage from '@d11/react-native-fast-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../../../i18n';

// Delay before showing pause overlay (in milliseconds)
const PAUSE_OVERLAY_DELAY = 5000;

interface PauseOverlayProps {
    visible: boolean;
    onClose: () => void;
    title: string;
    episodeTitle?: string;
    season?: number;
    episode?: number;
    year?: string | number;
    type: string;
    description: string;
    cast: any[];
    screenDimensions: { width: number, height: number };
}

export const PauseOverlay: React.FC<PauseOverlayProps> = ({
    visible,
    onClose,
    title,
    episodeTitle,
    season,
    episode,
    year,
    type,
    description,
    cast,
    screenDimensions
}) => {
    const insets = useSafeAreaInsets();

    // Internal state to track if overlay should actually be shown (after delay)
    const [shouldShow, setShouldShow] = useState(false);
    const delayTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Handle delay logic - show overlay only after paused for 5 seconds
    useEffect(() => {
        if (visible) {
            // Start timer to show overlay after delay
            delayTimerRef.current = setTimeout(() => {
                setShouldShow(true);
            }, PAUSE_OVERLAY_DELAY);
        } else {
            // Immediately hide when not paused
            if (delayTimerRef.current) {
                clearTimeout(delayTimerRef.current);
                delayTimerRef.current = null;
            }
            setShouldShow(false);
        }

        return () => {
            if (delayTimerRef.current) {
                clearTimeout(delayTimerRef.current);
                delayTimerRef.current = null;
            }
        };
    }, [visible]);

    // Internal Animation State
    const pauseOverlayOpacity = useRef(new Animated.Value(shouldShow ? 1 : 0)).current;
    const pauseOverlayTranslateY = useRef(new Animated.Value(12)).current;
    const metadataOpacity = useRef(new Animated.Value(1)).current;
    const metadataScale = useRef(new Animated.Value(1)).current;

    // Cast Details State
    const [selectedCastMember, setSelectedCastMember] = useState<any>(null);
    const [showCastDetails, setShowCastDetails] = useState(false);
    const castDetailsOpacity = useRef(new Animated.Value(0)).current;
    const castDetailsScale = useRef(new Animated.Value(0.95)).current;

    useEffect(() => {
        Animated.timing(pauseOverlayOpacity, {
            toValue: shouldShow ? 1 : 0,
            duration: 250,
            useNativeDriver: true
        }).start();
    }, [shouldShow]);

    if (!shouldShow && !showCastDetails) return null;

    return (
        <TouchableOpacity
            activeOpacity={1}
            onPress={onClose}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 30,
            }}
        >
            <Animated.View
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    opacity: pauseOverlayOpacity,
                }}
            >
                {/* Horizontal Fade */}
                <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: screenDimensions.width * 0.7 }}>
                    <LinearGradient
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.0)']}
                        locations={[0, 1]}
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                <LinearGradient
                    colors={[
                        'rgba(0,0,0,0.6)',
                        'rgba(0,0,0,0.4)',
                        'rgba(0,0,0,0.2)',
                        'rgba(0,0,0,0.0)'
                    ]}
                    locations={[0, 0.3, 0.6, 1]}
                    style={StyleSheet.absoluteFill}
                />

                <Animated.View style={{
                    position: 'absolute',
                    left: 24 + insets.left,
                    right: 24 + insets.right,
                    top: 24 + insets.top,
                    bottom: 110 + insets.bottom,
                    transform: [{ translateY: pauseOverlayTranslateY }]
                }}>
                    {showCastDetails && selectedCastMember ? (
                        <Animated.View
                            style={{
                                flex: 1,
                                justifyContent: 'center',
                                opacity: castDetailsOpacity,
                                transform: [{ scale: castDetailsScale }]
                            }}
                        >
                            <View style={{ alignItems: 'flex-start', paddingBottom: screenDimensions.height * 0.1 }}>
                                <TouchableOpacity
                                    style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24, paddingVertical: 8, paddingHorizontal: 4 }}
                                    onPress={() => {
                                        Animated.parallel([
                                            Animated.timing(castDetailsOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
                                            Animated.timing(castDetailsScale, { toValue: 0.95, duration: 250, useNativeDriver: true })
                                        ]).start(() => {
                                            setShowCastDetails(false);
                                            setSelectedCastMember(null);
                                            Animated.parallel([
                                                Animated.timing(metadataOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
                                                Animated.spring(metadataScale, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true })
                                            ]).start();
                                        });
                                    }}
                                >
                                    <MaterialIcons name="arrow-back" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                                    <Text style={{ color: '#B8B8B8', fontSize: Math.min(14, screenDimensions.width * 0.02) }}>{i18n.t('components.back_to_details')}</Text>
                                </TouchableOpacity>

                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', width: '100%' }}>
                                    {selectedCastMember.profile_path && (
                                        <View style={{ marginRight: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 }}>
                                            <FastImage
                                                source={{ uri: `https://image.tmdb.org/t/p/w300${selectedCastMember.profile_path}` }}
                                                style={{ width: Math.min(120, screenDimensions.width * 0.18), height: Math.min(180, screenDimensions.width * 0.27), borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' }}
                                                resizeMode={FastImage.resizeMode.cover}
                                            />
                                        </View>
                                    )}
                                    <View style={{ flex: 1, paddingTop: 8 }}>
                                        <Text style={{ color: '#FFFFFF', fontSize: Math.min(32, screenDimensions.width * 0.045), fontWeight: '800', marginBottom: 8 }} numberOfLines={2}>
                                            {selectedCastMember.name}
                                        </Text>
                                        {selectedCastMember.character && (
                                            <Text style={{ color: '#CCCCCC', fontSize: Math.min(16, screenDimensions.width * 0.022), marginBottom: 8, fontWeight: '500', fontStyle: 'italic' }} numberOfLines={2}>
                                                as {selectedCastMember.character}
                                            </Text>
                                        )}
                                        {selectedCastMember.biography && (
                                            <Text style={{ color: '#D6D6D6', fontSize: Math.min(14, screenDimensions.width * 0.019), lineHeight: Math.min(20, screenDimensions.width * 0.026), marginTop: 16, opacity: 0.9 }} numberOfLines={4}>
                                                {selectedCastMember.biography}
                                            </Text>
                                        )}
                                    </View>
                                </View>
                            </View>
                        </Animated.View>
                    ) : (
                        <Animated.View style={{ flex: 1, justifyContent: 'space-between', opacity: metadataOpacity, transform: [{ scale: metadataScale }] }}>
                            <View>
                                <Text style={{ color: '#B8B8B8', fontSize: Math.min(18, screenDimensions.width * 0.025), marginBottom: 8 }}>{i18n.t('components.youre_watching')}</Text>
                                <Text style={{ color: '#FFFFFF', fontSize: Math.min(48, screenDimensions.width * 0.06), fontWeight: '800', marginBottom: 10 }} numberOfLines={2}>
                                    {title}
                                </Text>
                                {!!year && (
                                    <Text style={{ color: '#CCCCCC', fontSize: Math.min(18, screenDimensions.width * 0.025), marginBottom: 8 }} numberOfLines={1}>
                                        {`${year}${type === 'series' && season && episode ? ` • S${season}E${episode}` : ''}`}
                                    </Text>
                                )}
                                {!!episodeTitle && (
                                    <Text style={{ color: '#FFFFFF', fontSize: Math.min(20, screenDimensions.width * 0.03), fontWeight: '600', marginBottom: 8 }} numberOfLines={2}>
                                        {episodeTitle}
                                    </Text>
                                )}
                                {description && (
                                    <Text style={{ color: '#D6D6D6', fontSize: Math.min(18, screenDimensions.width * 0.025), lineHeight: Math.min(24, screenDimensions.width * 0.03) }} numberOfLines={3}>
                                        {description}
                                    </Text>
                                )}
                                {cast && cast.length > 0 && (
                                    <View style={{ marginTop: 16 }}>
                                        <Text style={{ color: '#B8B8B8', fontSize: Math.min(16, screenDimensions.width * 0.022), marginBottom: 8 }}>{i18n.t('components.cast')}</Text>
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                            {cast.slice(0, 6).map((castMember: any, index: number) => (
                                                <TouchableOpacity
                                                    key={castMember.id || index}
                                                    style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingHorizontal: Math.min(12, screenDimensions.width * 0.015), paddingVertical: Math.min(6, screenDimensions.height * 0.008), marginRight: 8, marginBottom: 8 }}
                                                    onPress={() => {
                                                        setSelectedCastMember(castMember);
                                                        Animated.parallel([
                                                            Animated.timing(metadataOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
                                                            Animated.timing(metadataScale, { toValue: 0.95, duration: 250, useNativeDriver: true })
                                                        ]).start(() => {
                                                            setShowCastDetails(true);
                                                            Animated.parallel([
                                                                Animated.timing(castDetailsOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
                                                                Animated.spring(castDetailsScale, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true })
                                                            ]).start();
                                                        });
                                                    }}
                                                >
                                                    <Text style={{ color: '#FFFFFF', fontSize: Math.min(14, screenDimensions.width * 0.018) }}>
                                                        {castMember.name}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </View>
                                )}
                            </View>
                        </Animated.View>
                    )}
                </Animated.View>
            </Animated.View>
        </TouchableOpacity>
    );
};
