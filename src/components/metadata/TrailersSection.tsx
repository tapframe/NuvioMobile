import React, { useState, useEffect, useCallback, memo, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
  Platform,
  ScrollView,
  Modal,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import FastImage from '@d11/react-native-fast-image';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettings } from '../../hooks/useSettings';
import { useTrailer } from '../../contexts/TrailerContext';
import { logger } from '../../utils/logger';
import TrailerService from '../../services/trailerService';
import { TMDBService } from '../../services/tmdbService';
import TrailerModal from './TrailerModal';
import Animated, { useSharedValue, withTiming, withDelay, useAnimatedStyle } from 'react-native-reanimated';

// Enhanced responsive breakpoints for Trailers Section
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

interface TrailerVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  size: number;
  type: string;
  official: boolean;
  published_at: string;
  seasonNumber: number | null;
  displayName?: string;
}

interface TrailersSectionProps {
  tmdbId: number | null;
  type: 'movie' | 'tv';
  contentId: string;
  contentTitle: string;
}

interface CategorizedTrailers {
  [key: string]: TrailerVideo[];
}

const TrailersSection: React.FC<TrailersSectionProps> = memo(({
  tmdbId,
  type,
  contentId,
  contentTitle
}) => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const { settings } = useSettings();
  const { pauseTrailer } = useTrailer();
  const [trailers, setTrailers] = useState<CategorizedTrailers>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrailer, setSelectedTrailer] = useState<TrailerVideo | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('Trailer');
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);

  // Enhanced responsive sizing for tablets and TV screens
  const deviceWidth = Dimensions.get('window').width;
  const deviceHeight = Dimensions.get('window').height;

  // Determine device type based on width
  const getDeviceType = useCallback(() => {
    if (deviceWidth >= BREAKPOINTS.tv) return 'tv';
    if (deviceWidth >= BREAKPOINTS.largeTablet) return 'largeTablet';
    if (deviceWidth >= BREAKPOINTS.tablet) return 'tablet';
    return 'phone';
  }, [deviceWidth]);

  const deviceType = getDeviceType();
  const isTablet = deviceType === 'tablet';
  const isLargeTablet = deviceType === 'largeTablet';
  const isTV = deviceType === 'tv';
  const isLargeScreen = isTablet || isLargeTablet || isTV;

  // Enhanced spacing and padding
  const horizontalPadding = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 32;
      case 'largeTablet':
        return 28;
      case 'tablet':
        return 24;
      default:
        return 16; // phone
    }
  }, [deviceType]);

  // Enhanced trailer card sizing
  const trailerCardWidth = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 280;
      case 'largeTablet':
        return 260;
      case 'tablet':
        return 240;
      default:
        return 200; // phone
    }
  }, [deviceType]);

  const trailerCardSpacing = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 16;
      case 'largeTablet':
        return 14;
      case 'tablet':
        return 12;
      default:
        return 12; // phone
    }
  }, [deviceType]);

  // Smooth reveal animation after trailers are fetched
  const sectionOpacitySV = useSharedValue(0);
  const sectionTranslateYSV = useSharedValue(8);
  const hasAnimatedRef = useRef(false);

  const sectionAnimatedStyle = useAnimatedStyle(() => ({
    opacity: sectionOpacitySV.value,
    transform: [{ translateY: sectionTranslateYSV.value }],
  }));

  // Reset animation state before a new fetch starts
  const resetSectionAnimation = useCallback(() => {
    hasAnimatedRef.current = false;
    sectionOpacitySV.value = 0;
    sectionTranslateYSV.value = 8;
  }, [sectionOpacitySV, sectionTranslateYSV]);

  // Trigger animation once, 500ms after trailers are available
  const triggerSectionAnimation = useCallback(() => {
    if (hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;
    sectionOpacitySV.value = withDelay(500, withTiming(1, { duration: 400 }));
    sectionTranslateYSV.value = withDelay(500, withTiming(0, { duration: 400 }));
  }, [sectionOpacitySV, sectionTranslateYSV]);


  // Fetch trailers from TMDB
  useEffect(() => {
    if (!tmdbId) return;

    const initializeTrailers = async () => {
      resetSectionAnimation();
      setBackendAvailable(true); // Assume available, let TrailerService handle errors
      await fetchTrailers();
    };

    const fetchTrailers = async () => {
      setLoading(true);
      setError(null);

      try {
        logger.info('TrailersSection', `Fetching trailers for TMDB ID: ${tmdbId}, type: ${type}`);

        // Resolve user-configured TMDB API key (falls back to default if not set)
        const tmdbApiKey = await TMDBService.getInstance().getApiKey();

        // First check if the movie/TV show exists
        const basicEndpoint = type === 'movie'
          ? `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}`
          : `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbApiKey}`;

        const basicResponse = await fetch(basicEndpoint);
        if (!basicResponse.ok) {
          if (basicResponse.status === 404) {
            // 404 on basic endpoint means TMDB ID doesn't exist - this is normal
            logger.info('TrailersSection', `TMDB ID ${tmdbId} not found in TMDB (404) - skipping trailers`);
            setTrailers({}); // Empty trailers - section won't render
            return;
          }
          logger.error('TrailersSection', `TMDB basic endpoint failed: ${basicResponse.status} ${basicResponse.statusText}`);
          setError(`Failed to verify content: ${basicResponse.status}`);
          return;
        }

        let allVideos: any[] = [];

        if (type === 'movie') {
          // For movies, just fetch the main videos endpoint
          const videosEndpoint = `https://api.themoviedb.org/3/movie/${tmdbId}/videos?api_key=${tmdbApiKey}`;

          logger.info('TrailersSection', `Fetching movie videos from: ${videosEndpoint}`);

          const response = await fetch(videosEndpoint);
          if (!response.ok) {
            // 404 is normal - means no videos exist for this content
            if (response.status === 404) {
              logger.info('TrailersSection', `No videos found for movie TMDB ID ${tmdbId} (404 response)`);
              setTrailers({}); // Empty trailers - section won't render
              return;
            }
            logger.error('TrailersSection', `Videos endpoint failed: ${response.status} ${response.statusText}`);
            throw new Error(`Failed to fetch trailers: ${response.status}`);
          }

          const data = await response.json();
          allVideos = data.results || [];
          logger.info('TrailersSection', `Received ${allVideos.length} videos for movie TMDB ID ${tmdbId}`);
        } else {
          // For TV shows, fetch both main TV videos and season-specific videos
          logger.info('TrailersSection', `Fetching TV show videos and season trailers for TMDB ID ${tmdbId}`);

          // Get TV show details to know how many seasons there are
          const tvDetailsResponse = await fetch(basicEndpoint);
          const tvDetails = await tvDetailsResponse.json();
          const numberOfSeasons = tvDetails.number_of_seasons || 0;

          logger.info('TrailersSection', `TV show has ${numberOfSeasons} seasons`);

          // Fetch main TV show videos
          const tvVideosEndpoint = `https://api.themoviedb.org/3/tv/${tmdbId}/videos?api_key=${tmdbApiKey}`;
          const tvResponse = await fetch(tvVideosEndpoint);

          if (tvResponse.ok) {
            const tvData = await tvResponse.json();
            // Add season info to main TV videos
            const mainVideos = (tvData.results || []).map((video: any) => ({
              ...video,
              seasonNumber: null as number | null, // null indicates main TV show videos
              displayName: video.name
            }));
            allVideos.push(...mainVideos);
            logger.info('TrailersSection', `Received ${mainVideos.length} main TV videos`);
          }

          // Fetch videos from each season (skip season 0 which is specials)
          const seasonPromises = [];
          for (let seasonNum = 1; seasonNum <= numberOfSeasons; seasonNum++) {
            seasonPromises.push(
              fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}/videos?api_key=${tmdbApiKey}`)
                .then(res => res.json())
                .then(data => ({
                  seasonNumber: seasonNum,
                  videos: data.results || []
                }))
                .catch(err => {
                  logger.warn('TrailersSection', `Failed to fetch season ${seasonNum} videos:`, err);
                  return { seasonNumber: seasonNum, videos: [] };
                })
            );
          }

          const seasonResults = await Promise.all(seasonPromises);

          // Add season videos to the collection
          seasonResults.forEach(result => {
            if (result.videos.length > 0) {
              const seasonVideos = result.videos.map((video: any) => ({
                ...video,
                seasonNumber: result.seasonNumber as number | null,
                displayName: `Season ${result.seasonNumber} - ${video.name}`
              }));
              allVideos.push(...seasonVideos);
              logger.info('TrailersSection', `Season ${result.seasonNumber}: ${result.videos.length} videos`);
            }
          });

          const totalSeasonVideos = seasonResults.reduce((sum, result) => sum + result.videos.length, 0);
          logger.info('TrailersSection', `Total videos collected: ${allVideos.length} (main: ${allVideos.filter(v => v.seasonNumber === null).length}, seasons: ${totalSeasonVideos})`);
        }

        const categorized = categorizeTrailers(allVideos);
        const totalVideos = Object.values(categorized).reduce((sum, videos) => sum + videos.length, 0);

        if (totalVideos === 0) {
          logger.info('TrailersSection', `No videos found for TMDB ID ${tmdbId} - this is normal`);
          setTrailers({}); // No trailers available
          setSelectedCategory(''); // No category selected
        } else {
          logger.info('TrailersSection', `Categorized ${totalVideos} videos into ${Object.keys(categorized).length} categories`);
          setTrailers(categorized);
          // Trigger smooth reveal after 1.5s since we have content
          triggerSectionAnimation();

          // Auto-select the first available category, preferring "Trailer"
          const availableCategories = Object.keys(categorized);
          const preferredCategory = availableCategories.includes('Trailer') ? 'Trailer' :
            availableCategories.includes('Teaser') ? 'Teaser' : availableCategories[0];
          setSelectedCategory(preferredCategory);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load trailers';
        setError(errorMessage);
        logger.error('TrailersSection', 'Error fetching trailers:', err);
      } finally {
        setLoading(false);
      }
    };

    initializeTrailers();
  }, [tmdbId, type]);

  // Categorize trailers by type
  const categorizeTrailers = (videos: any[]): CategorizedTrailers => {
    const categories: CategorizedTrailers = {};

    videos.forEach(video => {
      if (video.site !== 'YouTube') return; // Only YouTube videos

      const category = video.type;
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(video);
    });

    // Sort within each category: season trailers first (newest seasons), then main series, official first, then by date
    Object.keys(categories).forEach(category => {
      categories[category].sort((a, b) => {
        // Season trailers come before main series trailers
        if (a.seasonNumber !== null && b.seasonNumber === null) return -1;
        if (a.seasonNumber === null && b.seasonNumber !== null) return 1;

        // If both have season numbers, sort by season number (newest seasons first)
        if (a.seasonNumber !== null && b.seasonNumber !== null) {
          if (a.seasonNumber !== b.seasonNumber) {
            return b.seasonNumber - a.seasonNumber; // Higher season numbers first
          }
        }

        // Official trailers come first within the same season/main series group
        if (a.official && !b.official) return -1;
        if (!a.official && b.official) return 1;

        // If both are official or both are not, sort by published date (newest first)
        return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
      });
    });

    // Sort categories: "Trailer" category first, then categories with official trailers, then alphabetically
    const sortedCategories = Object.keys(categories).sort((a, b) => {
      // "Trailer" category always comes first
      if (a === 'Trailer') return -1;
      if (b === 'Trailer') return 1;

      const aHasOfficial = categories[a].some(trailer => trailer.official);
      const bHasOfficial = categories[b].some(trailer => trailer.official);

      // Categories with official trailers come first (after Trailer)
      if (aHasOfficial && !bHasOfficial) return -1;
      if (!aHasOfficial && bHasOfficial) return 1;

      // If both have or don't have official trailers, sort alphabetically
      return a.localeCompare(b);
    });

    // Create new object with sorted categories
    const sortedCategoriesObj: CategorizedTrailers = {};
    sortedCategories.forEach(category => {
      sortedCategoriesObj[category] = categories[category];
    });

    return sortedCategoriesObj;
  };

  // Handle trailer selection
  const handleTrailerPress = (trailer: TrailerVideo) => {
    // Pause hero section trailer when modal opens
    try {
      pauseTrailer();
    } catch (error) {
      logger.warn('TrailersSection', 'Error pausing hero trailer:', error);
    }

    setSelectedTrailer(trailer);
    setModalVisible(true);
  };

  // Handle modal close
  const handleModalClose = () => {
    setModalVisible(false);
    setSelectedTrailer(null);
    // Note: Hero trailer will resume automatically when modal closes
    // The HeroSection component handles resuming based on scroll position
  };

  // Handle category selection
  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setDropdownVisible(false);
  };

  // Toggle dropdown
  const toggleDropdown = () => {
    setDropdownVisible(!dropdownVisible);
  };

  // Get thumbnail URL for YouTube video
  const getYouTubeThumbnail = (videoId: string, quality: 'default' | 'hq' | 'maxres' = 'hq') => {
    const qualities = {
      default: `https://img.youtube.com/vi/${videoId}/default.jpg`,
      hq: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      maxres: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    };
    return qualities[quality];
  };

  // Format trailer type for display
  const formatTrailerType = useCallback((type: string): string => {
    switch (type) {
      case 'Trailer':
        return t('trailers.official_trailers');
      case 'Teaser':
        return t('trailers.teasers');
      case 'Clip':
        return t('trailers.clips_scenes');
      case 'Featurette':
        return t('trailers.featurettes');
      case 'Behind the Scenes':
        return t('trailers.behind_the_scenes');
      default:
        return type;
    }
  }, [t]);

  // Get icon for trailer type
  const getTrailerTypeIcon = (type: string): string => {
    switch (type) {
      case 'Trailer':
        return 'movie';
      case 'Teaser':
        return 'videocam';
      case 'Clip':
        return 'content-cut';
      case 'Featurette':
        return 'featured-video';
      case 'Behind the Scenes':
        return 'camera';
      default:
        return 'play-circle-outline';
    }
  };

  if (!tmdbId) {
    return null; // Don't show if no TMDB ID
  }

  // Don't render if backend availability is still being checked or backend is unavailable
  if (backendAvailable === null || backendAvailable === false) {
    return null;
  }

  // Don't render if TMDB enrichment is disabled
  if (!settings?.enrichMetadataWithTMDB) {
    return null;
  }

  if (loading) {
    return null;
  }

  if (error) {
    return null;
  }

  const trailerCategories = Object.keys(trailers);
  const totalVideos = Object.values(trailers).reduce((sum, videos) => sum + videos.length, 0);

  // Don't show section if no trailers (this is normal for many movies/TV shows)
  if (trailerCategories.length === 0 || totalVideos === 0) {
    // In development, show a subtle indicator that the section checked but found no trailers
    if (__DEV__) {
      return (
        <View style={styles.container}>
          <View style={styles.header}>
            <MaterialIcons name="movie" size={20} color={currentTheme.colors.primary} />
            <Text style={[styles.headerTitle, { color: currentTheme.colors.highEmphasis }]}>
              {t('trailers.title')}
            </Text>
          </View>
          <View style={styles.noTrailersContainer}>
            <Text style={[styles.noTrailersText, { color: currentTheme.colors.textMuted }]}>
              {t('trailers.no_trailers')}
            </Text>
          </View>
        </View>
      );
    }
    return null;
  }

  return (
    <Animated.View style={[
      styles.container,
      sectionAnimatedStyle,
      { paddingHorizontal: horizontalPadding }
    ]}>
      {/* Enhanced Header with Category Selector */}
      <View style={styles.header}>
        <Text style={[
          styles.headerTitle,
          {
            color: currentTheme.colors.highEmphasis,
            fontSize: isTV ? 28 : isLargeTablet ? 26 : isTablet ? 24 : 20
          }
        ]}>
          {t('trailers.title')}
        </Text>

        {/* Category Selector - Right Aligned */}
        {trailerCategories.length > 0 && selectedCategory && (
          <TouchableOpacity
            style={[
              styles.categorySelector,
              {
                borderColor: 'rgba(255,255,255,0.6)',
                paddingHorizontal: isTV ? 14 : isLargeTablet ? 12 : isTablet ? 10 : 10,
                paddingVertical: isTV ? 8 : isLargeTablet ? 6 : isTablet ? 5 : 5,
                borderRadius: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16,
                maxWidth: isTV ? 200 : isLargeTablet ? 180 : isTablet ? 160 : 160
              }
            ]}
            onPress={toggleDropdown}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.categorySelectorText,
                {
                  color: currentTheme.colors.highEmphasis,
                  fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 12,
                  maxWidth: isTV ? 150 : isLargeTablet ? 130 : isTablet ? 120 : 120
                }
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {formatTrailerType(selectedCategory)}
            </Text>
            <MaterialIcons
              name={dropdownVisible ? "expand-less" : "expand-more"}
              size={isTV ? 22 : isLargeTablet ? 20 : isTablet ? 18 : 18}
              color="rgba(255,255,255,0.7)"
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Category Dropdown Modal */}
      <Modal
        visible={dropdownVisible}
        transparent={true}
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setDropdownVisible(false)}
      >
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setDropdownVisible(false)}
        >
          <View style={[styles.dropdownContainer, {
            backgroundColor: currentTheme.colors.background,
            borderColor: currentTheme.colors.primary + '20',
            maxWidth: isTV ? 400 : isLargeTablet ? 360 : isTablet ? 320 : 320,
            borderRadius: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16
          }]}>
            {trailerCategories.map(category => (
              <TouchableOpacity
                key={category}
                style={[
                  styles.dropdownItem,
                  {
                    paddingHorizontal: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16,
                    paddingVertical: isTV ? 18 : isLargeTablet ? 16 : isTablet ? 14 : 14
                  }
                ]}
                onPress={() => handleCategorySelect(category)}
                activeOpacity={0.7}
              >
                <View style={styles.dropdownItemContent}>
                  <View style={[
                    styles.categoryIconContainer,
                    {
                      backgroundColor: currentTheme.colors.primary + '15',
                      width: isTV ? 36 : isLargeTablet ? 32 : isTablet ? 28 : 28,
                      height: isTV ? 36 : isLargeTablet ? 32 : isTablet ? 28 : 28,
                      borderRadius: isTV ? 10 : isLargeTablet ? 9 : isTablet ? 8 : 8
                    }
                  ]}>
                    <MaterialIcons
                      name={getTrailerTypeIcon(category) as any}
                      size={isTV ? 18 : isLargeTablet ? 16 : isTablet ? 14 : 14}
                      color={currentTheme.colors.primary}
                    />
                  </View>
                  <Text style={[
                    styles.dropdownItemText,
                    {
                      color: currentTheme.colors.highEmphasis,
                      fontSize: isTV ? 18 : isLargeTablet ? 17 : isTablet ? 16 : 16
                    }
                  ]}>
                    {formatTrailerType(category)}
                  </Text>
                  <Text style={[
                    styles.dropdownItemCount,
                    {
                      color: currentTheme.colors.textMuted,
                      fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 12,
                      paddingHorizontal: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 8 : 8,
                      paddingVertical: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 4,
                      borderRadius: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 10 : 10
                    }
                  ]}>
                    {trailers[category].length}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Selected Category Trailers */}
      {selectedCategory && trailers[selectedCategory] && (
        <View style={styles.selectedCategoryContent}>
          {/* Trailers Horizontal Scroll */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.trailersScrollContent,
              { gap: trailerCardSpacing }
            ]}
            style={styles.trailersScrollView}
            decelerationRate="fast"
            snapToInterval={trailerCardWidth + trailerCardSpacing} // card width + gap for smooth scrolling
            snapToAlignment="start"
          >
            {trailers[selectedCategory].map((trailer, index) => (
              <View
                key={trailer.id}
                style={[
                  styles.trailerCardContainer,
                  { width: trailerCardWidth }
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.trailerCard,
                    {
                      width: trailerCardWidth,
                      borderRadius: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16
                    }
                  ]}
                  onPress={() => handleTrailerPress(trailer)}
                  activeOpacity={0.9}
                >
                  {/* Thumbnail with Gradient Overlay */}
                  <View style={styles.thumbnailWrapper}>
                    <FastImage
                      source={{ uri: getYouTubeThumbnail(trailer.key, 'hq') }}
                      style={[
                        styles.thumbnail,
                        {
                          borderRadius: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16
                        }
                      ]}
                      resizeMode={FastImage.resizeMode.cover}
                    />
                    {/* Subtle Gradient Overlay */}
                    <View style={[
                      styles.thumbnailGradient,
                      {
                        borderRadius: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16
                      }
                    ]} />
                  </View>
                </TouchableOpacity>

                {/* Trailer Info Below Card */}
                <View style={styles.trailerInfoBelow}>
                  <Text
                    style={[
                      styles.trailerTitle,
                      {
                        color: currentTheme.colors.highEmphasis,
                        fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 12,
                        lineHeight: isTV ? 22 : isLargeTablet ? 20 : isTablet ? 18 : 16,
                        marginTop: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 10,
                        marginBottom: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 3
                      }
                    ]}
                    numberOfLines={2}
                  >
                    {trailer.displayName || trailer.name}
                  </Text>
                  <Text style={[
                    styles.trailerMeta,
                    {
                      color: currentTheme.colors.textMuted,
                      fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 10
                    }
                  ]}>
                    {new Date(trailer.published_at).getFullYear()}
                  </Text>
                </View>
              </View>
            ))}
            {/* Scroll Indicator - shows when there are more items to scroll */}
            {trailers[selectedCategory].length > (isTV ? 5 : isLargeTablet ? 4 : isTablet ? 4 : 3) && (
              <View style={[
                styles.scrollIndicator,
                {
                  width: isTV ? 32 : isLargeTablet ? 28 : isTablet ? 24 : 24,
                  height: isTV ? 28 : isLargeTablet ? 24 : isTablet ? 20 : 20,
                  borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                }
              ]}>
                <MaterialIcons
                  name="chevron-right"
                  size={isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20}
                  color={currentTheme.colors.textMuted}
                  style={{ opacity: 0.6 }}
                />
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {/* Trailer Modal */}
      <TrailerModal
        visible={modalVisible}
        onClose={handleModalClose}
        trailer={selectedTrailer}
        contentTitle={contentTitle}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    marginBottom: 16,
  },
  // Enhanced Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 0,
    gap: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Category Selector Styles
  categorySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.03)',
    gap: 6,
    maxWidth: 160, // Limit maximum width to prevent overflow
  },
  categorySelectorText: {
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 120, // Limit text width
  },

  // Dropdown Styles
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  dropdownContainer: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  dropdownItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  dropdownItemText: {
    fontSize: 16,
    flex: 1,
  },
  dropdownItemCount: {
    fontSize: 12,
    opacity: 0.7,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    minWidth: 24,
    textAlign: 'center',
  },

  // Selected Category Content
  selectedCategoryContent: {
    marginTop: 16,
  },

  // Category Section Styles
  categorySection: {
    gap: 12,
    position: 'relative', // For scroll indicator positioning
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  categoryBadge: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
  },
  categoryBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Trailers Scroll View
  trailersScrollView: {
    marginHorizontal: -4, // Compensate for padding
  },
  trailersScrollContent: {
    paddingHorizontal: 4, // Restore padding for first/last items
    paddingRight: 20, // Extra padding at end for scroll indicator
  },

  // Trailer Card Container (wraps card + info)
  trailerCardContainer: {
    alignItems: 'flex-start',
  },

  // Enhanced Trailer Card Styles (thumbnail only)
  trailerCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },

  // Thumbnail Styles
  thumbnailWrapper: {
    position: 'relative',
    aspectRatio: 16 / 9,
    width: '100%',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  thumbnailGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
  },

  // Trailer Info Below Card
  trailerInfoBelow: {
    width: '100%',
    alignItems: 'flex-start',
    paddingLeft: 4,
  },
  trailerTitle: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  trailerMeta: {
    fontSize: 10,
    opacity: 0.7,
    fontWeight: '500',
  },

  // Loading and Error States
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    opacity: 0.7,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },

  // Scroll Indicator
  scrollIndicator: {
    position: 'absolute',
    right: 4,
    top: '50%',
    transform: [{ translateY: -10 }],
    width: 24,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
  },

  // No Trailers State
  noTrailersContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  noTrailersText: {
    fontSize: 14,
    opacity: 0.6,
    fontStyle: 'italic',
  },
});

export default TrailersSection;
