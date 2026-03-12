import React, { memo, useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { LegendList } from '@legendapp/list';
import { LinearGradient } from 'expo-linear-gradient';
import FastImage from '@d11/react-native-fast-image';
import { MaterialIcons } from '@expo/vector-icons';
import { BlurView as ExpoBlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing
} from 'react-native-reanimated';

// Lazy-safe community blur import for Android
let AndroidBlurView: any = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AndroidBlurView = require('@react-native-community/blur').BlurView;
  } catch (_) {
    AndroidBlurView = null;
  }
}

import { Stream } from '../types/metadata';
import { RootStackNavigationProp } from '../navigation/AppNavigator';
import ProviderFilter from './ProviderFilter';
import PulsingChip from './PulsingChip';
import StreamCard from './StreamCard';
import i18n from '../i18n';

interface TabletStreamsLayoutProps {
  // Background and content props
  episodeImage?: string | null;
  bannerImage?: string | null;
  metadata?: any;
  type: string;
  currentEpisode?: any;

  // Movie logo props
  movieLogoError: boolean;
  setMovieLogoError: (error: boolean) => void;

  // Stream-related props
  streamsEmpty: boolean;
  selectedProvider: string;
  filterItems: Array<{ id: string; name: string; }>;
  handleProviderChange: (provider: string) => void;
  activeFetchingScrapers: string[];

  // Loading states
  isAutoplayWaiting: boolean;
  autoplayTriggered: boolean;
  showNoSourcesError: boolean;
  showInitialLoading: boolean;
  showStillFetching: boolean;

  // Stream rendering props
  sections: Array<{ title: string; addonId: string; data: Stream[]; isEmptyDueToQualityFilter?: boolean } | null>;
  renderSectionHeader: ({ section }: { section: { title: string; addonId: string; isEmptyDueToQualityFilter?: boolean } }) => React.ReactElement;
  handleStreamPress: (stream: Stream) => void;
  openAlert: (title: string, message: string) => void;

  // Settings and theme
  settings: any;
  currentTheme: any;
  colors: any;

  // Other props
  navigation: RootStackNavigationProp;
  insets: any;
  streams: any;
  scraperLogos: Record<string, string>;
  id: string;
  imdbId?: string;
  loadingStreams: boolean;
  loadingEpisodeStreams: boolean;
  hasStremioStreamProviders: boolean;
}

const TabletStreamsLayout: React.FC<TabletStreamsLayoutProps> = ({
  episodeImage,
  bannerImage,
  metadata,
  type,
  currentEpisode,
  movieLogoError,
  setMovieLogoError,
  streamsEmpty,
  selectedProvider,
  filterItems,
  handleProviderChange,
  activeFetchingScrapers,
  isAutoplayWaiting,
  autoplayTriggered,
  showNoSourcesError,
  showInitialLoading,
  showStillFetching,
  sections,
  renderSectionHeader,
  handleStreamPress,
  openAlert,
  settings,
  currentTheme,
  colors,
  navigation,
  insets,
  streams,
  scraperLogos,
  id,
  imdbId,
  loadingStreams,
  loadingEpisodeStreams,
  hasStremioStreamProviders,
}) => {
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  // Animation values for backdrop entrance
  const backdropOpacity = useSharedValue(0);
  const backdropScale = useSharedValue(1.05);
  const [backdropLoaded, setBackdropLoaded] = useState(false);
  const [backdropError, setBackdropError] = useState(false);

  // Animation values for content panels
  const leftPanelOpacity = useSharedValue(0);
  const leftPanelTranslateX = useSharedValue(-30);
  const rightPanelOpacity = useSharedValue(0);
  const rightPanelTranslateX = useSharedValue(30);

  // Get the backdrop source - prioritize episode thumbnail, then show backdrop, then poster
  // For episodes without thumbnails, use show's backdrop instead of poster
  const backdropSource = React.useMemo(() => {
    // Debug logging
    if (__DEV__) {
      console.log('[TabletStreamsLayout] Backdrop source selection:', {
        episodeImage,
        bannerImage,
        metadataPoster: metadata?.poster,
        episodeImageIsPoster: episodeImage === metadata?.poster,
        backdropError
      });
    }

    // If episodeImage failed to load, skip it and use backdrop
    if (backdropError && episodeImage && episodeImage !== metadata?.poster) {
      if (__DEV__) console.log('[TabletStreamsLayout] Episode thumbnail failed, falling back to backdrop');
      if (bannerImage) {
        if (__DEV__) console.log('[TabletStreamsLayout] Using show backdrop (episode failed):', bannerImage);
        return { uri: bannerImage };
      }
    }

    // If episodeImage exists and is not the same as poster, use it (real episode thumbnail)
    if (episodeImage && episodeImage !== metadata?.poster && !backdropError) {
      if (__DEV__) console.log('[TabletStreamsLayout] Using episode thumbnail:', episodeImage);
      return { uri: episodeImage };
    }

    // If episodeImage is the same as poster (fallback case), prioritize backdrop
    if (bannerImage) {
      if (__DEV__) console.log('[TabletStreamsLayout] Using show backdrop:', bannerImage);
      return { uri: bannerImage };
    }

    // No fallback to poster images

    if (__DEV__) console.log('[TabletStreamsLayout] No backdrop source found');
    return undefined;
  }, [episodeImage, bannerImage, metadata?.poster, backdropError]);


  useEffect(() => {
    if (backdropSource?.uri && !backdropLoaded && !backdropError) {

      const timeoutId = setTimeout(() => {

        leftPanelOpacity.value = withTiming(1, {
          duration: 600,
          easing: Easing.out(Easing.cubic)
        });
        leftPanelTranslateX.value = withTiming(0, {
          duration: 600,
          easing: Easing.out(Easing.cubic)
        });

        rightPanelOpacity.value = withDelay(200, withTiming(1, {
          duration: 600,
          easing: Easing.out(Easing.cubic)
        }));
        rightPanelTranslateX.value = withDelay(200, withTiming(0, {
          duration: 600,
          easing: Easing.out(Easing.cubic)
        }));
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [backdropSource?.uri, backdropLoaded, backdropError]);


  useEffect(() => {
    if (backdropSource?.uri && backdropLoaded) {
      // Animate backdrop first
      backdropOpacity.value = withTiming(1, {
        duration: 800,
        easing: Easing.out(Easing.cubic)
      });
      backdropScale.value = withTiming(1, {
        duration: 1000,
        easing: Easing.out(Easing.cubic)
      });

      // Animate content panels with delay after backdrop starts loading
      leftPanelOpacity.value = withDelay(300, withTiming(1, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      }));
      leftPanelTranslateX.value = withDelay(300, withTiming(0, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      }));

      rightPanelOpacity.value = withDelay(500, withTiming(1, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      }));
      rightPanelTranslateX.value = withDelay(500, withTiming(0, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      }));
    } else if (!backdropSource?.uri || backdropError) {
      // No backdrop available OR backdrop failed to load - animate content panels immediately
      leftPanelOpacity.value = withTiming(1, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      });
      leftPanelTranslateX.value = withTiming(0, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      });

      rightPanelOpacity.value = withDelay(200, withTiming(1, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      }));
      rightPanelTranslateX.value = withDelay(200, withTiming(0, {
        duration: 600,
        easing: Easing.out(Easing.cubic)
      }));
    }
  }, [backdropSource?.uri, backdropLoaded, backdropError]);

  // Reset animation when episode changes
  useEffect(() => {
    backdropOpacity.value = 0;
    backdropScale.value = 1.05;
    leftPanelOpacity.value = 0;
    leftPanelTranslateX.value = -30;
    rightPanelOpacity.value = 0;
    rightPanelTranslateX.value = 30;
    setBackdropLoaded(false);
    setBackdropError(false);
  }, [episodeImage]);

  // Animated styles for backdrop
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    transform: [{ scale: backdropScale.value }],
  }));

  // Animated styles for content panels
  const leftPanelAnimatedStyle = useAnimatedStyle(() => ({
    opacity: leftPanelOpacity.value,
    transform: [{ translateX: leftPanelTranslateX.value }],
  }));

  const rightPanelAnimatedStyle = useAnimatedStyle(() => ({
    opacity: rightPanelOpacity.value,
    transform: [{ translateX: rightPanelTranslateX.value }],
  }));

  const handleBackdropLoad = () => {
    setBackdropLoaded(true);
  };

  const handleBackdropError = () => {
    if (__DEV__) console.log('[TabletStreamsLayout] Backdrop image failed to load:', backdropSource?.uri);
    setBackdropError(true);
    setBackdropLoaded(false);
  };

  const renderStreamContent = () => {
    if (showNoSourcesError) {
      return (
        <View style={[styles.noStreams, { paddingTop: 50 }]}>
          <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
          <Text style={styles.noStreamsText}>{i18n.t('components.no_streaming_sources')}</Text>
          <Text style={styles.noStreamsSubText}>
            Please add streaming sources in settings
          </Text>
          <TouchableOpacity
            style={styles.addSourcesButton}
            onPress={() => navigation.navigate('Addons')}
          >
            <Text style={styles.addSourcesButtonText}>{i18n.t('components.add_sources')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (streamsEmpty) {
      if (showInitialLoading || showStillFetching || isAutoplayWaiting) {
        return (
          <View style={[styles.loadingContainer, { paddingTop: 50 }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>
              {isAutoplayWaiting ? 'Finding best stream for autoplay...' :
                showStillFetching ? 'Still fetching streams…' :
                  'Finding available streams...'}
            </Text>
          </View>
        );
      } else {
        return (
          <View style={[styles.noStreams, { paddingTop: 50 }]}>
            <MaterialIcons name="error-outline" size={48} color={colors.textMuted} />
            <Text style={styles.noStreamsText}>{i18n.t('components.no_streams')}</Text>
          </View>
        );
      }
    }

    // Flatten sections into a single list with header items
    type ListItem = { type: 'header'; title: string; addonId: string } | { type: 'stream'; stream: Stream; index: number };

    const flatListData: ListItem[] = [];
    sections
      .filter(Boolean)
      .filter(section => section!.data && section!.data.length > 0)
      .forEach(section => {
        flatListData.push({ type: 'header', title: section!.title, addonId: section!.addonId });
        section!.data.forEach((stream, index) => {
          flatListData.push({ type: 'stream', stream, index });
        });
      });

    const renderItem = ({ item }: { item: ListItem }) => {
      if (item.type === 'header') {
        return renderSectionHeader({ section: { title: item.title, addonId: item.addonId } });
      }

      const stream = item.stream;
      return (
        <StreamCard
          stream={stream}
          onPress={() => handleStreamPress(stream)}
          index={item.index}
          isLoading={false}
          statusMessage={undefined}
          theme={currentTheme}
          showLogos={settings.showScraperLogos}
          scraperLogo={(stream.addonId && scraperLogos[stream.addonId]) || (stream as any).addon ? scraperLogos[(stream.addonId || (stream as any).addon) as string] || null : null}
          showAlert={(t: string, m: string) => openAlert(t, m)}
          parentTitle={metadata?.name}
          parentType={type as 'movie' | 'series'}
          parentYear={metadata?.year}
          parentSeason={(type === 'series' || type === 'other') ? currentEpisode?.season_number : undefined}
          parentEpisode={(type === 'series' || type === 'other') ? currentEpisode?.episode_number : undefined}
          parentEpisodeTitle={(type === 'series' || type === 'other') ? currentEpisode?.name : undefined}
          parentPosterUrl={episodeImage || metadata?.poster || undefined}
          providerName={streams && Object.keys(streams).find(pid => (streams as any)[pid]?.streams?.includes?.(stream))}
          parentId={id}
          parentImdbId={imdbId || undefined}
        />
      );
    };

    const keyExtractor = (item: ListItem, index: number) => {
      if (item.type === 'header') {
        return `header-${item.addonId}-${index}`;
      }
      if (item.stream && item.stream.url) {
        return `stream-${item.stream.url}-${index}`;
      }
      return `empty-${index}`;
    };

    const ListFooterComponent = () => {
      if (!(loadingStreams || loadingEpisodeStreams) || !hasStremioStreamProviders) return null;
      return (
        <View style={styles.footerLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.footerLoadingText}>{i18n.t('components.loading_sources')}</Text>
        </View>
      );
    };

    return (
      <LegendList
        data={flatListData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListFooterComponent={ListFooterComponent}
        contentContainerStyle={[
          styles.streamsContainer,
          { paddingBottom: insets.bottom + 100 }
        ]}
        style={styles.streamsContent}
        showsVerticalScrollIndicator={false}
        recycleItems={true}
        estimatedItemSize={78}
      />
    );
  };

  return (
    <View style={styles.tabletLayout}>
      {/* Full Screen Background with Entrance Animation */}
      {backdropSource?.uri ? (
        <Animated.View style={[styles.tabletFullScreenBackground, backdropAnimatedStyle]}>
          <FastImage
            source={backdropSource}
            style={StyleSheet.absoluteFillObject}
            resizeMode={FastImage.resizeMode.cover}
            onLoad={handleBackdropLoad}
            onError={handleBackdropError}
          />
        </Animated.View>
      ) : (
        <View style={styles.tabletFullScreenBackground}>
          <View style={styles.tabletNoBackdropBackground} />
        </View>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.6)']}
        locations={[0, 0.5, 1]}
        style={styles.tabletFullScreenGradient}
      />

      {/* Left Panel: Movie Logo/Episode Info */}
      <Animated.View style={[styles.tabletLeftPanel, leftPanelAnimatedStyle]}>
        {type === 'movie' && metadata ? (
          <View style={styles.tabletMovieLogoContainer}>
            {metadata.logo && !movieLogoError ? (
              <FastImage
                source={{ uri: metadata.logo }}
                style={styles.tabletMovieLogo}
                resizeMode={FastImage.resizeMode.contain}
                onError={() => setMovieLogoError(true)}
              />
            ) : (
              <Text style={styles.tabletMovieTitle}>{metadata.name}</Text>
            )}
          </View>
        ) : type === 'series' && currentEpisode ? (
          <View style={styles.tabletEpisodeInfo}>
            <Text style={[styles.streamsHeroEpisodeNumber, styles.tabletEpisodeText, styles.tabletEpisodeNumber]}>{currentEpisode.episodeString}</Text>
            <Text style={[styles.streamsHeroTitle, styles.tabletEpisodeText, styles.tabletEpisodeTitle]} numberOfLines={2}>{currentEpisode.name}</Text>
            {currentEpisode.overview && (
              <Text style={[styles.streamsHeroOverview, styles.tabletEpisodeText, styles.tabletEpisodeOverview]} numberOfLines={4}>{currentEpisode.overview}</Text>
            )}
          </View>
        ) : (
          <View style={styles.tabletEmptyLeftPanel}>
            <Text style={styles.tabletEmptyLeftPanelText}>{i18n.t('components.no_content_info')}</Text>
          </View>
        )}
      </Animated.View>

      {/* Right Panel: Streams List */}
      <Animated.View style={[styles.tabletRightPanel, rightPanelAnimatedStyle]}>
        {Platform.OS === 'android' && AndroidBlurView ? (
          <View style={[
            styles.streamsMainContent,
            styles.tabletStreamsContent,
            type === 'movie' && styles.streamsMainContentMovie
          ]}>
            <AndroidBlurView
              blurAmount={15}
              blurRadius={8}
              style={styles.androidBlurView}
            >
              <View style={styles.tabletBlurContent}>
                {/* Always show filter container to prevent layout shift */}
                <View style={[styles.filterContainer]}>
                  {!streamsEmpty && (
                    <ProviderFilter
                      selectedProvider={selectedProvider}
                      providers={filterItems}
                      onSelect={handleProviderChange}
                      theme={currentTheme}
                    />
                  )}
                </View>

                {/* Active Scrapers Status */}
                {activeFetchingScrapers.length > 0 && (
                  <View style={styles.activeScrapersContainer}>
                    <Text style={styles.activeScrapersTitle}>{i18n.t('components.fetching_from')}</Text>
                    <View style={styles.activeScrapersRow}>
                      {activeFetchingScrapers.map((scraperName, index) => (
                        <PulsingChip key={scraperName} text={scraperName} delay={index * 200} />
                      ))}
                    </View>
                  </View>
                )}

                {/* Stream content area - always show ScrollView to prevent flash */}
                <View collapsable={false} style={{ flex: 1 }}>
                  {/* Show autoplay loading overlay if waiting for autoplay */}
                  {isAutoplayWaiting && !autoplayTriggered && (
                    <View style={styles.autoplayOverlay}>
                      <View style={styles.autoplayIndicator}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={styles.autoplayText}>{i18n.t('components.starting_best')}</Text>
                      </View>
                    </View>
                  )}

                  {renderStreamContent()}
                </View>
              </View>
            </AndroidBlurView>
          </View>
        ) : (
          <ExpoBlurView
            intensity={80}
            tint="dark"
            style={[
              styles.streamsMainContent,
              styles.tabletStreamsContent,
              type === 'movie' && styles.streamsMainContentMovie
            ]}
          >
            <View style={styles.tabletBlurContent}>
              {/* Always show filter container to prevent layout shift */}
              <View style={[styles.filterContainer]}>
                {!streamsEmpty && (
                  <ProviderFilter
                    selectedProvider={selectedProvider}
                    providers={filterItems}
                    onSelect={handleProviderChange}
                    theme={currentTheme}
                  />
                )}
              </View>

              {/* Active Scrapers Status */}
              {activeFetchingScrapers.length > 0 && (
                <View style={styles.activeScrapersContainer}>
                  <Text style={styles.activeScrapersTitle}>{i18n.t('components.fetching_from')}</Text>
                  <View style={styles.activeScrapersRow}>
                    {activeFetchingScrapers.map((scraperName, index) => (
                      <PulsingChip key={scraperName} text={scraperName} delay={index * 200} />
                    ))}
                  </View>
                </View>
              )}

              {/* Stream content area - always show ScrollView to prevent flash */}
              <View collapsable={false} style={{ flex: 1 }}>
                {/* Show autoplay loading overlay if waiting for autoplay */}
                {isAutoplayWaiting && !autoplayTriggered && (
                  <View style={styles.autoplayOverlay}>
                    <View style={styles.autoplayIndicator}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.autoplayText}>{i18n.t('components.starting_best')}</Text>
                    </View>
                  </View>
                )}

                {renderStreamContent()}
              </View>
            </View>
          </ExpoBlurView>
        )}
      </Animated.View>
    </View>
  );
};

// Create a function to generate styles with the current theme colors
const createStyles = (colors: any) => StyleSheet.create({
  streamsMainContent: {
    flex: 1,
    backgroundColor: colors.darkBackground,
    paddingTop: 12,
    zIndex: 1,
    // iOS-specific fixes for navigation transition glitches
    ...(Platform.OS === 'ios' && {
      // Ensure proper rendering during transitions
      opacity: 1,
      // Prevent iOS optimization that can cause glitches
      shouldRasterizeIOS: false,
    }),
  },
  streamsMainContentMovie: {
    paddingTop: Platform.OS === 'android' ? 10 : 15,
  },
  filterContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  streamsContent: {
    flex: 1,
    width: '100%',
    zIndex: 2,
  },
  streamsContainer: {
    paddingHorizontal: 12,
    paddingBottom: 20,
    width: '100%',
  },
  streamsHeroEpisodeNumber: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  streamsHeroTitle: {
    color: colors.highEmphasis,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  streamsHeroOverview: {
    color: colors.mediumEmphasis,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 2,
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  noStreams: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noStreamsText: {
    color: colors.textMuted,
    fontSize: 16,
    marginTop: 16,
  },
  noStreamsSubText: {
    color: colors.mediumEmphasis,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  addSourcesButton: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  addSourcesButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  loadingText: {
    color: colors.primary,
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '500',
  },
  footerLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  footerLoadingText: {
    color: colors.primary,
    fontSize: 12,
    marginLeft: 8,
    fontWeight: '500',
  },
  activeScrapersContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'transparent',
    marginHorizontal: 16,
    marginBottom: 4,
  },
  activeScrapersTitle: {
    color: colors.mediumEmphasis,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
    opacity: 0.8,
  },
  activeScrapersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  autoplayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 16,
    alignItems: 'center',
    zIndex: 10,
  },
  autoplayIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.elevation2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  autoplayText: {
    color: colors.primary,
    fontSize: 14,
    marginLeft: 8,
    fontWeight: '600',
  },
  // Tablet-specific styles
  tabletLayout: {
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  tabletFullScreenBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  tabletNoBackdropBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.darkBackground,
  },
  tabletFullScreenGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  tabletLeftPanel: {
    width: '40%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 2,
  },
  tabletMovieLogoContainer: {
    width: '80%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabletMovieLogo: {
    width: '100%',
    height: 120,
    marginBottom: 16,
  },
  tabletMovieTitle: {
    color: colors.highEmphasis,
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  tabletEpisodeInfo: {
    width: '80%',
  },
  tabletEpisodeText: {
    textShadowColor: 'rgba(0,0,0,1)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  tabletEpisodeNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  tabletEpisodeTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
    lineHeight: 34,
  },
  tabletEpisodeOverview: {
    fontSize: 16,
    lineHeight: 24,
    opacity: 0.95,
  },
  tabletEmptyLeftPanel: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  tabletEmptyLeftPanelText: {
    color: colors.mediumEmphasis,
    fontSize: 16,
    fontStyle: 'italic',
  },
  tabletRightPanel: {
    width: '60%',
    flex: 1,
    paddingTop: Platform.OS === 'android' ? 60 : 20,
    zIndex: 2,
  },
  tabletStreamsContent: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 24,
    margin: 12,
    overflow: 'hidden', // Ensures content respects rounded corners
  },
  tabletBlurContent: {
    flex: 1,
    padding: 16,
    backgroundColor: 'transparent',
  },
  androidBlurView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default memo(TabletStreamsLayout);
