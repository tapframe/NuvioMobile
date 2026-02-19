import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  Keyboard,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import { catalogService, StreamingContent, GroupedSearchResults, AddonSearchResults } from '../services/catalogService';
import debounce from 'lodash/debounce';
import { DropUpMenu } from '../components/home/DropUpMenu';
import { DeviceEventEmitter, Share } from 'react-native';
import { mmkvStorage } from '../services/mmkvStorage';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { RootStackParamList } from '../navigation/AppNavigator';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import ScreenHeader from '../components/common/ScreenHeader';
import { useScrollToTop } from '../contexts/ScrollToTopContext';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useSettings } from '../hooks/useSettings';
import { useTraktContext } from '../contexts/TraktContext';
import { useToast } from '../contexts/ToastContext';

// Import extracted search components
import {
  DiscoverCatalog,
  isTablet,
  isLargeTablet,
  isTV,
  RECENT_SEARCHES_KEY,
  MAX_RECENT_SEARCHES,
} from '../components/search/searchUtils';
import { searchStyles as styles } from '../components/search/searchStyles';
import { SearchAnimation } from '../components/search/SearchAnimation';
import { AddonSection } from '../components/search/AddonSection';
import { DiscoverSection } from '../components/search/DiscoverSection';
import { DiscoverBottomSheets } from '../components/search/DiscoverBottomSheets';

const { width } = Dimensions.get('window');
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

// Add constants for saved settings keys
const DISCOVER_TYPE_KEY = 'discover_selected_type';
const DISCOVER_CATALOG_KEY = 'discover_selected_catalog';
const DISCOVER_GENRE_KEY = 'discover_selected_genre';

const SearchScreen = () => {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { addToWatchlist, removeFromWatchlist, addToCollection, removeFromCollection, isInWatchlist, isInCollection } = useTraktContext();
  const { showSuccess, showInfo } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GroupedSearchResults>({ byAddon: [], allResults: [] });
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(true);
  const inputRef = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const { currentTheme } = useTheme();
  const liveSearchHandle = useRef<{ cancel: () => void; done: Promise<void> } | null>(null);
  const addonOrderRankRef = useRef<Record<string, number>>({});
  const isInitialMount = useRef(true);
  const isMounted = useRef(true);
  const scrollViewRef = useRef<ScrollView>(null);

  // Discover section state
  const [discoverCatalogs, setDiscoverCatalogs] = useState<DiscoverCatalog[]>([]);
  const [selectedCatalog, setSelectedCatalog] = useState<DiscoverCatalog | null>(null);
  const [selectedDiscoverType, setSelectedDiscoverType] = useState<'movie' | 'series'>('movie');
  const [selectedDiscoverGenre, setSelectedDiscoverGenre] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [discoverResults, setDiscoverResults] = useState<StreamingContent[]>([]);
  const [pendingDiscoverResults, setPendingDiscoverResults] = useState<StreamingContent[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverInitialized, setDiscoverInitialized] = useState(false);

  // Bottom sheet refs
  const typeSheetRef = useRef<BottomSheetModal>(null);
  const catalogSheetRef = useRef<BottomSheetModal>(null);
  const genreSheetRef = useRef<BottomSheetModal>(null);

  // DropUpMenu state
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StreamingContent | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isWatched, setIsWatched] = useState(false);

  // Animation values
  const searchBarWidth = useSharedValue(width - 32);
  const backButtonOpacity = useSharedValue(0);

  // Scroll to top handler
  const scrollToTop = useCallback(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  useScrollToTop('Search', scrollToTop);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Load saved discover settings on mount
  useEffect(() => {
    const loadSavedDiscoverSettings = async () => {
      try {
        // Load saved type
        const savedType = await mmkvStorage.getItem(DISCOVER_TYPE_KEY);
        if (savedType && (savedType === 'movie' || savedType === 'series')) {
          setSelectedDiscoverType(savedType);
        }

        // Note: We'll load catalog and genre after discoverCatalogs are loaded
      } catch (error) {
        logger.error('Failed to load saved discover settings:', error);
      }
    };

    loadSavedDiscoverSettings();
  }, []);

  // Save discover settings when they change
  const saveDiscoverSettings = useCallback(async (type: 'movie' | 'series', catalog: DiscoverCatalog | null, genre: string | null) => {
    try {
      // Save type
      await mmkvStorage.setItem(DISCOVER_TYPE_KEY, type);

      // Save catalog if available
      if (catalog) {
        const catalogData = {
          addonId: catalog.addonId,
          catalogId: catalog.catalogId,
          type: catalog.type,
        };
        await mmkvStorage.setItem(DISCOVER_CATALOG_KEY, JSON.stringify(catalogData));
      } else {
        // Clear catalog if null
        await mmkvStorage.removeItem(DISCOVER_CATALOG_KEY);
      }

      // Save genre - use empty string to indicate "All genres"
      // This way we distinguish between "not set" and "All genres"
      if (genre) {
        await mmkvStorage.setItem(DISCOVER_GENRE_KEY, genre);
      } else {
        // Save empty string to indicate "All genres" is selected
        await mmkvStorage.setItem(DISCOVER_GENRE_KEY, '');
      }
    } catch (error) {
      logger.error('Failed to save discover settings:', error);
    }
  }, []);

  // Load saved catalog and genre after discoverCatalogs are loaded
  useEffect(() => {
    const loadSavedCatalogAndGenre = async () => {
      if (discoverCatalogs.length === 0) return;

      try {
        // Load saved catalog
        const savedCatalogData = await mmkvStorage.getItem(DISCOVER_CATALOG_KEY);
        if (savedCatalogData) {
          try {
            const parsedCatalog = JSON.parse(savedCatalogData);
            const foundCatalog = discoverCatalogs.find(catalog =>
              catalog.addonId === parsedCatalog.addonId &&
              catalog.catalogId === parsedCatalog.catalogId &&
              catalog.type === parsedCatalog.type
            );

            if (foundCatalog) {
              setSelectedCatalog(foundCatalog);

              // Load saved genre
              const savedGenre = await mmkvStorage.getItem(DISCOVER_GENRE_KEY);
              if (savedGenre !== null) {
                if (savedGenre === '') {
                  // Empty string means "All genres" was selected
                  setSelectedDiscoverGenre(null);
                } else if (foundCatalog.genres.includes(savedGenre)) {
                  setSelectedDiscoverGenre(savedGenre);
                } else if (foundCatalog.genres.length > 0) {
                  // Set first genre as default if saved genre not available
                  setSelectedDiscoverGenre(foundCatalog.genres[0]);
                }
              } else {
                // No saved genre, default to first genre
                if (foundCatalog.genres.length > 0) {
                  setSelectedDiscoverGenre(foundCatalog.genres[0]);
                }
              }
              return;
            }
          } catch (parseError) {
            logger.error('Failed to parse saved catalog data:', parseError);
          }
        }

        // Default behavior if no saved catalog found
        if (discoverCatalogs.length > 0) {
          const firstCatalog = discoverCatalogs[0];
          setSelectedCatalog(firstCatalog);
          if (firstCatalog.genres.length > 0) {
            setSelectedDiscoverGenre(firstCatalog.genres[0]);
          }
        }
      } catch (error) {
        logger.error('Failed to load saved catalog and genre:', error);
      }
    };

    loadSavedCatalogAndGenre();
  }, [discoverCatalogs]);

  useEffect(() => {
    const focusSubscription = DeviceEventEmitter.addListener('FOCUS_SEARCH_INPUT', () => {
      // Optional: Reset search state if user double taps while on search
      if (query.length === 0) {
        setResults({ byAddon: [], allResults: [] });
        setSearched(false);
        setShowRecent(true);
      }

      // Use a small timeout to ensure the UI is ready
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 120);
    });

    return () => focusSubscription.remove();
  }, [query]);

  // Update isSaved and isWatched when selectedItem changes
  useEffect(() => {
    if (!selectedItem) return;
    (async () => {
      const items = await catalogService.getLibraryItems();
      const found = items.find((libItem: any) => libItem.id === selectedItem.id && libItem.type === selectedItem.type);
      setIsSaved(!!found);
      const val = await mmkvStorage.getItem(`watched:${selectedItem.type}:${selectedItem.id}`);
      setIsWatched(val === 'true');
    })();
  }, [selectedItem]);

  const handleShowMore = () => {
    if (pendingDiscoverResults.length === 0) return;
    const batchSize = 50;
    const nextBatch = pendingDiscoverResults.slice(0, batchSize);
    const remaining = pendingDiscoverResults.slice(batchSize);
    setDiscoverResults(prev => [...prev, ...nextBatch]);
    setPendingDiscoverResults(remaining);
  };

  // Load discover catalogs on mount
  useEffect(() => {
    const loadDiscoverCatalogs = async () => {
      try {
        const filters = await catalogService.getDiscoverFilters();
        if (isMounted.current) {
          const allCatalogs: DiscoverCatalog[] = [];
          for (const [type, catalogs] of Object.entries(filters.catalogsByType)) {
            if (type === 'movie' || type === 'series') {
              for (const catalog of catalogs) {
                allCatalogs.push({ ...catalog, type });
              }
            }
          }
          setDiscoverCatalogs(allCatalogs);
          setDiscoverInitialized(true);
        }
      } catch (error) {
        logger.error('Failed to load discover catalogs:', error);
        if (isMounted.current) setDiscoverInitialized(true);
      }
    };
    loadDiscoverCatalogs();
  }, []);

  // Fetch discover content when catalog or genre changes
  useEffect(() => {
    if (!discoverInitialized || !selectedCatalog || query.trim().length > 0) return;

    const fetchDiscoverContent = async () => {
      if (!isMounted.current) return;
      setDiscoverLoading(true);
      setPage(1);
      setHasMore(true);
      setPendingDiscoverResults([]);
      try {
        const results = await catalogService.discoverContentFromCatalog(
          selectedCatalog.addonId,
          selectedCatalog.catalogId,
          selectedCatalog.type,
          selectedDiscoverGenre || undefined,
          1,
          selectedCatalog.filterKey || 'genre'
        );
        if (isMounted.current) {
          const seen = new Set<string>();
          const uniqueResults = results.filter(item => {
            const key = `${item.type}:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          const MAX_INITIAL_ITEMS = 100;
          if (uniqueResults.length > MAX_INITIAL_ITEMS) {
            setDiscoverResults(uniqueResults.slice(0, MAX_INITIAL_ITEMS));
            setPendingDiscoverResults(uniqueResults.slice(MAX_INITIAL_ITEMS));
            setHasMore(true);
          } else {
            setDiscoverResults(uniqueResults);
            setPendingDiscoverResults([]);
            setHasMore(uniqueResults.length >= 20);
          }
        }
      } catch (error) {
        logger.error('Failed to fetch discover content:', error);
        if (isMounted.current) setDiscoverResults([]);
      } finally {
        if (isMounted.current) setDiscoverLoading(false);
      }
    };

    fetchDiscoverContent();
  }, [discoverInitialized, selectedCatalog, selectedDiscoverGenre, query]);

  // Load more content for pagination
  const loadMoreDiscoverContent = async () => {
    if (!hasMore || loadingMore || discoverLoading || !selectedCatalog || pendingDiscoverResults.length > 0) return;

    setLoadingMore(true);
    const nextPage = page + 1;

    try {
      const moreResults = await catalogService.discoverContentFromCatalog(
        selectedCatalog.addonId,
        selectedCatalog.catalogId,
        selectedCatalog.type,
        selectedDiscoverGenre || undefined,
        nextPage,
        selectedCatalog.filterKey || 'genre'
      );

      if (isMounted.current) {
        if (moreResults.length > 0) {
          setDiscoverResults(prev => {
            const existingIds = new Set(prev.map(item => `${item.type}:${item.id}`));
            const newUniqueResults = moreResults.filter(item => {
              const key = `${item.type}:${item.id}`;
              return !existingIds.has(key);
            });

            if (newUniqueResults.length === 0) {
              setHasMore(false);
              return prev;
            }

            return [...prev, ...newUniqueResults];
          });
          setPage(nextPage);
        } else {
          setHasMore(false);
        }
      }
    } catch (error) {
      logger.error('Failed to load more discover content:', error);
      setHasMore(false);
    } finally {
      if (isMounted.current) setLoadingMore(false);
    }
  };

  // Force consistent status bar settings
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

  React.useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    loadRecentSearches();
    return () => { debouncedSearch.cancel(); };
  }, []);

  const animatedSearchBarStyle = useAnimatedStyle(() => ({
    width: searchBarWidth.value,
    opacity: 1,
  }));

  const handleSearchFocus = () => {
    searchBarWidth.value = withTiming(width - 80);
    backButtonOpacity.value = withTiming(1);
  };

  const handleSearchBlur = () => {
    if (!query) {
      searchBarWidth.value = withTiming(width - 32);
      backButtonOpacity.value = withTiming(0);
    }
  };

  const handleBackPress = () => {
    Keyboard.dismiss();
    if (query) {
      setQuery('');
      setResults({ byAddon: [], allResults: [] });
      setSearched(false);
      setShowRecent(true);
      loadRecentSearches();
    } else {
      if (Platform.OS === 'android') {
        setTimeout(() => navigation.goBack(), 100);
      } else {
        navigation.goBack();
      }
    }
  };

  const loadRecentSearches = async () => {
    try {
      const savedSearches = await mmkvStorage.getItem(RECENT_SEARCHES_KEY);
      if (savedSearches) setRecentSearches(JSON.parse(savedSearches));
    } catch (error) {
      logger.error('Failed to load recent searches:', error);
    }
  };

  const saveRecentSearch = async (searchQuery: string) => {
    try {
      setRecentSearches(prevSearches => {
        const newRecentSearches = [
          searchQuery,
          ...prevSearches.filter(s => s !== searchQuery)
        ].slice(0, MAX_RECENT_SEARCHES);
        mmkvStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(newRecentSearches));
        return newRecentSearches;
      });
    } catch (error) {
      logger.error('Failed to save recent search:', error);
    }
  };

  const debouncedSearch = useMemo(() => {
    return debounce(async (searchQuery: string) => {
      liveSearchHandle.current?.cancel();
      liveSearchHandle.current = null;
      performLiveSearch(searchQuery);
    }, 800);
  }, []);

  useFocusEffect(
    useCallback(() => {
      isMounted.current = true;
      return () => {
        isMounted.current = false;
        if (liveSearchHandle.current) {
          liveSearchHandle.current.cancel();
          liveSearchHandle.current = null;
        }
        debouncedSearch.cancel();
      };
    }, [debouncedSearch])
  );

  const performLiveSearch = async (searchQuery: string) => {
    if (!isMounted.current) return;
    if (!searchQuery || searchQuery.trim().length === 0) {
      setResults({ byAddon: [], allResults: [] });
      setSearching(false);
      return;
    }

    setSearching(true);
    setResults({ byAddon: [], allResults: [] });
    addonOrderRankRef.current = {};

    try {
      if (liveSearchHandle.current) liveSearchHandle.current.cancel();

      const addons = await catalogService.getAllAddons();
      const rank: Record<string, number> = {};
      let rankCounter = 0;
      rank['com.linvo.cinemeta'] = rankCounter++;
      addons.forEach(addon => {
        if (addon.id !== 'com.linvo.cinemeta') rank[addon.id] = rankCounter++;
      });
      addonOrderRankRef.current = rank;

      const handle = catalogService.startLiveSearch(searchQuery, async (section: AddonSearchResults) => {
        if (!isMounted.current) return;

        setResults(prev => {
          if (!isMounted.current) return prev;
          const getRank = (id: string) => addonOrderRankRef.current[id] ?? Number.MAX_SAFE_INTEGER;
          const existingIndex = prev.byAddon.findIndex(s => s.addonId === section.addonId);

          if (existingIndex >= 0) {
            const copy = prev.byAddon.slice();
            copy[existingIndex] = section;
            return { byAddon: copy, allResults: prev.allResults };
          }

          const insertRank = getRank(section.addonId);
          let insertAt = prev.byAddon.length;
          for (let i = 0; i < prev.byAddon.length; i++) {
            if (getRank(prev.byAddon[i].addonId) > insertRank) {
              insertAt = i;
              break;
            }
          }

          const nextByAddon = [
            ...prev.byAddon.slice(0, insertAt),
            section,
            ...prev.byAddon.slice(insertAt)
          ];

          if (prev.byAddon.length === 0) setSearching(false);
          return { byAddon: nextByAddon, allResults: prev.allResults };
        });

        try { await saveRecentSearch(searchQuery); } catch { }
      });

      liveSearchHandle.current = handle;
      await handle.done;
      if (isMounted.current) setSearching(false);
    } catch (error) {
      if (isMounted.current) {
        console.error('Live search error:', error);
        setSearching(false);
      }
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      loadRecentSearches();
      return;
    }

    if (query.trim() && query.trim().length >= 2) {
      setSearching(true);
      setSearched(true);
      setShowRecent(false);
      debouncedSearch(query);
    } else if (query.trim().length < 2 && query.trim().length > 0) {
      setSearching(false);
      setSearched(false);
      setShowRecent(false);
      setResults({ byAddon: [], allResults: [] });
    } else {
      debouncedSearch.cancel();
      liveSearchHandle.current?.cancel();
      liveSearchHandle.current = null;
      setResults({ byAddon: [], allResults: [] });
      setSearched(false);
      setSearching(false);
      setShowRecent(true);
      loadRecentSearches();
    }

    return () => { debouncedSearch.cancel(); };
  }, [query]);

  const handleClearSearch = () => {
    setQuery('');
    liveSearchHandle.current?.cancel();
    liveSearchHandle.current = null;
    setResults({ byAddon: [], allResults: [] });
    setSearched(false);
    setShowRecent(true);
    loadRecentSearches();
    inputRef.current?.focus();
  };

  const renderRecentSearches = () => {
    if (!showRecent || recentSearches.length === 0) return null;

    return (
      <View style={styles.recentSearchesContainer}>
        <Text style={[styles.carouselTitle, { color: currentTheme.colors.white }]}>
          {t('search.recent_searches')}
        </Text>
        {recentSearches.map((search, index) => (
          <TouchableOpacity
            key={index}
            style={styles.recentSearchItem}
            onPress={() => { setQuery(search); Keyboard.dismiss(); }}
          >
            <MaterialIcons name="history" size={20} color={currentTheme.colors.lightGray} style={styles.recentSearchIcon} />
            <Text style={[styles.recentSearchText, { color: currentTheme.colors.white }]}>{search}</Text>
            <TouchableOpacity
              onPress={() => {
                const newRecentSearches = [...recentSearches];
                newRecentSearches.splice(index, 1);
                setRecentSearches(newRecentSearches);
                mmkvStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(newRecentSearches));
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.recentSearchDeleteButton}
            >
              <MaterialIcons name="close" size={16} color={currentTheme.colors.lightGray} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const availableGenres = useMemo(() => selectedCatalog?.genres || [], [selectedCatalog]);
  const filteredCatalogs = useMemo(() => discoverCatalogs.filter(c => c.type === selectedDiscoverType), [discoverCatalogs, selectedDiscoverType]);

  const handleTypeSelect = (type: 'movie' | 'series') => {
    setSelectedDiscoverType(type);

    // Save type setting
    saveDiscoverSettings(type, selectedCatalog, selectedDiscoverGenre);

    const catalogsForType = discoverCatalogs.filter(c => c.type === type);

    // Try to find the same catalog in the new type
    let newCatalog = null;
    if (selectedCatalog) {
      newCatalog = catalogsForType.find(c =>
        c.addonId === selectedCatalog.addonId &&
        c.catalogId === selectedCatalog.catalogId
      );
    }

    // Fallback to first catalog if not found
    if (!newCatalog && catalogsForType.length > 0) {
      newCatalog = catalogsForType[0];
    }

    if (newCatalog) {
      setSelectedCatalog(newCatalog);

      // Try to preserve genre
      if (selectedDiscoverGenre && newCatalog.genres.includes(selectedDiscoverGenre)) {
        // Keep current genre - already saved
      } else if (newCatalog.genres.length > 0) {
        // Fallback to first genre if current not available
        const firstGenre = newCatalog.genres[0];
        setSelectedDiscoverGenre(firstGenre);
        saveDiscoverSettings(type, newCatalog, firstGenre);
      } else {
        setSelectedDiscoverGenre(null);
        saveDiscoverSettings(type, newCatalog, null);
      }
    } else {
      setSelectedCatalog(null);
      setSelectedDiscoverGenre(null);
      saveDiscoverSettings(type, null, null);
    }
    typeSheetRef.current?.dismiss();
  };

  const handleCatalogSelect = (catalog: DiscoverCatalog) => {
    setSelectedCatalog(catalog);
    setSelectedDiscoverGenre(null);

    // Save catalog setting
    saveDiscoverSettings(selectedDiscoverType, catalog, null);

    catalogSheetRef.current?.dismiss();
  };

  const handleGenreSelect = (genre: string | null) => {
    setSelectedDiscoverGenre(genre);

    // Save genre setting - this will save empty string for null (All genres)
    saveDiscoverSettings(selectedDiscoverType, selectedCatalog, genre);

    genreSheetRef.current?.dismiss();
  };

  const hasResultsToShow = useMemo(() => results.byAddon.length > 0, [results]);

  // Item press handlers for AddonSection
  const handleItemPress = useCallback((item: StreamingContent) => {
    navigation.navigate('Metadata', { id: item.id, type: item.type, addonId: item.addonId });
  }, [navigation]);

  const handleItemLongPress = useCallback((item: StreamingContent) => {
    setSelectedItem(item);
    setMenuVisible(true);
  }, []);

  // Set up listeners
  useEffect(() => {
    const watchedSub = DeviceEventEmitter.addListener('watchedStatusChanged', () => { });
    const librarySub = catalogService.subscribeToLibraryUpdates(() => { });
    return () => { watchedSub.remove(); librarySub(); };
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ScreenHeader title={t('search.title')} isTablet={isTV || isLargeTablet || isTablet}>
        <View style={styles.searchBarContainer}>
          <View style={[styles.searchBarWrapper, { width: '100%' }]}>
            <View style={[styles.searchBar, { backgroundColor: currentTheme.colors.elevation2, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }]}>
              <MaterialIcons name="search" size={24} color={currentTheme.colors.lightGray} style={styles.searchIcon} />
              <TextInput
                ref={inputRef}
                style={[styles.searchInput, { color: currentTheme.colors.white }]}
                placeholder={t('search.placeholder')}
                placeholderTextColor={currentTheme.colors.lightGray}
                value={query}
                onChangeText={setQuery}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={handleClearSearch} style={styles.clearButton}>
                  <MaterialIcons name="close" size={20} color={currentTheme.colors.lightGray} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </ScreenHeader>

      <View style={styles.contentContainer}>
        {searching && results.byAddon.length === 0 ? (
          <SearchAnimation />
        ) : searched && !hasResultsToShow && !searching ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="search-off" size={64} color={currentTheme.colors.lightGray} />
            <Text style={[styles.emptyText, { color: currentTheme.colors.white }]}>{t('search.no_results')}</Text>
            <Text style={[styles.emptySubtext, { color: currentTheme.colors.lightGray }]}>{t('search.try_keywords')}</Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollViewContent}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={({ nativeEvent }) => {
              if (query.trim().length > 0 || !settings.showDiscover || pendingDiscoverResults.length > 0) return;
              const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
              const isCloseToBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 500;
              if (isCloseToBottom) loadMoreDiscoverContent();
            }}
          >
            {!query.trim() && renderRecentSearches()}
            {!query.trim() && settings.showDiscover && (
              <DiscoverSection
                discoverLoading={discoverLoading}
                discoverInitialized={discoverInitialized}
                discoverResults={discoverResults}
                pendingDiscoverResults={pendingDiscoverResults}
                loadingMore={loadingMore}
                selectedCatalog={selectedCatalog}
                selectedDiscoverType={selectedDiscoverType}
                selectedDiscoverGenre={selectedDiscoverGenre}
                availableGenres={availableGenres}
                typeSheetRef={typeSheetRef}
                catalogSheetRef={catalogSheetRef}
                genreSheetRef={genreSheetRef}
                handleShowMore={handleShowMore}
                navigation={navigation}
                setSelectedItem={setSelectedItem}
                setMenuVisible={setMenuVisible}
                currentTheme={currentTheme}
              />
            )}

            {results.byAddon.map((addonGroup, addonIndex) => (
              <AddonSection
                key={addonGroup.addonId}
                addonGroup={addonGroup}
                addonIndex={addonIndex}
                onItemPress={handleItemPress}
                onItemLongPress={handleItemLongPress}
                currentTheme={currentTheme}
              />
            ))}
          </ScrollView>
        )}
      </View>

      {/* DropUpMenu */}
      {selectedItem && (
        <DropUpMenu
          visible={menuVisible}
          onClose={() => setMenuVisible(false)}
          item={selectedItem}
          isSaved={isSaved}
          isWatched={isWatched}
          onOptionSelect={async (option: string) => {
            if (!selectedItem) return;
            switch (option) {
              case 'share': {
                let url = '';
                if (selectedItem.type === 'movie') {
                  url = `https://www.imdb.com/title/${selectedItem.id}`;
                } else {
                  url = `https://www.imdb.com/title/${selectedItem.id}`;
                }
                try {
                  await Share.share({ message: `Check out ${selectedItem.name}: ${url}`, url });
                } catch (e) { }
                break;
              }
              case 'library':
                if (isSaved) {
                  await catalogService.removeFromLibrary(selectedItem.type, selectedItem.id);
                  showInfo(t('library.removed_from_library'), t('library.item_removed'));
                } else {
                  await catalogService.addToLibrary(selectedItem);
                  showSuccess(t('library.added_to_library'), t('library.item_added'));
                }
                setIsSaved(!isSaved);
                break;
              case 'watched': {
                const newWatchedState = !isWatched;
                await mmkvStorage.setItem(`watched:${selectedItem.type}:${selectedItem.id}`, newWatchedState ? 'true' : 'false');
                setIsWatched(newWatchedState);
                showInfo(
                  newWatchedState ? t('library.marked_watched') : t('library.marked_unwatched'),
                  newWatchedState ? t('library.item_marked_watched') : t('library.item_marked_unwatched')
                );
                DeviceEventEmitter.emit('watchedStatusChanged');
                break;
              }
              case 'trakt-watchlist':
                if (isInWatchlist(selectedItem.id, selectedItem.type as 'movie' | 'show')) {
                  await removeFromWatchlist(selectedItem.id, selectedItem.type as 'movie' | 'show');
                  showInfo(t('library.removed_from_watchlist'), t('library.removed_from_watchlist_desc'));
                } else {
                  await addToWatchlist(selectedItem.id, selectedItem.type as 'movie' | 'show');
                  showSuccess(t('library.added_to_watchlist'), t('library.added_to_watchlist_desc'));
                }
                break;
              case 'trakt-collection':
                if (isInCollection(selectedItem.id, selectedItem.type as 'movie' | 'show')) {
                  await removeFromCollection(selectedItem.id, selectedItem.type as 'movie' | 'show');
                  showInfo(t('library.removed_from_collection'), t('library.removed_from_collection_desc'));
                } else {
                  await addToCollection(selectedItem.id, selectedItem.type as 'movie' | 'show');
                  showSuccess(t('library.added_to_collection'), t('library.added_to_collection_desc'));
                }
                break;
            }
            setMenuVisible(false);
          }}
        />
      )}

      {/* Bottom Sheets */}
      <DiscoverBottomSheets
        typeSheetRef={typeSheetRef}
        catalogSheetRef={catalogSheetRef}
        genreSheetRef={genreSheetRef}
        selectedDiscoverType={selectedDiscoverType}
        selectedCatalog={selectedCatalog}
        selectedDiscoverGenre={selectedDiscoverGenre}
        filteredCatalogs={filteredCatalogs}
        availableGenres={availableGenres}
        onTypeSelect={handleTypeSelect}
        onCatalogSelect={handleCatalogSelect}
        onGenreSelect={handleGenreSelect}
        currentTheme={currentTheme}
      />
    </View>
  );
};

export default SearchScreen;
