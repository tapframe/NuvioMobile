import React, { useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { View, TouchableWithoutFeedback, StyleSheet } from 'react-native';
import { PinchGestureHandler } from 'react-native-gesture-handler';
import Video, { VideoRef, SelectedTrack, SelectedVideoTrack, ResizeMode } from 'react-native-video';
import MpvPlayer, { MpvPlayerRef } from '../MpvPlayer';
import { styles } from '../../utils/playerStyles';
import { ResizeModeType } from '../../utils/playerTypes';
import { logger } from '../../../../utils/logger';


const CODEC_ERROR_PATTERNS = [
    'exceeds_capabilities', 'no_exceeds_capabilities', 'decoder_exception',
    'decoder.*error', 'codec.*error', 'unsupported.*codec',
    'mediacodec.*exception', 'omx.*error', 'dolby.*vision', 'hevc.*error',
    'no suitable decoder', 'decoder initialization failed',
    'format.no_decoder', 'no_decoder', 'decoding_failed', 'error_code_decoding',
    'mediacodecvideodecoder', 'mediacodecvideodecoderexception', 'decoder failed',
];

interface VideoSurfaceProps {
    processedStreamUrl: string;
    videoType?: string;
    headers?: { [key: string]: string };
    volume: number;
    playbackSpeed: number;
    resizeMode: ResizeModeType;
    paused: boolean;
    currentStreamUrl: string;

    // Callbacks
    toggleControls: () => void;
    onLoad: (data: any) => void;
    onProgress: (data: any) => void;
    onSeek: (data: any) => void;
    onEnd: () => void;
    onError: (err: any) => void;
    onBuffer: (buf: any) => void;

    // Refs
    mpvPlayerRef?: React.RefObject<MpvPlayerRef>;
    exoPlayerRef?: React.RefObject<VideoRef>;
    pinchRef: any;

    // Handlers
    onPinchGestureEvent: any;
    onPinchHandlerStateChange: any;
    screenDimensions: { width: number, height: number };
    onTracksChanged?: (data: { audioTracks: any[]; subtitleTracks: any[] }) => void;
    selectedAudioTrack?: SelectedTrack;
    selectedTextTrack?: SelectedTrack;
    decoderMode?: 'auto' | 'sw' | 'hw' | 'hw+';
    gpuMode?: 'gpu' | 'gpu-next';
    glslShaders?: string;
    // Video EQ Props
    brightness?: number;
    contrast?: number;
    saturation?: number;
    gamma?: number;
    hue?: number;

    // Dual Engine Props
    useExoPlayer?: boolean;
    onCodecError?: () => void;
    onEngineChange?: (engine: 'exoplayer' | 'mpv') => void;

    // Subtitle Styling
    subtitleSize?: number;
    subtitleColor?: string;
    subtitleBackgroundOpacity?: number;
    subtitleBorderSize?: number;
    subtitleBorderColor?: string;
    subtitleShadowEnabled?: boolean;
    subtitlePosition?: number;
    subtitleBottomOffset?: number;
    subtitleDelay?: number;
    subtitleAlignment?: 'left' | 'center' | 'right';
}

// Helper function to check if error is a codec error
const isCodecError = (errorString: string): boolean => {
    const lowerError = errorString.toLowerCase();
    return CODEC_ERROR_PATTERNS.some(pattern => {
        const regex = new RegExp(pattern, 'i');
        return regex.test(lowerError);
    });
};

export const VideoSurface: React.FC<VideoSurfaceProps> = ({
    processedStreamUrl,
    videoType,
    headers,
    volume,
    playbackSpeed,
    resizeMode,
    paused,
    currentStreamUrl,
    toggleControls,
    onLoad,
    onProgress,
    onSeek,
    onEnd,
    onError,
    onBuffer,
    mpvPlayerRef,
    exoPlayerRef,
    pinchRef,
    onPinchGestureEvent,
    onPinchHandlerStateChange,
    screenDimensions,
    onTracksChanged,
    selectedAudioTrack,
    selectedTextTrack,
    decoderMode,
    gpuMode,
    glslShaders,
    brightness,
    contrast,
    saturation,
    gamma,
    hue,
    // Dual Engine
    useExoPlayer = true,
    onCodecError,
    onEngineChange,
    // Subtitle Styling
    subtitleSize,
    subtitleColor,
    subtitleBackgroundOpacity,
    subtitleBorderSize,
    subtitleBorderColor,
    subtitleShadowEnabled,
    subtitlePosition,
    subtitleBottomOffset,
    subtitleDelay,
    subtitleAlignment,
}) => {
    const streamUrl = currentStreamUrl || processedStreamUrl;

    const normalizeRnVideoType = (t?: string): 'm3u8' | 'mpd' | undefined => {
        if (!t) return undefined;
        const lower = String(t).toLowerCase();
        if (lower === 'm3u8' || lower === 'hls') return 'm3u8';
        if (lower === 'mpd' || lower === 'dash') return 'mpd';
        return undefined;
    };

    const inferRnVideoTypeFromUrl = (url?: string): 'm3u8' | 'mpd' | undefined => {
        if (!url) return undefined;
        const lower = url.toLowerCase();
        if (/\.m3u8(\b|$)/i.test(lower) || /(^|[?&])type=(m3u8|hls)(\b|$)/i.test(lower)) return 'm3u8';
        if (/\.mpd(\b|$)/i.test(lower) || /(^|[?&])type=(mpd|dash)(\b|$)/i.test(lower)) return 'mpd';

        if (/\b(hls|m3u8|m3u)\b/i.test(lower)) return 'm3u8';
        if (/\/playlist\//i.test(lower) && (/(^|[?&])token=/.test(lower) || /(^|[?&])expires=/.test(lower))) return 'm3u8';

        if (/\bdash\b/i.test(lower) || /manifest/.test(lower)) return 'mpd';
        return undefined;
    };

    const resolvedRnVideoType = normalizeRnVideoType(videoType) ?? inferRnVideoTypeFromUrl(streamUrl);

    const probeHlsResponse = useCallback(async (url: string) => {
        try {
            const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-2047' } });
            const text = await res.text();
            const prefix = text.slice(0, 200).replace(/\s+/g, ' ').trim();
            console.log('[VideoSurface] Manifest probe:', {
                status: res.status,
                contentType: res.headers.get('content-type'),
                contentEncoding: res.headers.get('content-encoding'),
                prefix,
            });
        } catch (e: any) {
            console.log('[VideoSurface] Manifest probe failed:', e?.message);
        }
    }, []);

    const exoRequestHeaders = (() => {
        const merged = { ...(headers ?? {}) } as Record<string, string>;
        const hasUA = Object.keys(merged).some(k => k.toLowerCase() === 'user-agent');
        if (!hasUA && resolvedRnVideoType === 'm3u8') {
            merged['User-Agent'] = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
            merged['Accept'] = '*/*';
        }
        return merged;
    })();

    const exoRequestHeadersArray = Object.entries(exoRequestHeaders).map(([key, value]) => ({ key, value }));

    const lastLoggedExoRequestKeyRef = useRef<string>('');
    useEffect(() => {
        if (!__DEV__ || !useExoPlayer) return;
        const key = `${streamUrl}::${JSON.stringify(exoRequestHeaders)}`;
        if (lastLoggedExoRequestKeyRef.current === key) return;
        lastLoggedExoRequestKeyRef.current = key;
        console.log('[VideoSurface] Headers:', exoRequestHeaders);
    }, [streamUrl, useExoPlayer, exoRequestHeaders]);

    useEffect(() => {
        if (mpvPlayerRef?.current && !useExoPlayer) {
            mpvPlayerRef.current.setResizeMode(getMpvResizeMode());
        }
    }, [resizeMode, useExoPlayer, mpvPlayerRef]);

    const handleMpvLoad = (data: { duration: number; width: number; height: number }) => {
        console.log('[VideoSurface] MPV onLoad received:', data);
        onLoad({
            duration: data.duration,
            naturalSize: {
                width: data.width,
                height: data.height,
            },
        });
    };

    const handleMpvProgress = (data: { currentTime: number; duration: number }) => {
        onProgress({
            currentTime: data.currentTime,
            playableDuration: data.currentTime,
        });
    };

    const handleMpvError = (error: { error: string }) => {
        console.log('[VideoSurface] MPV onError received:', error);
        onError({
            error: {
                errorString: error.error,
            },
        });
    };

    const handleMpvEnd = () => {
        console.log('[VideoSurface] MPV onEnd received');
        onEnd();
    };

    const handleExoLoad = (data: any) => {
        const audioTracks = data.audioTracks?.map((t: any, i: number) => ({
            id: i,
            name: t.title || t.language || `Track ${i + 1}`,
            language: t.language,
        })) ?? [];

        const subtitleTracks = data.textTracks?.map((t: any, i: number) => ({
            id: i,
            name: t.title || t.language || `Track ${i + 1}`,
            language: t.language,
        })) ?? [];

        if (onTracksChanged && (audioTracks.length > 0 || subtitleTracks.length > 0)) {
            onTracksChanged({ audioTracks, subtitleTracks });
        }

        onLoad({
            duration: data.duration,
            naturalSize: data.naturalSize || { width: 1920, height: 1080 },
            audioTracks: data.audioTracks,
            textTracks: data.textTracks,
        });
    };

    const handleExoProgress = (data: any) => {
        onProgress({
            currentTime: data.currentTime,
            playableDuration: data.playableDuration || data.currentTime,
        });
    };

    const handleExoError = (error: any) => {
        // Extract error message from multiple possible paths
        const errorParts: string[] = [];
        if (typeof error?.error === 'string') errorParts.push(error.error);
        if (error?.error?.errorString) errorParts.push(error.error.errorString);
        if (error?.error?.errorCode) errorParts.push(String(error.error.errorCode));
        if (typeof error === 'string') errorParts.push(error);
        if (error?.nativeStackAndroid) errorParts.push(error.nativeStackAndroid.join(' '));
        if (error?.message) errorParts.push(error.message);
        const errorString = errorParts.length > 0 ? errorParts.join(' ') : JSON.stringify(error);

        if (isCodecError(errorString)) {
            logger.warn('[VideoSurface] Codec error → MPV fallback:', errorString);
            onCodecError?.();
            return;
        }

        if (__DEV__ && (errorString.includes('ERROR_CODE_PARSING_MANIFEST_MALFORMED') || errorString.includes('23002'))) {
            probeHlsResponse(streamUrl);
        }

        onError({
            error: {
                errorString: errorString,
            },
        });
    };

    const handleExoBuffer = (data: any) => {
        onBuffer({ isBuffering: data.isBuffering });
    };

    const handleExoEnd = () => {
        console.log('[VideoSurface] ExoPlayer onEnd received');
        onEnd();
    };

    const handleExoSeek = (data: any) => {
        onSeek({ currentTime: data.currentTime });
    };

    const getExoResizeMode = (): ResizeMode => {
        switch (resizeMode) {
            case 'cover':
                return ResizeMode.COVER;
            case 'stretch':
                return ResizeMode.STRETCH;
            case 'contain':
            default:
                return ResizeMode.CONTAIN;
        }
    };

    const getMpvResizeMode = (): 'contain' | 'cover' | 'stretch' => {
        switch (resizeMode) {
            case 'cover':
                return 'cover';
            case 'stretch':
                return 'stretch';
            case 'contain':
            default:
                return 'contain';
        }
    };

    const alphaHex = (opacity01: number) => {
        const a = Math.max(0, Math.min(1, opacity01));
        return Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase();
    };

    return (
        <View style={[styles.videoContainer, {
            width: screenDimensions.width,
            height: screenDimensions.height,
        }]}>
            {useExoPlayer ? (
                /* ExoPlayer via react-native-video */
                <Video
                    ref={exoPlayerRef}
                    source={{
                        uri: streamUrl,
                        headers: exoRequestHeaders,
                        requestHeaders: exoRequestHeadersArray,
                        ...(resolvedRnVideoType ? { type: resolvedRnVideoType } : null),
                        bufferConfig: {
                            minBufferMs: 10000,
                            maxBufferMs: 20000,
                            bufferForPlaybackMs: 2000,
                            bufferForPlaybackAfterRebufferMs: 4000,
                            // @ts-ignore - Extra props supported by patched react-native-video
                            minBufferMemoryReservePercent: 0.15,
                            // @ts-ignore - Extra props supported by patched react-native-video
                            maxHeapAllocationPercent: 0.25,
                        }
                    } as any}
                    paused={paused}
                    volume={volume}
                    rate={playbackSpeed}
                    // @ts-ignore - Prop supported by react-native-video 6.0+
                    bufferingStrategy="DependingOnMemory"
                    resizeMode={getExoResizeMode()}
                    selectedAudioTrack={selectedAudioTrack}
                    selectedTextTrack={selectedTextTrack}
                    style={localStyles.player}
                    onLoad={handleExoLoad}
                    onProgress={handleExoProgress}
                    onEnd={handleExoEnd}
                    onError={handleExoError}
                    onBuffer={handleExoBuffer}
                    onSeek={handleExoSeek}
                    progressUpdateInterval={500}
                    playInBackground={false}
                    playWhenInactive={false}
                    ignoreSilentSwitch="ignore"
                    automaticallyWaitsToMinimizeStalling={true}
                    useTextureView={true}
                    subtitleStyle={{
                        fontSize: subtitleSize ? Math.round(subtitleSize / 1.5) : 28,
                        paddingTop: 0,
                        paddingBottom: Math.max(0, Math.round(subtitleBottomOffset ?? 0)),
                        paddingLeft: 16,
                        paddingRight: 16,
                        opacity: 1,
                        subtitlesFollowVideo: false,
                        textColor: subtitleColor || '#FFFFFFFF',
                        backgroundColor: subtitleBackgroundOpacity && subtitleBackgroundOpacity > 0 ? `#${alphaHex(subtitleBackgroundOpacity)}000000` : '#00000000',
                        edgeType: subtitleBorderSize && subtitleBorderSize > 0 ? 'outline' : (subtitleShadowEnabled ? 'shadow' : 'none'),
                        edgeColor: (subtitleBorderSize && subtitleBorderSize > 0 && subtitleBorderColor) ? subtitleBorderColor : (subtitleShadowEnabled ? '#FF000000' : 'transparent'),
                    } as any}
                />
            ) : (
                /* MPV Player fallback */
                <MpvPlayer
                    ref={mpvPlayerRef}
                    source={streamUrl}
                    headers={headers}
                    paused={paused}
                    volume={volume}
                    rate={playbackSpeed}
                    resizeMode={resizeMode === 'none' ? 'contain' : resizeMode}
                    style={localStyles.player}
                    onLoad={handleMpvLoad}
                    onProgress={handleMpvProgress}
                    onEnd={handleMpvEnd}
                    onError={handleMpvError}
                    onTracksChanged={onTracksChanged}
                    decoderMode={decoderMode}
                    gpuMode={gpuMode}
                    glslShaders={glslShaders}
                    brightness={brightness}
                    contrast={contrast}
                    saturation={saturation}
                    gamma={gamma}
                    hue={hue}
                    subtitleSize={subtitleSize}
                    subtitleColor={subtitleColor}
                    subtitleBackgroundOpacity={subtitleBackgroundOpacity}
                    subtitleBorderSize={subtitleBorderSize}
                    subtitleBorderColor={subtitleBorderColor}
                    subtitleShadowEnabled={subtitleShadowEnabled}
                    subtitlePosition={subtitlePosition}
                    subtitleDelay={subtitleDelay}
                    subtitleAlignment={subtitleAlignment}
                />
            )}

            <PinchGestureHandler
                ref={pinchRef}
                onGestureEvent={onPinchGestureEvent}
                onHandlerStateChange={onPinchHandlerStateChange}
            >
                <View style={localStyles.gestureOverlay} pointerEvents="box-only">
                    <TouchableWithoutFeedback onPress={toggleControls}>
                        <View style={localStyles.touchArea} />
                    </TouchableWithoutFeedback>
                </View>
            </PinchGestureHandler>
        </View>
    );
};

const localStyles = StyleSheet.create({
    player: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    gestureOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    touchArea: {
        flex: 1,
        backgroundColor: 'transparent',
    },
});
