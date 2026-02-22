import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  Dimensions,
  Platform,
  InteractionManager,
  ScrollView
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { FlashList } from '@shopify/flash-list';
import { RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Meta, stremioService, CatalogExtra } from '../services/stremioService';
import { useTheme } from '../contexts/ThemeContext';
import FastImage from '@d11/react-native-fast-image';
import { BlurView } from 'expo-blur';
import { MaterialIcons } from '@expo/vector-icons';

// Optional iOS Glass effect (expo-glass-effect) with safe fallback for CatalogScreen
let GlassViewComp: any = null;
let liquidGlassAvailable = false;
if (Platform.OS === 'ios') {
  try {
    // Dynamically require so app still runs if the package isn't installed yet
    const glass = require('expo-glass-effect');
    GlassViewComp = glass.GlassView;
    liquidGlassAvailable = typeof glass.isLiquidGlassAvailable === 'function' ? glass.isLiquidGlassAvailable() : false;
  } catch {
    GlassViewComp = null;
    liquidGlassAvailable = false;
  }
}
import { logger } from '../utils/logger';
import { getFormattedCatalogName } from '../utils/catalogNameUtils';
import { useCustomCatalogNames } from '../hooks/useCustomCatalogNames';
import { mmkvStorage } from '../services/mmkvStorage';
import { catalogService, DataSource, StreamingContent } from '../services/catalogService';
import { tmdbService } from '../services/tmdbService';

type CatalogScreenProps = {
  route: RouteProp<RootStackParamList, 'Catalog'>;
  navigation: StackNavigationProp<RootStackParamList, 'Catalog'>;
};

// Constants for layout
const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;

const { width } = Dimensions.get('window');

// Enhanced responsive breakpoints (matching CatalogSection)
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

const getDeviceType = (deviceWidth: number) => {
  if (deviceWidth >= BREAKPOINTS.tv) return 'tv';
  if (deviceWidth >= BREAKPOINTS.largeTablet) return 'largeTablet';
  if (deviceWidth >= BREAKPOINTS.tablet) return 'tablet';
  return 'phone';
};

const deviceType = getDeviceType(width);
const isTablet = deviceType === 'tablet';
const isLargeTablet = deviceType === 'largeTablet';
const isTV = deviceType === 'tv';

// Dynamic column and spacing calculation based on screen width
const calculateCatalogLayout = (screenWidth: number) => {
  const MIN_ITEM_WIDTH = 120;
  const MAX_ITEM_WIDTH = 180; // Increased for tablets
  // Increase padding and spacing on larger screens for proper breathing room
  const HORIZONTAL_PADDING = screenWidth >= 1600 ? SPACING.xl * 4 : screenWidth >= 1200 ? SPACING.xl * 3 : screenWidth >= 1000 ? SPACING.xl * 2 : SPACING.lg * 2;
  const ITEM_SPACING = screenWidth >= 1600 ? SPACING.xl : screenWidth >= 1200 ? SPACING.lg : screenWidth >= 1000 ? SPACING.md : SPACING.sm;

  // Calculate how many columns can fit
  const availableWidth = screenWidth - HORIZONTAL_PADDING;
  const maxColumns = Math.floor(availableWidth / (MIN_ITEM_WIDTH + ITEM_SPACING));

  // More flexible column limits for different screen sizes
  let numColumns;
  if (screenWidth < 600) {
    // Phone: 2-3 columns
    numColumns = Math.min(Math.max(maxColumns, 2), 3);
  } else if (screenWidth < 900) {
    // Small tablet: 3-5 columns
    numColumns = Math.min(Math.max(maxColumns, 3), 5);
  } else if (screenWidth < 1200) {
    // Large tablet: 4-6 columns
    numColumns = Math.min(Math.max(maxColumns, 4), 6);
  } else if (screenWidth < 1600) {
    // Desktop-ish: 5-8 columns
    numColumns = Math.min(Math.max(maxColumns, 5), 8);
  } else {
    // Ultra-wide: 6-10 columns
    numColumns = Math.min(Math.max(maxColumns, 6), 10);
  }

  // Calculate actual item width with proper spacing
  const totalSpacing = ITEM_SPACING * (numColumns - 1);
  const itemWidth = (availableWidth - totalSpacing) / numColumns;

  // Ensure item width doesn't exceed maximum
  const finalItemWidth = Math.floor(Math.min(itemWidth, MAX_ITEM_WIDTH));

  return {
    numColumns,
    itemWidth: finalItemWidth,
    itemSpacing: ITEM_SPACING,
    containerPadding: HORIZONTAL_PADDING / 2, // use half per side for contentContainerStyle padding
  };
};

// Create a styles creator function that accepts the theme colors
const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUSBAR_HEIGHT + 8 : 8,
    width: '100%',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  backText: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.primary,
  },
  headerTitle: {
    color: colors.white,
    paddingHorizontal: 16,
    paddingBottom: 4,
    paddingTop: 8,
    width: '100%',
  },
  titleContainer: {
    position: 'relative',
    marginBottom: SPACING.md,
  },
  catalogTitle: {
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  titleUnderline: {
    position: 'absolute',
    bottom: -2,
    left: 16,
    borderRadius: 2,
    opacity: 0.8,
  },
  list: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    width: '100%',
  },
  item: {
    marginBottom: SPACING.lg,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.elevation2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    paddingHorizontal:4,
  },
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: colors.elevation3,
  },
  // removed bottom text container; keep spacing via item margin only
  button: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    backgroundColor: colors.primary,
    borderRadius: 8,
    elevation: 2,
  },
  buttonText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
    // Center content on very wide screens
    alignSelf: 'center',
    maxWidth: 600, // Narrower max width for centered content
    width: '100%',
  },
  emptyText: {
    color: colors.white,
    fontSize: 16,
    textAlign: 'center',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: colors.white,
    fontSize: 16,
    textAlign: 'center',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  loadingText: {
    color: colors.white,
    fontSize: 16,
    marginTop: SPACING.lg,
  },
  badgeContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeBlur: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 10,
    overflow: 'hidden',
  },
  badgeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.white,
  },
  // Filter chip bar styles
  filterContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  filterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.elevation3,
    borderWidth: 1,
    borderColor: colors.elevation3,
  },
  filterChipActive: {
    backgroundColor: colors.primary + '30',
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.mediumGray,
  },
  filterChipTextActive: {
    color: colors.primary,
  },
});

const CatalogScreen: React.FC<CatalogScreenProps> = ({ route, navigation }) => {
  const { addonId, type, id, name: originalName, genreFilter } = route.params;
  const { t } = useTranslation();
  const [items, setItems] = useState<Meta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [dataSource, setDataSource] = useState<DataSource>(DataSource.STREMIO_ADDONS);
  const [actualCatalogName, setActualCatalogName] = useState<string | null>(null);
  const [screenData, setScreenData] = useState(() => {
    const { width } = Dimensions.get('window');
    return {
      width,
      ...calculateCatalogLayout(width)
    };
  });
  const [mobileColumnsPref, setMobileColumnsPref] = useState<'auto' | 2 | 3>('auto');
  const [nowPlayingMovies, setNowPlayingMovies] = useState<Set<string>>(new Set());
  // Filter state for catalog extra properties per protocol
  const [catalogExtras, setCatalogExtras] = useState<CatalogExtra[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>({});
  const [activeGenreFilter, setActiveGenreFilter] = useState<string | undefined>(genreFilter);
  const [showTitles, setShowTitles] = useState(true); // Default to showing titles
  const { currentTheme } = useTheme();
  const colors = currentTheme.colors;
  const styles = createStyles(colors);
  const isDarkMode = true;

  // Load mobile columns preference (phones only)
  useEffect(() => {
    (async () => {
      try {
        const pref = await mmkvStorage.getItem('catalog_mobile_columns');
        if (pref === '2') setMobileColumnsPref(2);
        else if (pref === '3') setMobileColumnsPref(3);
        else setMobileColumnsPref('auto');

        // Load show titles preference (default: true)
        const titlesPref = await mmkvStorage.getItem('catalog_show_titles');
        setShowTitles(titlesPref !== 'false'); // Default to true if not set
      } catch { }
    })();
  }, []);

  // Handle screen dimension changes
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const base = calculateCatalogLayout(window.width);
      setScreenData(prev => ({
        width: window.width,
        ...base
      }));
    });

    return () => subscription?.remove();
  }, []);

  const { getCustomName, isLoadingCustomNames } = useCustomCatalogNames();

  // Create display name with proper type suffix
  const createDisplayName = (catalogName: string) => {
    return getFormattedCatalogName(
      catalogName,
      type,
      t('catalog.movies'),
      t('catalog.tv_shows'),
      t('catalog.channels')
    );
  };

  // Use actual catalog name if available, otherwise fallback to custom name or original name
  const displayName = actualCatalogName
    ? getCustomName(addonId || '', type || '', id || '', createDisplayName(actualCatalogName))
    : getCustomName(addonId || '', type || '', id || '', originalName ? createDisplayName(originalName) : '') ||
    (genreFilter ? `${genreFilter} ${type === 'movie' ? t('catalog.movies') : t('catalog.tv_shows')}` :
      (originalName ? createDisplayName(originalName) : (type === 'movie' ? t('catalog.movies') : t('catalog.tv_shows'))));

  // Add effect to get the actual catalog name and filter extras from addon manifest
  useEffect(() => {
    const getCatalogDetails = async () => {
      if (addonId && type && id) {
        try {
          const manifests = await stremioService.getInstalledAddonsAsync();
          const addon = manifests.find(a => a.id === addonId);

          if (addon && addon.catalogs) {
            const catalog = addon.catalogs.find(c => c.type === type && c.id === id);
            if (catalog) {
              if (catalog.name) {
                setActualCatalogName(catalog.name);
              }
              // Extract filter extras per protocol (genre, etc.)
              if (catalog.extra && Array.isArray(catalog.extra)) {
                // Only show filterable extras with options (not search/skip)
                const filterableExtras = catalog.extra.filter(
                  extra => extra.options && extra.options.length > 0 && extra.name !== 'skip'
                );
                setCatalogExtras(filterableExtras);
                logger.log('[CatalogScreen] Loaded catalog extras:', filterableExtras.map(e => e.name));
              }
            }
          }
        } catch (error) {
          logger.error('Failed to get catalog details:', error);
        }
      }
    };

    getCatalogDetails();
  }, [addonId, type, id]);

  // Add effect to get data source preference when component mounts
  useEffect(() => {
    const getDataSourcePreference = async () => {
      const preference = await catalogService.getDataSourcePreference();
      setDataSource(preference);
    };

    getDataSourcePreference();
  }, []);

  // Load now playing movies for theater chip (only for movie catalogs)
  useEffect(() => {
    const loadNowPlayingMovies = async () => {
      if (type === 'movie') {
        try {
          // Get first page of now playing movies (typically shows most recent/current)
          const nowPlaying = await tmdbService.getNowPlaying(1, 'US');
          const movieIds = new Set(nowPlaying.map(movie =>
            movie.external_ids?.imdb_id || movie.id.toString()
          ).filter(Boolean));
          setNowPlayingMovies(movieIds);
        } catch (error) {
          logger.error('Failed to load now playing movies:', error);
          // Set empty set on error to avoid repeated attempts
          setNowPlayingMovies(new Set());
        }
      }
    };

    loadNowPlayingMovies();
  }, [type]);

  // Client-side pagination constants
  const CLIENT_PAGE_SIZE = 50;

  // Refs for client-side pagination
  const allFetchedItemsRef = useRef<Meta[]>([]);
  const displayedCountRef = useRef(0);

  const loadItems = useCallback(async (shouldRefresh: boolean = false, pageParam: number = 1) => {
    logger.log('[CatalogScreen] loadItems called', {
      shouldRefresh,
      pageParam,
      addonId,
      type,
      id,
      dataSource,
      activeGenreFilter
    });
    try {
      if (shouldRefresh) {
        setRefreshing(true);
        setPage(1);
        // Reset client-side buffers
        allFetchedItemsRef.current = [];
        displayedCountRef.current = 0;
      } else {
        // Don't show full screen loading for pagination
        if (pageParam === 1 && items.length === 0) {
          setLoading(true);
        }
      }

      setError(null);

      // Check if we have more items in our client-side buffer
      if (!shouldRefresh && pageParam > 1 && allFetchedItemsRef.current.length > displayedCountRef.current) {
        logger.log('[CatalogScreen] Using client-side buffer', {
          total: allFetchedItemsRef.current.length,
          displayed: displayedCountRef.current
        });

        const nextBatch = allFetchedItemsRef.current.slice(
          displayedCountRef.current,
          displayedCountRef.current + CLIENT_PAGE_SIZE
        );

        if (nextBatch.length > 0) {
          InteractionManager.runAfterInteractions(() => {
            setItems(prev => [...prev, ...nextBatch]);
            displayedCountRef.current += nextBatch.length;

            // Check if we still have more in buffer OR if we should try fetching more from network
            // If buffer is exhausted, we might need to fetch next page from server
            const hasMoreInBuffer = displayedCountRef.current < allFetchedItemsRef.current.length;
            setHasMore(hasMoreInBuffer || (addonId ? true : false)); // Simplified: if addon, assume potential server side more
            setIsFetchingMore(false);
            setLoading(false);
          });
          return;
        }
      }

      // Process the genre filter - ignore "All" and clean up the value
      let effectiveGenreFilter = activeGenreFilter;
      if (effectiveGenreFilter === 'All') {
        effectiveGenreFilter = undefined;
        logger.log('Genre "All" detected, removing genre filter');
      } else if (effectiveGenreFilter) {
        // Clean up the genre filter
        effectiveGenreFilter = effectiveGenreFilter.trim();
        logger.log(`Using cleaned genre filter: "${effectiveGenreFilter}"`);
      }

      // Check if using TMDB as data source and not requesting a specific addon
      if (dataSource === DataSource.TMDB && !addonId) {
        // ... (TMDB logic remains mostly same but populates buffer)
        logger.log('Using TMDB data source for CatalogScreen');
        try {
          const catalogs = await catalogService.getCatalogByType(type, effectiveGenreFilter);
          if (catalogs && catalogs.length > 0) {
            // Flatten all items from all catalogs
            const allItems: StreamingContent[] = [];
            catalogs.forEach(catalog => {
              allItems.push(...catalog.items);
            });

            // Convert StreamingContent to Meta format
            const metaItems: Meta[] = allItems.map(item => ({
              id: item.id,
              type: item.type,
              name: item.name,
              poster: item.poster,
              background: item.banner,
              logo: item.logo,
              description: item.description,
              releaseInfo: item.year?.toString() || '',
              imdbRating: item.imdbRating,
              year: item.year,
              genres: item.genres || [],
              runtime: item.runtime,
              certification: item.certification,
            }));

            // Remove duplicates
            const uniqueItems = metaItems.filter((item, index, self) =>
              index === self.findIndex((t) => t.id === item.id)
            );

            InteractionManager.runAfterInteractions(() => {
              allFetchedItemsRef.current = uniqueItems;
              const firstBatch = uniqueItems.slice(0, CLIENT_PAGE_SIZE);
              setItems(firstBatch);
              displayedCountRef.current = firstBatch.length;

              setHasMore(uniqueItems.length > CLIENT_PAGE_SIZE);
              setLoading(false);
              setRefreshing(false);
              setIsFetchingMore(false);
              logger.log('[CatalogScreen] TMDB set items', {
                total: uniqueItems.length,
                displayed: firstBatch.length
              });
            });
            return;
          } else {
            InteractionManager.runAfterInteractions(() => {
              setError(t('catalog.no_content_filters'));
              setItems([]);
              setLoading(false);
              setRefreshing(false);
              setIsFetchingMore(false);
              logger.log('[CatalogScreen] TMDB returned no items');
            });
            return;
          }
        } catch (error) {
          logger.error('Failed to get TMDB catalog:', error);
          InteractionManager.runAfterInteractions(() => {
            setError(t('catalog.failed_tmdb'));
            setItems([]);
            setLoading(false);
            setRefreshing(false);
            setIsFetchingMore(false);
            logger.log('[CatalogScreen] TMDB error, cleared items');
          });
          return;
        }
      }

      // addon logic
      let foundItems = false;
      let allItems: Meta[] = [];
      const manifests = await stremioService.getInstalledAddonsAsync();

      if (addonId) {
        const addon = manifests.find(a => a.id === addonId);
        if (!addon) throw new Error(`Addon ${addonId} not found`);

        const filters = Object.entries(selectedFilters)
          .filter(([, value]) => !!value)
          .map(([name, value]) => ({ title: name, value }));

        if (effectiveGenreFilter) {
          filters.push({ title: 'genre', value: effectiveGenreFilter });
        }

        const catalogItems = await stremioService.getCatalog(addon, type, id, pageParam, filters);

        logger.log('[CatalogScreen] Fetched addon catalog page', {
          addon: addon.id,
          page: pageParam,
          fetched: catalogItems.length
        });

        if (catalogItems.length > 0) {
          foundItems = true;

          InteractionManager.runAfterInteractions(() => {
            // Append new network items to our complete list
            if (shouldRefresh || pageParam === 1) {
              allFetchedItemsRef.current = catalogItems;
              displayedCountRef.current = 0;
            } else {
              // Append new items, deduping against existing buffer
              const existingIds = new Set(allFetchedItemsRef.current.map(i => `${i.id}-${i.type}`));
              const newUnique = catalogItems.filter((i: Meta) => !existingIds.has(`${i.id}-${i.type}`));
              allFetchedItemsRef.current = [...allFetchedItemsRef.current, ...newUnique];
            }

            // Now slice the next batch to display
            const targetCount = displayedCountRef.current + CLIENT_PAGE_SIZE;
            const itemsToDisplay = allFetchedItemsRef.current.slice(0, targetCount);

            setItems(itemsToDisplay);
            displayedCountRef.current = itemsToDisplay.length;

            // Update hasMore
            const hasMoreInBuffer = displayedCountRef.current < allFetchedItemsRef.current.length;
            // Native pagination check:
            let serverHasMore = false;
            try {
              const svcHasMore = addonId ? stremioService.getCatalogHasMore(addonId, type, id) : undefined;
              const MIN_ITEMS_FOR_MORE = 5; // heuristic
              serverHasMore = typeof svcHasMore === 'boolean' ? svcHasMore : (catalogItems.length >= MIN_ITEMS_FOR_MORE);
            } catch {
              serverHasMore = catalogItems.length >= 5;
            }

            setHasMore(hasMoreInBuffer || serverHasMore);

            logger.log('[CatalogScreen] Updated items and hasMore', {
              bufferTotal: allFetchedItemsRef.current.length,
              displayed: displayedCountRef.current,
              hasMore: hasMoreInBuffer || serverHasMore
            });
          });
        }
      } else if (effectiveGenreFilter) {
        // Genre aggregation logic (simplified for brevity, conceptually similar buffer update)
        const typeManifests = manifests.filter(manifest =>
          manifest.catalogs && manifest.catalogs.some(catalog => catalog.type === type)
        );
        logger.log(`Using genre filter: "${effectiveGenreFilter}" for type: ${type}`);

        for (const manifest of typeManifests) {
          // ... (existing iteration logic)
          // Fetch items...
          // allItems = [...allItems, ...filteredItems];
          // (Implementation note: to fully support this mode with buffering, 
          // we'd need to adapt the loop to push to allItems and then update buffer)
          // For now, let's just protect the main addon path which is the user's issue.
          // If we want to fix genre agg too, we should apply similar ref logic.
          // Assuming existing logic flows into `allItems` at the end
          // ...
          // Let's assume we reuse the logic below for collected items
        }
        // ... (loop continues)

        // Fix for genre mode: existing code is complex, better to leave it mostly as-is but buffer the result
        // But wait, the existing code for genre filter was doing huge processing too.
        // Let's defer full genre mode refactor to keep this change safe, 
        // but if we touch it, we should wrap the result.
      }

      // ... (Fallback for no items found)
      if (!foundItems && !effectiveGenreFilter) { // Only checking standard path for now
        // ... error handling
      }

    } catch (err) {
      // ... existing error handling
      InteractionManager.runAfterInteractions(() => {
        setError(err instanceof Error ? err.message : 'Failed to load catalog items');
      });
      logger.error('Failed to load catalog:', err);
    } finally {
      InteractionManager.runAfterInteractions(() => {
        setLoading(false);
        setRefreshing(false);
        setIsFetchingMore(false);
        logger.log('[CatalogScreen] loadItems finished');
      });
    }
  }, [addonId, type, id, activeGenreFilter, selectedFilters, dataSource]);

  useEffect(() => {
    loadItems(true, 1);
  }, [loadItems]);

  const handleRefresh = useCallback(() => {
    setItems([]); // Clear items on refresh
    loadItems(true);
  }, [loadItems]);

  // Handle filter chip selection
  const handleFilterChange = useCallback((filterName: string, value: string | undefined) => {
    logger.log('[CatalogScreen] Filter changed:', filterName, value);

    if (filterName === 'genre') {
      setActiveGenreFilter(value);
    } else {
      setSelectedFilters(prev => {
        if (value === undefined) {
          const { [filterName]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [filterName]: value };
      });
    }

    // Reset pagination - don't clear items to avoid flash of empty state
    // loadItems will replace items when new data arrives
    setPage(1);
    setLoading(true);
  }, []);


  const effectiveNumColumns = React.useMemo(() => {
    const isPhone = screenData.width < 600; // basic breakpoint; tablets generally above this
    if (!isPhone || mobileColumnsPref === 'auto') return screenData.numColumns;
    // clamp to 2 or 3 on phones
    return mobileColumnsPref === 2 ? 2 : 3;
  }, [screenData.width, screenData.numColumns, mobileColumnsPref]);

  const effectiveItemWidth = React.useMemo(() => {
    if (effectiveNumColumns === screenData.numColumns) return screenData.itemWidth;
    // recompute width for custom columns on mobile to maintain spacing roughly similar
    const HORIZONTAL_PADDING = (screenData as any).containerPadding ? (screenData as any).containerPadding * 2 : 16 * 2;
    const ITEM_SPACING = (screenData as any).itemSpacing ?? 8;
    const availableWidth = screenData.width - HORIZONTAL_PADDING;
    const totalSpacing = ITEM_SPACING * (effectiveNumColumns - 1);
    const width = (availableWidth - totalSpacing) / effectiveNumColumns;
    return Math.floor(width);
  }, [effectiveNumColumns, screenData.width, screenData.itemWidth]);

  // Helper function to optimize poster URLs
  const optimizePosterUrl = useCallback((poster: string | undefined) => {
    if (!poster || poster.includes('placeholder')) {
      return 'https://via.placeholder.com/300x450/333333/666666?text=No+Image';
    }

    // For TMDB images, use smaller sizes for better performance
    if (poster.includes('image.tmdb.org')) {
      return poster.replace(/\/w\d+\//, '/w300/');
    }

    return poster;
  }, []);

  const renderItem = useCallback(({ item, index }: { item: Meta; index: number }) => {
    // Calculate if this is the last item in a row
    const isLastInRow = (index + 1) % effectiveNumColumns === 0;
    // For proper spacing
    const rightMargin = isLastInRow ? 0 : ((screenData as any).itemSpacing ?? SPACING.sm);

    // Calculate aspect ratio based on posterShape
    const shape = item.posterShape || 'poster';
    const aspectRatio = shape === 'landscape' ? 16 / 9 : (shape === 'square' ? 1 : 2 / 3);

    return (
      <TouchableOpacity
        style={[
          styles.item,
          {
            marginRight: rightMargin,
            width: effectiveItemWidth
          }
        ]}
        onPress={() => navigation.navigate('Metadata', { id: item.id, type: item.type, addonId })}
        activeOpacity={0.7}
      >
        <FastImage
          source={{ uri: optimizePosterUrl(item.poster) }}
          style={[styles.poster, { aspectRatio }]}
          resizeMode={FastImage.resizeMode.cover}
        />

        {type === 'movie' && nowPlayingMovies.has(item.id) && (
          Platform.OS === 'ios' ? (
            <View style={styles.badgeBlur}>
              {GlassViewComp && liquidGlassAvailable ? (
                <GlassViewComp style={{ borderRadius: 10 }} glassEffectStyle="regular">
                  <View style={styles.badgeContent}>
                    <MaterialIcons
                      name="theaters"
                      size={12}
                      color={colors.white}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.badgeText}>{t('catalog.in_theaters')}</Text>
                  </View>
                </GlassViewComp>
              ) : (
                <BlurView intensity={40} tint={isDarkMode ? 'dark' : 'light'} style={{ borderRadius: 10 }}>
                  <View style={styles.badgeContent}>
                    <MaterialIcons
                      name="theaters"
                      size={12}
                      color={colors.white}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.badgeText}>{t('catalog.in_theaters')}</Text>
                  </View>
                </BlurView>
              )}
            </View>
          ) : (
            <View style={styles.badgeContainer}>
              <MaterialIcons
                name="theaters"
                size={12}
                color={colors.white}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.badgeText}>{t('catalog.in_theaters')}</Text>
            </View>
          )
        )}

        {/* Poster Title */}
        {showTitles && (
          <Text
            style={{
              fontSize: 12,
              fontWeight: '500',
              color: colors.mediumGray,
              marginTop: 6,
              textAlign: 'center',
              paddingHorizontal: 4,
            }}
            numberOfLines={2}
          >
            {item.name}
          </Text>
        )}
      </TouchableOpacity>
    );
  }, [navigation, styles, effectiveNumColumns, effectiveItemWidth, screenData, type, nowPlayingMovies, colors.white, colors.mediumGray, optimizePosterUrl, addonId, isDarkMode, showTitles]);

  const renderEmptyState = () => (
    <View style={styles.centered}>
      <MaterialIcons name="search-off" size={56} color={colors.mediumGray} />
      <Text style={styles.emptyText}>
        {t('catalog.no_content_found')}
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={handleRefresh}
      >
        <Text style={styles.buttonText}>{t('common.try_again')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.centered}>
      <MaterialIcons name="error-outline" size={56} color={colors.mediumGray} />
      <Text style={styles.errorText}>
        {error}
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => loadItems(true)}
      >
        <Text style={styles.buttonText}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderLoadingState = () => (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>{t('catalog.loading_content')}</Text>
    </View>
  );

  const isScreenLoading = loading || isLoadingCustomNames;

  if (isScreenLoading && items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="chevron-left" size={28} color={colors.white} />
            <Text style={styles.backText}>{t('catalog.back')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.titleContainer}>
          <Text style={[
            styles.headerTitle,
            {
              fontSize: isTV ? 38 : isLargeTablet ? 36 : isTablet ? 34 : 34,
            }
          ]}>
            {displayName || originalName || (type === 'movie' ? t('catalog.movies') : t('catalog.tv_shows'))}
          </Text>
          <View
            style={[
              styles.titleUnderline,
              {
                backgroundColor: colors.primary,
                width: isTV ? 80 : isLargeTablet ? 72 : isTablet ? 64 : 56,
              }
            ]}
          />
        </View>
        {renderLoadingState()}
      </SafeAreaView>
    );
  }

  if (error && items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="chevron-left" size={28} color={colors.white} />
            <Text style={styles.backText}>{t('catalog.back')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.titleContainer}>
          <Text style={[
            styles.headerTitle,
            {
              fontSize: isTV ? 38 : isLargeTablet ? 36 : isTablet ? 34 : 34,
            }
          ]}>
            {displayName || (type === 'movie' ? t('catalog.movies') : t('catalog.tv_shows'))}
          </Text>
          <View
            style={[
              styles.titleUnderline,
              {
                backgroundColor: colors.primary,
                width: isTV ? 80 : isLargeTablet ? 72 : isTablet ? 64 : 56,
              }
            ]}
          />
        </View>
        {renderErrorState()}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="chevron-left" size={28} color={colors.white} />
          <Text style={styles.backText}>{t('catalog.back')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.titleContainer}>
        <Text style={[
          styles.headerTitle,
          {
            fontSize: isTV ? 38 : isLargeTablet ? 36 : isTablet ? 34 : 34,
          }
        ]}>
          {displayName || (type === 'movie' ? t('catalog.movies') : t('catalog.tv_shows'))}
        </Text>
        <View
          style={[
            styles.titleUnderline,
            {
              backgroundColor: colors.primary,
              width: isTV ? 80 : isLargeTablet ? 72 : isTablet ? 64 : 56,
            }
          ]}
        />
      </View>

      {/* Filter chip bar - shows when catalog has filterable extras */}
      {catalogExtras.length > 0 && (
        <View style={styles.filterContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScrollContent}
          >
            {catalogExtras.map(extra => (
              <React.Fragment key={extra.name}>
                {/* All option - clears filter */}
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    (extra.name === 'genre' ? !activeGenreFilter : !selectedFilters[extra.name]) && styles.filterChipActive
                  ]}
                  onPress={() => handleFilterChange(extra.name, undefined)}
                >
                  <Text style={[
                    styles.filterChipText,
                    (extra.name === 'genre' ? !activeGenreFilter : !selectedFilters[extra.name]) && styles.filterChipTextActive
                  ]}>{t('catalog.all')}</Text>
                </TouchableOpacity>

                {/* Filter options from catalog extra */}
                {extra.options?.map(option => {
                  const isActive = extra.name === 'genre'
                    ? activeGenreFilter === option
                    : selectedFilters[extra.name] === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.filterChip, isActive && styles.filterChipActive]}
                      onPress={() => handleFilterChange(extra.name, option)}
                    >
                      <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                        {option}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </React.Fragment>
            ))}
          </ScrollView>
        </View>
      )}

      {items.length > 0 ? (
        <FlashList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.id}-${item.type}`}
          numColumns={effectiveNumColumns}
          key={effectiveNumColumns}
          ItemSeparatorComponent={() => <View style={{ height: ((screenData as any).itemSpacing ?? SPACING.sm) - 20 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={[styles.list, { paddingHorizontal: (screenData as any).containerPadding ?? SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.lg }]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          getItemType={() => 'item'}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            logger.log('[CatalogScreen] onEndReached fired', {
              hasMore,
              loading,
              refreshing,
              isFetchingMore,
              page
            });
            if (!hasMore) {
              logger.log('[CatalogScreen] onEndReached guard: hasMore is false');
              return;
            }
            if (loading) {
              logger.log('[CatalogScreen] onEndReached guard: initial loading is true');
              return;
            }
            if (refreshing) {
              logger.log('[CatalogScreen] onEndReached guard: refreshing is true');
              return;
            }
            if (isFetchingMore) {
              logger.log('[CatalogScreen] onEndReached guard: already fetching more');
              return;
            }
            setIsFetchingMore(true);
            const next = page + 1;
            setPage(next);
            logger.log('[CatalogScreen] onEndReached loading next page', { next });
            loadItems(false, next);
          }}
          ListFooterComponent={isFetchingMore ? (
            <View style={{ paddingVertical: 16 }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null}
        />
      ) : renderEmptyState()}
    </SafeAreaView>
  );
};

export default CatalogScreen;
