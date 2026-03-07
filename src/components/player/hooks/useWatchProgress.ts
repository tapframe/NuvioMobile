import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { storageService } from '../../../services/storageService';
import { logger } from '../../../utils/logger';
import { useSettings } from '../../../hooks/useSettings';

export const useWatchProgress = (
    id: string | undefined,
    type: string | undefined,
    episodeId: string | undefined,
    currentTime: number,
    duration: number,
    paused: boolean,
    traktAutosync: any,
    seekToTime: (time: number) => void,
    addonId?: string,
    isInPictureInPicture: boolean = false
) => {
    const [resumePosition, setResumePosition] = useState<number | null>(null);
    const [savedDuration, setSavedDuration] = useState<number | null>(null);
    const [initialPosition, setInitialPosition] = useState<number | null>(null);
    const [showResumeOverlay, setShowResumeOverlay] = useState(false);
    const { settings: appSettings } = useSettings();
    const initialSeekTargetRef = useRef<number | null>(null);
    const wasPausedRef = useRef<boolean>(paused);

    // Values refs for unmount cleanup
    const currentTimeRef = useRef(currentTime);
    const durationRef = useRef(duration);
    const isInPictureInPictureRef = useRef(isInPictureInPicture);

    useEffect(() => {
        currentTimeRef.current = currentTime;
    }, [currentTime]);

    useEffect(() => {
        durationRef.current = duration;
    }, [duration]);

    useEffect(() => {
        isInPictureInPictureRef.current = isInPictureInPicture;
    }, [isInPictureInPicture]);

    // Keep latest traktAutosync ref to avoid dependency cycles in listeners
    const traktAutosyncRef = useRef(traktAutosync);
    useEffect(() => {
        traktAutosyncRef.current = traktAutosync;
    }, [traktAutosync]);

    // AppState Listener for background save
    useEffect(() => {
        const subscription = AppState.addEventListener('change', async (nextAppState) => {
            if (nextAppState.match(/inactive|background/)) {
                if (id && type && durationRef.current > 0) {
                    logger.log('[useWatchProgress] App backgrounded, saving progress');

                    // Local save
                    const progress = {
                        currentTime: currentTimeRef.current,
                        duration: durationRef.current,
                        lastUpdated: Date.now(),
                        addonId: addonId
                    };
                    try {
                        await storageService.setWatchProgress(id, type, progress, episodeId);

                        if (isInPictureInPictureRef.current) {
                            logger.log('[useWatchProgress] In PiP mode, skipping background playback end sync');
                        } else {
                            // Trakt sync (end session)
                            // Use 'user_close' to force immediate sync
                            await traktAutosyncRef.current.handlePlaybackEnd(currentTimeRef.current, durationRef.current, 'user_close');
                        }
                    } catch (error) {
                        logger.error('[useWatchProgress] Error saving background progress:', error);
                    }
                }
            }
        });

        return () => {
            subscription.remove();
        };
    }, [id, type, episodeId, addonId]);

    // Load Watch Progress
    useEffect(() => {
        const loadWatchProgress = async () => {
            if (id && type) {
                try {
                    const savedProgress = await storageService.getWatchProgress(id, type, episodeId);
                    console.log('[useWatchProgress] Loaded saved progress:', savedProgress);

                    if (savedProgress) {
                        const progressPercent = (savedProgress.currentTime / savedProgress.duration) * 100;
                        console.log('[useWatchProgress] Progress percent:', progressPercent);

                        if (progressPercent < 85) {
                            setResumePosition(savedProgress.currentTime);
                            setSavedDuration(savedProgress.duration);

                            if (appSettings.alwaysResume) {
                                console.log('[useWatchProgress] Always resume enabled, setting initial position:', savedProgress.currentTime);
                                setInitialPosition(savedProgress.currentTime);
                                initialSeekTargetRef.current = savedProgress.currentTime;
                                // Don't call seekToTime here - duration is 0
                                // The seek will be handled in handleLoad callback
                            } else {
                                setShowResumeOverlay(true);
                            }
                        }
                    }
                } catch (error) {
                    logger.error('[useWatchProgress] Error loading watch progress:', error);
                }
            }
        };
        loadWatchProgress();
    }, [id, type, episodeId, appSettings.alwaysResume]);

    const saveWatchProgress = async () => {
        if (id && type && currentTimeRef.current > 0 && durationRef.current > 0) {
            const progress = {
                currentTime: currentTimeRef.current,
                duration: durationRef.current,
                lastUpdated: Date.now(),
                addonId: addonId
            };
            try {
                await storageService.setWatchProgress(id, type, progress, episodeId);
                await traktAutosync.handleProgressUpdate(currentTimeRef.current, durationRef.current);
            } catch (error) {
                logger.error('[useWatchProgress] Error saving watch progress:', error);
            }
        }
    };

    
    useEffect(() => {
        if (wasPausedRef.current !== paused) {
            const becamePaused = paused;
            wasPausedRef.current = paused;
            if (becamePaused) {
                void saveWatchProgress();
            }
        }
    }, [paused]);

    // Unmount Save - deferred to allow navigation to complete first
    useEffect(() => {
        return () => {
            // Use setTimeout(0) to defer save operations to next event loop tick
            // This allows navigation animations to complete smoothly
            setTimeout(() => {
                if (id && type && durationRef.current > 0) {
                    saveWatchProgress();
                    traktAutosync.handlePlaybackEnd(currentTimeRef.current, durationRef.current, 'unmount');
                }
            }, 0);
        };
    }, [id, type]);

    return {
        resumePosition,
        savedDuration,
        initialPosition,
        setInitialPosition,
        showResumeOverlay,
        setShowResumeOverlay,
        saveWatchProgress,
        initialSeekTargetRef
    };
};
