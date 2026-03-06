import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { Share } from 'react-native';
import { mmkvStorage } from '../services/mmkvStorage';
import { useToast } from '../contexts/ToastContext';
import DropUpMenu from '../components/home/DropUpMenu';
import ScreenHeader from '../components/common/ScreenHeader';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  SafeAreaView,
  StatusBar,
  Animated as RNAnimated,
  ActivityIndicator,
  Platform,
  ScrollView,
  BackHandler,
  Image,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import FastImage from '@d11/react-native-fast-image';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { catalogService } from '../services/catalogService';
import type { StreamingContent } from '../services/catalogService';
import { RootStackParamList } from '../navigation/AppNavigator';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useTraktContext } from '../contexts/TraktContext';
import { useSimklContext } from '../contexts/SimklContext';
import TraktIcon from '../../assets/rating-icons/trakt.svg';
import { traktService, TraktService, TraktImages } from '../services/traktService';
import { TraktLoadingSpinner } from '../components/common/TraktLoadingSpinner';
import { useSettings } from '../hooks/useSettings';
import { useTranslation } from 'react-i18next';
import { useScrollToTop } from '../contexts/ScrollToTopContext';
import { TMDBService } from '../services/tmdbService';

interface LibraryItem extends StreamingContent {
  progress?: number;
  lastWatched?: string;
  gradient: [string, string];
  imdbId?: string;
  traktId: number;
  images?: TraktImages;
  watched?: boolean;
}

interface TraktDisplayItem {
  id: string;
  name: string;
  type: 'movie' | 'series';
  poster: string;
  year?: number;
  lastWatched?: string;
  plays?: number;
  rating?: number;
  imdbId?: string;
  traktId: number;
  images?: TraktImages;
}

interface TraktFolder {
  id: string;
  name: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  itemCount: number;
}

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;
const TRAKT_LIBRARY_SYNC_MODE_KEY = 'trakt_library_sync_mode';

function getGridLayout(screenWidth: number): { numColumns: number; itemWidth: number } {
  const horizontalPadding = 26;
  const gutter = 12;
  let numColumns = 3;
  if (screenWidth >= 1200) numColumns = 5;
  else if (screenWidth >= 1000) numColumns = 4;
  else if (screenWidth >= 700) numColumns = 3;
  else numColumns = 3;
  const available = screenWidth - horizontalPadding - (numColumns - 1) * gutter;
  const itemWidth = Math.floor(available / numColumns);
  return { numColumns, itemWidth };
}

const TraktItem = React.memo(({
  item,
  width,
  navigation,
  currentTheme,
  showTitles
}: {
  item: TraktDisplayItem;
  width: number;
  navigation: any;
  currentTheme: any;
  showTitles: boolean;
}) => {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchPoster = async () => {
      if (item.images) {
        const url = TraktService.getTraktPosterUrl(item.images);
        if (isMounted && url) {
          setPosterUrl(url);
          return;
        }
      }

      if (item.imdbId || item.traktId) {
        try {
          const tmdbService = TMDBService.getInstance();
          let tmdbId: number | null = null;

          if (item.imdbId) {
            tmdbId = await tmdbService.findTMDBIdByIMDB(item.imdbId);
          }

          if (tmdbId) {
            let posterPath: string | null = null;

            if (item.type === 'movie') {
              const details = await tmdbService.getMovieDetails(String(tmdbId));
              posterPath = details?.poster_path ?? null;
            } else {
              const details = await tmdbService.getTVShowDetails(tmdbId);
              posterPath = details?.poster_path ?? null;
            }

            if (isMounted && posterPath) {
              const url = tmdbService.getImageUrl(posterPath, 'w500');
              setPosterUrl(url);
            }
          }
        } catch (error) {
          logger.debug('Failed to fetch poster from TMDB', error);
        }
      }
    };
    fetchPoster();
    return () => { isMounted = false; };
  }, [item.images, item.imdbId, item.traktId, item.type]);

  const handlePress = useCallback(() => {
    if (item.imdbId) {
      navigation.navigate('Metadata', { id: item.imdbId, type: item.type });
    }
  }, [navigation, item.imdbId, item.type]);

  return (
    <TouchableOpacity
      style={[styles.itemContainer, { width }]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View>
        <View style={[styles.posterContainer, { shadowColor: currentTheme.colors.black }]}>
          {posterUrl ? (
            <FastImage
              source={{ uri: posterUrl }}
              style={styles.poster}
              resizeMode={FastImage.resizeMode.cover}
            />
          ) : (
            <View style={[styles.poster, { backgroundColor: currentTheme.colors.elevation1, justifyContent: 'center', alignItems: 'center' }]}>
              <ActivityIndicator color={currentTheme.colors.primary} />
            </View>
          )}
        </View>
        {showTitles && (
          <Text style={[styles.cardTitle, { color: currentTheme.colors.mediumEmphasis }]}>
            {item.name}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

const SkeletonLoader = () => {
  const pulseAnim = React.useRef(new RNAnimated.Value(0)).current;
  const { width, height } = useWindowDimensions();
  const { numColumns, itemWidth } = getGridLayout(width);
  const { currentTheme } = useTheme();

  React.useEffect(() => {
    const pulse = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        RNAnimated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  const renderSkeletonItem = () => (
    <View style={[styles.itemContainer, { width: itemWidth }]}>
      <RNAnimated.View
        style={[
          styles.posterContainer,
          { opacity, backgroundColor: currentTheme.colors.darkBackground }
        ]}
      />
      <RNAnimated.View
        style={[
          styles.skeletonTitle,
          { opacity, backgroundColor: currentTheme.colors.darkBackground }
        ]}
      />
    </View>
  );

  const skeletonCount = numColumns * 2;
  return (
    <View style={styles.skeletonContainer}>
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <View key={index} style={{ width: itemWidth, marginBottom: 16 }}>
          {renderSkeletonItem()}
        </View>
      ))}
    </View>
  );
};

const LibraryScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const isDarkMode = useColorScheme() === 'dark';
  const { width, height } = useWindowDimensions();
  const { numColumns, itemWidth } = useMemo(() => getGridLayout(width), [width]);
  const [loading, setLoading] = useState(true);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [filter, setFilter] = useState<'trakt' | 'simkl' | 'movies' | 'series'>('movies');
  const [showTraktContent, setShowTraktContent] = useState(false);
  const [selectedTraktFolder, setSelectedTraktFolder] = useState<string | null>(null);
  const [showSimklContent, setShowSimklContent] = useState(false);
  const [selectedSimklFolder, setSelectedSimklFolder] = useState<string | null>(null);
  const { showInfo, showError } = useToast();
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const insets = useSafeAreaInsets();
  const { currentTheme } = useTheme();
  const { settings } = useSettings();
  const flashListRef = useRef<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [traktSyncMode, setTraktSyncMode] = useState<'off' | 'manual' | 'automatic'>('off');
  const hasAutoSyncedThisSession = useRef(false);

  const scrollToTop = useCallback(() => {
    flashListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  useScrollToTop('Library', scrollToTop);

  const {
    isAuthenticated: traktAuthenticated,
    isLoading: traktLoading,
    watchedMovies,
    watchedShows,
    watchlistMovies,
    watchlistShows,
    collectionMovies,
    collectionShows,
    continueWatching,
    ratedContent,
    loadWatchedItems,
    loadAllCollections
  } = useTraktContext();

  const {
    isAuthenticated: simklAuthenticated,
    isLoading: simklLoading,
    watchingShows,
    watchingMovies,
    watchingAnime,
    planToWatchShows,
    planToWatchMovies,
    planToWatchAnime,
    completedShows,
    completedMovies,
    completedAnime,
    onHoldShows,
    onHoldMovies,
    onHoldAnime,
    droppedShows,
    droppedMovies,
    droppedAnime,
    continueWatching: simklContinueWatching,
    ratedContent: simklRatedContent,
    loadAllCollections: loadSimklCollections
  } = useSimklContext();

  // Load Trakt sync mode preferences
  useEffect(() => {
    const loadSyncMode = async () => {
      try {
        const mode = await mmkvStorage.getItem(TRAKT_LIBRARY_SYNC_MODE_KEY);
        if (mode === 'manual' || mode === 'automatic') {
          setTraktSyncMode(mode);
        } else {
          setTraktSyncMode('off');
        }
      } catch (error) {
        logger.error('[LibraryScreen] Failed to load sync mode:', error);
        setTraktSyncMode('off');
      }
    };
    
    loadSyncMode();

    // Reload when screen is focused (to pick up changes from settings)
    const unsubscribe = navigation.addListener('focus', loadSyncMode);
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    const applyStatusBarConfig = () => {
      StatusBar.setBarStyle('light-content');
      if (Platform.OS === 'android') {
        StatusBar.setTranslucent(true);
        StatusBar.setBackgroundColor('transparent');
      }
    };

    applyStatusBarConfig();
    const unsubscribe = navigation.addListener('focus', applyStatusBarConfig);
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    const backAction = () => {
      if (showTraktContent) {
        if (selectedTraktFolder) {
          setSelectedTraktFolder(null);
        } else {
          setShowTraktContent(false);
        }
        return true;
      }
      if (showSimklContent) {
        if (selectedSimklFolder) {
          setSelectedSimklFolder(null);
        } else {
          setShowSimklContent(false);
        }
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [showTraktContent, showSimklContent, selectedTraktFolder, selectedSimklFolder]);

  useEffect(() => {
    const loadLibrary = async () => {
      setLoading(true);
      try {
        const items = await catalogService.getLibraryItems();

        const sortedItems = items.sort((a, b) => {
          const timeA = (a as any).addedToLibraryAt || 0;
          const timeB = (b as any).addedToLibraryAt || 0;
          return timeB - timeA;
        });

        const updatedItems = await Promise.all(sortedItems.map(async (item) => {
          const libraryItem: LibraryItem = {
            ...item,
            gradient: Array.isArray((item as any).gradient) ? (item as any).gradient : ['#222', '#444'],
            traktId: typeof (item as any).traktId === 'number' ? (item as any).traktId : 0,
          };
          const key = `watched:${item.type}:${item.id}`;
          const watched = await mmkvStorage.getItem(key);
          return {
            ...libraryItem,
            watched: watched === 'true'
          };
        }));
        setLibraryItems(updatedItems);
      } catch (error) {
        logger.error('Failed to load library:', error);
      } finally {
        setLoading(false);
      }
    };

    loadLibrary();

    const unsubscribe = catalogService.subscribeToLibraryUpdates(async (items) => {
      const sortedItems = items.sort((a, b) => {
        const timeA = (a as any).addedToLibraryAt || 0;
        const timeB = (b as any).addedToLibraryAt || 0;
        return timeB - timeA;
      });

      const updatedItems = await Promise.all(sortedItems.map(async (item) => {
        const libraryItem: LibraryItem = {
          ...item,
          gradient: Array.isArray((item as any).gradient) ? (item as any).gradient : ['#222', '#444'],
          traktId: typeof (item as any).traktId === 'number' ? (item as any).traktId : 0,
        };
        const key = `watched:${item.type}:${item.id}`;
        const watched = await mmkvStorage.getItem(key);
        return {
          ...libraryItem,
          watched: watched === 'true'
        };
      }));
      setLibraryItems(updatedItems);
    });

    const watchedSub = DeviceEventEmitter.addListener('watchedStatusChanged', loadLibrary);
    const focusSub = navigation.addListener('focus', loadLibrary);

    return () => {
      unsubscribe();
      watchedSub.remove();
      focusSub();
    };
  }, [navigation]);

  // Refs to always have access to latest context values (avoids stale closure)
  const watchlistMoviesRef = useRef(watchlistMovies);
  const watchlistShowsRef = useRef(watchlistShows);
  
  useEffect(() => {
    watchlistMoviesRef.current = watchlistMovies;
    watchlistShowsRef.current = watchlistShows;
  }, [watchlistMovies, watchlistShows]);

  // Sync Trakt watchlist to local library
  const syncTraktWatchlistToLibrary = useCallback(async () => {
    if (!traktAuthenticated) {
      showError('Sync Failed', 'Please connect to Trakt first');
      return;
    }

    setIsSyncing(true);
    logger.log('[LibraryScreen] Starting Trakt watchlist sync...');

    try {
      // Load Trakt data fresh before syncing
      logger.log('[LibraryScreen] Loading Trakt collections...');
      await loadAllCollections();
      
      // Wait for React to process state updates
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Access FRESH values from refs (updated by useEffect)
      const currentMovies = watchlistMoviesRef.current;
      const currentShows = watchlistShowsRef.current;
      
      logger.log(`[LibraryScreen] Syncing ${currentMovies?.length || 0} movies and ${currentShows?.length || 0} shows`);
      
      const hasMovies = currentMovies && currentMovies.length > 0;
      const hasShows = currentShows && currentShows.length > 0;

      if (!hasMovies && !hasShows) {
        logger.error('[LibraryScreen] No Trakt watchlist data available');
        showError(
          'Sync Failed',
          'No items found in your Trakt watchlist. Add some movies or shows to your Trakt watchlist first.'
        );
        return;
      }

      const tmdbService = TMDBService.getInstance();
      let addedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;

      const currentLibraryItems = await catalogService.getLibraryItems();
      const traktWatchlistImdbIds = new Set<string>();

      // Collect IMDb IDs from watchlist (using FRESH refs)
      if (currentMovies) {
        currentMovies.forEach(item => {
          if (item.movie?.ids?.imdb) {
            traktWatchlistImdbIds.add(item.movie.ids.imdb);
          }
        });
      }

      if (currentShows) {
        currentShows.forEach(item => {
          if (item.show?.ids?.imdb) {
            traktWatchlistImdbIds.add(item.show.ids.imdb);
          }
        });
      }

      // Remove items not in watchlist
      for (const libraryItem of currentLibraryItems) {
        const imdbId = libraryItem.id;
        if (imdbId.startsWith('tt') && !traktWatchlistImdbIds.has(imdbId)) {
          logger.log(`[LibraryScreen] Removing: ${libraryItem.name}`);
          await catalogService.removeFromLibrary(libraryItem.type, imdbId);
          removedCount++;
        }
      }

      // Add/update movies (using FRESH refs)
      if (currentMovies) {
        for (const watchlistItem of currentMovies) {
          const movie = watchlistItem.movie;
          if (!movie?.ids?.imdb) continue;

          const imdbId = movie.ids.imdb;
          const existingItem = currentLibraryItems.find(
            item => item.id === imdbId && item.type === 'movie'
          );

          let posterUrl = 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image';
          let overview = '';
          let genres: string[] = [];
          let year = movie.year;

          try {
            const tmdbId = await tmdbService.findTMDBIdByIMDB(imdbId);
            if (tmdbId) {
              const details = await tmdbService.getMovieDetails(String(tmdbId));
              if (details) {
                if (details.poster_path) {
                  posterUrl = tmdbService.getImageUrl(details.poster_path, 'w500') || posterUrl;
                }
                overview = details.overview || '';
                genres = details.genres?.map((g: any) => g.name) || [];
                year = details.release_date ? new Date(details.release_date).getFullYear() : year;
              }
            }
          } catch (error) {
            logger.error(`Failed to fetch TMDB data for ${movie.title}:`, error);
          }

          if (posterUrl === 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image' && movie.images) {
            const traktPosterUrl = TraktService.getTraktPosterUrl(movie.images);
            if (traktPosterUrl) posterUrl = traktPosterUrl;
          }

          const contentToAdd: StreamingContent = {
            id: imdbId,
            type: 'movie',
            name: movie.title,
            poster: posterUrl,
            posterShape: 'poster',
            year,
            description: overview,
            genres,
            imdbRating: undefined,
            inLibrary: true,
          };

          if (existingItem) {
            if (existingItem.poster !== posterUrl) {
              await catalogService.addToLibrary(contentToAdd);
              updatedCount++;
            }
          } else {
            await catalogService.addToLibrary(contentToAdd);
            addedCount++;
          }
        }
      }

      // Add/update shows (using FRESH refs)
      if (currentShows) {
        for (const watchlistItem of currentShows) {
          const show = watchlistItem.show;
          if (!show?.ids?.imdb) continue;

          const imdbId = show.ids.imdb;
          const existingItem = currentLibraryItems.find(
            item => item.id === imdbId && item.type === 'series'
          );

          let posterUrl = 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image';
          let overview = '';
          let genres: string[] = [];
          let year = show.year;

          try {
            const tmdbId = await tmdbService.findTMDBIdByIMDB(imdbId);
            if (tmdbId) {
              const details = await tmdbService.getTVShowDetails(tmdbId);
              if (details) {
                if (details.poster_path) {
                  posterUrl = tmdbService.getImageUrl(details.poster_path, 'w500') || posterUrl;
                }
                overview = details.overview || '';
                genres = details.genres?.map((g: any) => g.name) || [];
                year = details.first_air_date ? new Date(details.first_air_date).getFullYear() : year;
              }
            }
          } catch (error) {
            logger.error(`Failed to fetch TMDB data for ${show.title}:`, error);
          }

          if (posterUrl === 'https://via.placeholder.com/300x450/cccccc/666666?text=No+Image' && show.images) {
            const traktPosterUrl = TraktService.getTraktPosterUrl(show.images);
            if (traktPosterUrl) posterUrl = traktPosterUrl;
          }

          const contentToAdd: StreamingContent = {
            id: imdbId,
            type: 'series',
            name: show.title,
            poster: posterUrl,
            posterShape: 'poster',
            year,
            description: overview,
            genres,
            imdbRating: undefined,
            inLibrary: true,
          };

          if (existingItem) {
            if (existingItem.poster !== posterUrl) {
              await catalogService.addToLibrary(contentToAdd);
              updatedCount++;
            }
          } else {
            await catalogService.addToLibrary(contentToAdd);
            addedCount++;
          }
        }
      }

      // Show result
      if (addedCount > 0 || updatedCount > 0 || removedCount > 0) {
        let message = '';
        if (addedCount > 0) message += `Added ${addedCount}`;
        if (updatedCount > 0) message += `${message ? ', updated ' : 'Updated '}${updatedCount}`;
        if (removedCount > 0) message += `${message ? ', removed ' : 'Removed '}${removedCount}`;
        showInfo('Sync Complete', message);
        logger.log(`[LibraryScreen] Sync complete: ${message}`);
      } else {
        showInfo('Sync Complete', 'Library is up to date');
      }
    } catch (error) {
      logger.error('[LibraryScreen] Sync failed:', error);
      showError('Sync Failed', 'Unable to sync. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  }, [traktAuthenticated, loadAllCollections, showInfo, showError]);
  // Removed watchlistMovies and watchlistShows from deps - we access via refs!

  // Automatic sync on first visit
  useEffect(() => {
    if (
      traktSyncMode === 'automatic' &&
      traktAuthenticated &&
      !hasAutoSyncedThisSession.current &&
      !showTraktContent &&
      !showSimklContent
    ) {
      hasAutoSyncedThisSession.current = true;
      logger.log('[LibraryScreen] Performing automatic sync');
      syncTraktWatchlistToLibrary();
    }

  }, [traktSyncMode, traktAuthenticated, showTraktContent, showSimklContent, syncTraktWatchlistToLibrary]);

  const filteredItems = libraryItems.filter(item => {
    if (filter === 'movies') return item.type === 'movie';
    if (filter === 'series') return item.type === 'series';
    return true;
  });

  const traktFolders = useMemo((): TraktFolder[] => {
    if (!traktAuthenticated) return [];

    const folders: TraktFolder[] = [
      {
        id: 'watched',
        name: t('library.watched'),
        icon: 'visibility',
        itemCount: (watchedMovies?.length || 0) + (watchedShows?.length || 0),
      },
      {
        id: 'continue-watching',
        name: t('library.continue'),
        icon: 'play-circle-outline',
        itemCount: continueWatching?.length || 0,
      },
      {
        id: 'watchlist',
        name: t('library.watchlist'),
        icon: 'bookmark',
        itemCount: (watchlistMovies?.length || 0) + (watchlistShows?.length || 0),
      },
      {
        id: 'collection',
        name: t('library.collection'),
        icon: 'library-add',
        itemCount: (collectionMovies?.length || 0) + (collectionShows?.length || 0),
      },
      {
        id: 'ratings',
        name: t('library.rated'),
        icon: 'star',
        itemCount: ratedContent?.length || 0,
      }
    ];

    return folders.filter(folder => folder.itemCount > 0);
  }, [traktAuthenticated, watchedMovies, watchedShows, watchlistMovies, watchlistShows, collectionMovies, collectionShows, continueWatching, ratedContent, t]);

  const simklFolders = useMemo((): TraktFolder[] => {
    if (!simklAuthenticated) return [];

    const folders: TraktFolder[] = [
      {
        id: 'continue-watching',
        name: t('library.continue'),
        icon: 'play-circle-outline',
        itemCount: simklContinueWatching?.length || 0,
      },
      {
        id: 'watching-shows',
        name: 'Watching Shows',
        icon: 'visibility',
        itemCount: watchingShows?.length || 0,
      },
      {
        id: 'watching-movies',
        name: 'Watching Movies',
        icon: 'visibility',
        itemCount: watchingMovies?.length || 0,
      },
      {
        id: 'watching-anime',
        name: 'Watching Anime',
        icon: 'visibility',
        itemCount: watchingAnime?.length || 0,
      },
      {
        id: 'plantowatch-shows',
        name: 'Plan to Watch Shows',
        icon: 'bookmark-border',
        itemCount: planToWatchShows?.length || 0,
      },
      {
        id: 'plantowatch-movies',
        name: 'Plan to Watch Movies',
        icon: 'bookmark-border',
        itemCount: planToWatchMovies?.length || 0,
      },
      {
        id: 'plantowatch-anime',
        name: 'Plan to Watch Anime',
        icon: 'bookmark-border',
        itemCount: planToWatchAnime?.length || 0,
      },
      {
        id: 'completed-shows',
        name: 'Completed Shows',
        icon: 'check-circle',
        itemCount: completedShows?.length || 0,
      },
      {
        id: 'completed-movies',
        name: 'Completed Movies',
        icon: 'check-circle',
        itemCount: completedMovies?.length || 0,
      },
      {
        id: 'completed-anime',
        name: 'Completed Anime',
        icon: 'check-circle',
        itemCount: completedAnime?.length || 0,
      },
      {
        id: 'onhold-shows',
        name: 'On Hold Shows',
        icon: 'pause-circle-outline',
        itemCount: onHoldShows?.length || 0,
      },
      {
        id: 'onhold-movies',
        name: 'On Hold Movies',
        icon: 'pause-circle-outline',
        itemCount: onHoldMovies?.length || 0,
      },
      {
        id: 'onhold-anime',
        name: 'On Hold Anime',
        icon: 'pause-circle-outline',
        itemCount: onHoldAnime?.length || 0,
      },
      {
        id: 'dropped-shows',
        name: 'Dropped Shows',
        icon: 'cancel',
        itemCount: droppedShows?.length || 0,
      },
      {
        id: 'dropped-movies',
        name: 'Dropped Movies',
        icon: 'cancel',
        itemCount: droppedMovies?.length || 0,
      },
      {
        id: 'dropped-anime',
        name: 'Dropped Anime',
        icon: 'cancel',
        itemCount: droppedAnime?.length || 0,
      },
      {
        id: 'ratings',
        name: t('library.rated'),
        icon: 'star',
        itemCount: simklRatedContent?.length || 0,
      }
    ];

    return folders.filter(folder => folder.itemCount > 0);
  }, [simklAuthenticated, watchingShows, watchingMovies, watchingAnime, planToWatchShows, planToWatchMovies, planToWatchAnime, completedShows, completedMovies, completedAnime, onHoldShows, onHoldMovies, onHoldAnime, droppedShows, droppedMovies, droppedAnime, simklContinueWatching, simklRatedContent, t]);

  const renderItem = ({ item }: { item: LibraryItem }) => (
    <TouchableOpacity
      style={[styles.itemContainer, { width: itemWidth }]}
      onPress={() => navigation.navigate('Metadata', { id: item.id, type: item.type })}
      onLongPress={() => {
        setSelectedItem(item);
        setMenuVisible(true);
      }}
      activeOpacity={0.7}
    >
      <View>
        <View style={[styles.posterContainer, { shadowColor: currentTheme.colors.black, borderRadius: settings.posterBorderRadius ?? 12 }]}>
          <FastImage
            source={{ uri: item.poster || 'https://via.placeholder.com/300x450' }}
            style={[styles.poster, { borderRadius: settings.posterBorderRadius ?? 12 }]}
            resizeMode={FastImage.resizeMode.cover}
          />
          {item.watched && (
            <View style={styles.watchedIndicator}>
              <MaterialIcons name="check-circle" size={22} color={currentTheme.colors.success || '#4CAF50'} />
            </View>
          )}
          {item.progress !== undefined && item.progress < 1 && (
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${item.progress * 100}%`, backgroundColor: currentTheme.colors.primary }
                ]}
              />
            </View>
          )}
        </View>
        {settings.showPosterTitles && (
          <Text style={[styles.cardTitle, { color: currentTheme.colors.mediumEmphasis }]}>
            {item.name}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderTraktCollectionFolder = ({ folder }: { folder: TraktFolder }) => (
    <TouchableOpacity
      style={[styles.itemContainer, { width: itemWidth }]}
      onPress={() => {
        setSelectedTraktFolder(folder.id);
        loadAllCollections();
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.posterContainer, styles.folderContainer, { shadowColor: currentTheme.colors.black, backgroundColor: currentTheme.colors.elevation1 }]}>
        <View style={styles.folderGradient}>
          <MaterialIcons
            name={folder.icon}
            size={48}
            color={currentTheme.colors.white}
            style={{ marginBottom: 8 }}
          />
          <Text style={[styles.folderTitle, { color: currentTheme.colors.white }]}>
            {folder.name}
          </Text>
          <Text style={styles.folderCount}>
            {folder.itemCount} {t('library.items')}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderTraktFolder = () => (
    <TouchableOpacity
      style={[styles.itemContainer, { width: itemWidth }]}
      onPress={() => {
        if (!traktAuthenticated) {
          navigation.navigate('TraktSettings');
        } else {
          setShowTraktContent(true);
          setSelectedTraktFolder(null);
          loadAllCollections();
        }
      }}
      activeOpacity={0.7}
    >
      <View>
        <View style={[styles.posterContainer, styles.folderContainer, { shadowColor: currentTheme.colors.black, backgroundColor: currentTheme.colors.elevation1 }]}>
          <View style={styles.folderGradient}>
            <TraktIcon width={48} height={48} style={{ marginBottom: 8 }} />
            <Text style={[styles.folderTitle, { color: currentTheme.colors.white }]}>
              Trakt
            </Text>
            {traktAuthenticated && traktFolders.length > 0 && (
              <Text style={styles.folderCount}>
                {traktFolders.length} {t('library.items')}
              </Text>
            )}
          </View>
        </View>
        {settings.showPosterTitles && (
          <Text style={[styles.cardTitle, { color: currentTheme.colors.mediumEmphasis }]}>
            {t('library.trakt_collections')}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderTraktItem = useCallback(({ item }: { item: TraktDisplayItem }) => {
    return <TraktItem
      item={item}
      width={itemWidth}
      navigation={navigation}
      currentTheme={currentTheme}
      showTitles={settings.showPosterTitles}
    />;
  }, [itemWidth, navigation, currentTheme, settings.showPosterTitles]);

  const getTraktFolderItems = useCallback((folderId: string): TraktDisplayItem[] => {
    const items: TraktDisplayItem[] = [];

    switch (folderId) {
      case 'watched':
        if (watchedMovies) {
          for (const watchedMovie of watchedMovies) {
            const movie = watchedMovie.movie;
            if (movie) {
              items.push({
                id: String(movie.ids.trakt),
                name: movie.title,
                type: 'movie',
                poster: 'placeholder',
                year: movie.year,
                lastWatched: watchedMovie.last_watched_at,
                plays: watchedMovie.plays,
                imdbId: movie.ids.imdb,
                traktId: movie.ids.trakt,
                images: movie.images,
              });
            }
          }
        }
        if (watchedShows) {
          for (const watchedShow of watchedShows) {
            const show = watchedShow.show;
            if (show) {
              items.push({
                id: String(show.ids.trakt),
                name: show.title,
                type: 'series',
                poster: 'placeholder',
                year: show.year,
                lastWatched: watchedShow.last_watched_at,
                plays: watchedShow.plays,
                imdbId: show.ids.imdb,
                traktId: show.ids.trakt,
                images: show.images,
              });
            }
          }
        }
        break;

      case 'continue-watching':
        if (continueWatching) {
          for (const item of continueWatching) {
            if (item.type === 'movie' && item.movie) {
              items.push({
                id: String(item.movie.ids.trakt),
                name: item.movie.title,
                type: 'movie',
                poster: 'placeholder',
                year: item.movie.year,
                lastWatched: item.paused_at,
                imdbId: item.movie.ids.imdb,
                traktId: item.movie.ids.trakt,
                images: item.movie.images,
              });
            } else if (item.type === 'episode' && item.show && item.episode) {
              items.push({
                id: `${item.show.ids.trakt}:${item.episode.season}:${item.episode.number}`,
                name: `${item.show.title} S${item.episode.season}E${item.episode.number}`,
                type: 'series',
                poster: 'placeholder',
                year: item.show.year,
                lastWatched: item.paused_at,
                imdbId: item.show.ids.imdb,
                traktId: item.show.ids.trakt,
                images: item.show.images,
              });
            }
          }
        }
        break;

      case 'watchlist':
        if (watchlistMovies) {
          for (const watchlistMovie of watchlistMovies) {
            const movie = watchlistMovie.movie;
            if (movie) {
              items.push({
                id: String(movie.ids.trakt),
                name: movie.title,
                type: 'movie',
                poster: 'placeholder',
                year: movie.year,
                lastWatched: watchlistMovie.listed_at,
                imdbId: movie.ids.imdb,
                traktId: movie.ids.trakt,
                images: movie.images,
              });
            }
          }
        }
        if (watchlistShows) {
          for (const watchlistShow of watchlistShows) {
            const show = watchlistShow.show;
            if (show) {
              items.push({
                id: String(show.ids.trakt),
                name: show.title,
                type: 'series',
                poster: 'placeholder',
                year: show.year,
                lastWatched: watchlistShow.listed_at,
                imdbId: show.ids.imdb,
                traktId: show.ids.trakt,
                images: show.images,
              });
            }
          }
        }
        break;

      case 'collection':
        if (collectionMovies) {
          for (const collectionMovie of collectionMovies) {
            const movie = collectionMovie.movie;
            if (movie) {
              items.push({
                id: String(movie.ids.trakt),
                name: movie.title,
                type: 'movie',
                poster: 'placeholder',
                year: movie.year,
                lastWatched: collectionMovie.collected_at,
                imdbId: movie.ids.imdb,
                traktId: movie.ids.trakt,
                images: movie.images,
              });
            }
          }
        }
        if (collectionShows) {
          for (const collectionShow of collectionShows) {
            const show = collectionShow.show;
            if (show) {
              items.push({
                id: String(show.ids.trakt),
                name: show.title,
                type: 'series',
                poster: 'placeholder',
                year: show.year,
                lastWatched: collectionShow.collected_at,
                imdbId: show.ids.imdb,
                traktId: show.ids.trakt,
                images: show.images,
              });
            }
          }
        }
        break;

      case 'ratings':
        if (ratedContent) {
          for (const ratedItem of ratedContent) {
            if (ratedItem.movie) {
              const movie = ratedItem.movie;
              items.push({
                id: String(movie.ids.trakt),
                name: movie.title,
                type: 'movie',
                poster: 'placeholder',
                year: movie.year,
                lastWatched: ratedItem.rated_at,
                rating: ratedItem.rating,
                imdbId: movie.ids.imdb,
                traktId: movie.ids.trakt,
                images: movie.images,
              });
            } else if (ratedItem.show) {
              const show = ratedItem.show;
              items.push({
                id: String(show.ids.trakt),
                name: show.title,
                type: 'series',
                poster: 'placeholder',
                year: show.year,
                lastWatched: ratedItem.rated_at,
                rating: ratedItem.rating,
                imdbId: show.ids.imdb,
                traktId: show.ids.trakt,
                images: show.images,
              });
            }
          }
        }
        break;
    }

    return items.sort((a, b) => {
      const dateA = a.lastWatched ? new Date(a.lastWatched).getTime() : 0;
      const dateB = b.lastWatched ? new Date(b.lastWatched).getTime() : 0;
      return dateB - dateA;
    });
  }, [watchedMovies, watchedShows, watchlistMovies, watchlistShows, collectionMovies, collectionShows, continueWatching, ratedContent]);

  const getSimklFolderItems = useCallback((folderId: string): TraktDisplayItem[] => {
    const items: TraktDisplayItem[] = [];

    switch (folderId) {
      case 'continue-watching':
        return (simklContinueWatching || []).map(item => {
          const content = item.show || item.movie;
          return {
            id: String(content?.ids?.simkl || Math.random()),
            name: content?.title || 'Unknown',
            type: item.show ? 'series' : 'movie',
            poster: '',
            year: content?.year,
            lastWatched: item.paused_at,
            imdbId: content?.ids?.imdb,
            traktId: content?.ids?.simkl || 0,
          };
        });

      case 'watching-shows':
        return (watchingShows || []).map(item => ({
          id: String(item.show?.ids?.simkl || Math.random()),
          name: item.show?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.show?.year,
          lastWatched: item.last_watched_at,
          rating: item.user_rating,
          imdbId: item.show?.ids?.imdb,
          traktId: item.show?.ids?.simkl || 0,
        }));

      case 'watching-movies':
        return (watchingMovies || []).map(item => ({
          id: String(item.movie?.ids?.simkl || Math.random()),
          name: item.movie?.title || 'Unknown',
          type: 'movie' as const,
          poster: '',
          year: item.movie?.year,
          lastWatched: item.last_watched_at,
          rating: item.user_rating,
          imdbId: item.movie?.ids?.imdb,
          traktId: item.movie?.ids?.simkl || 0,
        }));

      case 'watching-anime':
        return (watchingAnime || []).map(item => ({
          id: String(item.anime?.ids?.simkl || Math.random()),
          name: item.anime?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.anime?.year,
          lastWatched: item.last_watched_at,
          rating: item.user_rating,
          imdbId: item.anime?.ids?.imdb,
          traktId: item.anime?.ids?.simkl || 0,
        }));

      case 'plantowatch-shows':
        return (planToWatchShows || []).map(item => ({
          id: String(item.show?.ids?.simkl || Math.random()),
          name: item.show?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.show?.year,
          lastWatched: item.added_to_watchlist_at,
          imdbId: item.show?.ids?.imdb,
          traktId: item.show?.ids?.simkl || 0,
        }));

      case 'plantowatch-movies':
        return (planToWatchMovies || []).map(item => ({
          id: String(item.movie?.ids?.simkl || Math.random()),
          name: item.movie?.title || 'Unknown',
          type: 'movie' as const,
          poster: '',
          year: item.movie?.year,
          lastWatched: item.added_to_watchlist_at,
          imdbId: item.movie?.ids?.imdb,
          traktId: item.movie?.ids?.simkl || 0,
        }));

      case 'plantowatch-anime':
        return (planToWatchAnime || []).map(item => ({
          id: String(item.anime?.ids?.simkl || Math.random()),
          name: item.anime?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.anime?.year,
          lastWatched: item.added_to_watchlist_at,
          imdbId: item.anime?.ids?.imdb,
          traktId: item.anime?.ids?.simkl || 0,
        }));

      case 'completed-shows':
        return (completedShows || []).map(item => ({
          id: String(item.show?.ids?.simkl || Math.random()),
          name: item.show?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.show?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.show?.ids?.imdb,
          traktId: item.show?.ids?.simkl || 0,
        }));

      case 'completed-movies':
        return (completedMovies || []).map(item => ({
          id: String(item.movie?.ids?.simkl || Math.random()),
          name: item.movie?.title || 'Unknown',
          type: 'movie' as const,
          poster: '',
          year: item.movie?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.movie?.ids?.imdb,
          traktId: item.movie?.ids?.simkl || 0,
        }));

      case 'completed-anime':
        return (completedAnime || []).map(item => ({
          id: String(item.anime?.ids?.simkl || Math.random()),
          name: item.anime?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.anime?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.anime?.ids?.imdb,
          traktId: item.anime?.ids?.simkl || 0,
        }));

      case 'onhold-shows':
        return (onHoldShows || []).map(item => ({
          id: String(item.show?.ids?.simkl || Math.random()),
          name: item.show?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.show?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.show?.ids?.imdb,
          traktId: item.show?.ids?.simkl || 0,
        }));

      case 'onhold-movies':
        return (onHoldMovies || []).map(item => ({
          id: String(item.movie?.ids?.simkl || Math.random()),
          name: item.movie?.title || 'Unknown',
          type: 'movie' as const,
          poster: '',
          year: item.movie?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.movie?.ids?.imdb,
          traktId: item.movie?.ids?.simkl || 0,
        }));

      case 'onhold-anime':
        return (onHoldAnime || []).map(item => ({
          id: String(item.anime?.ids?.simkl || Math.random()),
          name: item.anime?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.anime?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.anime?.ids?.imdb,
          traktId: item.anime?.ids?.simkl || 0,
        }));

      case 'dropped-shows':
        return (droppedShows || []).map(item => ({
          id: String(item.show?.ids?.simkl || Math.random()),
          name: item.show?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.show?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.show?.ids?.imdb,
          traktId: item.show?.ids?.simkl || 0,
        }));

      case 'dropped-movies':
        return (droppedMovies || []).map(item => ({
          id: String(item.movie?.ids?.simkl || Math.random()),
          name: item.movie?.title || 'Unknown',
          type: 'movie' as const,
          poster: '',
          year: item.movie?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.movie?.ids?.imdb,
          traktId: item.movie?.ids?.simkl || 0,
        }));

      case 'dropped-anime':
        return (droppedAnime || []).map(item => ({
          id: String(item.anime?.ids?.simkl || Math.random()),
          name: item.anime?.title || 'Unknown',
          type: 'series' as const,
          poster: '',
          year: item.anime?.year,
          lastWatched: item.last_watched_at,
          imdbId: item.anime?.ids?.imdb,
          traktId: item.anime?.ids?.simkl || 0,
        }));

      case 'ratings':
        return (simklRatedContent || []).map(item => {
          const content = item.show || item.movie || item.anime;
          const type = item.show ? 'series' : item.movie ? 'movie' : 'series';
          return {
            id: String(content?.ids?.simkl || Math.random()),
            name: content?.title || 'Unknown',
            type,
            poster: '',
            year: content?.year,
            lastWatched: item.rated_at,
            rating: item.rating,
            imdbId: content?.ids?.imdb,
            traktId: content?.ids?.simkl || 0,
          };
        });
    }

    return items.sort((a, b) => {
      const dateA = a.lastWatched ? new Date(a.lastWatched).getTime() : 0;
      const dateB = b.lastWatched ? new Date(b.lastWatched).getTime() : 0;
      return dateB - dateA;
    });
  }, [simklContinueWatching, watchingShows, watchingMovies, watchingAnime, planToWatchShows, planToWatchMovies, planToWatchAnime, completedShows, completedMovies, completedAnime, onHoldShows, onHoldMovies, onHoldAnime, droppedShows, droppedMovies, droppedAnime, simklRatedContent]);

  const renderTraktContent = () => {
    if (traktLoading) {
      return <TraktLoadingSpinner />;
    }

    if (!selectedTraktFolder) {
      if (traktFolders.length === 0) {
        return (
          <View style={styles.emptyContainer}>
            <TraktIcon width={80} height={80} style={{ opacity: 0.7, marginBottom: 16 }} />
            <Text style={[styles.emptyText, { color: currentTheme.colors.white }]}>{t('library.no_trakt')}</Text>
            <Text style={[styles.emptySubtext, { color: currentTheme.colors.mediumGray }]}>
              {t('library.no_trakt_desc')}
            </Text>
            <TouchableOpacity
              style={[styles.exploreButton, {
                backgroundColor: currentTheme.colors.primary,
                shadowColor: currentTheme.colors.black
              }]}
              onPress={() => {
                loadAllCollections();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.exploreButtonText, { color: currentTheme.colors.white }]}>{t('library.load_collections')}</Text>
            </TouchableOpacity>
          </View>
        );
      }

      return (
        <FlashList
          ref={flashListRef}
          data={traktFolders}
          renderItem={({ item }) => renderTraktCollectionFolder({ folder: item })}
          keyExtractor={item => item.id}
          numColumns={numColumns}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.7}
          onEndReached={() => { }}
        />
      );
    }

    const folderItems = getTraktFolderItems(selectedTraktFolder);

    if (folderItems.length === 0) {
      const folderName = traktFolders.find(f => f.id === selectedTraktFolder)?.name || t('library.collection');
      return (
        <View style={styles.emptyContainer}>
          <TraktIcon width={80} height={80} style={{ opacity: 0.7, marginBottom: 16 }} />
          <Text style={[styles.emptyText, { color: currentTheme.colors.white }]}>{t('library.empty_folder', { folder: folderName })}</Text>
          <Text style={[styles.emptySubtext, { color: currentTheme.colors.mediumGray }]}>
            {t('library.empty_folder_desc')}
          </Text>
          <TouchableOpacity
            style={[styles.exploreButton, {
              backgroundColor: currentTheme.colors.primary,
              shadowColor: currentTheme.colors.black
            }]}
            onPress={() => {
              loadAllCollections();
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.exploreButtonText, { color: currentTheme.colors.white }]}>Refresh</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlashList
        ref={flashListRef}
        data={folderItems}
        renderItem={({ item }) => renderTraktItem({ item })}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        numColumns={numColumns}
        style={styles.traktContainer}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.7}
        onEndReached={() => { }}
      />
    );
  };

  const renderSimklCollectionFolder = ({ folder }: { folder: TraktFolder }) => (
    <TouchableOpacity
      style={[styles.itemContainer, { width: itemWidth }]}
      onPress={() => {
        setSelectedSimklFolder(folder.id);
        loadSimklCollections();
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.posterContainer, styles.folderContainer, { shadowColor: currentTheme.colors.black, backgroundColor: currentTheme.colors.elevation1 }]}>
        <View style={styles.folderGradient}>
          <MaterialIcons
            name={folder.icon}
            size={48}
            color={currentTheme.colors.white}
            style={{ marginBottom: 8 }}
          />
          <Text style={[styles.folderTitle, { color: currentTheme.colors.white }]}>
            {folder.name}
          </Text>
          <Text style={styles.folderCount}>
            {folder.itemCount} {t('library.items')}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderSimklContent = () => {
    if (simklLoading) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 }}>
          <Image
            source={require('../../assets/simkl-logo.png')}
            style={{ width: 120, height: 40, tintColor: currentTheme.colors.text }}
            resizeMode="contain"
          />
        </View>
      );
    }

    if (!selectedSimklFolder) {
      if (simklFolders.length === 0) {
        return (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="video-library" size={80} color={currentTheme.colors.lightGray} />
            <Text style={[styles.emptyText, { color: currentTheme.colors.white }]}>
              {t('library.no_trakt')}
            </Text>
            <Text style={[styles.emptySubtext, { color: currentTheme.colors.mediumGray }]}>
              {t('library.no_trakt_desc')}
            </Text>
            <TouchableOpacity
              style={[styles.exploreButton, {
                backgroundColor: currentTheme.colors.primary,
                shadowColor: currentTheme.colors.black
              }]}
              onPress={() => {
                loadSimklCollections();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.exploreButtonText, { color: currentTheme.colors.white }]}>{t('library.load_collections')}</Text>
            </TouchableOpacity>
          </View>
        );
      }

      return (
        <FlashList
          ref={flashListRef}
          data={simklFolders}
          renderItem={({ item }) => renderSimklCollectionFolder({ folder: item })}
          keyExtractor={item => item.id}
          numColumns={numColumns}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.7}
          onEndReached={() => { }}
        />
      );
    }

    const folderItems = getSimklFolderItems(selectedSimklFolder);

    if (folderItems.length === 0) {
      const folderName = simklFolders.find(f => f.id === selectedSimklFolder)?.name || t('library.collection');
      return (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="video-library" size={80} color={currentTheme.colors.lightGray} />
          <Text style={[styles.emptyText, { color: currentTheme.colors.white }]}>{t('library.empty_folder', { folder: folderName })}</Text>
          <Text style={[styles.emptySubtext, { color: currentTheme.colors.mediumGray }]}>
            {t('library.empty_folder_desc')}
          </Text>
          <TouchableOpacity
            style={[styles.exploreButton, {
              backgroundColor: currentTheme.colors.primary,
              shadowColor: currentTheme.colors.black
            }]}
            onPress={() => {
              loadSimklCollections();
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.exploreButtonText, { color: currentTheme.colors.white }]}>Refresh</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlashList
        ref={flashListRef}
        data={folderItems}
        renderItem={({ item }) => renderTraktItem({ item })}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        numColumns={numColumns}
        style={styles.traktContainer}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.7}
        onEndReached={() => { }}
      />
    );
  };

  const renderFilter = (filterType: 'trakt' | 'simkl' | 'movies' | 'series', label: string) => {
    const isActive = filter === filterType;

    return (
      <TouchableOpacity
        style={[
          styles.filterButton,
          isActive && { backgroundColor: currentTheme.colors.primary },
          { shadowColor: currentTheme.colors.black }
        ]}
        onPress={() => {
          if (filterType === 'trakt') {
            if (!traktAuthenticated) {
              navigation.navigate('TraktSettings');
            } else {
              setShowTraktContent(true);
              setSelectedTraktFolder(null);
              loadAllCollections();
            }
            return;
          }
          if (filterType === 'simkl') {
            if (!simklAuthenticated) {
              navigation.navigate('Settings');
            } else {
              setShowSimklContent(true);
              setSelectedSimklFolder(null);
              loadSimklCollections();
            }
            return;
          }
          setFilter(filterType);
        }}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.filterText,
            { color: currentTheme.colors.mediumGray },
            isActive && { color: currentTheme.colors.white, fontWeight: '600' }
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (loading) {
      return <SkeletonLoader />;
    }

    if (filteredItems.length === 0) {
      const emptyTitle = filter === 'movies' ? t('library.no_movies') : filter === 'series' ? t('library.no_series') : t('library.no_content');
      const emptySubtitle = t('library.add_content_desc');
      return (
        <View style={styles.emptyContainer}>
          <MaterialIcons
            name="video-library"
            size={64}
            color={currentTheme.colors.lightGray}
          />
          <Text style={[styles.emptyText, { color: currentTheme.colors.white }]}>
            {emptyTitle}
          </Text>
          <Text style={[styles.emptySubtext, { color: currentTheme.colors.mediumGray }]}>
            {emptySubtitle}
          </Text>
          <TouchableOpacity
            style={[styles.exploreButton, {
              backgroundColor: currentTheme.colors.primary,
              shadowColor: currentTheme.colors.black
            }]}
            onPress={() => navigation.navigate('Search')}
            activeOpacity={0.7}
          >
            <Text style={[styles.exploreButtonText, { color: currentTheme.colors.white }]}>{t('library.find_something')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlashList
        ref={flashListRef}
        data={filteredItems}
        renderItem={({ item }) => renderItem({ item: item as LibraryItem })}
        keyExtractor={item => item.id}
        numColumns={numColumns}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.7}
        onEndReached={() => { }}
      />
    );
  };

  const isTablet = useMemo(() => {
    const smallestDimension = Math.min(width, height);
    return (Platform.OS === 'ios' ? (Platform as any).isPad === true : smallestDimension >= 768);
  }, [width, height]);

  // Show sync button only when mode is 'manual' and viewing local library
  const shouldShowSyncButton = traktSyncMode === 'manual' && !showTraktContent && !showSimklContent && traktAuthenticated;

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <ScreenHeader
        title={showTraktContent
          ? (selectedTraktFolder
            ? traktFolders.find(f => f.id === selectedTraktFolder)?.name || t('library.collection')
            : t('library.trakt_collection'))
          : showSimklContent
            ? (selectedSimklFolder
              ? simklFolders.find(f => f.id === selectedSimklFolder)?.name || t('library.collection')
              : 'SIMKL Collections')
            : t('library.title')
        }
        showBackButton={showTraktContent || showSimklContent}
        onBackPress={(showTraktContent || showSimklContent) ? () => {
          if (showTraktContent) {
            if (selectedTraktFolder) {
              setSelectedTraktFolder(null);
            } else {
              setShowTraktContent(false);
            }
          } else if (showSimklContent) {
            if (selectedSimklFolder) {
              setSelectedSimklFolder(null);
            } else {
              setShowSimklContent(false);
            }
          }
        } : undefined}
        useMaterialIcons={showTraktContent}
        rightActionIcon={!showTraktContent ? 'calendar' : undefined}
        onRightActionPress={!showTraktContent ? () => navigation.navigate('Calendar') : undefined}
        isTablet={isTablet}
      />

      <View style={[styles.contentContainer, { backgroundColor: currentTheme.colors.darkBackground }]}>
        {!showTraktContent && !showSimklContent && (
          <View style={styles.filtersContainer}>
            {renderFilter('trakt', 'Trakt')}
            {renderFilter('simkl', 'SIMKL')}
            {renderFilter('movies', t('search.movies'))}
            {renderFilter('series', t('search.tv_shows'))}
          </View>
        )}

        {showTraktContent ? renderTraktContent() : showSimklContent ? renderSimklContent() : renderContent()}
      </View>

      {/* Sync FAB - Bottom Right (only in manual mode) */}
      {shouldShowSyncButton && (
        <TouchableOpacity
          style={[
            styles.syncFab,
            {
              backgroundColor: currentTheme.colors.primary,
              bottom: insets.bottom + 80,
              shadowColor: currentTheme.colors.black,
            }
          ]}
          onPress={syncTraktWatchlistToLibrary}
          activeOpacity={0.8}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <ActivityIndicator color={currentTheme.colors.white} size="small" />
          ) : (
            <MaterialIcons name="sync" size={24} color={currentTheme.colors.white} />
          )}
        </TouchableOpacity>
      )}

      {selectedItem && (
        <DropUpMenu
          visible={menuVisible}
          onClose={() => setMenuVisible(false)}
          item={selectedItem}
          isWatched={!!selectedItem.watched}
          isSaved={true}
          onOptionSelect={async (option) => {
            if (!selectedItem) return;
            switch (option) {
              case 'library': {
                try {
                  await catalogService.removeFromLibrary(selectedItem.type, selectedItem.id);
                  showInfo(t('library.removed_from_library'), t('library.item_removed'));
                  setLibraryItems(prev => prev.filter(item => !(item.id === selectedItem.id && item.type === selectedItem.type)));
                  setMenuVisible(false);
                } catch (error) {
                  showError(t('library.failed_update_library'), t('library.unable_remove'));
                }
                break;
              }
              case 'watched': {
                try {
                  const key = `watched:${selectedItem.type}:${selectedItem.id}`;
                  const newWatched = !selectedItem.watched;
                  await mmkvStorage.setItem(key, newWatched ? 'true' : 'false');
                  showInfo(newWatched ? t('library.marked_watched') : t('library.marked_unwatched'), newWatched ? t('library.item_marked_watched') : t('library.item_marked_unwatched'));
                  setLibraryItems(prev => prev.map(item =>
                    item.id === selectedItem.id && item.type === selectedItem.type
                      ? { ...item, watched: newWatched }
                      : item
                  ));
                } catch (error) {
                  showError(t('library.failed_update_watched'), t('library.unable_update_watched'));
                }
                break;
              }
              case 'share': {
                let url = '';
                if (selectedItem.id) {
                  url = `https://www.imdb.com/title/${selectedItem.id}/`;
                }
                const message = `${selectedItem.name}\n${url}`;
                Share.share({ message, url, title: selectedItem.name });
                break;
              }
              default:
                break;
            }
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  watchedIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 12,
    padding: 2,
    zIndex: 2,
  },
  contentContainer: {
    flex: 1,
  },
  filtersContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    zIndex: 10,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 4,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.05)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  filterIcon: {
    marginRight: 8,
  },
  filterText: {
    fontSize: 15,
    fontWeight: '500',
  },
  listContainer: {
    paddingLeft: 12,
    paddingVertical: 16,
    paddingBottom: 90,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  skeletonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 16,
    justifyContent: 'space-between',
  },
  itemContainer: {
    marginBottom: 14,
  },
  posterContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
    aspectRatio: 2 / 3,
    elevation: Platform.OS === 'android' ? 1 : 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  poster: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  posterGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    justifyContent: 'flex-end',
    height: '45%',
  },
  progressBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  progressBar: {
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    letterSpacing: 0.3,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  lastWatched: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  skeletonTitle: {
    height: 14,
    marginTop: 8,
    borderRadius: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 90,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  exploreButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    elevation: 3,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  exploreButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  playsCount: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginTop: 2,
  },
  filtersScrollView: {
    flexGrow: 0,
  },
  folderContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
    aspectRatio: 2 / 3,
    elevation: 5,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  folderGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  folderTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    letterSpacing: 0.5,
  },
  folderCount: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginBottom: 2,
  },
  folderSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginTop: 2,
  },
  backButton: {
    padding: 8,
  },
  sectionsContainer: {
    flex: 1,
  },
  sectionsContent: {
    paddingBottom: 90,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  sectionIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  horizontalScrollContent: {
    paddingLeft: 16,
    paddingRight: 4,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  traktContainer: {
    flex: 1,
  },
  emptyListText: {
    fontSize: 16,
    fontWeight: '500',
  },
  row: {
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  calendarButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  syncFab: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
});

export default LibraryScreen;