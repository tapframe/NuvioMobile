import i18n from '../../i18n';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image, Animated, Dimensions } from 'react-native';
import { MaterialIcons as MaterialIconsWrapper } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import FastImage from '@d11/react-native-fast-image';
import { useMDBListRatings } from '../../hooks/useMDBListRatings';
import { mmkvStorage } from '../../services/mmkvStorage';
import { isMDBListEnabled, RATING_PROVIDERS_STORAGE_KEY } from '../../screens/MDBListSettingsScreen';

// Import SVG icons
import LetterboxdIcon from '../../../assets/rating-icons/letterboxd.svg';
import MetacriticIcon from '../../../assets/rating-icons/Metacritic.png';
import RottenTomatoesIcon from '../../../assets/rating-icons/RottenTomatoes.svg';
import TMDBIcon from '../../../assets/rating-icons/tmdb.svg';
import TraktIcon from '../../../assets/rating-icons/trakt.svg';
import AudienceScoreIcon from '../../../assets/rating-icons/audienscore.png';

// Enhanced responsive breakpoints for Ratings Section
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

const IMDb_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/IMDB_Logo_2016.svg/575px-IMDB_Logo_2016.svg.png';

export const RATING_PROVIDERS = {
  imdb: {
    name: 'IMDb',
    color: '#F5C518',
  },
  tmdb: {
    name: 'TMDB',
    color: '#01B4E4',
  },
  trakt: {
    name: 'Trakt',
    color: '#ED1C24',
  },
  letterboxd: {
    name: 'Letterboxd',
    color: '#00E054',
  },
  tomatoes: {
    name: i18n.t('components.rotten_tomatoes'),
    color: '#FA320A',
  },
  audience: {
    name: i18n.t('components.audience_score'),
    color: '#FA320A',
  },
  metacritic: {
    name: 'Metacritic',
    color: '#FFCC33',
  }
} as const;

interface RatingsSectionProps {
  imdbId: string;
  type: 'movie' | 'show';
}

export const RatingsSection: React.FC<RatingsSectionProps> = ({ imdbId, type }) => {
  const { ratings, loading, error } = useMDBListRatings(imdbId, type);
  const [enabledProviders, setEnabledProviders] = useState<Record<string, boolean>>({});
  const [isMDBEnabled, setIsMDBEnabled] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { currentTheme } = useTheme();

  // Responsive device type
  const deviceWidth = Dimensions.get('window').width;
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

  const horizontalPadding = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 32;
      case 'largeTablet':
        return 28;
      case 'tablet':
        return 24;
      default:
        return 16;
    }
  }, [deviceType]);

  const iconSize = useMemo(() => {
    const baseSize = deviceType === 'tv' ? 20 : deviceType === 'largeTablet' ? 18 : deviceType === 'tablet' ? 16 : 16;
    const numRatings = ratings ? Object.keys(ratings).length : 0;
    // Reduce size if many ratings to fit in one line
    if (numRatings > 4) {
      return Math.max(baseSize - 2, 12);
    }
    return baseSize;
  }, [deviceType, ratings]);

  const textSize = useMemo(() => {
    const baseSize = isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14;
    const numRatings = ratings ? Object.keys(ratings).length : 0;
    if (numRatings > 4) {
      return Math.max(baseSize - 1, 12);
    }
    return baseSize;
  }, [isTV, isLargeTablet, isTablet, ratings]);

  const itemSpacing = useMemo(() => {
    const baseSpacing = isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12;
    const numRatings = ratings ? Object.keys(ratings).length : 0;
    if (numRatings > 4) {
      return Math.max(baseSpacing - 2, 8);
    }
    return baseSpacing;
  }, [isTV, isLargeTablet, isTablet, ratings]);

  const iconTextGap = useMemo(() => {
    const baseGap = isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 4;
    const numRatings = ratings ? Object.keys(ratings).length : 0;
    if (numRatings > 4) {
      return Math.max(baseGap - 1, 2);
    }
    return baseGap;
  }, [isTV, isLargeTablet, isTablet, ratings]);

  useEffect(() => {
    loadProviderSettings();
    checkMDBListEnabled();
  }, []);

  const checkMDBListEnabled = async () => {
    try {
      const enabled = await isMDBListEnabled();
      setIsMDBEnabled(enabled);
    } catch (error) {
      setIsMDBEnabled(true); // Default to enabled
    }
  };

  const loadProviderSettings = async () => {
    try {
      const savedSettings = await mmkvStorage.getItem(RATING_PROVIDERS_STORAGE_KEY);
      if (savedSettings) {
        setEnabledProviders(JSON.parse(savedSettings));
      } else {
        // Default all providers to enabled
        const defaultSettings = Object.keys(RATING_PROVIDERS).reduce((acc, key) => {
          acc[key] = true;
          return acc;
        }, {} as Record<string, boolean>);
        setEnabledProviders(defaultSettings);
      }
    } catch (error) {
    }
  };

  useEffect(() => {
    if (ratings && Object.keys(ratings).length > 0) {
      // Start fade-in animation when ratings are loaded
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [ratings, fadeAnim]);

  // If MDBList is disabled, don't show anything
  if (!isMDBEnabled) return null;
  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="small" color={currentTheme.colors.primary} /></View>;
  if (error || !ratings || Object.keys(ratings).length === 0) return null;

  // Define the order and icons/colors for the ratings
  const ratingConfig = {
    imdb: {
      name: 'IMDb',
      icon: { uri: IMDb_LOGO },
      isImage: true,
      color: '#F5C518',
      transform: (value: number) => value.toFixed(1)
    },
    tmdb: {
      name: 'TMDB',
      icon: TMDBIcon,
      isImage: false,
      color: '#01B4E4',
      transform: (value: number) => value.toFixed(0)
    },
    trakt: {
      name: 'Trakt',
      icon: TraktIcon,
      isImage: false,
      color: '#ED1C24',
      transform: (value: number) => value.toFixed(0)
    },
    letterboxd: {
      name: 'Letterboxd',
      icon: LetterboxdIcon,
      isImage: false,
      color: '#00E054',
      transform: (value: number) => value.toFixed(1)
    },
    tomatoes: {
      name: i18n.t('components.rotten_tomatoes'),
      icon: RottenTomatoesIcon,
      isImage: false,
      color: '#FA320A',
      transform: (value: number) => Math.round(value).toString() + '%'
    },
    audience: {
      name: i18n.t('components.audience_score'),
      icon: AudienceScoreIcon,
      isImage: true,
      color: '#FA320A',
      transform: (value: number) => Math.round(value).toString() + '%'
    },
    metacritic: {
      name: 'Metacritic',
      icon: MetacriticIcon,
      isImage: true,
      color: '#FFCC33',
      transform: (value: number) => Math.round(value).toString()
    }
  };

  // Priority: IMDB, TMDB, Tomatoes, Metacritic 
  const priorityOrder = ['imdb', 'tmdb', 'tomatoes', 'metacritic', 'trakt', 'letterboxd', 'audience'];
  const displayRatings = priorityOrder
    .filter(source =>
      source in ratings &&
      ratings[source as keyof typeof ratings] !== undefined &&
      (enabledProviders[source] ?? true) // Show by default if setting not found
    )
    .map(source => [source, ratings[source as keyof typeof ratings]!]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          paddingHorizontal: horizontalPadding,
          opacity: fadeAnim,
          transform: [{
            translateY: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [10, 0],
            }),
          }],
        },
      ]}
    >
      <View style={styles.compactRatingsContainer}>
        {displayRatings.map(([source, value]) => {
          const config = ratingConfig[source as keyof typeof ratingConfig];
          const displayValue = config.transform(parseFloat(value as string));

          return (
            <View key={source} style={[styles.compactRatingItem, { marginRight: itemSpacing }]}>
              {config.isImage ? (
                <FastImage
                  source={config.icon as any}
                  style={[styles.compactRatingIcon, { 
                    width: source === 'imdb' ? iconSize * 2 : iconSize, 
                    height: iconSize, 
                    marginRight: iconTextGap 
                  }]}
                  resizeMode={FastImage.resizeMode.contain}
                />
              ) : config.icon ? (
                <View style={[styles.compactSvgContainer, { marginRight: iconTextGap }]}>
                  {React.createElement(config.icon as any, {
                    width: iconSize,
                    height: iconSize,
                  })}
                </View>
              ) : (
                // Text fallback
                <Text style={{
                  color: config.color,
                  fontSize: textSize,
                  fontWeight: '900',
                  marginRight: iconTextGap
                }}>
                  {config.name}
                </Text>
              )}
              <Text style={[styles.compactRatingValue, { color: config.color, fontSize: textSize }]}>
                {displayValue}
              </Text>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 2,
    marginBottom: 8,
  },
  loadingContainer: {
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactRatingsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  compactRatingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  compactRatingIcon: {
    width: 16,
    height: 16,
    marginRight: 4,
  },
  compactSvgContainer: {
    marginRight: 4,
  },
  compactRatingValue: {
    fontSize: 14,
    fontWeight: '600',
  },
}); 
