import { useState, useRef, useCallback, useEffect } from 'react';
import { Animated } from 'react-native';
import { mmkvStorage } from '../../../../services/mmkvStorage';
import { logger } from '../../../../utils/logger';

const SPEED_SETTINGS_KEY = '@nuvio_speed_settings';

export const useSpeedControl = (initialSpeed: number = 1.0) => {
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(initialSpeed);
    const [holdToSpeedEnabled, setHoldToSpeedEnabled] = useState(true);
    const [holdToSpeedValue, setHoldToSpeedValue] = useState(2.0);
    const [isSpeedBoosted, setIsSpeedBoosted] = useState(false);
    const [originalSpeed, setOriginalSpeed] = useState<number>(initialSpeed);
    const [showSpeedActivatedOverlay, setShowSpeedActivatedOverlay] = useState(false);

    const speedActivatedOverlayOpacity = useRef(new Animated.Value(0)).current;

    // Load Settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const saved = await mmkvStorage.getItem(SPEED_SETTINGS_KEY);
                if (saved) {
                    const settings = JSON.parse(saved);
                    if (typeof settings.holdToSpeedEnabled === 'boolean') setHoldToSpeedEnabled(settings.holdToSpeedEnabled);
                    if (typeof settings.holdToSpeedValue === 'number') setHoldToSpeedValue(settings.holdToSpeedValue);
                }
            } catch (e) {
                logger.warn('[useSpeedControl] Error loading settings', e);
            }
        };
        loadSettings();
    }, []);

    // Save Settings
    useEffect(() => {
        const saveSettings = async () => {
            try {
                await mmkvStorage.setItem(SPEED_SETTINGS_KEY, JSON.stringify({
                    holdToSpeedEnabled,
                    holdToSpeedValue
                }));
            } catch (e) { }
        };
        saveSettings();
    }, [holdToSpeedEnabled, holdToSpeedValue]);

    const activateSpeedBoost = useCallback(() => {
        if (!holdToSpeedEnabled || isSpeedBoosted || playbackSpeed === holdToSpeedValue) return;

        setOriginalSpeed(playbackSpeed);
        setPlaybackSpeed(holdToSpeedValue);
        setIsSpeedBoosted(true);
        setShowSpeedActivatedOverlay(true);

        Animated.timing(speedActivatedOverlayOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true
        }).start();

    }, [holdToSpeedEnabled, isSpeedBoosted, playbackSpeed, holdToSpeedValue, speedActivatedOverlayOpacity]);

    const deactivateSpeedBoost = useCallback(() => {
        if (isSpeedBoosted) {
            setPlaybackSpeed(originalSpeed);
            setIsSpeedBoosted(false);

            Animated.timing(speedActivatedOverlayOpacity, { 
                toValue: 0, 
                duration: 100, 
                useNativeDriver: true 
            }).start(() => {
                setShowSpeedActivatedOverlay(false);
            });
        }
    }, [isSpeedBoosted, originalSpeed, speedActivatedOverlayOpacity]);

    return {
        playbackSpeed,
        setPlaybackSpeed,
        holdToSpeedEnabled,
        setHoldToSpeedEnabled,
        holdToSpeedValue,
        setHoldToSpeedValue,
        isSpeedBoosted,
        activateSpeedBoost,
        deactivateSpeedBoost,
        showSpeedActivatedOverlay,
        speedActivatedOverlayOpacity
    };
};
