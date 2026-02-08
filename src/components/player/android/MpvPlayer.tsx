import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { View, StyleSheet, requireNativeComponent, Platform, UIManager, findNodeHandle } from 'react-native';

// Only available on Android
const MpvPlayerNative = Platform.OS === 'android'
    ? requireNativeComponent<any>('MpvPlayer')
    : null;

export interface MpvPlayerRef {
    seek: (positionSeconds: number) => void;
    setAudioTrack: (trackId: number) => void;
    setSubtitleTrack: (trackId: number) => void;
    setResizeMode: (mode: 'contain' | 'cover' | 'stretch') => void;
}

export interface MpvPlayerProps {
    source: string;
    headers?: { [key: string]: string };
    paused?: boolean;
    volume?: number;
    rate?: number;
    resizeMode?: 'contain' | 'cover' | 'stretch';
    style?: any;
    onLoad?: (data: { duration: number; width: number; height: number }) => void;
    onProgress?: (data: { currentTime: number; duration: number }) => void;
    onEnd?: () => void;
    onError?: (error: { error: string }) => void;
    onTracksChanged?: (data: { audioTracks: any[]; subtitleTracks: any[] }) => void;
    decoderMode?: 'auto' | 'sw' | 'hw' | 'hw+';
    gpuMode?: 'gpu' | 'gpu-next';
    glslShaders?: string;
    // Video EQ Props
    brightness?: number;
    contrast?: number;
    saturation?: number;
    gamma?: number;
    hue?: number;
    // Subtitle Styling
    subtitleSize?: number;
    subtitleColor?: string;
    subtitleBackgroundOpacity?: number;
    subtitleBorderSize?: number;
    subtitleBorderColor?: string;
    subtitleShadowEnabled?: boolean;
    subtitlePosition?: number;
    subtitleDelay?: number;
    subtitleAlignment?: 'left' | 'center' | 'right';
}

const MpvPlayer = forwardRef<MpvPlayerRef, MpvPlayerProps>((props, ref) => {
    const nativeRef = useRef<any>(null);

    const dispatchCommand = useCallback((commandName: string, args: any[] = []) => {
        if (nativeRef.current && Platform.OS === 'android') {
            const handle = findNodeHandle(nativeRef.current);
            if (handle) {
                UIManager.dispatchViewManagerCommand(
                    handle,
                    commandName,
                    args
                );
            }
        }
    }, []);

    useImperativeHandle(ref, () => ({
        seek: (positionSeconds: number) => {
            dispatchCommand('seek', [positionSeconds]);
        },
        setAudioTrack: (trackId: number) => {
            dispatchCommand('setAudioTrack', [trackId]);
        },
        setSubtitleTrack: (trackId: number) => {
            dispatchCommand('setSubtitleTrack', [trackId]);
        },
        setResizeMode: (mode: 'contain' | 'cover' | 'stretch') => {
            dispatchCommand('setResizeMode', [mode]);
        },
    }), [dispatchCommand]);

    if (Platform.OS !== 'android' || !MpvPlayerNative) {
        // Fallback for iOS or if native component is not available
        return (
            <View style={[styles.container, props.style, { backgroundColor: 'black' }]} />
        );
    }

    // Debug logging removed to prevent console spam

    const handleLoad = (event: any) => {
        console.log('[MpvPlayer] Native onLoad event:', event?.nativeEvent);
        props.onLoad?.(event?.nativeEvent);
    };

    const handleProgress = (event: any) => {
        props.onProgress?.(event?.nativeEvent);
    };

    const handleEnd = (event: any) => {
        console.log('[MpvPlayer] Native onEnd event');
        props.onEnd?.();
    };

    const handleError = (event: any) => {
        console.log('[MpvPlayer] Native onError event:', event?.nativeEvent);
        props.onError?.(event?.nativeEvent);
    };

    const handleTracksChanged = (event: any) => {
        console.log('[MpvPlayer] Native onTracksChanged event:', event?.nativeEvent);
        props.onTracksChanged?.(event?.nativeEvent);
    };

    return (
        <MpvPlayerNative
            ref={nativeRef}
            style={[styles.container, props.style]}
            source={props.source}
            headers={props.headers}
            paused={props.paused ?? true}
            volume={props.volume ?? 1.0}
            rate={props.rate ?? 1.0}
            resizeMode={props.resizeMode ?? 'contain'}
            onLoad={handleLoad}
            onProgress={handleProgress}
            onEnd={handleEnd}
            onError={handleError}
            onTracksChanged={handleTracksChanged}
            decoderMode={props.decoderMode ?? 'auto'}
            gpuMode={props.gpuMode ?? 'gpu'}
            glslShaders={props.glslShaders}
            brightness={props.brightness ?? 0}
            contrast={props.contrast ?? 0}
            saturation={props.saturation ?? 0}
            gamma={props.gamma ?? 0}
            hue={props.hue ?? 0}
            // Subtitle Styling
            subtitleSize={props.subtitleSize ?? 48}
            subtitleColor={props.subtitleColor ?? '#FFFFFF'}
            subtitleBackgroundOpacity={props.subtitleBackgroundOpacity ?? 0}
            subtitleBorderSize={props.subtitleBorderSize ?? 3}
            subtitleBorderColor={props.subtitleBorderColor ?? '#000000'}
            subtitleShadowEnabled={props.subtitleShadowEnabled ?? true}
            subtitlePosition={props.subtitlePosition ?? 100}
            subtitleDelay={props.subtitleDelay ?? 0}
            subtitleAlignment={props.subtitleAlignment ?? 'center'}
        />
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'black',
    },
});

MpvPlayer.displayName = 'MpvPlayer';

export default MpvPlayer;
