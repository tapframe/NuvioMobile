import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useTrailer } from '../../contexts/TrailerContext';
import { logger } from '../../utils/logger';
import TrailerService, { TrailerPlaybackSource } from '../../services/trailerService';
import Video, { VideoRef, OnLoadData, OnProgressData } from 'react-native-video';

const { width, height } = Dimensions.get('window');
const isTablet = width >= 768;

interface TrailerVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  size: number;
  type: string;
  official: boolean;
  published_at: string;
}

interface TrailerModalProps {
  visible: boolean;
  onClose: () => void;
  trailer: TrailerVideo | null;
  contentTitle: string;
}

function isUnsupportedIosMediaFormat(error: any): boolean {
  if (Platform.OS !== 'ios') return false;

  const errorCode = error?.error?.code;
  const errorDomain = error?.error?.domain;
  return errorDomain === 'AVFoundationErrorDomain' && errorCode === -11828;
}

const TrailerModal: React.FC<TrailerModalProps> = memo(({
  visible,
  onClose,
  trailer,
  contentTitle
}) => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const { pauseTrailer, resumeTrailer } = useTrailer();

  // Helper function to format trailer type with translations
  const formatTrailerType = useCallback((type: string): string => {
    switch (type) {
      case 'Trailer':
        return t('trailers.official_trailer');
      case 'Teaser':
        return t('trailers.teaser');
      case 'Clip':
        return t('trailers.clip');
      case 'Featurette':
        return t('trailers.featurette');
      case 'Behind the Scenes':
        return t('trailers.behind_the_scenes');
      default:
        return type;
    }
  }, [t]);

  const videoRef = React.useRef<VideoRef>(null);
  const [playbackSource, setPlaybackSource] = useState<TrailerPlaybackSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Load trailer when modal opens or trailer changes
  useEffect(() => {
    if (visible && trailer) {
      loadTrailer();
    } else {
      // Reset state when modal closes
      setPlaybackSource(null);
      setLoading(false);
      setError(null);
      setIsPlaying(false);
      setRetryCount(0);
    }
  }, [visible, trailer]);

  const loadTrailer = useCallback(async (resetRetryCount = true) => {
    if (!trailer) return;

    // Pause hero section trailer when modal opens
    try {
      pauseTrailer();
      logger.info('TrailerModal', 'Paused hero section trailer');
    } catch (error) {
      logger.warn('TrailerModal', 'Error pausing hero trailer:', error);
    }

    setLoading(true);
    setError(null);
    setPlaybackSource(null);
    if (resetRetryCount) {
      setRetryCount(0);
    }

    try {
      const youtubeUrl = `https://www.youtube.com/watch?v=${trailer.key}`;

      logger.info('TrailerModal', `Loading trailer: ${trailer.name} (${youtubeUrl})`);

      // Use the direct YouTube URL method - much more efficient!
      const source = await TrailerService.getTrailerPlaybackSourceFromYouTubeUrl(
        youtubeUrl,
        `${contentTitle} - ${trailer.name}`,
        new Date(trailer.published_at).getFullYear().toString()
      );

      if (source) {
        setPlaybackSource(source);
        setIsPlaying(true);
        logger.info('TrailerModal', `Successfully loaded direct trailer URL for: ${trailer.name}`);
      } else {
        throw new Error('No streaming URL available');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load trailer';
      setError(errorMessage);
      setLoading(false);
      logger.error('TrailerModal', 'Error loading trailer:', err);

      Alert.alert(
        t('trailers.unavailable'),
        t('trailers.unavailable_desc'),
        [{ text: t('common.ok'), style: 'default' }]
      );
    }
  }, [trailer, contentTitle, pauseTrailer]);

  const handleClose = useCallback(() => {
    setIsPlaying(false);
    
    // Resume hero section trailer when modal closes
    try {
      resumeTrailer();
      logger.info('TrailerModal', 'Resumed hero section trailer');
    } catch (error) {
      logger.warn('TrailerModal', 'Error resuming hero trailer:', error);
    }
    
    onClose();
  }, [onClose, resumeTrailer]);

  const handleTrailerError = useCallback(() => {
    setError('Failed to play trailer');
    setIsPlaying(false);
  }, []);

  // Handle video playback errors with retry logic
  const handleVideoError = useCallback((error: any) => {
    logger.error('TrailerModal', 'Video error:', error);

    if (isUnsupportedIosMediaFormat(error)) {
      logger.error('TrailerModal', 'Unsupported iOS trailer format:', error);
      setError('This trailer format is not supported on iOS.');
      setLoading(false);
      setIsPlaying(false);
      return;
    }

    if (retryCount < 2) {
      logger.info('TrailerModal', `Re-extracting trailer (attempt ${retryCount + 1}/2)`);
      setRetryCount(prev => prev + 1);
      // Invalidate cache so loadTrailer gets a fresh URL, not the same bad one
      if (trailer?.key) TrailerService.invalidateCache(trailer.key);
      loadTrailer(false);
      return;
    }

    logger.error('TrailerModal', 'Video error after retries:', error);
    setError('Unable to play trailer. Please try again.');
    setLoading(false);
  }, [retryCount, loadTrailer, trailer?.key]);

  const handleTrailerEnd = useCallback(() => {
    setIsPlaying(false);
  }, []);

  if (!visible || !trailer) return null;

  const modalHeight = isTablet ? height * 0.8 : height * 0.7;
  const modalWidth = isTablet ? width * 0.8 : width * 0.95;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.overlay}>
        <View style={[styles.modal, {
          width: modalWidth,
          maxHeight: modalHeight,
          backgroundColor: currentTheme.colors.background
        }]}>
          {/* Enhanced Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerTextContainer}>
                <Text
                  style={[styles.title, { color: currentTheme.colors.highEmphasis }]}
                  numberOfLines={2}
                >
                  {trailer.name}
                </Text>
                <View style={styles.headerMeta}>
                  <Text style={[styles.meta, { color: currentTheme.colors.textMuted }]}>
                    {formatTrailerType(trailer.type)} • {new Date(trailer.published_at).getFullYear()}
                  </Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={[styles.closeButton, { backgroundColor: 'rgba(255,255,255,0.1)' }]}
              hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
            >
              <Text style={[styles.closeButtonText, { color: currentTheme.colors.highEmphasis }]}>
                {t('common.close')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Player Container */}
          <View style={styles.playerContainer}>
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={currentTheme.colors.primary} />
                <Text style={[styles.loadingText, { color: currentTheme.colors.textMuted }]}>
                  Loading trailer...
                </Text>
              </View>
            )}

            {error && !loading && (
              <View style={styles.errorContainer}>
                <Text style={[styles.errorText, { color: currentTheme.colors.textMuted }]}>
                  {error}
                </Text>
                <TouchableOpacity
                  style={[styles.retryButton, { backgroundColor: currentTheme.colors.primary }]}
                  onPress={() => {
                    void loadTrailer(true);
                  }}
                >
                  <Text style={styles.retryButtonText}>{t('common.try_again')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Render the Video as soon as we have a URL; keep spinner overlay until onLoad */}
            {playbackSource?.videoUrl && !error && (
              <View style={styles.playerWrapper}>
                <Video
                  ref={videoRef}
                  source={(() => {
                    const lower = playbackSource.videoUrl.toLowerCase();
                    const looksLikeHls = /\.m3u8(\b|$)/.test(lower) || /hls|playlist|m3u/.test(lower);
                    if (Platform.OS === 'android') {
                      const headers = { 'User-Agent': 'Nuvio/1.0 (Android)' };
                      if (looksLikeHls) {
                        return { uri: playbackSource.videoUrl, type: 'm3u8', headers } as any;
                      }
                      return {
                        uri: playbackSource.videoUrl,
                        headers,
                        ...(playbackSource.audioUrl ? { audioUri: playbackSource.audioUrl } : null),
                      } as any;
                    }
                    return {
                      uri: playbackSource.videoUrl,
                      ...(playbackSource.audioUrl ? { audioUri: playbackSource.audioUrl } : null),
                    } as any;
                  })()}
                  style={styles.player}
                  controls={true}
                  paused={!isPlaying}
                  resizeMode="contain"
                  volume={1.0}
                  rate={1.0}
                  playInBackground={false}
                  playWhenInactive={false}
                  ignoreSilentSwitch="ignore"
                  onLoad={(data: OnLoadData) => {
                    logger.info('TrailerModal', 'Trailer loaded successfully', data);
                    setLoading(false);
                    setError(null);
                    setIsPlaying(true);
                  }}
                  onError={handleVideoError}
                  onEnd={() => {
                    logger.info('TrailerModal', 'Trailer ended');
                    handleTrailerEnd();
                  }}
                  onProgress={(data: OnProgressData) => {
                    // Handle progress if needed
                  }}
                  onLoadStart={() => {
                    logger.info('TrailerModal', 'Video load started');
                    setLoading(true);
                  }}
                  onReadyForDisplay={() => {
                    logger.info('TrailerModal', 'Video ready for display');
                  }}
                />
              </View>
            )}
          </View>

          {/* Enhanced Footer */}
          <View style={styles.footer}>
            <View style={styles.footerContent}>
              <Text style={[styles.footerText, { color: currentTheme.colors.textMuted }]}>
                {contentTitle}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },

  // Enhanced Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerLeft: {
    flexDirection: 'row',
    flex: 1,
  },
  headerTextContainer: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
    color: '#fff',
  },
  headerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    fontSize: 12,
    opacity: 0.7,
    fontWeight: '500',
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  playerContainer: {
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    opacity: 0.8,
  },
  errorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20,
    gap: 16,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  playerWrapper: {
    flex: 1,
  },
  player: {
    flex: 1,
  },
  // Enhanced Footer Styles
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  footerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.8,
  },
  footerMeta: {
    alignItems: 'flex-end',
  },
  footerMetaText: {
    fontSize: 11,
    opacity: 0.6,
    fontWeight: '500',
  },
});

export default TrailerModal;
