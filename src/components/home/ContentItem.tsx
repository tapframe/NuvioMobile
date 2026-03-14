import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { DeviceEventEmitter } from 'react-native';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet, Dimensions, Platform, Text, Share } from 'react-native';
import FastImage from '@d11/react-native-fast-image';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettings } from '../../hooks/useSettings';
import { catalogService, StreamingContent } from '../../services/catalogService';
import { DropUpMenu } from './DropUpMenu';
import { mmkvStorage } from '../../services/mmkvStorage';
import { storageService } from '../../services/storageService';
import { TraktService } from '../../services/traktService';
import { useTraktContext } from '../../contexts/TraktContext';
import Animated, { FadeIn } from 'react-native-reanimated';

interface ContentItemProps {
  item: StreamingContent;
  onPress: (id: string, type: string) => void;
  shouldLoadImage?: boolean;
  deferMs?: number;
}

const { width } = Dimensions.get('window');

// Enhanced responsive breakpoints
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

const getDeviceType = (screenWidth: number) => {
  if (screenWidth >= BREAKPOINTS.tv) return 'tv';
  if (screenWidth >= BREAKPOINTS.largeTablet) return 'largeTablet';
  if (screenWidth >= BREAKPOINTS.tablet) return 'tablet';
  return 'phone';
};

// Dynamic poster calculation based on screen width - show 1/4 of next poster
const calculatePosterLayout = (screenWidth: number) => {
  const deviceType = getDeviceType(screenWidth);

  // Responsive sizing based on device type
  const MIN_POSTER_WIDTH = deviceType === 'tv' ? 180 : deviceType === 'largeTablet' ? 160 : deviceType === 'tablet' ? 140 : 100;
  const MAX_POSTER_WIDTH = deviceType === 'tv' ? 220 : deviceType === 'largeTablet' ? 200 : deviceType === 'tablet' ? 180 : 130;
  const LEFT_PADDING = deviceType === 'tv' ? 32 : deviceType === 'largeTablet' ? 28 : deviceType === 'tablet' ? 24 : 16;
  const SPACING = deviceType === 'tv' ? 12 : deviceType === 'largeTablet' ? 10 : deviceType === 'tablet' ? 8 : 8;

  // Calculate available width for posters (reserve space for left padding)
  const availableWidth = screenWidth - LEFT_PADDING;

  // Try different numbers of full posters to find the best fit
  let bestLayout = {
    numFullPosters: 3,
    posterWidth: deviceType === 'tv' ? 200 : deviceType === 'largeTablet' ? 180 : deviceType === 'tablet' ? 160 : 120
  };

  for (let n = 3; n <= 6; n++) {
    // Calculate poster width needed for N full posters + 0.25 partial poster
    // Formula: N * posterWidth + (N-1) * spacing + 0.25 * posterWidth = availableWidth - rightPadding
    // Simplified: posterWidth * (N + 0.25) + (N-1) * spacing = availableWidth - rightPadding
    // We'll use minimal right padding (8px) to maximize space
    const usableWidth = availableWidth - 8;
    const posterWidth = (usableWidth - (n - 1) * SPACING) / (n + 0.25);

    if (posterWidth >= MIN_POSTER_WIDTH && posterWidth <= MAX_POSTER_WIDTH) {
      bestLayout = { numFullPosters: n, posterWidth };
    }
  }

  return {
    numFullPosters: bestLayout.numFullPosters,
    posterWidth: bestLayout.posterWidth,
    spacing: SPACING,
    partialPosterWidth: bestLayout.posterWidth * 0.25 // 1/4 of next poster
  };
};

const posterLayout = calculatePosterLayout(width);
const POSTER_WIDTH = posterLayout.posterWidth;

const ContentItem = ({ item, onPress, shouldLoadImage: shouldLoadImageProp, deferMs = 0 }: ContentItemProps) => {
  const { t } = useTranslation();
  // Track inLibrary status locally to force re-render
  const [inLibrary, setInLibrary] = useState(!!item.inLibrary);

  useEffect(() => {
    // Subscribe to library updates and update local state if this item's status changes
    const unsubscribe = catalogService.subscribeToLibraryUpdates((items) => {
      const found = items.find((libItem) => libItem.id === item.id && libItem.type === item.type);
      const newInLibrary = !!found;
      // Only update state if the value actually changed to prevent unnecessary re-renders
      setInLibrary(prev => prev !== newInLibrary ? newInLibrary : prev);
    });
    return () => unsubscribe();
  }, [item.id, item.type]);

  // Load watched state from AsyncStorage when item changes
  useEffect(() => {
    const updateWatched = () => {
      mmkvStorage.getItem(`watched:${item.type}:${item.id}`).then((val: string | null) => setIsWatched(val === 'true'));
    };
    updateWatched();
    const sub = DeviceEventEmitter.addListener('watchedStatusChanged', updateWatched);
    return () => sub.remove();
  }, [item.id, item.type]);

  const [menuVisible, setMenuVisible] = useState(false);
  const [isWatched, setIsWatched] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Trakt integration
  const { isAuthenticated, isInWatchlist, isInCollection, addToWatchlist, removeFromWatchlist, addToCollection, removeFromCollection } = useTraktContext();

  useEffect(() => {
    // Reset image error state when item changes, allowing for retry on re-render
    setImageError(false);
  }, [item.id, item.poster]);

  const { currentTheme } = useTheme();
  const { settings, isLoaded } = useSettings();
  const { showSuccess, showInfo } = useToast();
  const posterRadius = typeof settings.posterBorderRadius === 'number' ? settings.posterBorderRadius : 12;
  // Memoize poster width calculation to avoid recalculating on every render
  const posterWidth = React.useMemo(() => {
    const deviceType = getDeviceType(width);
    const sizeMultiplier = deviceType === 'tv' ? 1.2 : deviceType === 'largeTablet' ? 1.1 : deviceType === 'tablet' ? 1.0 : 0.9;

    switch (settings.posterSize) {
      case 'small':
        return Math.max(90, POSTER_WIDTH - 15) * sizeMultiplier;
      case 'medium':
        return Math.max(110, POSTER_WIDTH + 10) * sizeMultiplier;
      case 'large':
        return Math.max(130, POSTER_WIDTH + 25) * sizeMultiplier;
      default:
        return POSTER_WIDTH * sizeMultiplier;
    }
  }, [settings.posterSize, width]);

  // Determine dimensions based on poster shape
  const { finalWidth, finalAspectRatio, borderRadius } = React.useMemo(() => {
    const shape = item.posterShape || 'poster';
    const baseHeight = posterWidth / (2 / 3); // Standard height derived from portrait width

    let w = posterWidth;
    let ratio = 2 / 3;

    if (shape === 'landscape') {
      ratio = 16 / 9;
      // Maintain same height as portrait posters
      w = baseHeight * ratio;
    } else if (shape === 'square') {
      ratio = 1;
      w = baseHeight;
    }

    return {
      finalWidth: w,
      finalAspectRatio: ratio,
      borderRadius: typeof settings.posterBorderRadius === 'number' ? settings.posterBorderRadius : 12
    };
  }, [posterWidth, item.posterShape, settings.posterBorderRadius]);

  // Intersection observer simulation for lazy loading
  const itemRef = useRef<View>(null);

  const handleLongPress = useCallback(() => {
    setMenuVisible(true);
  }, []);

  const handlePress = useCallback(() => {
    // Validate ID before pressing to prevent errors with NaN/undefined IDs
    if (item.id && item.id !== 'NaN' && item.id !== 'undefined') {
      onPress(item.id, item.type);
    }
  }, [item.id, item.type, onPress]);

  const handleOptionSelect = useCallback(async (option: string) => {
    switch (option) {
      case 'library':
        if (inLibrary) {
          catalogService.removeFromLibrary(item.type, item.id);
          showInfo(t('library.removed_from_library'), t('library.item_removed'));
        } else {
          catalogService.addToLibrary(item);
          showSuccess(t('library.added_to_library'), t('library.item_added'));
        }
        break;
      case 'watched': {
        const targetWatched = !isWatched;
        setIsWatched(targetWatched);
        
        // Use the centralized watchedService to handle all the sync logic (Supabase, Trakt, Simkl, MAL)
        import('../../services/watchedService').then(({ watchedService }) => {
          if (targetWatched) {
            if (item.type === 'movie') {
              // Pass the title so it correctly populates the database instead of defaulting to IMDb ID
              watchedService.markMovieAsWatched(item.id, new Date(), undefined, undefined, item.name);
            } else {
              // For series from the homescreen drop-down, we mark S1E1 as watched as a baseline
              watchedService.markEpisodeAsWatched(item.id, item.id, 1, 1, new Date(), undefined, item.name);
            }
          } else {
            if (item.type === 'movie') {
              watchedService.unmarkMovieAsWatched(item.id);
            } else {
              // Unmarking a series from the top level is tricky as we don't know the exact episodes.
              // For safety and consistency with old behavior, we just clear the legacy flag.
              mmkvStorage.removeItem(`watched:${item.type}:${item.id}`);
            }
          }
          
          showInfo(
            targetWatched ? t('library.marked_watched') : t('library.marked_unwatched'), 
            targetWatched ? t('library.item_marked_watched') : t('library.item_marked_unwatched')
          );
          setTimeout(() => {
            DeviceEventEmitter.emit('watchedStatusChanged');
          }, 100);
        });

        setMenuVisible(false);
        break;
      }
      case 'playlist':
        break;
      case 'share': {
        let url = '';
        if (item.id) {
          url = `https://www.imdb.com/title/${item.id}/`;
        }
        const message = `${item.name}\n${url}`;
        Share.share({ message, url, title: item.name });
        break;
      }
      case 'trakt-watchlist': {
        if (isInWatchlist(item.id, item.type as 'movie' | 'show')) {
          await removeFromWatchlist(item.id, item.type as 'movie' | 'show');
          showInfo(t('library.removed_from_watchlist'), t('library.removed_from_watchlist_desc'));
        } else {
          await addToWatchlist(item.id, item.type as 'movie' | 'show');
          showSuccess(t('library.added_to_watchlist'), t('library.added_to_watchlist_desc'));
        }
        setMenuVisible(false);
        break;
      }
      case 'trakt-collection': {
        if (isInCollection(item.id, item.type as 'movie' | 'show')) {
          await removeFromCollection(item.id, item.type as 'movie' | 'show');
          showInfo(t('library.removed_from_collection'), t('library.removed_from_collection_desc'));
        } else {
          await addToCollection(item.id, item.type as 'movie' | 'show');
          showSuccess(t('library.added_to_collection'), t('library.added_to_collection_desc'));
        }
        setMenuVisible(false);
        break;
      }
    }
  }, [item, inLibrary, isWatched, isInWatchlist, isInCollection, addToWatchlist, removeFromWatchlist, addToCollection, removeFromCollection, showSuccess, showInfo]);

  const handleMenuClose = useCallback(() => {
    setMenuVisible(false);
  }, []);

  // Memoize optimized poster URL to prevent recalculating
  const optimizedPosterUrl = React.useMemo(() => {
    if (!item.poster || item.poster.includes('placeholder')) {
      return 'https://via.placeholder.com/154x231/333/666?text=No+Image';
    }
    if (item.poster.includes('image.tmdb.org')) {
      return item.poster.replace(/\/w\d+\//, '/w154/');
    }
    if (item.poster.includes('placeholder')) {
      return item.poster.replace('/medium/', '/small/');
    }
    return item.poster;
  }, [item.poster, item.id]);

  if (!isLoaded) {
    return (
      <View style={[styles.itemContainer, { width: finalWidth }]}>
        <View
          style={[
            styles.contentItem,
            {
              width: finalWidth,
              aspectRatio: finalAspectRatio,
              borderRadius,
              backgroundColor: currentTheme.colors.elevation1,
            },
          ]}
        />
        <View style={{ height: 18, marginTop: 4 }} />
      </View>
    );
  }

  return (
    <>
      <Animated.View style={[styles.itemContainer, { width: finalWidth }]} entering={FadeIn.duration(300)}>
        <TouchableOpacity
          style={[styles.contentItem, { width: finalWidth, aspectRatio: finalAspectRatio, borderRadius }]}
          activeOpacity={0.7}
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={300}
        >
          <View ref={itemRef} style={[styles.contentItemContainer, { borderRadius }]}>
            {/* Image with FastImage for aggressive caching */}
            {item.poster ? (
              <FastImage
                source={{
                  uri: optimizedPosterUrl,
                  priority: FastImage.priority.normal,
                  cache: FastImage.cacheControl.immutable
                }}
                style={[styles.poster, { backgroundColor: currentTheme.colors.elevation1, borderRadius }]}
                resizeMode={FastImage.resizeMode.cover}
                onLoad={() => {
                  setImageError(false);
                }}
                onError={() => {
                  if (__DEV__) console.warn('Image load error for:', item.poster);
                  setImageError(true);
                }}
              />
            ) : (
              // Show placeholder for items without posters
              <View style={[styles.poster, { backgroundColor: currentTheme.colors.elevation1, justifyContent: 'center', alignItems: 'center', borderRadius: posterRadius }]}>
                <Text style={{ color: currentTheme.colors.textMuted, fontSize: 10, textAlign: 'center' }}>
                  {item.name.substring(0, 20)}...
                </Text>
              </View>
            )}
            {imageError && (
              <View style={[styles.loadingOverlay, { backgroundColor: currentTheme.colors.elevation1 }]}>
                <MaterialIcons name="broken-image" size={24} color={currentTheme.colors.textMuted} />
              </View>
            )}
            {isWatched && (
              <View style={styles.watchedIndicator}>
                <MaterialIcons name="check-circle" size={22} color={currentTheme.colors.success} />
              </View>
            )}
            {inLibrary && (
              <View style={styles.libraryBadge}>
                <Feather name="bookmark" size={16} color={currentTheme.colors.white} />
              </View>
            )}
            {isAuthenticated && isInWatchlist(item.id, item.type as 'movie' | 'show') && (
              <View style={styles.traktWatchlistIcon}>
                <MaterialIcons name="playlist-add-check" size={16} color="#E74C3C" />
              </View>
            )}
            {isAuthenticated && isInCollection(item.id, item.type as 'movie' | 'show') && (
              <View style={styles.traktCollectionIcon}>
                <MaterialIcons name="video-library" size={16} color="#3498DB" />
              </View>
            )}
          </View>
        </TouchableOpacity>
        {settings.showPosterTitles && (
          <Text
            style={[
              styles.title,
              {
                color: currentTheme.colors.mediumEmphasis,
                fontSize: getDeviceType(width) === 'tv' ? 16 : getDeviceType(width) === 'largeTablet' ? 15 : getDeviceType(width) === 'tablet' ? 14 : 13
              }
            ]}
            numberOfLines={2}
          >
            {item.name}
          </Text>
        )}
      </Animated.View>

      <DropUpMenu
        visible={menuVisible}
        onClose={handleMenuClose}
        item={item}
        onOptionSelect={handleOptionSelect}
        isSaved={inLibrary}
        isWatched={isWatched}
      />
    </>
  );
};

const styles = StyleSheet.create({
  itemContainer: {
    width: POSTER_WIDTH,
  },
  contentItem: {
    width: POSTER_WIDTH,
    aspectRatio: 2 / 3,
    margin: 0,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    elevation: Platform.OS === 'android' ? 1 : 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    marginBottom: 8,
  },
  contentItemContainer: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  poster: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  watchedIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 12,
    padding: 2,
  },
  libraryBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 8,
    padding: 4,
  },
  traktWatchlistIcon: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 2,
  },
  traktCollectionIcon: {
    position: 'absolute',
    top: 8,
    right: 32, // Positioned to the left of watchlist icon
    padding: 2,
  },
  title: {
    fontSize: 13, // Will be overridden responsively
    fontWeight: '500',
    marginTop: 4,
    textAlign: 'center',
  }
});

export default React.memo(ContentItem, (prev, next) => {
  // Re-render when identity or poster changes. Caching is handled by FastImage.
  if (prev.item.id !== next.item.id) return false;
  if (prev.item.poster !== next.item.poster) return false;
  return true;
});