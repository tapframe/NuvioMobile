import React, { useEffect, useMemo, useState } from 'react';
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
import { Stream } from '../../../types/streams';
import {
  estimateNetworkProfile,
  getPlaybackViabilityFromStream,
  rankStreamsByPlaybackViability,
} from '../../../screens/streams/utils';

interface SourcesModalProps {
  showSourcesModal: boolean;
  setShowSourcesModal: (show: boolean) => void;
  availableStreams: { [providerId: string]: { streams: Stream[]; addonName: string } };
  currentStreamUrl: string;
  onSelectStream: (stream: Stream) => void;
  isChangingSource?: boolean;
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

export const SourcesModal: React.FC<SourcesModalProps> = ({
  showSourcesModal,
  setShowSourcesModal,
  availableStreams,
  currentStreamUrl,
  onSelectStream,
  isChangingSource = false,
}) => {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const MENU_WIDTH = Math.min(width * 0.85, 400);
  const [networkMbps, setNetworkMbps] = useState(20);

  const handleClose = () => {
    setShowSourcesModal(false);
  };

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

  const sortedProviders = useMemo<Array<[string, { streams: Stream[]; addonName: string }]>>(() => {
    return Object.entries(availableStreams).map(([providerId, providerData]) => [
      providerId,
      {
        ...providerData,
        streams: rankStreamsByPlaybackViability((providerData.streams as any) || [], networkMbps) as any as Stream[],
      },
    ]);
  }, [availableStreams, networkMbps]);

  const handleStreamSelect = (stream: Stream) => {
    if (stream.url !== currentStreamUrl && !isChangingSource) {
      onSelectStream(stream);
    }
  };

  const getQualityFromTitle = (title?: string): string | null => {
    if (!title) return null;
    const match = title.match(/(\d+)p/);
    return match ? match[1] : null;
  };

  const isStreamSelected = (stream: Stream): boolean => {
    return stream.url === currentStreamUrl;
  };

  if (!showSourcesModal) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10000 }]}>
      {/* Backdrop */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={handleClose}
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
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>
            {t('player_ui.change_source')}
          </Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 40 }}
        >
          {isChangingSource && (
            <View style={{
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              borderRadius: 12,
              padding: 10,
              marginBottom: 15,
              flexDirection: 'row',
              alignItems: 'center',
            }}>
              <ActivityIndicator size="small" color="#22C55E" />
              <Text style={{ color: '#22C55E', fontSize: 14, fontWeight: '600', marginLeft: 10 }}>
                {t('player_ui.switching_source')}
              </Text>
            </View>
          )}

          {sortedProviders.length > 0 ? (
            sortedProviders.map(([providerId, providerData]) => (
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
                  {providerData.addonName} ({providerData.streams.length})
                </Text>

                <View style={{ gap: 8 }}>
                  {providerData.streams.map((stream, index) => {
                    const isSelected = isStreamSelected(stream);
                    const quality = getQualityFromTitle(stream.title) || stream.quality;
                    const viability = getPlaybackViabilityFromStream(stream as any);

                    return (
                      <TouchableOpacity
                        key={`${providerId}-${index}`}
                        style={{
                          padding: 8,
                          borderRadius: 12,
                          backgroundColor: isSelected ? 'white' : 'rgba(255,255,255,0.05)',
                          borderWidth: 1,
                          borderColor: isSelected ? 'white' : 'rgba(255,255,255,0.05)',
                          opacity: (isChangingSource && !isSelected) ? 0.5 : 1,
                        }}
                        onPress={() => handleStreamSelect(stream)}
                        activeOpacity={0.7}
                        disabled={isChangingSource === true}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{
                                color: isSelected ? 'black' : 'white',
                                fontWeight: isSelected ? '700' : '500',
                                fontSize: 14,
                                flex: 1,
                              }} numberOfLines={1}>
                                {stream.title || stream.name || t('player_ui.stream', { number: index + 1 })}
                              </Text>
                              {viability?.label ? (
                                <View style={{
                                  backgroundColor: isSelected ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.12)',
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 4,
                                  marginLeft: 6,
                                }}>
                                  <Text style={{
                                    color: isSelected ? 'black' : 'white',
                                    fontSize: 10,
                                    fontWeight: '700',
                                  }}>
                                    {viability.label.toUpperCase()}
                                  </Text>
                                </View>
                              ) : null}
                              <QualityBadge quality={quality} />
                            </View>

                            {(stream.size || stream.lang) && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                {stream.size && (
                                  <Text style={{
                                    color: isSelected ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
                                    fontSize: 11,
                                  }}>
                                    {(stream.size / (1024 * 1024 * 1024)).toFixed(1)} GB
                                  </Text>
                                )}
                                {stream.lang && (
                                  <Text style={{
                                    color: isSelected ? 'rgba(59, 130, 246, 1)' : 'rgba(59, 130, 246, 0.8)',
                                    fontSize: 11,
                                    fontWeight: '600',
                                  }}>
                                    {stream.lang.toUpperCase()}
                                  </Text>
                                )}
                              </View>
                            )}
                          </View>

                          <View style={{ marginLeft: 12 }}>
                            {isSelected ? (
                              <MaterialIcons name="check" size={20} color="black" />
                            ) : (
                              <MaterialIcons name="play-arrow" size={20} color="rgba(255,255,255,0.3)" />
                            )}
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))
          ) : (
            <View style={{ padding: 40, alignItems: 'center', opacity: 0.5 }}>
              <MaterialIcons name="cloud-off" size={48} color="white" />
              <Text style={{ color: 'white', marginTop: 16, textAlign: 'center', fontWeight: '600' }}>
                {t('player_ui.no_sources_found')}
              </Text>
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

export default SourcesModal;
