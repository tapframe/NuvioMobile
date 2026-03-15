import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, useWindowDimensions, useColorScheme, FlatList, Modal, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import FastImage from '@d11/react-native-fast-image';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettings } from '../../hooks/useSettings';
import { Episode } from '../../types/metadata';
import { tmdbService, IMDbRatings } from '../../services/tmdbService';
import { storageService } from '../../services/storageService';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutLeft } from 'react-native-reanimated';
import { TraktService } from '../../services/traktService';
import { watchedService } from '../../services/watchedService';
import { logger } from '../../utils/logger';
import { mmkvStorage } from '../../services/mmkvStorage';
import { MalSync } from '../../services/mal/MalSync';

// ... other imports
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

interface SeriesContentProps {
  episodes: Episode[];
  selectedSeason: number;
  loadingSeasons: boolean;
  onSeasonChange: (season: number) => void;
  onSelectEpisode: (episode: Episode) => void;
  groupedEpisodes?: { [seasonNumber: number]: Episode[] };
  metadata?: { 
    poster?: string; 
    id?: string; 
    name?: string;
    mal_id?: number;
    external_ids?: {
      mal_id?: number;
    }
  };
  imdbId?: string; // IMDb ID for Trakt sync
}

// Add placeholder constant at the top
const DEFAULT_PLACEHOLDER = 'https://via.placeholder.com/300x450/1a1a1a/666666?text=No+Image';
const EPISODE_PLACEHOLDER = 'https://via.placeholder.com/500x280/1a1a1a/666666?text=No+Preview';
const TMDB_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Tmdb.new.logo.svg/512px-Tmdb.new.logo.svg.png?20200406190906';
const IMDb_LOGO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/IMDB_Logo_2016.svg/575px-IMDB_Logo_2016.svg.png';

const SeriesContentComponent: React.FC<SeriesContentProps> = ({
  episodes,
  selectedSeason,
  loadingSeasons,
  onSeasonChange,
  onSelectEpisode,
  groupedEpisodes = {},
  metadata,
  imdbId
}) => {
  const { currentTheme } = useTheme();
  const { settings } = useSettings();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isDarkMode = useColorScheme() === 'dark';

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

  // Enhanced spacing and padding for seasons section
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

  // Match ThisWeekSection card sizing for horizontal episode cards
  const horizontalCardWidth = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return Math.min(deviceWidth * 0.25, 400);
      case 'largeTablet':
        return Math.min(deviceWidth * 0.35, 350);
      case 'tablet':
        return Math.min(deviceWidth * 0.46, 300);
      default:
        return width * 0.75;
    }
  }, [deviceType, deviceWidth, width]);

  const horizontalCardHeight = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 280;
      case 'largeTablet':
        return 250;
      case 'tablet':
        return 220;
      default:
        return 180;
    }
  }, [deviceType]);

  const horizontalItemSpacing = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 20;
      case 'largeTablet':
        return 18;
      case 'tablet':
        return 16;
      default:
        return 16;
    }
  }, [deviceType]);

  // Enhanced season poster sizing
  const seasonPosterWidth = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 140;
      case 'largeTablet':
        return 130;
      case 'tablet':
        return 120;
      default:
        return 100; // phone
    }
  }, [deviceType]);

  const seasonPosterHeight = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 210;
      case 'largeTablet':
        return 195;
      case 'tablet':
        return 180;
      default:
        return 150; // phone
    }
  }, [deviceType]);

  const seasonButtonSpacing = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 20;
      case 'largeTablet':
        return 18;
      case 'tablet':
        return 16;
      default:
        return 16; // phone
    }
  }, [deviceType]);

  const [episodeProgress, setEpisodeProgress] = useState<{ [key: string]: { currentTime: number; duration: number; lastUpdated: number } }>({});
  // Delay item entering animations to avoid FlashList initial layout glitches
  const [enableItemAnimations, setEnableItemAnimations] = useState(false);
  // Local TMDB hydration for rating/runtime when addon (Cinemeta) lacks these
  const [tmdbEpisodeOverrides, setTmdbEpisodeOverrides] = useState<{ [epKey: string]: { vote_average?: number; runtime?: number; still_path?: string } }>({});
  // IMDb ratings for episodes - using a map for O(1) lookups instead of array searches
  const [imdbRatingsMap, setImdbRatingsMap] = useState<{ [key: string]: number }>({});

  // Add state for season view mode (persists for current show across navigation)
  const [seasonViewMode, setSeasonViewMode] = useState<'posters' | 'text'>('posters');

  // View mode state (no animations)
  const [posterViewVisible, setPosterViewVisible] = useState(true);
  const [textViewVisible, setTextViewVisible] = useState(false);

  // Episode action menu state
  const [episodeActionMenuVisible, setEpisodeActionMenuVisible] = useState(false);
  const [selectedEpisodeForAction, setSelectedEpisodeForAction] = useState<Episode | null>(null);
  const [markingAsWatched, setMarkingAsWatched] = useState(false);

  // Add refs for the scroll views
  const seasonScrollViewRef = useRef<ScrollView | null>(null);
  const episodeScrollViewRef = useRef<FlashListRef<Episode>>(null);
  const horizontalEpisodeScrollViewRef = useRef<FlatList<Episode>>(null);

  // Load saved global view mode preference when component mounts
  useEffect(() => {
    const loadViewModePreference = async () => {
      try {
        const savedMode = await mmkvStorage.getItem('global_season_view_mode');
        if (savedMode === 'text' || savedMode === 'posters') {
          setSeasonViewMode(savedMode);
          if (__DEV__) console.log('[SeriesContent] Loaded global view mode:', savedMode);
        }
      } catch (error) {
        if (__DEV__) console.log('[SeriesContent] Error loading global view mode preference:', error);
      }
    };

    loadViewModePreference();
  }, []);

  // Initialize view mode visibility based on current view mode
  useEffect(() => {
    if (seasonViewMode === 'text') {
      setPosterViewVisible(false);
      setTextViewVisible(true);
    } else {
      setPosterViewVisible(true);
      setTextViewVisible(false);
    }
  }, [seasonViewMode]);



  // Update view mode without animations
  const updateViewMode = (newMode: 'posters' | 'text') => {
    setSeasonViewMode(newMode);
    mmkvStorage.setItem('global_season_view_mode', newMode).catch((error: any) => {
      if (__DEV__) console.log('[SeriesContent] Error saving global view mode preference:', error);
    });
  };

  // Add refs for the scroll views



  const loadEpisodesProgress = async () => {
    if (!metadata?.id) return;

    const allProgress = await storageService.getAllWatchProgress();
    const progress: { [key: string]: { currentTime: number; duration: number; lastUpdated: number } } = {};

    episodes.forEach(episode => {
      const episodeId = episode.stremioId || `${metadata.id}:${episode.season_number}:${episode.episode_number}`;
      const key = `series:${metadata.id}:${episodeId}`;
      if (allProgress[key]) {
        progress[episodeId] = {
          currentTime: allProgress[key].currentTime,
          duration: allProgress[key].duration,
          lastUpdated: allProgress[key].lastUpdated
        };
      }
    });

    // ---------------- Trakt watched-history integration ----------------
    try {
      const traktService = TraktService.getInstance();
      const isAuthed = await traktService.isAuthenticated();
      if (isAuthed && metadata?.id) {
        // Fetch multiple pages to ensure we get all episodes for shows with many seasons
        // Each page has up to 100 items by default, fetch enough to cover ~12+ seasons
        let allHistoryItems: any[] = [];
        const pageLimit = 10; // Fetch up to 10 pages (max 1000 items) to cover extensive libraries

        for (let page = 1; page <= pageLimit; page++) {
          const historyItems = await traktService.getWatchedEpisodesHistory(page, 100);
          if (!historyItems || historyItems.length === 0) {
            break; // No more items to fetch
          }
          allHistoryItems = allHistoryItems.concat(historyItems);
        }

        allHistoryItems.forEach(item => {
          if (item.type !== 'episode') return;

          const showImdb = item.show?.ids?.imdb ? `tt${item.show.ids.imdb.replace(/^tt/, '')}` : null;
          if (!showImdb || showImdb !== metadata.id) return;

          const season = item.episode?.season;
          const epNum = item.episode?.number;
          if (season === undefined || epNum === undefined) return;

          const episodeId = `${metadata.id}:${season}:${epNum}`;
          const watchedAt = new Date(item.watched_at).getTime();

          // Mark as 100% completed (use 1/1 to avoid divide-by-zero)
          const traktProgressEntry = {
            currentTime: 1,
            duration: 1,
            lastUpdated: watchedAt,
          };

          const existing = progress[episodeId];
          const existingPercent = existing ? (existing.currentTime / existing.duration) * 100 : 0;

          // Prefer local progress if it is already >=85%; otherwise use Trakt data
          if (!existing || existingPercent < 85) {
            progress[episodeId] = traktProgressEntry;
          }
        });
      }
    } catch (err) {
      logger.error('[SeriesContent] Failed to merge Trakt history:', err);
    }

    setEpisodeProgress(progress);
  };

  // Function to find and scroll to the most recently watched episode
  const scrollToMostRecentEpisode = () => {
    if (!metadata?.id || !settings?.episodeLayoutStyle || settings.episodeLayoutStyle !== 'horizontal') {
      return;
    }

    const currentSeasonEpisodes = groupedEpisodes[selectedSeason] || [];
    if (currentSeasonEpisodes.length === 0) {
      return;
    }

    // Find the most recently watched episode in the current season
    let mostRecentEpisodeIndex = -1;
    let mostRecentTimestamp = 0;
    let mostRecentEpisodeName = '';

    currentSeasonEpisodes.forEach((episode, index) => {
      const episodeId = episode.stremioId || `${metadata.id}:${episode.season_number}:${episode.episode_number}`;
      const progress = episodeProgress[episodeId];

      if (progress && progress.lastUpdated > mostRecentTimestamp && progress.currentTime > 0) {
        mostRecentTimestamp = progress.lastUpdated;
        mostRecentEpisodeIndex = index;
        mostRecentEpisodeName = episode.name;
      }
    });

    // Scroll to the most recently watched episode if found
    if (mostRecentEpisodeIndex >= 0) {
      setTimeout(() => {
        if (horizontalEpisodeScrollViewRef.current) {
          // Use scrollToIndex which automatically uses getItemLayout for accurate positioning
          horizontalEpisodeScrollViewRef.current.scrollToIndex({
            index: mostRecentEpisodeIndex,
            animated: true,
            viewPosition: 0 // Align to start of card for precise positioning
          });
        }
      }, 500); // Delay to ensure the season has loaded
    }
  };

  // Initial load of watch progress
  useEffect(() => {
    loadEpisodesProgress();
  }, [episodes, metadata?.id]);

  // Fetch IMDb ratings for the show
  useEffect(() => {
    const fetchIMDbRatings = async () => {
      try {
        if (!metadata?.id) {
          logger.log('[SeriesContent] No metadata.id, skipping IMDb ratings fetch');
          return;
        }

        logger.log('[SeriesContent] Starting IMDb ratings fetch for metadata.id:', metadata.id);

        // Resolve TMDB show id
        let tmdbShowId: number | null = null;
        if (metadata.id.startsWith('tmdb:')) {
          tmdbShowId = parseInt(metadata.id.split(':')[1], 10);
          logger.log('[SeriesContent] Extracted TMDB ID from metadata.id:', tmdbShowId);
        } else if (metadata.id.startsWith('tt')) {
          logger.log('[SeriesContent] Found IMDb ID, looking up TMDB ID...');
          tmdbShowId = await tmdbService.findTMDBIdByIMDB(metadata.id);
          logger.log('[SeriesContent] TMDB ID lookup result:', tmdbShowId);
        } else {
          logger.log('[SeriesContent] metadata.id does not start with tmdb: or tt:', metadata.id);
        }

        if (!tmdbShowId) {
          logger.warn('[SeriesContent] Could not resolve TMDB show ID, skipping IMDb ratings fetch');
          return;
        }

        logger.log('[SeriesContent] Fetching IMDb ratings for TMDB ID:', tmdbShowId);
        // Fetch IMDb ratings for all seasons
        const ratings = await tmdbService.getIMDbRatings(tmdbShowId);

        if (ratings) {
          logger.log('[SeriesContent] IMDb ratings fetched successfully. Seasons:', ratings.length);

          // Create a lookup map for O(1) access: key format "season:episode" -> rating
          const ratingsMap: { [key: string]: number } = {};
          ratings.forEach(season => {
            if (season.episodes) {
              season.episodes.forEach(episode => {
                const key = `${episode.season_number}:${episode.episode_number}`;
                if (episode.vote_average) {
                  ratingsMap[key] = episode.vote_average;
                }
              });
            }
          });

          logger.log('[SeriesContent] IMDb ratings map created with', Object.keys(ratingsMap).length, 'episodes');
          setImdbRatingsMap(ratingsMap);
        } else {
          logger.warn('[SeriesContent] IMDb ratings fetch returned null/undefined');
        }
      } catch (err) {
        logger.error('[SeriesContent] Failed to fetch IMDb ratings:', err);
      }
    };

    fetchIMDbRatings();
  }, [metadata?.id]);

  // Hydrate TMDB rating/runtime for current season episodes if missing
  useEffect(() => {
    const hydrateFromTmdb = async () => {
      try {
        if (!metadata?.id || !selectedSeason) return;
        // Respect settings: skip TMDB enrichment when disabled
        if (!settings?.enrichMetadataWithTMDB) return;
        const currentSeasonEpisodes = groupedEpisodes[selectedSeason] || [];
        if (currentSeasonEpisodes.length === 0) return;

        // Check if hydration is needed
        const needsHydration = currentSeasonEpisodes.some(ep => !(ep as any).runtime || !(ep as any).vote_average);
        if (!needsHydration) return;

        // Resolve TMDB show id
        let tmdbShowId: number | null = null;
        if (metadata.id.startsWith('tmdb:')) {
          tmdbShowId = parseInt(metadata.id.split(':')[1], 10);
        } else if (metadata.id.startsWith('tt')) {
          tmdbShowId = await tmdbService.findTMDBIdByIMDB(metadata.id);
        }
        if (!tmdbShowId) return;

        // Fetch all episodes from TMDB and build override map for the current season
        const all = await tmdbService.getAllEpisodes(tmdbShowId);
        const overrides: { [k: string]: { vote_average?: number; runtime?: number; still_path?: string } } = {};
        const seasonEpisodes = all?.[selectedSeason] || [];
        seasonEpisodes.forEach((tmdbEp: any) => {
          const key = `${metadata.id}:${tmdbEp.season_number}:${tmdbEp.episode_number}`;
          overrides[key] = {
            vote_average: tmdbEp.vote_average,
            runtime: tmdbEp.runtime,
            still_path: tmdbEp.still_path,
          };
        });
        if (Object.keys(overrides).length > 0) {
          setTmdbEpisodeOverrides(prev => ({ ...prev, ...overrides }));
        }
      } catch (err) {
        logger.error('[SeriesContent] TMDB hydration failed:', err);
      }
    };

    hydrateFromTmdb();
  }, [metadata?.id, selectedSeason, groupedEpisodes, settings?.enrichMetadataWithTMDB]);

  // Enable item animations shortly after mount to avoid initial overlap/glitch
  useEffect(() => {
    const timer = setTimeout(() => setEnableItemAnimations(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Refresh watch progress when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      loadEpisodesProgress();
    }, [episodes, metadata?.id])
  );

  // Memory optimization: Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear any pending timeouts
      if (__DEV__) console.log('[SeriesContent] Component unmounted, cleaning up memory');

      // Force garbage collection if available (development only)
      if (__DEV__ && global.gc) {
        global.gc();
      }
    };
  }, []);

  // Track previous season to only scroll when it actually changes
  const previousSeasonRef = React.useRef<number | null>(null);

  // Add effect to scroll to selected season (only when season changes, not on every groupedEpisodes update)
  useEffect(() => {
    if (selectedSeason && seasonScrollViewRef.current && Object.keys(groupedEpisodes).length > 0) {
      // Only scroll if the season actually changed (not just groupedEpisodes update)
      if (previousSeasonRef.current === selectedSeason) {
        return; // Season didn't change, don't scroll
      }
      previousSeasonRef.current = selectedSeason;

      // Find the index of the selected season
      const seasons = Object.keys(groupedEpisodes).map(Number).sort((a, b) => a - b);
      const selectedIndex = seasons.findIndex(season => season === selectedSeason);

      if (selectedIndex !== -1) {
        // Wait a small amount of time for layout to be ready
        setTimeout(() => {
          if (seasonScrollViewRef.current && typeof (seasonScrollViewRef.current as any).scrollToOffset === 'function') {
            (seasonScrollViewRef.current as any).scrollToOffset({
              offset: selectedIndex * 116, // 100px width + 16px margin
              animated: true
            });
          }
        }, 300);
      }
    }
  }, [selectedSeason, groupedEpisodes]);

  // Add effect to scroll to most recently watched episode when season changes or progress loads
  useEffect(() => {
    if (Object.keys(episodeProgress).length > 0 && selectedSeason && settings?.episodeLayoutStyle) {
      scrollToMostRecentEpisode();
    }
  }, [selectedSeason, episodeProgress, settings?.episodeLayoutStyle, groupedEpisodes]);



  // Helper function to get IMDb rating for an episode - O(1) lookup using map
  const getIMDbRating = useCallback((seasonNumber: number, episodeNumber: number): number | null => {
    const key = `${seasonNumber}:${episodeNumber}`;
    const rating = imdbRatingsMap[key];
    return rating ?? null;
  }, [imdbRatingsMap]);

  // Handle long press on episode to show action menu
  const handleEpisodeLongPress = useCallback((episode: Episode) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedEpisodeForAction(episode);
    setEpisodeActionMenuVisible(true);
  }, []);

  // Check if an episode is watched (>= 85% progress)
  const isEpisodeWatched = useCallback((episode: Episode): boolean => {
    const episodeId = episode.stremioId || `${metadata?.id}:${episode.season_number}:${episode.episode_number}`;
    const progress = episodeProgress[episodeId];
    if (!progress) return false;
    const progressPercent = (progress.currentTime / progress.duration) * 100;
    return progressPercent >= 85;
  }, [episodeProgress, metadata?.id]);

  // Mark episode as watched
  const handleMarkAsWatched = useCallback(async () => {
    if (!selectedEpisodeForAction || !metadata?.id) return;

    const episode = selectedEpisodeForAction; // Capture for closure
    const episodeId = episode.stremioId || `${metadata.id}:${episode.season_number}:${episode.episode_number}`;

    // 1. Optimistic UI Update
    setEpisodeProgress(prev => ({
      ...prev,
      [episodeId]: { currentTime: 1, duration: 1, lastUpdated: Date.now() } // 100% progress
    }));

    // 2. Instant Feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEpisodeActionMenuVisible(false);
    setSelectedEpisodeForAction(null);

    // 3. Background Async Operation
    const showImdbId = imdbId || metadata.id;
    const malId = (metadata as any)?.mal_id || (metadata as any)?.external_ids?.mal_id;
    const tmdbId = (metadata as any)?.tmdbId || (metadata as any)?.external_ids?.tmdb_id;
    
    // Calculate dayIndex for same-day releases
    let dayIndex = 0;
    if (episode.air_date) {
      const sameDayEpisodes = episodes
        .filter(ep => ep.air_date === episode.air_date)
        .sort((a, b) => a.episode_number - b.episode_number);
      dayIndex = sameDayEpisodes.findIndex(ep => ep.episode_number === episode.episode_number);
      if (dayIndex < 0) dayIndex = 0;
    }

    try {
      const result = await watchedService.markEpisodeAsWatched(
        showImdbId || 'Anime',
        metadata.id || '',
        episode.season_number,
        episode.episode_number,
        new Date(),
        episode.air_date,
        metadata?.name,
        malId,
        dayIndex,
        tmdbId
      );

      // Reload to ensure consistency (e.g. if optimistic update was slightly off or for other effects)
      // But we don't strictly *need* to wait for this to update UI
      loadEpisodesProgress();

      logger.log(`[SeriesContent] Mark as watched result:`, result);
    } catch (error) {
      logger.error('[SeriesContent] Error marking episode as watched:', error);
      // Ideally revert state here, but simple error logging is often enough for non-critical non-transactional actions
      loadEpisodesProgress(); // Reload to revert to source of truth
    }
  }, [selectedEpisodeForAction, metadata?.id, imdbId]);

  // Mark episode as unwatched
  const handleMarkAsUnwatched = useCallback(async () => {
    if (!selectedEpisodeForAction || !metadata?.id) return;

    const episode = selectedEpisodeForAction;
    const episodeId = episode.stremioId || `${metadata.id}:${episode.season_number}:${episode.episode_number}`;

    // 1. Optimistic UI Update - Remove from progress map
    setEpisodeProgress(prev => {
      const newState = { ...prev };
      delete newState[episodeId];
      return newState;
    });

    // 2. Instant Feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEpisodeActionMenuVisible(false);
    setSelectedEpisodeForAction(null);

    // 3. Background Async Operation
    const showImdbId = imdbId || metadata.id;
    const malId = (metadata as any)?.mal_id || (metadata as any)?.external_ids?.mal_id;
    const tmdbId = (metadata as any)?.tmdbId || (metadata as any)?.external_ids?.tmdb_id;

    // Calculate dayIndex for same-day releases
    let dayIndex = 0;
    if (episode.air_date) {
      const sameDayEpisodes = episodes
        .filter(ep => ep.air_date === episode.air_date)
        .sort((a, b) => a.episode_number - b.episode_number);
      dayIndex = sameDayEpisodes.findIndex(ep => ep.episode_number === episode.episode_number);
      if (dayIndex < 0) dayIndex = 0;
    }

    try {
      const result = await watchedService.unmarkEpisodeAsWatched(
        showImdbId || 'Anime',
        metadata.id || '',
        episode.season_number,
        episode.episode_number,
        episode.air_date,
        metadata?.name,
        malId,
        dayIndex,
        tmdbId
      );

      loadEpisodesProgress(); // Sync with source of truth
      logger.log(`[SeriesContent] Unmark watched result:`, result);
    } catch (error) {
      logger.error('[SeriesContent] Error unmarking episode as watched:', error);
      loadEpisodesProgress(); // Revert
    }
  }, [selectedEpisodeForAction, metadata?.id, imdbId]);

  // Mark entire season as watched
  const handleMarkSeasonAsWatched = useCallback(async () => {
    if (!metadata?.id) return;

    // Capture values
    const currentSeason = selectedSeason;
    const seasonEpisodes = groupedEpisodes[currentSeason] || [];
    const episodeNumbers = seasonEpisodes.map(ep => ep.episode_number);

    // 1. Optimistic UI Update
    setEpisodeProgress(prev => {
      const next = { ...prev };
      seasonEpisodes.forEach(ep => {
        const id = ep.stremioId || `${metadata.id}:${ep.season_number}:${ep.episode_number}`;
        next[id] = { currentTime: 1, duration: 1, lastUpdated: Date.now() };
      });
      return next;
    });

    // 2. Instant Feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEpisodeActionMenuVisible(false);
    setSelectedEpisodeForAction(null);

    // 3. Background Async Operation
    const showImdbId = imdbId || metadata.id;
    try {
      const result = await watchedService.markSeasonAsWatched(
        showImdbId,
        metadata.id,
        currentSeason,
        episodeNumbers
      );

      // Sync to MAL (last episode of the season)
      const malEnabled = mmkvStorage.getBoolean('mal_enabled') ?? true;
      if (malEnabled && metadata?.name && episodeNumbers.length > 0) {
          const lastEp = Math.max(...episodeNumbers);
          const lastEpisodeData = seasonEpisodes.find(e => e.episode_number === lastEp);
          const totalEpisodes = Object.values(groupedEpisodes).reduce((acc, curr) => acc + (curr?.length || 0), 0);
          
          MalSync.scrobbleEpisode(
              metadata.name, 
              lastEp, 
              totalEpisodes, 
              'series', 
              currentSeason, 
              imdbId,
              lastEpisodeData?.air_date // Pass release date for accuracy
          );
      }

      // Re-sync with source of truth
      loadEpisodesProgress();

      logger.log(`[SeriesContent] Mark season as watched result:`, result);
    } catch (error) {
      logger.error('[SeriesContent] Error marking season as watched:', error);
      loadEpisodesProgress(); // Revert
    }
  }, [metadata?.id, imdbId, selectedSeason, groupedEpisodes]);

  // Check if entire season is watched
  const isSeasonWatched = useCallback((): boolean => {
    const seasonEpisodes = groupedEpisodes[selectedSeason] || [];
    if (seasonEpisodes.length === 0) return false;

    return seasonEpisodes.every(ep => {
      const episodeId = ep.stremioId || `${metadata?.id}:${ep.season_number}:${ep.episode_number}`;
      const progress = episodeProgress[episodeId];
      if (!progress) return false;
      const progressPercent = (progress.currentTime / progress.duration) * 100;
      return progressPercent >= 85;
    });
  }, [groupedEpisodes, selectedSeason, episodeProgress, metadata?.id]);

  // Unmark entire season as watched
  const handleMarkSeasonAsUnwatched = useCallback(async () => {
    if (!metadata?.id) return;

    // Capture values
    const currentSeason = selectedSeason;
    const seasonEpisodes = groupedEpisodes[currentSeason] || [];
    const episodeNumbers = seasonEpisodes.map(ep => ep.episode_number);

    // 1. Optimistic UI Update - Remove all episodes of season from progress
    setEpisodeProgress(prev => {
      const next = { ...prev };
      seasonEpisodes.forEach(ep => {
        const id = ep.stremioId || `${metadata.id}:${ep.season_number}:${ep.episode_number}`;
        delete next[id];
      });
      return next;
    });

    // 2. Instant Feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEpisodeActionMenuVisible(false);
    setSelectedEpisodeForAction(null);

    // 3. Background Async Operation
    const showImdbId = imdbId || metadata.id;
    try {
      const result = await watchedService.unmarkSeasonAsWatched(
        showImdbId,
        metadata.id,
        currentSeason,
        episodeNumbers
      );

      // Re-sync
      loadEpisodesProgress();

      logger.log(`[SeriesContent] Unmark season as watched result:`, result);
    } catch (error) {
      logger.error('[SeriesContent] Error unmarking season as watched:', error);
      loadEpisodesProgress(); // Revert
    }
  }, [metadata?.id, imdbId, selectedSeason, groupedEpisodes]);

  // Close action menu
  const closeEpisodeActionMenu = useCallback(() => {
    setEpisodeActionMenuVisible(false);
    setSelectedEpisodeForAction(null);
  }, []);

  if (loadingSeasons) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={currentTheme.colors.primary} />
        <Text style={[styles.centeredText, { color: currentTheme.colors.text }]}>{t('metadata.loading_episodes')}</Text>
      </View>
    );
  }

  if (episodes.length === 0) {
    return (
      <View style={styles.centeredContainer}>
        <MaterialIcons name="error-outline" size={48} color={currentTheme.colors.textMuted} />
        <Text style={[styles.centeredText, { color: currentTheme.colors.text }]}>{t('metadata.no_episodes_available')}</Text>
      </View>
    );
  }

  const renderSeasonSelector = () => {
    // Show selector if we have grouped episodes data or can derive from episodes
    if (!groupedEpisodes || Object.keys(groupedEpisodes).length <= 1) {
      return null;
    }



    const seasons = Object.keys(groupedEpisodes).map(Number).sort((a, b) => {
      if (a === 0) return 1;
      if (b === 0) return -1;
      return a - b;
    });

    return (
      <View style={[
        styles.seasonSelectorWrapper,
        { paddingHorizontal: horizontalPadding }
      ]}>
        <View style={[
          styles.seasonSelectorHeader,
          {
            marginBottom: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
          }
        ]}>
          <Text style={[
            styles.seasonSelectorTitle,
            {
              color: currentTheme.colors.highEmphasis,
              fontSize: isTV ? 28 : isLargeTablet ? 26 : isTablet ? 24 : 18
            }
          ]}>{t('metadata.seasons')}</Text>

          {/* Dropdown Toggle Button */}
          <TouchableOpacity
            style={[
              styles.seasonViewToggle,
              {
                backgroundColor: seasonViewMode === 'posters'
                  ? currentTheme.colors.elevation2
                  : currentTheme.colors.elevation3,
                borderColor: seasonViewMode === 'posters'
                  ? 'rgba(255,255,255,0.2)'
                  : 'rgba(255,255,255,0.3)',
                paddingHorizontal: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8,
                paddingVertical: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 4,
                borderRadius: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 6 : 6
              }
            ]}
            onPress={() => {
              const newMode = seasonViewMode === 'posters' ? 'text' : 'posters';
              updateViewMode(newMode);
              if (__DEV__) console.log('[SeriesContent] View mode changed to:', newMode, 'Current ref value:', seasonViewMode);
            }}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.seasonViewToggleText,
              {
                color: seasonViewMode === 'posters'
                  ? currentTheme.colors.mediumEmphasis
                  : currentTheme.colors.highEmphasis,
                fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 12
              }
            ]}>
              {seasonViewMode === 'posters' ? 'Posters' : 'Text'}
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          ref={seasonScrollViewRef as React.RefObject<FlatList<any>>}
          data={seasons}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.seasonSelectorContainer}
          contentContainerStyle={[
            styles.seasonSelectorContent,
            {
              paddingBottom: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8
            }
          ]}
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={3}
          renderItem={({ item: season }) => {
            const seasonEpisodes = groupedEpisodes[season] || [];

            // Get season poster URL (needed for both views)
            let seasonPoster = DEFAULT_PLACEHOLDER;
            if (seasonEpisodes[0]?.season_poster_path) {
              const tmdbUrl = tmdbService.getImageUrl(seasonEpisodes[0].season_poster_path, 'original');
              if (tmdbUrl) seasonPoster = tmdbUrl;
            } else if (metadata?.poster) {
              seasonPoster = metadata.poster;
            }

            if (seasonViewMode === 'text') {
              // Text-only view

              return (
                <View
                  key={season}
                  style={{ opacity: textViewVisible ? 1 : 0 }}
                >
                  <TouchableOpacity
                    style={[
                      styles.seasonTextButton,
                      {
                        marginRight: seasonButtonSpacing,
                        paddingVertical: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
                        paddingHorizontal: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16,
                        borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
                      },
                      selectedSeason === season && styles.selectedSeasonTextButton
                    ]}
                    onPress={() => onSeasonChange(season)}
                  >
                    <Text style={[
                      styles.seasonTextButtonText,
                      isTablet && styles.seasonTextButtonTextTablet,
                      { color: currentTheme.colors.highEmphasis },
                      selectedSeason === season && [
                        styles.selectedSeasonTextButtonText,
                        isTablet && styles.selectedSeasonTextButtonTextTablet,
                        { color: currentTheme.colors.highEmphasis }
                      ]
                    ]} numberOfLines={1}>
                      {season === 0 ? t('metadata.specials') : t('metadata.season_number', { number: season })}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }

            // Poster view (current implementation)

            return (
              <View
                key={season}
                style={{ opacity: posterViewVisible ? 1 : 0 }}
              >
                <TouchableOpacity
                  style={[
                    styles.seasonButton,
                    {
                      marginRight: seasonButtonSpacing,
                      width: seasonPosterWidth
                    },
                    selectedSeason === season && [styles.selectedSeasonButton, { borderColor: currentTheme.colors.primary }]
                  ]}
                  onPress={() => onSeasonChange(season)}
                >
                  <View style={[
                    styles.seasonPosterContainer,
                    {
                      width: seasonPosterWidth,
                      height: seasonPosterHeight,
                      borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 8,
                      marginBottom: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8
                    }
                  ]}>
                    <FastImage
                      source={{ uri: seasonPoster }}
                      style={styles.seasonPoster}
                      resizeMode={FastImage.resizeMode.cover}
                    />
                    {selectedSeason === season && (
                      <View style={[
                        styles.selectedSeasonIndicator,
                        {
                          backgroundColor: currentTheme.colors.primary,
                          height: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 4
                        }
                      ]} />
                    )}

                  </View>
                  <Text
                    style={[
                      styles.seasonButtonText,
                      {
                        color: currentTheme.colors.mediumEmphasis,
                        fontSize: isTV ? 18 : isLargeTablet ? 17 : isTablet ? 16 : 14
                      },
                      selectedSeason === season && [
                        styles.selectedSeasonButtonText,
                        { color: currentTheme.colors.primary }
                      ]
                    ]}
                  >
                    {season === 0 ? t('metadata.specials') : t('metadata.season_number', { number: season })}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
          keyExtractor={season => season.toString()}
        />
      </View>
    );
  };

  // Vertical layout episode card (traditional)
  const renderVerticalEpisodeCard = (episode: Episode) => {
    // Resolve episode image with addon-first logic
    const resolveEpisodeImage = (): string => {
      const candidates: Array<string | undefined | null> = [
        // Add-on common fields
        (episode as any).thumbnail,
        (episode as any).image,
        (episode as any).thumb,
        (episode as any)?.images?.still,
        episode.still_path,
      ];

      for (const cand of candidates) {
        if (!cand) continue;
        if (typeof cand === 'string' && (cand.startsWith('http://') || cand.startsWith('https://'))) {
          return cand;
        }
        // TMDB relative paths only when enrichment is enabled
        if (typeof cand === 'string' && cand.startsWith('/') && settings?.enrichMetadataWithTMDB) {
          const tmdbUrl = tmdbService.getImageUrl(cand, 'original');
          if (tmdbUrl) return tmdbUrl;
        }
      }
      return metadata?.poster || EPISODE_PLACEHOLDER;
    };

    let episodeImage = resolveEpisodeImage();

    const episodeNumber = typeof episode.episode_number === 'number' ? episode.episode_number.toString() : '';
    const seasonNumber = typeof episode.season_number === 'number' ? episode.season_number.toString() : '';
    const episodeString = seasonNumber && episodeNumber ? `S${seasonNumber.padStart(2, '0')}E${episodeNumber.padStart(2, '0')}` : '';

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    };

    const formatRuntime = (runtime: number) => {
      if (!runtime) return null;
      const hours = Math.floor(runtime / 60);
      const minutes = runtime % 60;
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    };

    // Get episode progress
    const episodeId = episode.stremioId || `${metadata?.id}:${episode.season_number}:${episode.episode_number}`;
    const tmdbOverride = tmdbEpisodeOverrides[`${metadata?.id}:${episode.season_number}:${episode.episode_number}`];
    // Prioritize IMDb rating, fallback to TMDB
    const imdbRating = getIMDbRating(episode.season_number, episode.episode_number);
    const tmdbRating = tmdbOverride?.vote_average ?? episode.vote_average;
    const effectiveVote = imdbRating ?? tmdbRating ?? 0;
    const isImdbRating = imdbRating !== null;



    const effectiveRuntime = tmdbOverride?.runtime ?? (episode as any).runtime;
    if (!episode.still_path && tmdbOverride?.still_path) {
      const tmdbUrl = tmdbService.getImageUrl(tmdbOverride.still_path, 'original');
      if (tmdbUrl) episodeImage = tmdbUrl;
    }
    const progress = episodeProgress[episodeId];
    const progressPercent = progress ? (progress.currentTime / progress.duration) * 100 : 0;

    // Don't show progress bar if episode is complete (>= 85%)
    const showProgress = progress && progressPercent < 85;

    return (
      <TouchableOpacity
        key={episode.id}
        style={[
          styles.episodeCardVertical,
          {
            backgroundColor: currentTheme.colors.elevation2,
            borderRadius: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16,
            marginBottom: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16,
            height: isTV ? 200 : isLargeTablet ? 180 : isTablet ? 160 : 120
          }
        ]}
        onPress={() => onSelectEpisode(episode)}
        onLongPress={() => handleEpisodeLongPress(episode)}
        delayLongPress={400}
        activeOpacity={0.7}
      >
        <View style={[
          styles.episodeImageContainer,
          {
            width: isTV ? 200 : isLargeTablet ? 180 : isTablet ? 160 : 120,
            height: isTV ? 200 : isLargeTablet ? 180 : isTablet ? 160 : 120
          }
        ]}>
          <FastImage
            source={{ uri: episodeImage }}
            style={styles.episodeImage}
            resizeMode={FastImage.resizeMode.cover}
          />
          <View style={[
            styles.episodeNumberBadge,
            {
              paddingHorizontal: isTV ? 8 : isLargeTablet ? 7 : isTablet ? 6 : 6,
              paddingVertical: isTV ? 4 : isLargeTablet ? 3 : isTablet ? 2 : 2,
              borderRadius: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 4
            }
          ]}>
            <Text style={[
              styles.episodeNumberText,
              {
                fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 11 : 11,
                fontWeight: '600'
              }
            ]}>{episodeString}</Text>
          </View>
          {showProgress && (
            <View style={styles.progressBarContainer}>
              <View
                style={[
                  styles.progressBar,
                  { width: `${progressPercent}%`, backgroundColor: currentTheme.colors.primary }
                ]}
              />
            </View>
          )}
          {progressPercent >= 85 && (
            <View style={[
              styles.completedBadge,
              {
                backgroundColor: currentTheme.colors.primary,
                width: isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20,
                height: isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20,
                borderRadius: isTV ? 12 : isLargeTablet ? 11 : isTablet ? 10 : 10
              }
            ]}>
              <MaterialIcons name="check" size={isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 12} color={currentTheme.colors.white} />
            </View>
          )}
          {(!progress || progressPercent === 0) && (
            <View style={{
              position: 'absolute',
              top: 8,
              left: 8,
              width: isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20,
              height: isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20,
              borderRadius: isTV ? 12 : isLargeTablet ? 11 : isTablet ? 10 : 10,
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: currentTheme.colors.textMuted,
              opacity: 0.85,
            }} />
          )}
        </View>

        <View style={[
          styles.episodeInfo,
          {
            paddingLeft: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 12,
            flex: 1,
            justifyContent: 'center'
          }
        ]}>
          <View style={[
            styles.episodeHeader,
            {
              marginBottom: isTV ? 8 : isLargeTablet ? 6 : isTablet ? 6 : 4
            }
          ]}>
            <Text style={[
              styles.episodeTitle,
              {
                color: currentTheme.colors.text,
                fontSize: isTV ? 18 : isLargeTablet ? 17 : isTablet ? 16 : 15,
                lineHeight: isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 18,
                marginBottom: isTV ? 4 : isLargeTablet ? 3 : isTablet ? 2 : 2
              }
            ]} numberOfLines={isLargeScreen ? 3 : 2}>
              {episode.name}
            </Text>
            <View style={[
              styles.episodeMetadata,
              {
                gap: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8,
                flexWrap: 'wrap'
              }
            ]}>
              {effectiveRuntime && (
                <View style={styles.runtimeContainer}>
                  <MaterialIcons name="schedule" size={isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14} color={currentTheme.colors.textMuted} />
                  <Text style={[
                    styles.runtimeText,
                    {
                      color: currentTheme.colors.textMuted,
                      fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 13 : 13
                    }
                  ]}>
                    {formatRuntime(effectiveRuntime)}
                  </Text>
                </View>
              )}
              {effectiveVote > 0 && (
                <View style={styles.ratingContainer}>
                  {isImdbRating ? (
                    <>
                      <FastImage
                        source={{ uri: IMDb_LOGO }}
                        style={[
                          styles.tmdbLogo, // Reuse same style for dimensions
                          {
                            width: isTV ? 28 : isLargeTablet ? 26 : isTablet ? 24 : 24,
                            height: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14,
                            marginRight: 4
                          }
                        ]}
                        resizeMode={FastImage.resizeMode.contain}
                      />
                      <Text style={[
                        styles.ratingText,
                        {
                          color: '#F5C518',
                          fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 13 : 13,
                          fontWeight: '600'
                        }
                      ]}>
                        {effectiveVote.toFixed(1)}
                      </Text>
                    </>
                  ) : (
                    <>
                      <FastImage
                        source={{ uri: TMDB_LOGO }}
                        style={[
                          styles.tmdbLogo,
                          {
                            width: isTV ? 22 : isLargeTablet ? 20 : isTablet ? 20 : 20,
                            height: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14
                          }
                        ]}
                        resizeMode={FastImage.resizeMode.contain}
                      />
                      <Text style={[
                        styles.ratingText,
                        {
                          color: currentTheme.colors.textMuted,
                          fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 13 : 13
                        }
                      ]}>
                        {effectiveVote.toFixed(1)}
                      </Text>
                    </>
                  )}
                </View>
              )}
              {episode.air_date && (
                <Text style={[
                  styles.airDateText,
                  {
                    color: currentTheme.colors.textMuted,
                    fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 12 : 12
                  }
                ]}>
                  {formatDate(episode.air_date)}
                </Text>
              )}
            </View>
          </View>
          <Text style={[
            styles.episodeOverview,
            {
              color: currentTheme.colors.mediumEmphasis,
              fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 14 : 13,
              lineHeight: isTV ? 22 : isLargeTablet ? 20 : isTablet ? 20 : 18
            }
          ]} numberOfLines={isLargeScreen ? 4 : isTablet ? 3 : 2}>
            {(episode.overview || (episode as any).description || (episode as any).plot || (episode as any).synopsis || 'No description available')}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Horizontal layout episode card (Netflix-style)
  const renderHorizontalEpisodeCard = (episode: Episode) => {
    const resolveEpisodeImage = (): string => {
      const candidates: Array<string | undefined | null> = [
        (episode as any).thumbnail,
        (episode as any).image,
        (episode as any).thumb,
        (episode as any)?.images?.still,
        episode.still_path,
      ];

      for (const cand of candidates) {
        if (!cand) continue;
        if (typeof cand === 'string' && (cand.startsWith('http://') || cand.startsWith('https://'))) {
          return cand;
        }
        if (typeof cand === 'string' && cand.startsWith('/') && settings?.enrichMetadataWithTMDB) {
          const tmdbUrl = tmdbService.getImageUrl(cand, 'original');
          if (tmdbUrl) return tmdbUrl;
        }
      }
      return metadata?.poster || EPISODE_PLACEHOLDER;
    };

    let episodeImage = resolveEpisodeImage();

    const episodeNumber = typeof episode.episode_number === 'number' ? episode.episode_number.toString() : '';
    const seasonNumber = typeof episode.season_number === 'number' ? episode.season_number.toString() : '';
    const episodeString = seasonNumber && episodeNumber ? `EPISODE ${episodeNumber}` : '';

    const formatRuntime = (runtime: number) => {
      if (!runtime) return null;
      const hours = Math.floor(runtime / 60);
      const minutes = runtime % 60;
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    };

    // Get episode progress
    const episodeId = episode.stremioId || `${metadata?.id}:${episode.season_number}:${episode.episode_number}`;
    const tmdbOverride = tmdbEpisodeOverrides[`${metadata?.id}:${episode.season_number}:${episode.episode_number}`];
    // Prioritize IMDb rating, fallback to TMDB
    const imdbRating = getIMDbRating(episode.season_number, episode.episode_number);
    const tmdbRating = tmdbOverride?.vote_average ?? episode.vote_average;
    const effectiveVote = imdbRating ?? tmdbRating ?? 0;
    const isImdbRating = imdbRating !== null;
    const effectiveRuntime = tmdbOverride?.runtime ?? (episode as any).runtime;

    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    };

    const progress = episodeProgress[episodeId];
    const progressPercent = progress ? (progress.currentTime / progress.duration) * 100 : 0;

    // Don't show progress bar if episode is complete (>= 85%)
    const showProgress = progress && progressPercent < 85;

    return (
      <TouchableOpacity
        key={episode.id}
        style={[
          styles.episodeCardHorizontal,
          {
            borderRadius: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16,
            height: horizontalCardHeight,
            elevation: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 8,
            shadowOpacity: isTV ? 0.4 : isLargeTablet ? 0.35 : isTablet ? 0.3 : 0.3,
            shadowRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 8
          },
          // Gradient border styling
          {
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
          }
        ]}
        onPress={() => onSelectEpisode(episode)}
        onLongPress={() => handleEpisodeLongPress(episode)}
        delayLongPress={400}
        activeOpacity={0.85}
      >
        {/* Solid outline replaces gradient border */}

        {/* Background Image */}
        <FastImage
          source={{ uri: episodeImage }}
          style={styles.episodeBackgroundImage}
          resizeMode={FastImage.resizeMode.cover}
        />

        {/* Standard Gradient Overlay */}
        <LinearGradient
          colors={[
            'rgba(0,0,0,0.05)',
            'rgba(0,0,0,0.2)',
            'rgba(0,0,0,0.6)',
            'rgba(0,0,0,0.85)',
            'rgba(0,0,0,0.95)'
          ]}
          locations={[0, 0.2, 0.5, 0.8, 1]}
          style={styles.episodeGradient}
        >
          {/* Content Container */}
          <View style={[
            styles.episodeContent,
            {
              padding: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 12,
              paddingBottom: isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 16
            }
          ]}>
            {/* Episode Number Badge */}
            <View style={[
              styles.episodeNumberBadgeHorizontal,
              {
                paddingHorizontal: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 6 : 6,
                paddingVertical: isTV ? 5 : isLargeTablet ? 4 : isTablet ? 3 : 3,
                borderRadius: isTV ? 8 : isLargeTablet ? 6 : isTablet ? 4 : 4,
                marginBottom: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 6 : 6
              }
            ]}>
              <Text style={[
                styles.episodeNumberHorizontal,
                {
                  fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 10,
                  fontWeight: isTV ? '700' : isLargeTablet ? '700' : isTablet ? '600' : '600'
                }
              ]}>{episodeString}</Text>
            </View>

            {/* Episode Title */}
            <Text style={[
              styles.episodeTitleHorizontal,
              {
                fontSize: isTV ? 20 : isLargeTablet ? 19 : isTablet ? 18 : 15,
                fontWeight: isTV ? '800' : isLargeTablet ? '800' : isTablet ? '700' : '700',
                lineHeight: isTV ? 26 : isLargeTablet ? 24 : isTablet ? 22 : 18,
                marginBottom: isTV ? 8 : isLargeTablet ? 6 : isTablet ? 4 : 4
              }
            ]} numberOfLines={2}>
              {episode.name}
            </Text>

            {/* Episode Description */}
            <Text style={[
              styles.episodeDescriptionHorizontal,
              {
                fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 12,
                lineHeight: isTV ? 22 : isLargeTablet ? 20 : isTablet ? 18 : 16,
                marginBottom: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8,
                opacity: isTV ? 0.95 : isLargeTablet ? 0.9 : isTablet ? 0.9 : 0.9
              }
            ]} numberOfLines={isLargeScreen ? 4 : 3}>
              {(episode.overview || (episode as any).description || (episode as any).plot || (episode as any).synopsis || 'No description available')}
            </Text>

            {/* Metadata Row */}
            <View style={[
              styles.episodeMetadataRowHorizontal,
              {
                gap: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
              }
            ]}>
              {effectiveRuntime && (
                <View style={styles.runtimeContainerHorizontal}>
                  <MaterialIcons name="schedule" size={isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14} color={currentTheme.colors.mediumEmphasis} />
                  <Text style={[
                    styles.runtimeTextHorizontal,
                    {
                      fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 11 : 11,
                      fontWeight: isTV ? '600' : isLargeTablet ? '500' : isTablet ? '500' : '500',
                      color: currentTheme.colors.mediumEmphasis
                    }
                  ]}>
                    {formatRuntime(effectiveRuntime)}
                  </Text>
                </View>
              )}
              {effectiveVote > 0 && (
                <View style={styles.ratingContainerHorizontal}>
                  {isImdbRating ? (
                    <>
                      <FastImage
                        source={{ uri: IMDb_LOGO }}
                        style={[
                          styles.tmdbLogo, // Reuse same style
                          {
                            width: isTV ? 28 : isLargeTablet ? 26 : isTablet ? 24 : 24,
                            height: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14,
                            marginRight: 4
                          }
                        ]}
                        resizeMode={FastImage.resizeMode.contain}
                      />
                      <Text style={[
                        styles.ratingTextHorizontal,
                        {
                          fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 11 : 11,
                          fontWeight: isTV ? '600' : isLargeTablet ? '600' : isTablet ? '600' : '600',
                          color: '#F5C518'
                        }
                      ]}>
                        {effectiveVote.toFixed(1)}
                      </Text>
                    </>
                  ) : (
                    <>
                      <FastImage
                        source={{ uri: TMDB_LOGO }}
                        style={[
                          styles.tmdbLogo,
                          {
                            width: isTV ? 22 : isLargeTablet ? 20 : isTablet ? 20 : 20,
                            height: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14
                          }
                        ]}
                        resizeMode={FastImage.resizeMode.contain}
                      />
                      <Text style={[
                        styles.ratingTextHorizontal,
                        {
                          fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 11 : 11,
                          fontWeight: isTV ? '600' : isLargeTablet ? '600' : isTablet ? '600' : '600'
                        }
                      ]}>
                        {effectiveVote.toFixed(1)}
                      </Text>
                    </>
                  )}
                </View>
              )}
              {episode.air_date && (
                <Text style={[
                  styles.airDateTextHorizontal,
                  {
                    color: currentTheme.colors.mediumEmphasis,
                    fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 11 : 11
                  }
                ]}>
                  {formatDate(episode.air_date)}
                </Text>
              )}
            </View>
          </View>

          {/* Progress Bar */}
          {showProgress && (
            <View style={styles.progressBarContainerHorizontal}>
              <View
                style={[
                  styles.progressBarHorizontal,
                  {
                    width: `${progressPercent}%`,
                    backgroundColor: currentTheme.colors.primary,
                  }
                ]}
              />
            </View>
          )}

          {/* Completed Badge */}
          {progressPercent >= 85 && (
            <View style={[
              styles.completedBadgeHorizontal,
              {
                backgroundColor: currentTheme.colors.primary,
                width: isTV ? 32 : isLargeTablet ? 28 : isTablet ? 24 : 24,
                height: isTV ? 32 : isLargeTablet ? 28 : isTablet ? 24 : 24,
                borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
                top: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
                left: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
              }
            ]}>
              <MaterialIcons name="check" size={isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16} color="#fff" />
            </View>
          )}
          {(!progress || progressPercent === 0) && (
            <View style={{
              position: 'absolute',
              top: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
              left: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
              width: isTV ? 32 : isLargeTablet ? 28 : isTablet ? 24 : 24,
              height: isTV ? 32 : isLargeTablet ? 28 : isTablet ? 24 : 24,
              borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: currentTheme.colors.textMuted,
              opacity: 0.9,
            }} />
          )}

        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const currentSeasonEpisodes = groupedEpisodes[selectedSeason] || [];

  return (
    <View style={styles.container}>
      <Animated.View
        entering={FadeIn.duration(300).delay(50)}
      >
        {renderSeasonSelector()}
      </Animated.View>

      <Animated.View
        entering={FadeIn.duration(300).delay(100)}
      >
        <Text style={[
          styles.sectionTitle,
          {
            color: currentTheme.colors.highEmphasis,
            fontSize: isTV ? 24 : isLargeTablet ? 22 : isTablet ? 20 : 20,
            marginBottom: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16,
            paddingHorizontal: horizontalPadding
          }
        ]}>
          {currentSeasonEpisodes.length === 1 ? t('metadata.episode_count', { count: currentSeasonEpisodes.length }) : t('metadata.episode_count_plural', { count: currentSeasonEpisodes.length })}
        </Text>

        {/* Show message when no episodes are available for selected season */}
        {currentSeasonEpisodes.length === 0 && (
          <View style={styles.centeredContainer}>
            <MaterialIcons name="schedule" size={48} color={currentTheme.colors.textMuted} />
            <Text style={[styles.centeredText, { color: currentTheme.colors.text }]}>
              {t('metadata.no_episodes_for_season', { season: selectedSeason })}
            </Text>
            <Text style={[styles.centeredSubText, { color: currentTheme.colors.textMuted }]}>
              {t('metadata.episodes_not_released')}
            </Text>
          </View>
        )}

        {/* Only render episode list if there are episodes */}
        {currentSeasonEpisodes.length > 0 && (
          (settings?.episodeLayoutStyle === 'horizontal') ? (
            // Horizontal Layout (Netflix-style) - Using FlatList
            <FlatList
              key={`episodes-${settings?.episodeLayoutStyle}-${selectedSeason}`}
              ref={horizontalEpisodeScrollViewRef}
              data={currentSeasonEpisodes}
              renderItem={({ item: episode, index }) => (
                <Animated.View
                  entering={enableItemAnimations ? FadeIn.duration(300).delay(100 + index * 30) : undefined as any}
                  style={[
                    styles.episodeCardWrapperHorizontal,
                    {
                      width: horizontalCardWidth,
                      marginRight: horizontalItemSpacing
                    }
                  ]}
                >
                  {renderHorizontalEpisodeCard(episode)}
                </Animated.View>
              )}
              keyExtractor={episode => episode.id.toString()}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.episodeListContentHorizontal,
                {
                  paddingLeft: horizontalPadding,
                  paddingRight: horizontalPadding
                }
              ]}
              removeClippedSubviews
              initialNumToRender={3}
              maxToRenderPerBatch={5}
              windowSize={5}
              snapToInterval={horizontalCardWidth + horizontalItemSpacing}
              snapToAlignment="start"
              decelerationRate="fast"
              getItemLayout={(data, index) => {
                const length = horizontalCardWidth + horizontalItemSpacing;
                return {
                  length,
                  offset: horizontalPadding + (length * index), // Account for left padding
                  index,
                };
              }}
              onScrollToIndexFailed={(info) => {
                // Fallback if scrollToIndex fails - use scrollToOffset with calculated position
                const wait = new Promise(resolve => setTimeout(resolve, 500));
                wait.then(() => {
                  if (horizontalEpisodeScrollViewRef.current) {
                    const length = horizontalCardWidth + horizontalItemSpacing;
                    const offset = horizontalPadding + (length * info.index);
                    horizontalEpisodeScrollViewRef.current.scrollToOffset({
                      offset: offset,
                      animated: true
                    });
                  }
                });
              }}
            />
          ) : (
            // Vertical Layout (Traditional) - Using FlashList
            <FlashList
              key={`episodes-${settings?.episodeLayoutStyle}-${selectedSeason}`}
              ref={episodeScrollViewRef}
              data={currentSeasonEpisodes}
              renderItem={({ item: episode, index }) => (
                <Animated.View
                  entering={enableItemAnimations ? FadeIn.duration(300).delay(100 + index * 30) : undefined as any}
                >
                  {renderVerticalEpisodeCard(episode)}
                </Animated.View>
              )}
              keyExtractor={episode => episode.id.toString()}
              contentContainerStyle={[
                styles.episodeListContentVertical,
                {
                  paddingHorizontal: horizontalPadding,
                  paddingBottom: isTV ? 32 : isLargeTablet ? 28 : isTablet ? 24 : 8
                }
              ]}
              removeClippedSubviews
            />
          )
        )}
      </Animated.View>

      {/* Episode Action Menu Modal */}
      <Modal
        visible={episodeActionMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={closeEpisodeActionMenu}
        statusBarTranslucent
        supportedOrientations={['portrait', 'landscape']}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.85)', // Darker overlay
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
          }}
          onPress={closeEpisodeActionMenu}
        >
          <Pressable
            style={{
              backgroundColor: '#1E1E1E', // Solid opaque dark background
              borderRadius: isTV ? 20 : 16,
              padding: isTV ? 24 : 20,
              width: isTV ? 400 : isLargeTablet ? 360 : isTablet ? 320 : '100%',
              maxWidth: 400,
              alignSelf: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.1)', // Subtle border
              shadowColor: "#000",
              shadowOffset: {
                width: 0,
                height: 10,
              },
              shadowOpacity: 0.51,
              shadowRadius: 13.16,
              elevation: 20,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={{ marginBottom: isTV ? 20 : 16 }}>
              <Text style={{
                color: '#FFFFFF', // High contrast text
                fontSize: isTV ? 20 : 18,
                fontWeight: '700',
                marginBottom: 4,
              }}>
                {selectedEpisodeForAction ? `S${selectedEpisodeForAction.season_number}E${selectedEpisodeForAction.episode_number}` : ''}
              </Text>
              <Text style={{
                color: '#AAAAAA', // Medium emphasis text
                fontSize: isTV ? 16 : 14,
              }} numberOfLines={1} ellipsizeMode="tail">
                {selectedEpisodeForAction?.name || ''}
              </Text>
            </View>

            {/* Action buttons */}
            <View style={{ gap: isTV ? 12 : 10 }}>
              {/* Mark as Watched / Unwatched */}
              {selectedEpisodeForAction && (
                isEpisodeWatched(selectedEpisodeForAction) ? (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)', // Defined background
                      padding: isTV ? 16 : 14,
                      borderRadius: isTV ? 12 : 10,
                      opacity: markingAsWatched ? 0.5 : 1,
                    }}
                    onPress={handleMarkAsUnwatched}
                    disabled={markingAsWatched}
                  >
                    <MaterialIcons
                      name="visibility-off"
                      size={isTV ? 24 : 22}
                      color="#FFFFFF"
                      style={{ marginRight: 12 }}
                    />
                    <Text style={{
                      color: '#FFFFFF',
                      fontSize: isTV ? 16 : 15,
                      fontWeight: '500',
                    }}>
                      {markingAsWatched ? t('metadata.removing') : t('metadata.mark_as_unwatched')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: currentTheme.colors.primary,
                      padding: isTV ? 16 : 14,
                      borderRadius: isTV ? 12 : 10,
                      opacity: markingAsWatched ? 0.5 : 1,
                    }}
                    onPress={handleMarkAsWatched}
                    disabled={markingAsWatched}
                  >
                    <MaterialIcons
                      name="check-circle"
                      size={isTV ? 24 : 22}
                      color="#FFFFFF"
                      style={{ marginRight: 12 }}
                    />
                    <Text style={{
                      color: '#FFFFFF',
                      fontSize: isTV ? 16 : 15,
                      fontWeight: '600',
                    }}>
                      {markingAsWatched ? t('metadata.marking') : t('metadata.mark_as_watched')}
                    </Text>
                  </TouchableOpacity>
                )
              )}

              {/* Mark Season as Watched / Unwatched */}
              {isSeasonWatched() ? (
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    padding: isTV ? 16 : 14,
                    borderRadius: isTV ? 12 : 10,
                    opacity: markingAsWatched ? 0.5 : 1,
                  }}
                  onPress={handleMarkSeasonAsUnwatched}
                  disabled={markingAsWatched}
                >
                  <MaterialIcons
                    name="playlist-remove"
                    size={isTV ? 24 : 22}
                    color="#FFFFFF"
                    style={{ marginRight: 12 }}
                  />
                  <Text style={{
                    color: '#FFFFFF',
                    fontSize: isTV ? 16 : 15,
                    fontWeight: '500',
                    flex: 1, // Allow text to take up space
                  }} numberOfLines={1}>
                    {markingAsWatched ? t('metadata.removing') : t('metadata.unmark_season', { season: selectedSeason })}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    padding: isTV ? 16 : 14,
                    borderRadius: isTV ? 12 : 10,
                    opacity: markingAsWatched ? 0.5 : 1,
                  }}
                  onPress={handleMarkSeasonAsWatched}
                  disabled={markingAsWatched}
                >
                  <MaterialIcons
                    name="playlist-add-check"
                    size={isTV ? 24 : 22}
                    color="#FFFFFF"
                    style={{ marginRight: 12 }}
                  />
                  <Text style={{
                    color: '#FFFFFF',
                    fontSize: isTV ? 16 : 15,
                    fontWeight: '500',
                    flex: 1,
                  }} numberOfLines={1}>
                    {markingAsWatched ? t('metadata.marking') : t('metadata.mark_season', { season: selectedSeason })}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Cancel */}
              <TouchableOpacity
                style={{
                  alignItems: 'center',
                  padding: isTV ? 14 : 12,
                  marginTop: isTV ? 8 : 4,
                }}
                onPress={closeEpisodeActionMenu}
              >
                <Text style={{
                  color: '#999999',
                  fontSize: isTV ? 15 : 14,
                  fontWeight: '500',
                }}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

// Export memoized component to reduce unnecessary re-renders when focused
export const SeriesContent = memo(SeriesContentComponent);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 16,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  centeredText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
  },
  centeredSubText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  episodeList: {
    flex: 1,
  },

  // Vertical Layout Styles
  episodeListContentVertical: {
    paddingBottom: 8,
  },
  episodeGridVertical: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  episodeCardVertical: {
    flexDirection: 'row',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    height: 120,
  },
  episodeCardVerticalTablet: {
    width: '100%',
    flexDirection: 'row',
    height: 160,
    marginBottom: 16,
  },
  episodeImageContainer: {
    position: 'relative',
    width: 120,
    height: 120,
  },
  episodeImageContainerTablet: {
    width: 160,
    height: 160,
  },
  episodeImage: {
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.02 }],
  },
  episodeNumberBadge: {
    position: 'absolute',
    bottom: 8,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    zIndex: 1,
  },
  episodeNumberText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  episodeInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  episodeInfoTablet: {
    padding: 16,
  },
  episodeHeader: {
    marginBottom: 4,
  },
  episodeHeaderTablet: {
    marginBottom: 6,
  },
  episodeTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  episodeTitleTablet: {
    fontSize: 16,
    marginBottom: 4,
  },
  episodeMetadata: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  episodeMetadataTablet: {
    gap: 6,
    flexWrap: 'wrap',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    // chip background removed
  },
  tmdbLogo: {
    width: 20,
    height: 14,
  },
  ratingText: {
    color: '#01b4e4',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  runtimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    // chip background removed
    minWidth: 52, // reserve space so following items (rating) don't shift
  },
  runtimeText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  airDateText: {
    fontSize: 12,
    opacity: 0.8,
  },
  episodeOverview: {
    fontSize: 13,
    lineHeight: 18,
  },
  episodeOverviewTablet: {
    fontSize: 14,
    lineHeight: 20,
  },
  progressBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  progressBar: {
    height: '100%',
  },
  completedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    zIndex: 2,
  },

  // Horizontal Layout Styles
  episodeListContentHorizontal: {
    // Padding will be added responsively
  },
  episodeCardWrapperHorizontal: {
    // Dimensions will be set responsively
  },
  episodeCardHorizontal: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    height: 200,
    position: 'relative',
    width: '100%',
    backgroundColor: 'transparent',
  },
  episodeBackgroundImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  episodeGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    justifyContent: 'flex-end',
  },
  episodeContent: {
    padding: 12,
    paddingBottom: 16,
  },
  episodeContentTablet: {
    padding: 16,
    paddingBottom: 20,
  },
  episodeNumberBadgeHorizontal: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  episodeNumberBadgeHorizontalTablet: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  episodeNumberHorizontal: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  episodeNumberHorizontalTablet: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  episodeTitleHorizontal: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
    lineHeight: 18,
  },
  episodeTitleHorizontalTablet: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 6,
    lineHeight: 22,
  },
  episodeDescriptionHorizontal: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
    opacity: 0.9,
  },
  episodeDescriptionHorizontalTablet: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    lineHeight: 18,
    marginBottom: 10,
    opacity: 0.95,
  },
  episodeMetadataRowHorizontal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  runtimeContainerHorizontal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // chip background removed
  },
  runtimeTextHorizontal: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '500',
  },
  airDateTextHorizontal: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    opacity: 0.8,
  },
  ratingContainerHorizontal: {
    flexDirection: 'row',
    alignItems: 'center',
    // chip background removed
    gap: 2,
  },

  ratingTextHorizontal: {
    color: '#FFD700',
    fontSize: 11,
    fontWeight: '600',
  },
  progressBarContainerHorizontal: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressBarHorizontal: {
    height: '100%',
    borderRadius: 2,
  },
  completedBadgeHorizontal: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },

  // Season Selector Styles
  seasonSelectorWrapper: {
    marginBottom: 20,
  },
  seasonSelectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  seasonSelectorTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 0, // Removed margin bottom here
  },
  seasonSelectorTitleTablet: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 0, // Removed margin bottom here
  },
  seasonSelectorContainer: {
    flexGrow: 0,
  },
  seasonSelectorContent: {
    paddingBottom: 8,
  },
  seasonSelectorContentTablet: {
    paddingBottom: 12,
  },
  seasonButton: {
    alignItems: 'center',
  },
  selectedSeasonButton: {
    opacity: 1,
  },
  seasonPosterContainer: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  seasonPoster: {
    width: '100%',
    height: '100%',
  },
  selectedSeasonIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  selectedSeasonIndicatorTablet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 6,
  },
  seasonButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  seasonButtonTextTablet: {
    fontSize: 16,
    fontWeight: '600',
  },
  selectedSeasonButtonText: {
    fontWeight: '700',
  },
  selectedSeasonButtonTextTablet: {
    fontWeight: '800',
  },
  seasonViewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  seasonViewToggleText: {
    fontSize: 12,
    fontWeight: '500',
    marginRight: 4,
  },
  seasonTextButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  selectedSeasonTextButton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  seasonTextButtonText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  seasonTextButtonTextTablet: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  selectedSeasonTextButtonText: {
    fontWeight: '700',
  },
  selectedSeasonTextButtonTextTablet: {
    fontWeight: '800',
  },

});
