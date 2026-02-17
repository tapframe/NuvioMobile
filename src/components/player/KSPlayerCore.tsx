import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StatusBar, StyleSheet, Animated, Dimensions, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import axios from 'axios';

// Shared Components
import LoadingOverlay from './modals/LoadingOverlay';
import UpNextButton from './common/UpNextButton';
import { PlayerControls } from './controls/PlayerControls';
import AudioTrackModal from './modals/AudioTrackModal';
import SpeedModal from './modals/SpeedModal';
import { SubmitIntroModal } from './modals/SubmitIntroModal';
import SubtitleModals from './modals/SubtitleModals';
import { SubtitleSyncModal } from './modals/SubtitleSyncModal';
import SourcesModal from './modals/SourcesModal';
import EpisodesModal from './modals/EpisodesModal';
import { EpisodeStreamsModal } from './modals/EpisodeStreamsModal';
import { ErrorModal } from './modals/ErrorModal';
import CustomSubtitles from './subtitles/CustomSubtitles';
import ResumeOverlay from './modals/ResumeOverlay';
import ParentalGuideOverlay from './overlays/ParentalGuideOverlay';
import SkipIntroButton from './overlays/SkipIntroButton';
import { SpeedActivatedOverlay, PauseOverlay, GestureControls } from './components';

// Platform-specific components
import { KSPlayerSurface } from './ios/components/KSPlayerSurface';

import {
  usePlayerState,
  usePlayerModals,
  useSpeedControl,
  useOpeningAnimation,
  usePlayerTracks,
  useCustomSubtitles,
  usePlayerControls,
  usePlayerSetup,
  useWatchProgress,
  useNextEpisode,
  useSkipSegments
} from './hooks';

// Platform-specific hooks
import { useKSPlayer } from './ios/hooks/useKSPlayer';

// App-level Hooks
import { useTraktAutosync } from '../../hooks/useTraktAutosync';
import { useMetadata } from '../../hooks/useMetadata';
import { usePlayerGestureControls } from '../../hooks/usePlayerGestureControls';
import stremioService from '../../services/stremioService';
import { logger } from '../../utils/logger';

// Utils
import { formatTime } from './utils/playerUtils';
import { WyzieSubtitle } from './utils/playerTypes';
import { parseSRT } from './utils/subtitleParser';
import { findBestSubtitleTrack, autoSelectAudioTrack, findBestAudioTrack } from './utils/trackSelectionUtils';
import { useSettings } from '../../hooks/useSettings';
import { useTheme } from '../../contexts/ThemeContext';

// Player route params interface
interface PlayerRouteParams {
  uri: string;
  title: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  quality?: string;
  year?: number;
  streamProvider?: string;
  streamName?: string;
  videoType?: string;
  id: string;
  type: string;
  episodeId?: string;
  imdbId?: string;
  backdrop?: string;
  availableStreams?: { [providerId: string]: { streams: any[]; addonName: string } };
  headers?: Record<string, string>;
  initialPosition?: number;
}

const KSPlayerCore: React.FC = () => {
  // Navigation & Route
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const params = route.params as PlayerRouteParams;

  // Deconstruct params
  const {
    uri, title, episodeTitle, season, episode, id, type, quality, year,
    episodeId, imdbId, backdrop, availableStreams,
    headers, streamProvider, streamName,
    initialPosition: routeInitialPosition
  } = params;

  const videoType = (params as any)?.videoType as string | undefined;

  useEffect(() => {
    if (!__DEV__) return;
    const headerKeys = Object.keys(headers || {});
    logger.log('[KSPlayerCore] route params', {
      uri: typeof uri === 'string' ? uri.slice(0, 240) : uri,
      id,
      type,
      episodeId,
      imdbId,
      title,
      episodeTitle,
      season,
      episode,
      quality,
      year,
      streamProvider,
      streamName,
      videoType,
      headersKeys: headerKeys,
      headersCount: headerKeys.length,
    });
  }, [uri, episodeId]);

  useEffect(() => {
    if (!__DEV__) return;
    const headerKeys = Object.keys(headers || {});
    logger.log('[KSPlayerCore] source update', {
      uri: typeof uri === 'string' ? uri.slice(0, 240) : uri,
      videoType,
      headersCount: headerKeys.length,
      headersKeys: headerKeys,
    });
  }, [uri, headers, videoType]);

  // --- Hooks ---
  const playerState = usePlayerState();
  const {
    paused, setPaused,
    currentTime, setCurrentTime,
    duration, setDuration,
    buffered, setBuffered,
    isBuffering, setIsBuffering,
    isVideoLoaded, setIsVideoLoaded,
    isPlayerReady, setIsPlayerReady,
    showControls, setShowControls,
    resizeMode, setResizeMode,
    screenDimensions, setScreenDimensions,
    zoomScale, setZoomScale,
    lastZoomScale, setLastZoomScale,
    isAirPlayActive,
    allowsAirPlay,
    isSeeking,
    isMounted,
  } = playerState;

  const modals = usePlayerModals();
  const speedControl = useSpeedControl(1.0);

  // Metadata Hook
  const { metadata, groupedEpisodes, cast } = useMetadata({ id, type: type as 'movie' | 'series' });

  // Trakt Autosync
  const traktAutosync = useTraktAutosync({
    type: type as 'movie' | 'series',
    imdbId: imdbId || (id?.startsWith('tt') ? id : ''),
    season,
    episode,
    title,
    id,
    year: year?.toString() || metadata?.year?.toString() || ''
  });

  const openingAnim = useOpeningAnimation(backdrop, metadata);
  const tracks = usePlayerTracks();
  const { ksPlayerRef, seek } = useKSPlayer();
  const customSubs = useCustomSubtitles();
  const { settings } = useSettings();
  const { currentTheme } = useTheme();

  // Subtitle sync modal state
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Track auto-selection refs to prevent duplicate selections
  const hasAutoSelectedTracks = useRef(false);

  // Track previous video session to reset subtitle offset only when video actually changes
  const previousVideoRef = useRef<{ uri?: string; episodeId?: string }>({});

  // Reset subtitle offset when starting a new video session
  useEffect(() => {
    const currentVideo = { uri, episodeId };
    const previousVideo = previousVideoRef.current;

    // Only reset if this is actually a new video (uri or episodeId changed)
    if (previousVideo.uri !== undefined &&
      (previousVideo.uri !== currentVideo.uri || previousVideo.episodeId !== currentVideo.episodeId)) {
      customSubs.setSubtitleOffsetSec(0);
    }

    // Update the ref for next comparison
    previousVideoRef.current = currentVideo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, episodeId]);

  // Next Episode Hook
  const { nextEpisode, currentEpisodeDescription } = useNextEpisode({
    type,
    season,
    episode,
    groupedEpisodes: groupedEpisodes as any,
    episodeId
  });

  const { segments: skipIntervals, outroSegment } = useSkipSegments({
    imdbId: imdbId || (id?.startsWith('tt') ? id : undefined),
    type,
    season,
    episode,
    malId: (metadata as any)?.mal_id || (metadata as any)?.external_ids?.mal_id,
    kitsuId: id?.startsWith('kitsu:') ? id.split(':')[1] : undefined,
    enabled: settings.skipIntroEnabled
  });

  const controls = usePlayerControls({
    playerRef: ksPlayerRef,
    paused,
    setPaused,
    currentTime,
    duration,
    isSeeking,
    isMounted
  });

  const watchProgress = useWatchProgress(
    id, type, episodeId,
    currentTime,
    duration,
    paused,
    traktAutosync,
    controls.seekToTime
  );

  // Gestures
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Controls timeout
  const controlsTimeout = useRef<NodeJS.Timeout | null>(null);
  const hideControls = useCallback(() => {
    // Allow hiding controls even when paused (per user request)
    setShowControls(false);
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, setShowControls]);

  // Volume/Brightness State
  const [volume, setVolumeState] = useState(1.0);
  const [brightness, setBrightnessState] = useState(0.5);
  const [isSliderDragging, setIsSliderDragging] = useState(false);

  // Shared Gesture Hook
  const gestureControls = usePlayerGestureControls({
    volume: volume,
    setVolume: (v) => setVolumeState(v),
    brightness: brightness,
    setBrightness: (b) => setBrightnessState(b),
  });

  // Setup Hook (Listeners, StatusBar, etc)
  usePlayerSetup({
    setScreenDimensions,
    setVolume: setVolumeState,
    setBrightness: setBrightnessState,
    isOpeningAnimationComplete: openingAnim.isOpeningAnimationComplete,
    paused: paused
  });

  // Refs for Logic
  const isSyncingBeforeClose = useRef(false);

  // Toggle controls wrapper
  const toggleControls = useCallback(() => {
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
      controlsTimeout.current = null;
    }
    setShowControls(prev => {
      const next = !prev;
      Animated.timing(fadeAnim, {
        toValue: next ? 1 : 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      // Start auto-hide timer if showing controls and not paused
      if (next && !paused) {
        controlsTimeout.current = setTimeout(hideControls, 5000);
      }
      return next;
    });
  }, [fadeAnim, hideControls, setShowControls, paused]);

  // Auto-hide controls when playback resumes
  useEffect(() => {
    if (showControls && !paused) {
      // Reset auto-hide timer when playback resumes
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
      controlsTimeout.current = setTimeout(hideControls, 5000);
    } else if (paused) {
      // Clear timeout when paused - user controls when to hide
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
        controlsTimeout.current = null;
      }
    }
    return () => {
      if (controlsTimeout.current) {
        clearTimeout(controlsTimeout.current);
      }
    };
  }, [paused, showControls, hideControls]);

  // Subtitle Fetching Logic
  const fetchAvailableSubtitles = async (imdbIdParam?: string, autoSelectEnglish = true) => {
    const targetImdbId = imdbIdParam || imdbId;
    if (!targetImdbId) return;

    customSubs.setIsLoadingSubtitleList(true);
    try {
      const stremioType = type === 'series' ? 'series' : 'movie';
      const stremioVideoId = stremioType === 'series' && season && episode ? `series:${targetImdbId}:${season}:${episode}` : undefined;
      const results = await stremioService.getSubtitles(stremioType, targetImdbId, stremioVideoId);

      const subs: WyzieSubtitle[] = (results || []).map((sub: any) => ({
        id: sub.id || `${sub.lang}-${sub.url}`,
        url: sub.url,
        flagUrl: '',
        format: 'srt',
        encoding: 'utf-8',
        media: sub.addonName || sub.addon || '',
        display: sub.lang || 'Unknown',
        language: (sub.lang || '').toLowerCase(),
        isHearingImpaired: false,
        source: sub.addonName || sub.addon || 'Addon',
      }));

      customSubs.setAvailableSubtitles(subs);
      // Auto-selection is now handled by useEffect that waits for internal tracks
      // This ensures internal tracks are considered before falling back to external
    } catch (e) {
      logger.error('[VideoPlayer] Error fetching subtitles', e);
    } finally {
      customSubs.setIsLoadingSubtitleList(false);
    }
  };

  const loadWyzieSubtitle = async (subtitle: WyzieSubtitle) => {
    modals.setShowSubtitleLanguageModal(false);
    customSubs.setIsLoadingSubtitles(true);
    try {
      let srtContent = '';
      try {
        const resp = await axios.get(subtitle.url, { timeout: 10000 });
        srtContent = typeof resp.data === 'string' ? resp.data : String(resp.data);
      } catch {
        const resp = await fetch(subtitle.url);
        srtContent = await resp.text();
      }
      const parsedCues = parseSRT(srtContent);
      customSubs.setCustomSubtitles(parsedCues);
      customSubs.setUseCustomSubtitles(true);
      customSubs.setSelectedExternalSubtitleId(subtitle.id); // Track the selected external subtitle
      tracks.selectTextTrack(-1);

      const adjustedTime = currentTime + (customSubs.subtitleOffsetSec || 0);
      const cueNow = parsedCues.find(cue => adjustedTime >= cue.start && adjustedTime <= cue.end);
      customSubs.setCurrentSubtitle(cueNow ? cueNow.text : '');

    } catch (e) {
      logger.error('[VideoPlayer] Error loading wyzie', e);
    } finally {
      customSubs.setIsLoadingSubtitles(false);
    }
  };

  // Auto-fetch subtitles on load
  useEffect(() => {
    if (imdbId) {
      fetchAvailableSubtitles(undefined, true);
    }
  }, [imdbId]);

  // Auto-select subtitles when both internal tracks and video are loaded
  // This ensures we wait for internal tracks before falling back to external
  useEffect(() => {
    if (!isVideoLoaded || hasAutoSelectedTracks.current || !settings?.enableSubtitleAutoSelect) {
      return;
    }

    const internalTracks = tracks.ksTextTracks;
    const externalSubs = customSubs.availableSubtitles;

    // Wait a short delay to ensure tracks are fully populated
    const timeoutId = setTimeout(() => {
      if (hasAutoSelectedTracks.current) return;

      const subtitleSelection = findBestSubtitleTrack(
        internalTracks,
        externalSubs,
        {
          preferredSubtitleLanguage: settings?.preferredSubtitleLanguage || 'en',
          subtitleSourcePreference: settings?.subtitleSourcePreference || 'internal',
          enableSubtitleAutoSelect: true
        }
      );

      // Trust the findBestSubtitleTrack function's decision - it already implements priority logic
      if (subtitleSelection.type === 'internal' && subtitleSelection.internalTrackId !== undefined) {
        logger.debug(`[KSPlayerCore] Auto-selecting internal subtitle track ${subtitleSelection.internalTrackId}`);
        tracks.selectTextTrack(subtitleSelection.internalTrackId);
        hasAutoSelectedTracks.current = true;
      } else if (subtitleSelection.type === 'external' && subtitleSelection.externalSubtitle) {
        logger.debug(`[KSPlayerCore] Auto-selecting external subtitle: ${subtitleSelection.externalSubtitle.display}`);
        loadWyzieSubtitle(subtitleSelection.externalSubtitle);
        hasAutoSelectedTracks.current = true;
      }
    }, 500); // Short delay to ensure tracks are populated

    return () => clearTimeout(timeoutId);
  }, [isVideoLoaded, tracks.ksTextTracks, customSubs.availableSubtitles, settings]);

  // Sync custom subtitle text with current playback time
  useEffect(() => {
    if (!customSubs.useCustomSubtitles || customSubs.customSubtitles.length === 0) return;

    const adjustedTime = currentTime + (customSubs.subtitleOffsetSec || 0);
    const cueNow = customSubs.customSubtitles.find(
      cue => adjustedTime >= cue.start && adjustedTime <= cue.end
    );
    const newText = cueNow ? cueNow.text : '';
    // Only update state if the text has changed to avoid unnecessary re-renders
    if (newText !== customSubs.currentSubtitle) {
      customSubs.setCurrentSubtitle(newText);
    }
  }, [currentTime, customSubs.useCustomSubtitles, customSubs.customSubtitles, customSubs.subtitleOffsetSec, customSubs.currentSubtitle]);

  // Handlers
  const onLoad = (data: any) => {
    if (__DEV__) {
      logger.log('[KSPlayerCore] onLoad', {
        uri: typeof uri === 'string' ? uri.slice(0, 240) : uri,
        duration: data?.duration,
        audioTracksCount: Array.isArray(data?.audioTracks) ? data.audioTracks.length : 0,
        textTracksCount: Array.isArray(data?.textTracks) ? data.textTracks.length : 0,
        videoType,
        headersKeys: Object.keys(headers || {}),
      });
    }

    setDuration(data.duration);
    if (data.audioTracks) tracks.setKsAudioTracks(data.audioTracks);
    if (data.textTracks) tracks.setKsTextTracks(data.textTracks);

    setIsVideoLoaded(true);
    setIsPlayerReady(true);
    openingAnim.completeOpeningAnimation();

    // Auto-select audio track based on preferences
    if (data.audioTracks && data.audioTracks.length > 0 && settings?.preferredAudioLanguage) {
      const bestAudioTrack = findBestAudioTrack(data.audioTracks, settings.preferredAudioLanguage);
      if (bestAudioTrack !== null) {
        logger.debug(`[KSPlayerCore] Auto-selecting audio track ${bestAudioTrack} for language: ${settings.preferredAudioLanguage}`);
        tracks.selectAudioTrack(bestAudioTrack);
        if (ksPlayerRef.current) {
          ksPlayerRef.current.setAudioTrack(bestAudioTrack);
        }
      }
    }

    // Auto-select subtitle track based on preferences
    // Only auto-select internal tracks here if preference is 'internal' or 'any'
    // If preference is 'external', we wait for the useEffect to handle selection after external subs load
    if (data.textTracks && data.textTracks.length > 0 && !hasAutoSelectedTracks.current && settings?.enableSubtitleAutoSelect) {
      const sourcePreference = settings?.subtitleSourcePreference || 'internal';

      // Only pre-select internal if preference is internal or any
      if (sourcePreference === 'internal' || sourcePreference === 'any') {
        const subtitleSelection = findBestSubtitleTrack(
          data.textTracks,
          [], // External subtitles not yet loaded
          {
            preferredSubtitleLanguage: settings?.preferredSubtitleLanguage || 'en',
            subtitleSourcePreference: sourcePreference,
            enableSubtitleAutoSelect: true
          }
        );

        if (subtitleSelection.type === 'internal' && subtitleSelection.internalTrackId !== undefined) {
          logger.debug(`[KSPlayerCore] Auto-selecting internal subtitle track ${subtitleSelection.internalTrackId} on load`);
          tracks.selectTextTrack(subtitleSelection.internalTrackId);
          hasAutoSelectedTracks.current = true;
        }
      }
      // If preference is 'external', don't select anything here - useEffect will handle it
    }

    // Initial Seek
    const resumeTarget = routeInitialPosition || watchProgress.initialPosition || watchProgress.initialSeekTargetRef?.current;
    if (resumeTarget && resumeTarget > 0 && !watchProgress.showResumeOverlay && data.duration > 0) {
      setTimeout(() => {
        if (ksPlayerRef.current) {
          logger.debug(`[KSPlayerCore] Auto-resuming to ${resumeTarget}`);
          ksPlayerRef.current.seek(resumeTarget);
        }
      }, 500);
    }

    // Start trakt session
    if (data.duration > 0) {
      traktAutosync.handlePlaybackStart(currentTime, data.duration);
    }
  };

  const handleError = (error: any) => {
    let msg = 'Unknown Error';
    try {
      if (typeof error === 'string') {
        msg = error;
      } else if (error?.error?.localizedDescription) {
        msg = error.error.localizedDescription;
      } else if (error?.error?.message) {
        msg = error.error.message;
      } else if (error?.message) {
        msg = error.message;
      } else if (error?.error) {
        msg = typeof error.error === 'string' ? error.error : JSON.stringify(error.error);
      } else {
        msg = JSON.stringify(error);
      }
    } catch (e) {
      msg = 'Error parsing error details';
    }

    if (__DEV__) {
      logger.error('[KSPlayerCore] onError', {
        msg,
        uri: typeof uri === 'string' ? uri.slice(0, 240) : uri,
        videoType,
        streamProvider,
        streamName,
        headersKeys: Object.keys(headers || {}),
        rawError: error,
      });
    }
    modals.setErrorDetails(msg);
    modals.setShowErrorModal(true);
  };

  const handleClose = useCallback(() => {
    if (isSyncingBeforeClose.current) return;
    isSyncingBeforeClose.current = true;

    // Fire and forget - don't block navigation on async operations
    // The useWatchProgress and useTraktAutosync hooks handle cleanup on unmount
    traktAutosync.handleProgressUpdate(currentTime, duration, true);
    traktAutosync.handlePlaybackEnd(currentTime, duration, 'user_close');

    navigation.goBack();
  }, [navigation, currentTime, duration, traktAutosync]);

  // Track selection handlers - update state, prop change triggers native update
  const handleSelectTextTrack = useCallback((trackId: number) => {
    console.log('[KSPlayerCore] handleSelectTextTrack called with trackId:', trackId);

    // Disable custom subtitles when selecting a built-in track
    // This ensures the textTrack prop is actually passed to the native player
    if (trackId !== -1) {
      customSubs.setUseCustomSubtitles(false);
    }

    // Just update state - the textTrack prop change will trigger native update
    tracks.selectTextTrack(trackId);
  }, [tracks, customSubs]);

  const handleSelectAudioTrack = useCallback((trackId: number) => {
    tracks.selectAudioTrack(trackId);
    if (ksPlayerRef.current) {
      ksPlayerRef.current.setAudioTrack(trackId);
    }
  }, [tracks, ksPlayerRef]);

  // Stream selection handler
  const handleSelectStream = async (newStream: any) => {
    if (newStream.url === uri) {
      modals.setShowSourcesModal(false);
      return;
    }

    if (__DEV__) {
      logger.log('[KSPlayerCore] switching stream', {
        fromUri: typeof uri === 'string' ? uri.slice(0, 240) : uri,
        toUri: typeof newStream?.url === 'string' ? newStream.url.slice(0, 240) : newStream?.url,
        newStreamHeadersKeys: Object.keys(newStream?.headers || {}),
        newProvider: newStream?.addonName || newStream?.name || newStream?.addon || 'Unknown',
        newName: newStream?.name || newStream?.title || 'Unknown',
      });
    }

    modals.setShowSourcesModal(false);
    setPaused(true);

    const newQuality = newStream.quality || newStream.title?.match(/(\d+)p/)?.[0];
    const newProvider = newStream.addonName || newStream.name || newStream.addon || 'Unknown';
    const newStreamName = newStream.name || newStream.title || 'Unknown';

    setTimeout(() => {
      (navigation as any).replace('PlayerIOS', {
        ...params,
        uri: newStream.url,
        quality: newQuality,
        streamProvider: newProvider,
        streamName: newStreamName,
        headers: newStream.headers,
        availableStreams: availableStreams
      });
    }, 100);
  };

  // Episode selection handler - opens streams modal
  const handleSelectEpisode = (ep: any) => {
    modals.setSelectedEpisodeForStreams(ep);
    modals.setShowEpisodesModal(false);
    modals.setShowEpisodeStreamsModal(true);
  };

  // Episode stream selection handler - navigates to new episode with selected stream
  const handleEpisodeStreamSelect = async (stream: any) => {
    if (!modals.selectedEpisodeForStreams) return;
    modals.setShowEpisodeStreamsModal(false);
    setPaused(true);
    const ep = modals.selectedEpisodeForStreams;

    if (__DEV__) {
      logger.log('[KSPlayerCore] switching episode stream', {
        toUri: typeof stream?.url === 'string' ? stream.url.slice(0, 240) : stream?.url,
        streamHeadersKeys: Object.keys(stream?.headers || {}),
        ep: {
          season: ep?.season_number,
          episode: ep?.episode_number,
          name: ep?.name,
          stremioId: ep?.stremioId,
        },
      });
    }

    const newQuality = stream.quality || (stream.title?.match(/(\d+)p/)?.[0]);
    const newProvider = stream.addonName || stream.name || stream.addon || 'Unknown';
    const newStreamName = stream.name || stream.title || 'Unknown Stream';

    setTimeout(() => {
      (navigation as any).replace('PlayerIOS', {
        uri: stream.url,
        title: title,
        episodeTitle: ep.name,
        season: ep.season_number,
        episode: ep.episode_number,
        quality: newQuality,
        year: year,
        streamProvider: newProvider,
        streamName: newStreamName,
        headers: stream.headers || undefined,
        id,
        type: 'series',
        episodeId: ep.stremioId || `${id}:${ep.season_number}:${ep.episode_number} `,
        imdbId: imdbId ?? undefined,
        backdrop: backdrop || undefined,
      });
    }, 100);
  };

  // Slider handlers
  const onSliderValueChange = (value: number) => {
    setCurrentTime(value);
  };

  const onSlidingStart = () => {
    setIsSliderDragging(true);
  };

  const onSlidingComplete = (value: number) => {
    setIsSliderDragging(false);
    controls.seekToTime(value);
  };

  const handleProgress = useCallback((d: any) => {
    if (!isSliderDragging) {
      setCurrentTime(d.currentTime);
    }
    // Only update buffered if it changed by more than 0.5s to reduce re-renders
    const newBuffered = d.buffered || 0;
    setBuffered(prevBuffered => {
      if (Math.abs(newBuffered - prevBuffered) > 0.5) {
        return newBuffered;
      }
      return prevBuffered;
    });
  }, [isSliderDragging, setCurrentTime, setBuffered]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar hidden={true} />

      {/* Opening Animation Overlay */}
      <LoadingOverlay
        visible={!openingAnim.shouldHideOpeningOverlay}
        backdrop={backdrop}
        hasLogo={!!metadata?.logo}
        logo={metadata?.logo}
        backgroundFadeAnim={openingAnim.backgroundFadeAnim}
        backdropImageOpacityAnim={openingAnim.backdropImageOpacityAnim}
        onClose={handleClose}
        width={screenDimensions.width}
        height={screenDimensions.height}
      />

      {/* Video Surface & Pinch Zoom */}
      {/*
        For KSPlayer built-in subtitles (internal text tracks), we intentionally force background OFF.
        Background styling is only supported/used for custom (external/addon) subtitles overlay.
      */}
      <KSPlayerSurface
        ksPlayerRef={ksPlayerRef}
        uri={uri}
        headers={headers}
        paused={paused}
        volume={volume}
        playbackSpeed={speedControl.playbackSpeed}
        resizeMode={resizeMode}
        zoomScale={zoomScale}
        setZoomScale={setZoomScale}
        lastZoomScale={lastZoomScale}
        setLastZoomScale={setLastZoomScale}
        audioTrack={tracks.selectedAudioTrack ?? undefined}
        textTrack={customSubs.useCustomSubtitles ? -1 : tracks.selectedTextTrack}
        onAudioTracks={(d) => tracks.setKsAudioTracks(d.audioTracks || [])}
        onTextTracks={(d) => tracks.setKsTextTracks(d.textTracks || [])}
        onLoad={onLoad}
        onProgress={handleProgress}
        onEnd={async () => {
          setCurrentTime(duration);
          await traktAutosync.handlePlaybackEnd(duration, duration, 'ended');
        }}
        onError={handleError}
        onBuffer={(b) => {
          setIsBuffering(b);
        }}
        onReadyForDisplay={() => setIsPlayerReady(true)}
        onPlaybackStalled={() => {
          setIsBuffering(true);
        }}
        onPlaybackResume={() => {
          setIsBuffering(false);
        }}
        screenWidth={screenDimensions.width}
        screenHeight={screenDimensions.height}
        customVideoStyles={{ width: '100%', height: '100%' }}
        subtitleTextColor={customSubs.subtitleTextColor}
        subtitleBackgroundColor={
          tracks.selectedTextTrack !== null &&
            tracks.selectedTextTrack >= 0 &&
            !customSubs.useCustomSubtitles
            ? 'rgba(0,0,0,0)'
            : (customSubs.subtitleBackground ? `rgba(0,0,0,${customSubs.subtitleBgOpacity})` : 'transparent')
        }
        subtitleOutlineEnabled={
          tracks.selectedTextTrack !== null &&
            tracks.selectedTextTrack >= 0 &&
            !customSubs.useCustomSubtitles
            ? customSubs.subtitleOutline
            : false
        }
        subtitleFontSize={customSubs.subtitleSize}
        subtitleBottomOffset={customSubs.subtitleBottomOffset}
      />

      {/* Custom Subtitles Overlay */}
      <CustomSubtitles
        useCustomSubtitles={customSubs.useCustomSubtitles}
        currentSubtitle={customSubs.currentSubtitle}
        subtitleSize={customSubs.subtitleSize}
        subtitleBackground={customSubs.subtitleBackground}
        zoomScale={zoomScale}
        textColor={customSubs.subtitleTextColor}
        backgroundOpacity={customSubs.subtitleBgOpacity}
        textShadow={customSubs.subtitleTextShadow}
        outline={customSubs.subtitleOutline}
        outlineColor={customSubs.subtitleOutlineColor}
        outlineWidth={customSubs.subtitleOutlineWidth}
        align={customSubs.subtitleAlign}
        bottomOffset={customSubs.subtitleBottomOffset}
        letterSpacing={customSubs.subtitleLetterSpacing}
        lineHeightMultiplier={customSubs.subtitleLineHeightMultiplier}
        formattedSegments={customSubs.currentFormattedSegments}
        controlsVisible={showControls}
        controlsFixedOffset={106}
      />

      {/* Gesture Controls Overlay (Pan/Tap) */}
      <GestureControls
        screenDimensions={screenDimensions}
        gestureControls={gestureControls}
        onLongPressActivated={speedControl.activateSpeedBoost}
        onLongPressEnd={speedControl.deactivateSpeedBoost}
        onLongPressStateChange={() => { }}
        toggleControls={toggleControls}
        showControls={showControls}
        hideControls={hideControls}
        volume={volume}
        brightness={brightness}
        controlsTimeout={controlsTimeout}
        resizeMode={resizeMode}
        skip={controls.skip}
        currentTime={currentTime}
        duration={duration}
        seekToTime={controls.seekToTime}
        formatTime={formatTime}
      />

      {/* UI Controls */}
      {isVideoLoaded && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {/* Buffering Indicator (Visible when controls are hidden) */}
          {isBuffering && !showControls && (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', zIndex: 15 }]}>
              <ActivityIndicator size="large" color="#FFFFFF" />
            </View>
          )}

          <PlayerControls
            showControls={showControls}
            fadeAnim={fadeAnim}
            paused={paused}
            title={title}
            episodeTitle={episodeTitle}
            season={season}
            episode={episode}
            quality={quality}
            year={year}
            streamProvider={streamProvider}
            streamName={streamName}
            currentTime={currentTime}
            duration={duration}
            zoomScale={zoomScale}
            currentResizeMode={resizeMode}
            ksAudioTracks={tracks.ksAudioTracks}
            selectedAudioTrack={tracks.selectedAudioTrack}
            availableStreams={availableStreams}
            togglePlayback={controls.togglePlayback}
            skip={controls.skip}
            handleClose={handleClose}
            cycleAspectRatio={() => {
              gestureControls.showResizeModeOverlayFn(() => {
                setResizeMode(prev => {
                  switch (prev) {
                    case 'contain':
                      return 'cover';
                    case 'cover':
                      return 'stretch';
                    case 'stretch':
                    default:
                      return 'contain';
                  }
                });
              });
            }}
            cyclePlaybackSpeed={() => speedControl.setPlaybackSpeed(speedControl.playbackSpeed >= 2 ? 1 : speedControl.playbackSpeed + 0.25)}
            currentPlaybackSpeed={speedControl.playbackSpeed}
            setShowAudioModal={modals.setShowAudioModal}
            setShowSubtitleModal={modals.setShowSubtitleModal}
            setShowSpeedModal={modals.setShowSpeedModal}
            setShowSubmitIntroModal={modals.setShowSubmitIntroModal}
            isSubtitleModalOpen={modals.showSubtitleModal}
            setShowSourcesModal={modals.setShowSourcesModal}
            setShowEpisodesModal={type === 'series' ? modals.setShowEpisodesModal : undefined}
            onSliderValueChange={onSliderValueChange}
            onSlidingStart={onSlidingStart}
            onSlidingComplete={onSlidingComplete}
            buffered={buffered}
            formatTime={formatTime}
            playerBackend="KSAVPlayer"
            isAirPlayActive={isAirPlayActive}
            allowsAirPlay={allowsAirPlay}
            onAirPlayPress={() => ksPlayerRef.current?.showAirPlayPicker()}
            isBuffering={isBuffering}
            imdbId={imdbId}
          />
        </View>
      )}

      {/* Speed Overlay */}
      <SpeedActivatedOverlay
        visible={speedControl.showSpeedActivatedOverlay}
        opacity={speedControl.speedActivatedOverlayOpacity}
        speed={speedControl.holdToSpeedValue}
        screenDimensions={screenDimensions}
      />

      <ResumeOverlay
        showResumeOverlay={watchProgress.showResumeOverlay}
        resumePosition={watchProgress.resumePosition}
        duration={watchProgress.savedDuration || duration}
        title={title}
        season={season}
        episode={episode}
        handleResume={() => {
          watchProgress.setShowResumeOverlay(false);
          if (watchProgress.resumePosition) controls.seekToTime(watchProgress.resumePosition);
        }}
        handleStartFromBeginning={() => {
          watchProgress.setShowResumeOverlay(false);
          controls.seekToTime(0);
        }}
      />

      {/* Pause Overlay */}
      <PauseOverlay
        visible={paused && !showControls}
        onClose={() => setShowControls(true)}
        title={title}
        episodeTitle={episodeTitle}
        season={season}
        episode={episode}
        year={year}
        type={type}
        description={metadata?.description || ''}
        cast={cast || []}
        screenDimensions={screenDimensions}
      />

      {/* Parental Guide Overlay - Shows after controls first hide */}
      <ParentalGuideOverlay
        imdbId={imdbId || (id?.startsWith('tt') ? id : undefined)}
        type={type as 'movie' | 'series'}
        season={season}
        episode={episode}
        shouldShow={isVideoLoaded && !showControls && !paused}
      />

      {/* Skip Intro Button - Shows during intro section of TV episodes */}
      <SkipIntroButton
        imdbId={imdbId || (id?.startsWith('tt') ? id : undefined)}
        type={type}
        season={season}
        episode={episode}
        malId={(metadata as any)?.mal_id || (metadata as any)?.external_ids?.mal_id}
        kitsuId={id?.startsWith('kitsu:') ? id.split(':')[1] : undefined}
        skipIntervals={skipIntervals}
        currentTime={currentTime}
        onSkip={(endTime) => controls.seekToTime(endTime)}
        controlsVisible={showControls}
        controlsFixedOffset={126}
      />

      {/* Up Next Button */}
      <UpNextButton
        type={type}
        nextEpisode={nextEpisode}
        currentTime={currentTime}
        duration={duration}
        insets={insets}
        isLoading={false}
        nextLoadingProvider={null}
        nextLoadingQuality={null}
        nextLoadingTitle={null}
        onPress={() => {
          if (nextEpisode) {
            logger.log(`[KSPlayerCore] Opening streams for next episode: S${nextEpisode.season_number}E${nextEpisode.episode_number}`);
            modals.setSelectedEpisodeForStreams(nextEpisode);
            modals.setShowEpisodeStreamsModal(true);
          }
        }}
        metadata={metadata ? { poster: metadata.poster, id: metadata.id } : undefined}
        controlsVisible={showControls}
        controlsFixedOffset={126}
        outroSegment={outroSegment}
      />

      {/* Modals */}
      <AudioTrackModal
        showAudioModal={modals.showAudioModal}
        setShowAudioModal={modals.setShowAudioModal}
        ksAudioTracks={tracks.ksAudioTracks}
        selectedAudioTrack={tracks.selectedAudioTrack}
        selectAudioTrack={handleSelectAudioTrack}
      />

      <ErrorModal
        showErrorModal={modals.showErrorModal}
        setShowErrorModal={modals.setShowErrorModal}
        errorDetails={modals.errorDetails}
        onDismiss={handleClose}
      />

      <SpeedModal
        showSpeedModal={modals.showSpeedModal}
        setShowSpeedModal={modals.setShowSpeedModal}
        currentSpeed={speedControl.playbackSpeed}
        setPlaybackSpeed={speedControl.setPlaybackSpeed}
        holdToSpeedEnabled={speedControl.holdToSpeedEnabled}
        setHoldToSpeedEnabled={speedControl.setHoldToSpeedEnabled}
        holdToSpeedValue={speedControl.holdToSpeedValue}
        setHoldToSpeedValue={speedControl.setHoldToSpeedValue}
      />

      <SubmitIntroModal
        visible={modals.showSubmitIntroModal}
        onClose={() => modals.setShowSubmitIntroModal(false)}
        currentTime={currentTime}
        imdbId={imdbId}
        season={season}
        episode={episode}
      />

      <SubtitleModals
        showSubtitleModal={modals.showSubtitleModal}
        setShowSubtitleModal={modals.setShowSubtitleModal}
        showSubtitleLanguageModal={modals.showSubtitleLanguageModal}
        setShowSubtitleLanguageModal={modals.setShowSubtitleLanguageModal}
        customSubtitles={customSubs.customSubtitles}
        availableSubtitles={customSubs.availableSubtitles}
        fetchAvailableSubtitles={fetchAvailableSubtitles}
        loadWyzieSubtitle={loadWyzieSubtitle}
        subtitleSize={customSubs.subtitleSize}
        increaseSubtitleSize={() => customSubs.setSubtitleSize((s: number) => s + 2)}
        decreaseSubtitleSize={() => customSubs.setSubtitleSize((s: number) => Math.max(10, s - 2))}
        subtitleBackground={customSubs.subtitleBackground}
        toggleSubtitleBackground={() => customSubs.setSubtitleBackground((b: boolean) => !b)}
        subtitleTextColor={customSubs.subtitleTextColor}
        setSubtitleTextColor={customSubs.setSubtitleTextColor}
        subtitleBgOpacity={customSubs.subtitleBgOpacity}
        setSubtitleBgOpacity={customSubs.setSubtitleBgOpacity}
        subtitleTextShadow={customSubs.subtitleTextShadow}
        setSubtitleTextShadow={customSubs.setSubtitleTextShadow}
        subtitleOutline={customSubs.subtitleOutline}
        setSubtitleOutline={customSubs.setSubtitleOutline}
        subtitleOutlineColor={customSubs.subtitleOutlineColor}
        setSubtitleOutlineColor={customSubs.setSubtitleOutlineColor}
        subtitleOutlineWidth={customSubs.subtitleOutlineWidth}
        setSubtitleOutlineWidth={customSubs.setSubtitleOutlineWidth}
        subtitleAlign={customSubs.subtitleAlign}
        setSubtitleAlign={customSubs.setSubtitleAlign}
        subtitleBottomOffset={customSubs.subtitleBottomOffset}
        setSubtitleBottomOffset={customSubs.setSubtitleBottomOffset}
        subtitleLetterSpacing={customSubs.subtitleLetterSpacing}
        setSubtitleLetterSpacing={customSubs.setSubtitleLetterSpacing}
        subtitleLineHeightMultiplier={customSubs.subtitleLineHeightMultiplier}
        setSubtitleLineHeightMultiplier={customSubs.setSubtitleLineHeightMultiplier}
        subtitleOffsetSec={customSubs.subtitleOffsetSec}
        setSubtitleOffsetSec={customSubs.setSubtitleOffsetSec}
        isLoadingSubtitleList={customSubs.isLoadingSubtitleList}
        isLoadingSubtitles={customSubs.isLoadingSubtitles}
        ksTextTracks={tracks.ksTextTracks}
        selectedTextTrack={tracks.selectedTextTrack !== null ? tracks.selectedTextTrack : -1}
        useCustomSubtitles={customSubs.useCustomSubtitles}
        selectTextTrack={handleSelectTextTrack}
        disableCustomSubtitles={() => {
          customSubs.setUseCustomSubtitles(false);
          customSubs.setSelectedExternalSubtitleId(null); // Clear external selection
          handleSelectTextTrack(-1);
        }}
        selectedExternalSubtitleId={customSubs.selectedExternalSubtitleId}
        onOpenSyncModal={() => setShowSyncModal(true)}
      />

      {/* Visual Subtitle Sync Modal */}
      <SubtitleSyncModal
        visible={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        onConfirm={(offset) => customSubs.setSubtitleOffsetSec(offset)}
        currentOffset={customSubs.subtitleOffsetSec}
        currentTime={currentTime}
        subtitles={customSubs.customSubtitles}
        primaryColor={currentTheme.colors.primary}
      />

      <SourcesModal
        showSourcesModal={modals.showSourcesModal}
        setShowSourcesModal={modals.setShowSourcesModal}
        availableStreams={availableStreams || {}}
        currentStreamUrl={uri}
        onSelectStream={handleSelectStream}
      />

      {type === 'series' && (
        <EpisodesModal
          showEpisodesModal={modals.showEpisodesModal}
          setShowEpisodesModal={modals.setShowEpisodesModal}
          groupedEpisodes={groupedEpisodes}
          currentEpisode={{ season: season || 1, episode: episode || 1 }}
          metadata={{ poster: metadata?.poster, id: id }}
          onSelectEpisode={handleSelectEpisode}
        />
      )}

      <EpisodeStreamsModal
        visible={modals.showEpisodeStreamsModal}
        onClose={() => modals.setShowEpisodeStreamsModal(false)}
        episode={modals.selectedEpisodeForStreams}
        onSelectStream={handleEpisodeStreamSelect}
        metadata={{ id: id, name: title }}
      />
    </View>
  );
};

export default KSPlayerCore;
