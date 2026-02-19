import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutRight,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Episode } from '../../../types/metadata';
import { Stream } from '../../../types/streams';
import { stremioService } from '../../../services/stremioService';
import { logger } from '../../../utils/logger';
import {
  estimateNetworkProfile,
  getPlaybackViabilityFromStream,
  rankStreamsByPlaybackViability,
} from '../../../screens/streams/utils';

interface EpisodeStreamsModalProps {
  visible: boolean;
  episode: Episode | null;
  onClose: () => void;
  onSelectStream: (stream: Stream) => void;
  metadata?: { id?: string; name?: string };
}

const QualityBadge = ({ quality }: { quality: string | null | undefined }) => {
  if (!quality) return null;

  const qualityNum = parseInt(quality);
  let color = '#8B5CF6';
  let label = `${quality}p`;

  if (qualityNum >= 2160) {
    color = '#F59E0B';
    label = '4K';
  } else if (qualityNum >= 1080) {
    color = '#3B82F6';
    label = '1080p';
  } else if (qualityNum >= 720) {
    color = '#10B981';
    label = '720p';
  }

  return (
    <View style={{
      backgroundColor: color,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      marginLeft: 8,
    }}>
      <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>{label}</Text>
    </View>
  );
};

export const EpisodeStreamsModal: React.FC<EpisodeStreamsModalProps> = ({
  visible,
  episode,
  onClose,
  onSelectStream,
  metadata,
}) => {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const MENU_WIDTH = Math.min(width * 0.85, 400);

  const [availableStreams, setAvailableStreams] = useState<{ [providerId: string]: { streams: Stream[]; addonName: string } }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasErrors, setHasErrors] = useState<string[]>([]);
  const [networkMbps, setNetworkMbps] = useState(20);

  useEffect(() => {
    if (visible && episode && metadata?.id) {
      fetchStreams();
    } else {
      setAvailableStreams({});
      setIsLoading(false);
      setHasErrors([]);
    }
  }, [visible, episode, metadata?.id]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setNetworkMbps(estimateNetworkProfile(state as any).estimatedDownlinkMbps);
    });

    NetInfo.fetch()
      .then(state => setNetworkMbps(estimateNetworkProfile(state as any).estimatedDownlinkMbps))
      .catch(() => {
        // Keep default profile.
      });

    return () => unsubscribe();
  }, []);

  const fetchStreams = async () => {
    if (!episode || !metadata?.id) return;

    setIsLoading(true);
    setHasErrors([]);
    setAvailableStreams({});

    try {
      const episodeId = episode.stremioId || `${metadata.id}:${episode.season_number}:${episode.episode_number}`;
      let completedProviders = 0;
      const expectedProviders = new Set<string>();
      const respondedProviders = new Set<string>();

      const installedAddons = stremioService.getInstalledAddons();
      const streamAddons = installedAddons.filter((addon: any) =>
        addon.resources && addon.resources.includes('stream')
      );

      streamAddons.forEach((addon: any) => expectedProviders.add(addon.id));

      logger.log(`[EpisodeStreamsModal] Fetching streams for ${episodeId}, expecting ${expectedProviders.size} providers`);

      await stremioService.getStreams('series', episodeId, (streams: any, addonId: any, addonName: any, error: any) => {
        completedProviders++;
        respondedProviders.add(addonId);

        if (error) {
          setHasErrors(prev => [...prev, `${addonName || addonId}: ${error.message || 'Unknown error'}`]);
        } else if (streams && streams.length > 0) {
          setAvailableStreams(prev => ({
            ...prev,
            [addonId]: {
              streams: streams,
              addonName: addonName || addonId
            }
          }));
        }

        if (completedProviders >= expectedProviders.size) {
          setIsLoading(false);
        }
      });

      setTimeout(() => {
        if (respondedProviders.size === 0) {
          setIsLoading(false);
        }
      }, 8000);

    } catch (error) {
      setIsLoading(false);
    }
  };

  const getQualityFromTitle = (title?: string): string | null => {
    if (!title) return null;
    const match = title.match(/(\d+)p/);
    return match ? match[1] : null;
  };

  const sortedProviders = useMemo<Array<[string, { streams: Stream[]; addonName: string }]>>(() => {
    return Object.entries(availableStreams).map(([providerId, providerData]) => [
      providerId,
      {
        ...providerData,
        streams: rankStreamsByPlaybackViability((providerData.streams as any) || [], networkMbps) as any as Stream[],
      },
    ]);
  }, [availableStreams, networkMbps]);

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10000 }]}>
      {/* Backdrop */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
      >
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
        />
      </TouchableOpacity>

      <Animated.View
        entering={SlideInRight.duration(300)}
        exiting={SlideOutRight.duration(250)}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: MENU_WIDTH,
          backgroundColor: '#0f0f0f',
          borderLeftWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
        }}
      >
        {/* Header */}
        <View style={{
          paddingTop: Platform.OS === 'ios' ? 60 : 20,
          paddingHorizontal: 20,
          paddingBottom: 20,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }} numberOfLines={1}>
                {episode?.name || t('player_ui.sources')}
              </Text>
              {episode && (
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>
                  S{episode.season_number} • E{episode.episode_number}
                </Text>
              )}
            </View>
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 40 }}
        >
          {isLoading && sortedProviders.length === 0 && (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator color="white" />
              <Text style={{ color: 'white', marginTop: 15, opacity: 0.6 }}>{t('player_ui.finding_sources')}</Text>
            </View>
          )}

          {sortedProviders.map(([providerId, providerData]) => (
            <View key={providerId} style={{ marginBottom: 20 }}>
              <Text style={{
                color: 'rgba(255, 255, 255, 0.4)',
                fontSize: 12,
                fontWeight: '700',
                marginBottom: 10,
                marginLeft: 5,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}>
                {providerData.addonName}
              </Text>

              <View style={{ gap: 8 }}>
                {providerData.streams.map((stream, index) => {
                  const quality = getQualityFromTitle(stream.title) || stream.quality;
                  const viability = getPlaybackViabilityFromStream(stream as any);

                  return (
                    <TouchableOpacity
                      key={`${providerId}-${index}`}
                      style={{
                        padding: 8,
                        borderRadius: 12,
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.05)'
                      }}
                      onPress={() => {
                        onSelectStream(stream);
                        onClose();
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            <Text style={{ color: 'white', fontWeight: '700', fontSize: 14, flex: 1 }} numberOfLines={1}>
                              {stream.name || t('player_ui.unknown_source')}
                            </Text>
                            {viability?.label ? (
                              <View style={{
                                backgroundColor: 'rgba(255,255,255,0.12)',
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                                marginLeft: 6,
                              }}>
                                <Text style={{ color: 'white', fontSize: 10, fontWeight: '700' }}>
                                  {viability.label.toUpperCase()}
                                </Text>
                              </View>
                            ) : null}
                            <QualityBadge quality={quality} />
                          </View>
                          {stream.title && (
                            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }} numberOfLines={2}>
                              {stream.title}
                            </Text>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          {!isLoading && sortedProviders.length === 0 && (
            <View style={{ padding: 40, alignItems: 'center', opacity: 0.5 }}>
              <MaterialIcons name="cloud-off" size={48} color="white" />
              <Text style={{ color: 'white', marginTop: 16, textAlign: 'center', fontWeight: '600' }}>{t('player_ui.no_sources_found')}</Text>
            </View>
          )}

          {hasErrors.length > 0 && (
            <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, padding: 12, marginTop: 10 }}>
              <Text style={{ color: '#EF4444', fontSize: 11 }}>{t('player_ui.sources_limited')}</Text>
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

export default EpisodeStreamsModal;
