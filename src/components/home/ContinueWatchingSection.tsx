import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  AppState,
  AppStateStatus,
  ActivityIndicator,
  Platform
} from 'react-native';
import { FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, Layout } from 'react-native-reanimated';
import BottomSheet, { BottomSheetModal, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { StreamingContent, catalogService } from '../../services/catalogService';
import { LinearGradient } from 'expo-linear-gradient';
import FastImage from '@d11/react-native-fast-image';
import { useTheme } from '../../contexts/ThemeContext';
import { storageService } from '../../services/storageService';
import { logger } from '../../utils/logger';
import * as Haptics from 'expo-haptics';
import { TraktService } from '../../services/traktService';
import { SimklService } from '../../services/simklService';
import { stremioService } from '../../services/stremioService';
import { streamCacheService } from '../../services/streamCacheService';
import { useSettings } from '../../hooks/useSettings';
import { useBottomSheetBackHandler } from '../../hooks/useBottomSheetBackHandler';


// Define interface for continue watching items
interface ContinueWatchingItem extends StreamingContent {
  progress: number;
  lastUpdated: number;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  addonId?: string;
  addonPoster?: string;
  addonName?: string;
  addonDescription?: string;
  traktPlaybackId?: number; // Trakt playback ID for removal
}

// Define the ref interface
interface ContinueWatchingRef {
  refresh: () => Promise<boolean>;
}

// Enhanced responsive breakpoints for Continue Watching section
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

// Dynamic poster calculation based on screen width for Continue Watching section
const calculatePosterLayout = (screenWidth: number) => {
  const MIN_POSTER_WIDTH = 120; // Slightly larger for continue watching items
  const MAX_POSTER_WIDTH = 160; // Maximum poster width for this section
  const HORIZONTAL_PADDING = 40; // Total horizontal padding/margins

  // Calculate how many posters can fit (fewer items for continue watching)
  const availableWidth = screenWidth - HORIZONTAL_PADDING;
  const maxColumns = Math.floor(availableWidth / MIN_POSTER_WIDTH);

  // Limit to reasonable number of columns (2-5 for continue watching)
  const numColumns = Math.min(Math.max(maxColumns, 2), 5);

  // Calculate actual poster width
  const posterWidth = Math.min(availableWidth / numColumns, MAX_POSTER_WIDTH);

  return {
    numColumns,
    posterWidth,
    spacing: 12 // Space between posters
  };
};

const { width } = Dimensions.get('window');
const posterLayout = calculatePosterLayout(width);
const POSTER_WIDTH = posterLayout.posterWidth;

// Allow any known id formats (imdb 'tt...', kitsu 'kitsu:...', tmdb 'tmdb:...', or others)
const isSupportedId = (id: string): boolean => {
  return typeof id === 'string' && id.length > 0;
};

// Function to check if an episode has been released
const isEpisodeReleased = (video: any): boolean => {
  if (!video.released) return false;

  try {
    const releaseDate = new Date(video.released);
    const now = new Date();
    return releaseDate <= now;
  } catch (error) {
    // If we can't parse the date, assume it's not released
    return false;
  }
};

// Create a proper imperative handle with React.forwardRef and updated type
const ContinueWatchingSection = React.forwardRef<ContinueWatchingRef>((props, ref) => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { currentTheme } = useTheme();
  const { settings } = useSettings();
  const insets = useSafeAreaInsets();
  const [continueWatchingItems, setContinueWatchingItems] = useState<ContinueWatchingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const appState = useRef(AppState.currentState);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingRefreshRef = useRef(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Bottom sheet for item actions
  const actionSheetRef = useRef<BottomSheetModal>(null);
  const { onChange, onDismiss } = useBottomSheetBackHandler();
  const [selectedItem, setSelectedItem] = useState<ContinueWatchingItem | null>(null);

  // Enhanced responsive sizing for tablets and TV screens
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const deviceWidth = dimensions.width;
  const deviceHeight = dimensions.height;

  // Listen for dimension changes (orientation changes)
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions(window);
    });

    return () => subscription?.remove();
  }, []);

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

  // Enhanced responsive sizing for continue watching items
  const computedItemWidth = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 400; // Larger items for TV
      case 'largeTablet':
        return 350; // Medium-large items for large tablets
      case 'tablet':
        return 320; // Medium items for tablets
      default:
        return 280; // Original phone size
    }
  }, [deviceType]);

  const computedItemHeight = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 160; // Taller items for TV
      case 'largeTablet':
        return 140; // Medium-tall items for large tablets
      case 'tablet':
        return 130; // Medium items for tablets
      default:
        return 120; // Original phone height
    }
  }, [deviceType]);

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

  const itemSpacing = useMemo(() => {
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



  // Use a ref to track if a background refresh is in progress to avoid state updates
  const isRefreshingRef = useRef(false);

  // Track recently removed items to prevent immediate re-addition
  const recentlyRemovedRef = useRef<Set<string>>(new Set());
  const REMOVAL_IGNORE_DURATION = 10000; // 10 seconds

  // Track last Trakt sync to prevent excessive API calls
  const lastTraktSyncRef = useRef<number>(0);
  const TRAKT_SYNC_COOLDOWN = 0; // disabled (always fetch Trakt playback)

  // Track last Simkl sync to prevent excessive API calls
  const lastSimklSyncRef = useRef<number>(0);
  const SIMKL_SYNC_COOLDOWN = 0; // disabled (always fetch Simkl playback)

  // Track last Trakt reconcile per item (local -> Trakt catch-up)
  const lastTraktReconcileRef = useRef<Map<string, number>>(new Map());
  const TRAKT_RECONCILE_COOLDOWN = 0; // 2 minutes between reconcile attempts per item

  // Debug: avoid logging the same order repeatedly
  const lastOrderLogSigRef = useRef<string>('');

  // Cache for metadata to avoid redundant API calls
  const metadataCache = useRef<Record<string, { metadata: any; basicContent: StreamingContent | null; timestamp: number }>>({});
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  const getCachedMetadata = useCallback(async (type: string, id: string, addonId?: string) => {
    const cacheKey = `${type}:${id}:${addonId || 'default'}`;
    const cached = metadataCache.current[cacheKey];
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      return cached;
    }

    try {
      const shouldFetchMeta = await stremioService.isValidContentId(type, id);

      const [metadata, basicContent, addonSpecificMeta] = await Promise.all([
        shouldFetchMeta ? stremioService.getMetaDetails(type, id) : Promise.resolve(null),
        catalogService.getBasicContentDetails(type, id),

        addonId
          ? stremioService.getMetaDetails(type, id, addonId).catch(() => null)
          : Promise.resolve(null)
      ]);

      const preferredAddonMeta = addonSpecificMeta || metadata;


      const finalContent = basicContent ? {
        ...basicContent,
        ...(preferredAddonMeta?.name && { name: preferredAddonMeta.name }),
        ...(preferredAddonMeta?.poster && { poster: preferredAddonMeta.poster }),
        ...(preferredAddonMeta?.description && { description: preferredAddonMeta.description }),
      } : null;


      if (finalContent) {
        const result = {
          metadata,
          basicContent: finalContent,
          addonContent: preferredAddonMeta,
          timestamp: now
        };

        metadataCache.current[cacheKey] = result;
        return result;
      }
      return null;
    } catch (error: any) {
      return null;
    }
  }, []);


  const findNextEpisode = useCallback((
    currentSeason: number,
    currentEpisode: number,
    videos: any[],
    watchedSet?: Set<string>,
    showId?: string
  ) => {
    if (!videos || !Array.isArray(videos)) return null;

    const sortedVideos = [...videos].sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      return a.episode - b.episode;
    });

    const isAlreadyWatched = (season: number, episode: number): boolean => {
      if (!watchedSet || !showId) return false;
      const cleanShowId = showId.startsWith('tt') ? showId : `tt${showId}`;
      return watchedSet.has(`${cleanShowId}:${season}:${episode}`) ||
        watchedSet.has(`${showId}:${season}:${episode}`);
    };

    for (const video of sortedVideos) {
      if (video.season < currentSeason) continue;
      if (video.season === currentSeason && video.episode <= currentEpisode) continue;

      if (isAlreadyWatched(video.season, video.episode)) continue;

      if (isEpisodeReleased(video)) {
        return video;
      }
    }

    return null;
  }, []);


  // Modified loadContinueWatching to render incrementally
  const loadContinueWatching = useCallback(async (isBackgroundRefresh = false) => {
    if (isRefreshingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    if (!isBackgroundRefresh) {
      setLoading(true);
    }
    isRefreshingRef.current = true;

    logger.log(`[CW] loadContinueWatching start (background=${isBackgroundRefresh})`);

    const shouldPreferCandidate = (candidate: ContinueWatchingItem, existing: ContinueWatchingItem): boolean => {
      const candidateUpdated = candidate.lastUpdated ?? 0;
      const existingUpdated = existing.lastUpdated ?? 0;
      const candidateProgress = candidate.progress ?? 0;
      const existingProgress = existing.progress ?? 0;

      const sameEpisode =
        candidate.type === 'movie' ||
        (
          candidate.type === 'series' &&
          existing.type === 'series' &&
          candidate.season !== undefined &&
          candidate.episode !== undefined &&
          existing.season !== undefined &&
          existing.episode !== undefined &&
          candidate.season === existing.season &&
          candidate.episode === existing.episode
        );

      // If it's the same episode/movie, prefer the higher progress (local often leads Trakt)
      if (sameEpisode) {
        if (candidateProgress > existingProgress + 0.5) return true;
        if (existingProgress > candidateProgress + 0.5) return false;
      }

      // Otherwise, prefer the most recently watched item
      if (candidateUpdated !== existingUpdated) return candidateUpdated > existingUpdated;

      // Final tiebreaker
      return candidateProgress > existingProgress;
    };

    const compareCwItems = (a: ContinueWatchingItem, b: ContinueWatchingItem): number => {
      const aProgress = a.progress ?? 0;
      const bProgress = b.progress ?? 0;
      const aIsUpNext = a.type === 'series' && aProgress <= 0;
      const bIsUpNext = b.type === 'series' && bProgress <= 0;

      // Keep active in-progress items ahead of "Up Next" placeholders.
      if (aIsUpNext !== bIsUpNext) {
        return aIsUpNext ? 1 : -1;
      }

      return (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0);
    };

    type LocalProgressEntry = {
      episodeId?: string;
      season?: number;
      episode?: number;
      progressPercent: number;
      lastUpdated: number;
      currentTime: number;
      duration: number;
    };

    const getIdVariants = (id: string): string[] => {
      const variants = new Set<string>();
      if (typeof id !== 'string' || id.length === 0) return [];

      variants.add(id);

      if (id.startsWith('tt')) {
        variants.add(id.replace(/^tt/, ''));
      } else {
        // Only add a tt-variant when the id looks like a bare imdb numeric id.
        if (/^\d+$/.test(id)) {
          variants.add(`tt${id}`);
        }
      }

      return Array.from(variants);
    };

    const parseEpisodeId = (episodeId?: string): { season: number; episode: number } | null => {
      if (!episodeId) return null;

      const match = episodeId.match(/s(\d+)e(\d+)/i);
      if (match) {
        const season = parseInt(match[1], 10);
        const episode = parseInt(match[2], 10);
        if (!isNaN(season) && !isNaN(episode)) return { season, episode };
      }

      const parts = episodeId.split(':');
      if (parts.length >= 3) {
        const seasonNum = parseInt(parts[parts.length - 2], 10);
        const episodeNum = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(seasonNum) && !isNaN(episodeNum)) return { season: seasonNum, episode: episodeNum };
      }

      return null;
    };

    // Helper to merge a batch of items into state (dedupe by type:id, keep newest)
    const mergeBatchIntoState = async (batch: ContinueWatchingItem[]) => {
      if (!batch || batch.length === 0) return;

      // 1. Filter items first (async checks) - do this BEFORE any state updates
      const validItems: ContinueWatchingItem[] = [];
      for (const it of batch) {
        // For series, use episode-specific key
        const key = it.type === 'series' && it.season && it.episode
          ? `${it.type}:${it.id}:${it.season}:${it.episode}`
          : `${it.type}:${it.id}`;

        // Skip recently removed items
        if (recentlyRemovedRef.current.has(key)) {
          continue;
        }

        // Skip persistently removed items (episode-specific for series)
        const removeId = it.type === 'series' && it.season && it.episode
          ? `${it.id}:${it.season}:${it.episode}`
          : it.id;
        const isRemoved = await storageService.isContinueWatchingRemoved(removeId, it.type);
        if (isRemoved) {
          continue;
        }

        validItems.push(it);
      }

      if (validItems.length === 0) return;

      // 2. Single state update for the entire batch
      setContinueWatchingItems((prev) => {
        const map = new Map<string, ContinueWatchingItem>();
        // Add existing items
        for (const it of prev) {
          map.set(`${it.type}:${it.id}`, it);
        }

        // Merge new valid items
        for (const it of validItems) {
          const key = `${it.type}:${it.id}`;
          const existing = map.get(key);
          // Prefer local when it is ahead; otherwise, prefer newer
          if (!existing || shouldPreferCandidate(it, existing)) {
            map.set(key, it);
          }
        }

        const merged = Array.from(map.values());
        merged.sort(compareCwItems);

        return merged;
      });
    };

    try {
      const traktService = TraktService.getInstance();
      const isTraktAuthed = await traktService.isAuthenticated();

      const simklService = SimklService.getInstance();
      // Prefer Trakt if both are authenticated
      const isSimklAuthed = !isTraktAuthed ? await simklService.isAuthenticated() : false;

      logger.log(`[CW] Providers authed: trakt=${isTraktAuthed} simkl=${isSimklAuthed}`);

      // Declare groupPromises outside the if block
      let groupPromises: Promise<void>[] = [];

      // In Trakt mode, CW is sourced from Trakt only, but we still want to overlay local progress
      // when local is ahead (scrobble lag/offline playback).
      let localProgressIndex: Map<string, LocalProgressEntry[]> | null = null;
      if (isTraktAuthed || isSimklAuthed) {
        try {
          const allProgress = await storageService.getAllWatchProgress();
          const index = new Map<string, LocalProgressEntry[]>();

          for (const [key, progress] of Object.entries(allProgress)) {
            const keyParts = key.split(':');
            const [type, id, ...episodeIdParts] = keyParts;
            const episodeId = episodeIdParts.length > 0 ? episodeIdParts.join(':') : undefined;

            const progressPercent =
              progress?.duration > 0
                ? (progress.currentTime / progress.duration) * 100
                : 0;

            if (!isFinite(progressPercent) || progressPercent <= 0) continue;

            const parsed = parseEpisodeId(episodeId);
            const entry: LocalProgressEntry = {
              episodeId,
              season: parsed?.season,
              episode: parsed?.episode,
              progressPercent,
              lastUpdated: progress?.lastUpdated ?? 0,
              currentTime: progress?.currentTime ?? 0,
              duration: progress?.duration ?? 0,
            };

            for (const idVariant of getIdVariants(id)) {
              const idxKey = `${type}:${idVariant}`;
              const list = index.get(idxKey);
              if (list) list.push(entry);
              else index.set(idxKey, [entry]);
            }
          }

          localProgressIndex = index;
        } catch {
          localProgressIndex = null;
        }
      }

      // Local-only mode (no Trakt, no Simkl): use local storage
      if (!isTraktAuthed && !isSimklAuthed) {
        const allProgress = await storageService.getAllWatchProgress();
        if (Object.keys(allProgress).length === 0) {
          setContinueWatchingItems([]);
          return;
        }

        // Group progress items by content ID - process ONLY last 30 items
        const sortedProgress = Object.entries(allProgress)
          .sort(([, a], [, b]) => b.lastUpdated - a.lastUpdated)
          .slice(0, 30);

        const contentGroups: Record<string, { type: string; id: string; episodes: Array<{ key: string; episodeId?: string; progress: any; progressPercent: number }> }> = {};

        for (const [key, progress] of sortedProgress) {
          const keyParts = key.split(':');
          const [type, id, ...episodeIdParts] = keyParts;
          const episodeId = episodeIdParts.length > 0 ? episodeIdParts.join(':') : undefined;

          const progressPercent =
            progress.duration > 0
              ? (progress.currentTime / progress.duration) * 100
              : 0;
          // Skip fully watched movies
          if (type === 'movie' && progressPercent >= 85) continue;
          // Skip movies with no actual progress (ensure > 0%)
          if (type === 'movie' && (!isFinite(progressPercent) || progressPercent <= 0)) continue;
          const contentKey = `${type}:${id}`;
          if (!contentGroups[contentKey]) contentGroups[contentKey] = { type, id, episodes: [] };
          contentGroups[contentKey].episodes.push({ key, episodeId, progress, progressPercent });
        }

        // Fetch Trakt watched movies once and reuse
        const traktMoviesSetPromise = (async () => {
          try {
            if (!isTraktAuthed) return new Set<string>();
            if (typeof (traktService as any).getWatchedMovies === 'function') {
              const watched = await (traktService as any).getWatchedMovies();
              const watchedSet = new Set<string>();

              if (Array.isArray(watched)) {
                watched.forEach((w: any) => {
                  const ids = w?.movie?.ids;
                  if (!ids) return;

                  if (ids.imdb) {
                    const imdb = ids.imdb;
                    watchedSet.add(imdb.startsWith('tt') ? imdb : `tt${imdb}`);
                  }
                  if (ids.tmdb) {
                    watchedSet.add(ids.tmdb.toString());
                  }
                });
              }
              return watchedSet;
            }
            return new Set<string>();
          } catch {
            return new Set<string>();
          }
        })();

        // Fetch Trakt watched shows once and reuse
        const traktShowsSetPromise = (async () => {
          try {
            if (!isTraktAuthed) return new Set<string>();

            if (typeof (traktService as any).getWatchedShows === 'function') {
              const watched = await (traktService as any).getWatchedShows();
              const watchedSet = new Set<string>();

              if (Array.isArray(watched)) {
                watched.forEach((show: any) => {
                  const ids = show?.show?.ids;
                  if (!ids) return;

                  const imdbId = ids.imdb;
                  const tmdbId = ids.tmdb;

                  if (show.seasons && Array.isArray(show.seasons)) {
                    show.seasons.forEach((season: any) => {
                      if (season.episodes && Array.isArray(season.episodes)) {
                        season.episodes.forEach((episode: any) => {
                          if (imdbId) {
                            const cleanImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
                            watchedSet.add(`${cleanImdbId}:${season.number}:${episode.number}`);
                          }
                          if (tmdbId) {
                            watchedSet.add(`${tmdbId}:${season.number}:${episode.number}`);
                          }
                        });
                      }
                    });
                  }
                });
              }
              return watchedSet;
            }
            return new Set<string>();
          } catch {
            return new Set<string>();
          }
        })();

        // Process each content group concurrently, merging results as they arrive
        groupPromises = Object.values(contentGroups).map(async (group) => {
          try {
            if (!isSupportedId(group.id)) return;
            // Skip movies that are already watched on Trakt
            if (group.type === 'movie') {
              const watchedSet = await traktMoviesSetPromise;
              const imdbId = group.id.startsWith('tt')
                ? group.id
                : `tt${group.id}`;
              if (watchedSet.has(imdbId)) {
                // Optional: sync local store to watched to prevent reappearance
                try {
                  await storageService.setWatchProgress(group.id, 'movie', {
                    currentTime: 1,
                    duration: 1,
                    lastUpdated: Date.now(),
                    traktSynced: true,
                    traktProgress: 100,
                  } as any);
                } catch (_e) { }
                return;
              }
            }
            const cachedData = await getCachedMetadata(group.type, group.id, group.episodes[0]?.progress?.addonId);
            if (!cachedData?.basicContent) return;
            const { metadata, basicContent } = cachedData;

            const batch: ContinueWatchingItem[] = [];
            for (const episode of group.episodes) {
              const { episodeId, progress, progressPercent } = episode;

              if (group.type === 'series' && progressPercent >= 85) {
                // Episode is completed - find the next unwatched episode
                let completedSeason: number | undefined;
                let completedEpisode: number | undefined;

                if (episodeId) {
                  const match = episodeId.match(/s(\d+)e(\d+)/i);
                  if (match) {
                    completedSeason = parseInt(match[1], 10);
                    completedEpisode = parseInt(match[2], 10);
                  } else {
                    const parts = episodeId.split(':');
                    if (parts.length >= 3) {
                      const seasonPart = parts[parts.length - 2];
                      const episodePart = parts[parts.length - 1];
                      const seasonNum = parseInt(seasonPart, 10);
                      const episodeNum = parseInt(episodePart, 10);
                      if (!isNaN(seasonNum) && !isNaN(episodeNum)) {
                        completedSeason = seasonNum;
                        completedEpisode = episodeNum;
                      }
                    }
                  }
                }

                // If we have valid season/episode info, find the next episode
                if (completedSeason !== undefined && completedEpisode !== undefined && metadata?.videos) {
                  const watchedEpisodesSet = await traktShowsSetPromise;
                  const nextEpisode = findNextEpisode(
                    completedSeason,
                    completedEpisode,
                    metadata.videos,
                    watchedEpisodesSet,
                    group.id
                  );

                  if (nextEpisode) {
                    logger.log(`📺 [ContinueWatching] Found next episode: S${nextEpisode.season}E${nextEpisode.episode} for ${basicContent.name}`);
                    batch.push({
                      ...basicContent,
                      progress: 0, // Up next - no progress yet
                      lastUpdated: progress.lastUpdated, // Keep the timestamp from completed episode
                      season: nextEpisode.season,
                      episode: nextEpisode.episode,
                      episodeTitle: nextEpisode.title || `Episode ${nextEpisode.episode}`,
                      addonId: progress.addonId,
                    } as ContinueWatchingItem);
                  }
                }
                continue;
              }

              let season: number | undefined;
              let episodeNumber: number | undefined;
              let episodeTitle: string | undefined;
              let isWatchedOnTrakt = false;

              if (episodeId && group.type === 'series') {
                let match = episodeId.match(/s(\d+)e(\d+)/i);
                if (match) {
                  season = parseInt(match[1], 10);
                  episodeNumber = parseInt(match[2], 10);
                  episodeTitle = `Episode ${episodeNumber}`;
                } else {
                  const parts = episodeId.split(':');
                  if (parts.length >= 3) {
                    const seasonPart = parts[parts.length - 2];
                    const episodePart = parts[parts.length - 1];
                    const seasonNum = parseInt(seasonPart, 10);
                    const episodeNum = parseInt(episodePart, 10);
                    if (!isNaN(seasonNum) && !isNaN(episodeNum)) {
                      season = seasonNum;
                      episodeNumber = episodeNum;
                      episodeTitle = `Episode ${episodeNumber}`;
                    }
                  }
                }

                // Check if this specific episode is watched on Trakt
                if (season !== undefined && episodeNumber !== undefined) {
                  const watchedEpisodesSet = await traktShowsSetPromise;
                  // Try with both raw ID and tt-prefixed ID, and TMDB ID (which is just the ID string)
                  const rawId = group.id.replace(/^tt/, '');
                  const ttId = `tt${rawId}`;

                  if (watchedEpisodesSet.has(`${ttId}:${season}:${episodeNumber}`) ||
                    watchedEpisodesSet.has(`${rawId}:${season}:${episodeNumber}`) ||
                    watchedEpisodesSet.has(`${group.id}:${season}:${episodeNumber}`)) {
                    isWatchedOnTrakt = true;

                    // Update local storage to reflect watched status
                    try {
                      await storageService.setWatchProgress(
                        group.id,
                        'series',
                        {
                          currentTime: 1,
                          duration: 1,
                          lastUpdated: Date.now(),
                          traktSynced: true,
                          traktProgress: 100,
                        } as any,
                        episodeId
                      );
                    } catch (_e) { }
                  }
                }
              }

              // If watched on Trakt, skip it - Trakt playback handles in-progress items
              if (isWatchedOnTrakt) {
                continue;
              }

              batch.push({
                ...basicContent,
                progress: progressPercent,
                lastUpdated: progress.lastUpdated,
                season,
                episode: episodeNumber,
                episodeTitle,
                addonId: progress.addonId,
              } as ContinueWatchingItem);
            }

            if (batch.length > 0) await mergeBatchIntoState(batch);
          } catch (error) {
            // Continue processing other groups even if one fails
          }
        });
      }

      // TRAKT: fetch playback progress (in-progress items) and history, merge incrementally
      const traktMergePromise = (async () => {
        try {
          if (!isTraktAuthed) return;

          // Check Trakt sync cooldown to prevent excessive API calls
          const now = Date.now();
          if (TRAKT_SYNC_COOLDOWN > 0 && (now - lastTraktSyncRef.current) < TRAKT_SYNC_COOLDOWN) {
            logger.log(`[TraktSync] Skipping Trakt sync - cooldown active (${Math.round((TRAKT_SYNC_COOLDOWN - (now - lastTraktSyncRef.current)) / 1000)}s remaining)`);
            return;
          }

          lastTraktSyncRef.current = now;

          // Fetch only playback progress (paused items with actual progress %)
          // Removed: history items and watched shows - redundant with local logic
          const playbackItems = await traktService.getPlaybackProgress();

          try {
            const top = [...playbackItems]
              .sort((a, b) => new Date(b.paused_at).getTime() - new Date(a.paused_at).getTime())
              .slice(0, 10)
              .map((x) => ({
                id: x.id,
                type: x.type,
                progress: x.progress,
                pausedAt: x.paused_at,
                imdb: x.type === 'movie' ? x.movie?.ids?.imdb : x.show?.ids?.imdb,
                season: x.type === 'episode' ? x.episode?.season : undefined,
                episode: x.type === 'episode' ? x.episode?.number : undefined,
              }));
            logger.log('[CW][Trakt] top playback items:', top);
          } catch {
            // ignore
          }



          const traktBatch: ContinueWatchingItem[] = [];

          // STEP 1: Process playback progress items (in-progress, paused)
          // These have actual progress percentage from Trakt
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

          // Sort by paused_at descending and take top 30
          const sortedPlaybackItems = playbackItems
            .sort((a, b) => new Date(b.paused_at).getTime() - new Date(a.paused_at).getTime())
            .slice(0, 30);

          for (const item of sortedPlaybackItems) {
            try {
              // Skip items with < 2% progress (accidental clicks)
              if (item.progress < 2) continue;
              // Skip items older than 30 days
              const pausedAt = new Date(item.paused_at).getTime();
              if (pausedAt < thirtyDaysAgo) continue;

              if (item.type === 'movie' && item.movie?.ids?.imdb) {
                // Skip completed movies
                if (item.progress >= 85) continue;

                const imdbId = item.movie.ids.imdb.startsWith('tt')
                  ? item.movie.ids.imdb
                  : `tt${item.movie.ids.imdb}`;

                // Check if recently removed
                const movieKey = `movie:${imdbId}`;
                if (recentlyRemovedRef.current.has(movieKey)) continue;

                const cachedData = await getCachedMetadata('movie', imdbId);
                if (!cachedData?.basicContent) continue;

                const pausedAt = new Date(item.paused_at).getTime();
                traktBatch.push({
                  ...cachedData.basicContent,
                  id: imdbId,
                  type: 'movie',
                  progress: item.progress,
                  lastUpdated: pausedAt,
                  addonId: undefined,
                  traktPlaybackId: item.id, // Store playback ID for removal
                } as ContinueWatchingItem);

                logger.log(`📺 [TraktPlayback] Adding movie ${item.movie.title} with ${item.progress.toFixed(1)}% progress`);

              } else if (item.type === 'episode' && item.show?.ids?.imdb && item.episode) {
                const showImdb = item.show.ids.imdb.startsWith('tt')
                  ? item.show.ids.imdb
                  : `tt${item.show.ids.imdb}`;

                // Check if recently removed
                const showKey = `series:${showImdb}`;
                if (recentlyRemovedRef.current.has(showKey)) continue;

                const pausedAt = new Date(item.paused_at).getTime();

                const cachedData = await getCachedMetadata('series', showImdb);
                if (!cachedData?.basicContent) continue;

                // If episode is completed (>= 85%), find next episode
                if (item.progress >= 85) {
                  const metadata = cachedData.metadata;
                  if (metadata?.videos) {
                    const nextEpisode = findNextEpisode(
                      item.episode.season,
                      item.episode.number,
                      metadata.videos,
                      undefined, // No watched set needed, findNextEpisode handles it
                      showImdb
                    );

                    if (nextEpisode) {
                      logger.log(`📺 [TraktPlayback] Episode completed, adding next: S${nextEpisode.season}E${nextEpisode.episode} for ${item.show.title}`);
                      traktBatch.push({
                        ...cachedData.basicContent,
                        id: showImdb,
                        type: 'series',
                        progress: 0, // Up next - no progress yet
                        lastUpdated: pausedAt,
                        season: nextEpisode.season,
                        episode: nextEpisode.episode,
                        episodeTitle: nextEpisode.title || `Episode ${nextEpisode.episode}`,
                        addonId: undefined,
                        traktPlaybackId: item.id,
                      } as ContinueWatchingItem);
                    }
                  }
                  continue;
                }

                traktBatch.push({
                  ...cachedData.basicContent,
                  id: showImdb,
                  type: 'series',
                  progress: item.progress,
                  lastUpdated: pausedAt,
                  season: item.episode.season,
                  episode: item.episode.number,
                  episodeTitle: item.episode.title || `Episode ${item.episode.number}`,
                  addonId: undefined,
                  traktPlaybackId: item.id, // Store playback ID for removal
                } as ContinueWatchingItem);

                logger.log(`📺 [TraktPlayback] Adding ${item.show.title} S${item.episode.season}E${item.episode.number} with ${item.progress.toFixed(1)}% progress`);
              }
            } catch (err) {
              // Continue with other items
            }
          }

          // STEP 2: Get watched shows and find "Up Next" episodes
          // This handles cases where episodes are fully completed and removed from playback progress
          try {
            const watchedShows = await traktService.getWatchedShows();
            const thirtyDaysAgoForShows = Date.now() - (30 * 24 * 60 * 60 * 1000);

            for (const watchedShow of watchedShows) {
              try {
                if (!watchedShow.show?.ids?.imdb) continue;

                // Skip shows that haven't been watched recently
                const lastWatchedAt = new Date(watchedShow.last_watched_at).getTime();
                if (lastWatchedAt < thirtyDaysAgoForShows) continue;

                const showImdb = watchedShow.show.ids.imdb.startsWith('tt')
                  ? watchedShow.show.ids.imdb
                  : `tt${watchedShow.show.ids.imdb}`;

                // Check if recently removed
                const showKey = `series:${showImdb}`;
                if (recentlyRemovedRef.current.has(showKey)) continue;

                // Find the last watched episode
                let lastWatchedSeason = 0;
                let lastWatchedEpisode = 0;
                let latestEpisodeTimestamp = 0;

                if (watchedShow.seasons) {
                  for (const season of watchedShow.seasons) {
                    for (const episode of season.episodes) {
                      const episodeTimestamp = new Date(episode.last_watched_at).getTime();
                      if (episodeTimestamp > latestEpisodeTimestamp) {
                        latestEpisodeTimestamp = episodeTimestamp;
                        lastWatchedSeason = season.number;
                        lastWatchedEpisode = episode.number;
                      }
                    }
                  }
                }

                if (lastWatchedSeason === 0 && lastWatchedEpisode === 0) continue;

                // Get metadata with episode list
                const cachedData = await getCachedMetadata('series', showImdb);
                if (!cachedData?.basicContent || !cachedData?.metadata?.videos) continue;

                // Build a set of watched episodes for this show
                const watchedEpisodeSet = new Set<string>();
                if (watchedShow.seasons) {
                  for (const season of watchedShow.seasons) {
                    for (const episode of season.episodes) {
                      watchedEpisodeSet.add(`${showImdb}:${season.number}:${episode.number}`);
                    }
                  }
                }

                // Find the next unwatched episode
                const nextEpisode = findNextEpisode(
                  lastWatchedSeason,
                  lastWatchedEpisode,
                  cachedData.metadata.videos,
                  watchedEpisodeSet,
                  showImdb
                );

                if (nextEpisode) {
                  logger.log(`📺 [TraktWatched] Found Up Next: ${watchedShow.show.title} S${nextEpisode.season}E${nextEpisode.episode}`);
                  traktBatch.push({
                    ...cachedData.basicContent,
                    id: showImdb,
                    type: 'series',
                    progress: 0, // Up next - no progress yet
                    lastUpdated: latestEpisodeTimestamp,
                    season: nextEpisode.season,
                    episode: nextEpisode.episode,
                    episodeTitle: nextEpisode.title || `Episode ${nextEpisode.episode}`,
                    addonId: undefined,
                  } as ContinueWatchingItem);
                }
              } catch (err) {
                // Continue with other shows
              }
            }
          } catch (err) {
            logger.warn('[TraktSync] Error fetching watched shows for Up Next:', err);
          }

          // Trakt mode: show ONLY Trakt items, but override progress with local if local is higher.
          if (traktBatch.length > 0) {
            // Dedupe (keep most recent per show/movie)
            const deduped = new Map<string, ContinueWatchingItem>();
            for (const item of traktBatch) {
              const key = `${item.type}:${item.id}`;
              const existing = deduped.get(key);
              if (!existing || (item.lastUpdated ?? 0) > (existing.lastUpdated ?? 0)) {
                deduped.set(key, item);
              }
            }

            // Filter removed items
            const filteredItems: ContinueWatchingItem[] = [];
            for (const item of deduped.values()) {
              const key = item.type === 'series' && item.season && item.episode
                ? `${item.type}:${item.id}:${item.season}:${item.episode}`
                : `${item.type}:${item.id}`;
              if (recentlyRemovedRef.current.has(key)) continue;

              const removeId = item.type === 'series' && item.season && item.episode
                ? `${item.id}:${item.season}:${item.episode}`
                : item.id;
              const isRemoved = await storageService.isContinueWatchingRemoved(removeId, item.type);
              if (!isRemoved) filteredItems.push(item);
            }

            const getLocalMatches = (item: ContinueWatchingItem): LocalProgressEntry[] => {
              if (!localProgressIndex) return [];

              const typeKey = item.type;
              const matches: LocalProgressEntry[] = [];

              for (const idVariant of getIdVariants(item.id)) {
                const entries = localProgressIndex.get(`${typeKey}:${idVariant}`);
                if (!entries || entries.length === 0) continue;

                if (item.type === 'movie') {
                  matches.push(...entries);
                } else {
                  // series: only match same season/episode
                  if (item.season === undefined || item.episode === undefined) continue;
                  for (const e of entries) {
                    if (e.season === item.season && e.episode === item.episode) {
                      matches.push(e);
                    }
                  }
                }
              }

              return matches;
            };

            const toYearNumber = (value: any): number | undefined => {
              if (typeof value === 'number' && isFinite(value)) return value;
              if (typeof value === 'string') {
                const parsed = parseInt(value, 10);
                if (isFinite(parsed)) return parsed;
              }
              return undefined;
            };

            const buildTraktContentData = (item: ContinueWatchingItem): import('../../services/traktService').TraktContentData | null => {
              if (item.type === 'movie') {
                return {
                  type: 'movie',
                  imdbId: item.id,
                  title: item.name,
                  year: toYearNumber((item as any).year),
                };
              }

              if (item.type === 'series' && item.season && item.episode) {
                return {
                  type: 'episode',
                  imdbId: item.id,
                  title: item.episodeTitle || `S${item.season}E${item.episode}`,
                  season: item.season,
                  episode: item.episode,
                  showTitle: item.name,
                  showYear: toYearNumber((item as any).year),
                  showImdbId: item.id,
                };
              }

              return null;
            };

            const reconcilePromises: Promise<any>[] = [];
            const reconcileLocalPromises: Promise<any>[] = [];

            const adjustedItems = filteredItems.map((it) => {
              const matches = getLocalMatches(it);
              if (matches.length === 0) return it;

              const mostRecentLocal = matches.reduce<LocalProgressEntry | null>((acc, cur) => {
                if (!acc) return cur;
                return (cur.lastUpdated ?? 0) > (acc.lastUpdated ?? 0) ? cur : acc;
              }, null);

              const highestLocal = matches.reduce<LocalProgressEntry | null>((acc, cur) => {
                if (!acc) return cur;
                return (cur.progressPercent ?? 0) > (acc.progressPercent ?? 0) ? cur : acc;
              }, null);

              if (!mostRecentLocal || !highestLocal) return it;

              // IMPORTANT:
              // In Trakt-auth mode, the "most recently watched" ordering should reflect local playback,
              // not Trakt's paused_at (which can be stale or even appear newer than local).
              // So: if we have any local match, use its timestamp for ordering.
              const mergedLastUpdated = (mostRecentLocal.lastUpdated ?? 0) > 0
                ? (mostRecentLocal.lastUpdated ?? 0)
                : (it.lastUpdated ?? 0);

              try {
                logger.log('[CW][Trakt][Overlay] item/local summary', {
                  key: `${it.type}:${it.id}:${it.season ?? ''}:${it.episode ?? ''}`,
                  traktProgress: it.progress,
                  traktLastUpdated: it.lastUpdated,
                  localMostRecent: { progress: mostRecentLocal.progressPercent, lastUpdated: mostRecentLocal.lastUpdated },
                  localHighest: { progress: highestLocal.progressPercent, lastUpdated: highestLocal.lastUpdated },
                  mergedLastUpdated,
                });
              } catch {
                // ignore
              }

              // Background reconcile: if local progress is ahead of Trakt OR local is newer than Trakt,
              // scrobble local progress to Trakt.
              // This handles missed scrobbles (local ahead) and intentional seek-back/rewatch (local newer but lower).
              const localProgress = mostRecentLocal.progressPercent;
              const traktProgress = it.progress ?? 0;
              const traktTs = it.lastUpdated ?? 0;
              const localTs = mostRecentLocal.lastUpdated ?? 0;

              const isAhead = isFinite(localProgress) && localProgress > traktProgress + 0.5;
              const isLocalNewer = localTs > traktTs + 5000; // 5s guard against clock jitter
              const isLocalRecent = localTs > 0 && (Date.now() - localTs) < (5 * 60 * 1000); // 5 minutes
              const isDifferent = Math.abs((localProgress || 0) - (traktProgress || 0)) > 0.5;

              const isTraktAhead = isFinite(traktProgress) && traktProgress > localProgress + 0.5;
              // If the user just interacted locally (seek-back/rewatch), do NOT overwrite local with Trakt.
              if (isTraktAhead && !isLocalRecent && mostRecentLocal.duration > 0) {
                const reconcileKey = `local:${it.type}:${it.id}:${it.season ?? ''}:${it.episode ?? ''}`;
                const last = lastTraktReconcileRef.current.get(reconcileKey) ?? 0;
                const now = Date.now();

                if (now - last >= TRAKT_RECONCILE_COOLDOWN) {
                  lastTraktReconcileRef.current.set(reconcileKey, now);

                  // Sync Trakt -> local so resume/progress UI uses the higher value.
                  // Only possible when we have a local duration.
                  const targetEpisodeId =
                    it.type === 'series'
                      ? (mostRecentLocal.episodeId || (it.season && it.episode ? `${it.id}:${it.season}:${it.episode}` : undefined))
                      : undefined;

                  const newCurrentTime = (traktProgress / 100) * mostRecentLocal.duration;

                  reconcileLocalPromises.push(
                    (async () => {
                      try {
                        const existing = await storageService.getWatchProgress(it.id, it.type, targetEpisodeId);
                        if (!existing || !existing.duration || existing.duration <= 0) return;

                        await storageService.setWatchProgress(
                          it.id,
                          it.type,
                          {
                            ...existing,
                            currentTime: Math.max(existing.currentTime ?? 0, newCurrentTime),
                            duration: existing.duration,
                            traktSynced: true,
                            traktLastSynced: Date.now(),
                            traktProgress: Math.max(existing.traktProgress ?? 0, traktProgress),
                            // Do NOT update lastUpdated here; this is a background state sync and
                            // should not affect "recent" ordering.
                            lastUpdated: existing.lastUpdated,
                          } as any,
                          targetEpisodeId,
                          { preserveTimestamp: true, forceWrite: true }
                        );
                      } catch {
                        // ignore
                      }
                    })()
                  );
                }
              }

              if ((isAhead || ((isLocalNewer || isLocalRecent) && isDifferent)) && localProgress >= 2) {
                const reconcileKey = `${it.type}:${it.id}:${it.season ?? ''}:${it.episode ?? ''}`;
                const last = lastTraktReconcileRef.current.get(reconcileKey) ?? 0;
                const now = Date.now();
                if (now - last >= TRAKT_RECONCILE_COOLDOWN) {
                  lastTraktReconcileRef.current.set(reconcileKey, now);

                  const contentData = buildTraktContentData(it);
                  if (contentData) {
                    // Trakt treats >=80% on /scrobble/stop as "watched".
                    // Keep in-progress items under 80 unless the user truly completed it in-app (>=85%).
                    const progressToSend = localProgress >= 85 ? Math.min(localProgress, 100) : Math.min(localProgress, 79.9);

                    reconcilePromises.push(
                      traktService
                        .pauseWatching(contentData, progressToSend)
                        .catch(() => null)
                    );
                  }
                }
              }

              // If local is newer/recent, prefer local progress immediately (covers seek-back/rewatch).
              // Otherwise, only prefer local progress when it is ahead.
              if (((isLocalNewer || isLocalRecent) && isDifferent) || localProgress > (it.progress ?? 0) + 0.5) {
                return {
                  ...it,
                  progress: ((isLocalNewer || isLocalRecent) && isDifferent) ? localProgress : localProgress,
                  lastUpdated: mergedLastUpdated,
                };
              }

              return {
                ...it,
                lastUpdated: mergedLastUpdated,
              };
            }).filter((it) => {
              // Never show completed items in Continue Watching
              const p = it.progress ?? 0;
              if (it.type === 'movie' && p >= 85) return false;
              if (it.type === 'series' && p >= 85) return false;
              return true;
            });

            // Sort by lastUpdated descending and set directly
            adjustedItems.sort(compareCwItems);

            // Debug final order (only if changed)
            try {
              const sig = adjustedItems
                .slice(0, 12)
                .map((x) => `${x.type}:${x.id}:${x.season ?? ''}:${x.episode ?? ''}@${Math.round(x.lastUpdated ?? 0)}:${Math.round(x.progress ?? 0)}`)
                .join('|');
              if (sig !== lastOrderLogSigRef.current) {
                lastOrderLogSigRef.current = sig;
                logger.log('[CW][Trakt] final CW order (top 12):',
                  adjustedItems.slice(0, 12).map((x) => ({
                    key: `${x.type}:${x.id}:${x.season ?? ''}:${x.episode ?? ''}`,
                    progress: x.progress,
                    lastUpdated: x.lastUpdated,
                  }))
                );
              }
            } catch {
              // ignore
            }

            setContinueWatchingItems(adjustedItems);

            // Fire-and-forget reconcile (don't block UI)
            if (reconcilePromises.length > 0) {
              Promise.allSettled(reconcilePromises).catch(() => null);
            }

            // Fire-and-forget local sync (Trakt -> local)
            if (reconcileLocalPromises.length > 0) {
              Promise.allSettled(reconcileLocalPromises).catch(() => null);
            }
          }
        } catch (err) {
          logger.error('[TraktSync] Error in Trakt merge:', err);
        }
      })();

      // SIMKL: fetch playback progress (in-progress, paused) and merge similarly to Trakt
      const simklMergePromise = (async () => {
        try {
          if (!isSimklAuthed || isTraktAuthed) return;

          const now = Date.now();
          if (SIMKL_SYNC_COOLDOWN > 0 && (now - lastSimklSyncRef.current) < SIMKL_SYNC_COOLDOWN) {
            return;
          }
          lastSimklSyncRef.current = now;

          const playbackItems = await simklService.getPlaybackStatus();
          logger.log(`[CW][Simkl] playback items: ${playbackItems.length}`);

          const simklBatch: ContinueWatchingItem[] = [];
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

          const sortedPlaybackItems = [...playbackItems]
            .sort((a, b) => new Date(b.paused_at).getTime() - new Date(a.paused_at).getTime())
            .slice(0, 30);

          for (const item of sortedPlaybackItems) {
            try {
              // Skip accidental clicks
              if ((item.progress ?? 0) < 2) continue;

              const pausedAt = new Date(item.paused_at).getTime();
              if (pausedAt < thirtyDaysAgo) continue;

              if (item.type === 'movie' && item.movie?.ids?.imdb) {
                // Skip completed movies
                if (item.progress >= 85) continue;

                const imdbId = item.movie.ids.imdb.startsWith('tt')
                  ? item.movie.ids.imdb
                  : `tt${item.movie.ids.imdb}`;

                const movieKey = `movie:${imdbId}`;
                if (recentlyRemovedRef.current.has(movieKey)) continue;

                const cachedData = await getCachedMetadata('movie', imdbId);
                if (!cachedData?.basicContent) continue;

                simklBatch.push({
                  ...cachedData.basicContent,
                  id: imdbId,
                  type: 'movie',
                  progress: item.progress,
                  lastUpdated: pausedAt,
                  addonId: undefined,
                } as ContinueWatchingItem);
              } else if (item.type === 'episode' && item.show?.ids?.imdb && item.episode) {
                const showImdb = item.show.ids.imdb.startsWith('tt')
                  ? item.show.ids.imdb
                  : `tt${item.show.ids.imdb}`;

                const episodeNum = (item.episode as any).episode ?? (item.episode as any).number;
                if (episodeNum === undefined || episodeNum === null) {
                  logger.warn('[CW][Simkl] Missing episode number in playback item, skipping', item);
                  continue;
                }

                const showKey = `series:${showImdb}`;
                if (recentlyRemovedRef.current.has(showKey)) continue;

                const cachedData = await getCachedMetadata('series', showImdb);
                if (!cachedData?.basicContent) continue;

                // If episode is completed (>= 85%), find next episode
                if (item.progress >= 85) {
                  const metadata = cachedData.metadata;
                  if (metadata?.videos) {
                    const nextEpisode = findNextEpisode(
                      item.episode.season,
                      episodeNum,
                      metadata.videos,
                      undefined,
                      showImdb
                    );

                    if (nextEpisode) {
                      simklBatch.push({
                        ...cachedData.basicContent,
                        id: showImdb,
                        type: 'series',
                        progress: 0,
                        lastUpdated: pausedAt,
                        season: nextEpisode.season,
                        episode: nextEpisode.episode,
                        episodeTitle: nextEpisode.title || `Episode ${nextEpisode.episode}`,
                        addonId: undefined,
                      } as ContinueWatchingItem);
                    }
                  }
                  continue;
                }

                simklBatch.push({
                  ...cachedData.basicContent,
                  id: showImdb,
                  type: 'series',
                  progress: item.progress,
                  lastUpdated: pausedAt,
                  season: item.episode.season,
                  episode: episodeNum,
                  episodeTitle: item.episode.title || `Episode ${episodeNum}`,
                  addonId: undefined,
                } as ContinueWatchingItem);
              }
            } catch {
              // Continue with other items
            }
          }

          if (simklBatch.length === 0) {
            setContinueWatchingItems([]);
            return;
          }

          // Dedupe (keep most recent per show/movie)
          const deduped = new Map<string, ContinueWatchingItem>();
          for (const item of simklBatch) {
            const key = `${item.type}:${item.id}`;
            const existing = deduped.get(key);
            if (!existing || (item.lastUpdated ?? 0) > (existing.lastUpdated ?? 0)) {
              deduped.set(key, item);
            }
          }

          // Filter removed items
          const filteredItems: ContinueWatchingItem[] = [];
          for (const item of deduped.values()) {
            const key = item.type === 'series' && item.season && item.episode
              ? `${item.type}:${item.id}:${item.season}:${item.episode}`
              : `${item.type}:${item.id}`;
            if (recentlyRemovedRef.current.has(key)) continue;

            const removeId = item.type === 'series' && item.season && item.episode
              ? `${item.id}:${item.season}:${item.episode}`
              : item.id;
            const isRemoved = await storageService.isContinueWatchingRemoved(removeId, item.type);
            if (!isRemoved) filteredItems.push(item);
          }

          // Overlay local progress when local is ahead or newer
          const adjustedItems = filteredItems.map((it) => {
            if (!localProgressIndex) return it;

            const matches: LocalProgressEntry[] = [];
            for (const idVariant of getIdVariants(it.id)) {
              const list = localProgressIndex.get(`${it.type}:${idVariant}`);
              if (!list) continue;
              for (const entry of list) {
                if (it.type === 'series' && it.season !== undefined && it.episode !== undefined) {
                  if (entry.season === it.season && entry.episode === it.episode) {
                    matches.push(entry);
                  }
                } else {
                  matches.push(entry);
                }
              }
            }

            if (matches.length === 0) return it;

            const mostRecentLocal = matches.reduce<LocalProgressEntry | null>((acc, cur) => {
              if (!acc) return cur;
              return (cur.lastUpdated ?? 0) > (acc.lastUpdated ?? 0) ? cur : acc;
            }, null);

            const highestLocal = matches.reduce<LocalProgressEntry | null>((acc, cur) => {
              if (!acc) return cur;
              return (cur.progressPercent ?? 0) > (acc.progressPercent ?? 0) ? cur : acc;
            }, null);

            if (!mostRecentLocal || !highestLocal) return it;

            const localProgress = mostRecentLocal.progressPercent;
            const simklProgress = it.progress ?? 0;
            const localTs = mostRecentLocal.lastUpdated ?? 0;
            const simklTs = it.lastUpdated ?? 0;

            const isAhead = isFinite(localProgress) && localProgress > simklProgress + 0.5;
            const isLocalNewer = localTs > simklTs + 5000;

            if (isAhead || isLocalNewer) {
              return {
                ...it,
                progress: localProgress,
                lastUpdated: localTs > 0 ? localTs : it.lastUpdated,
              } as ContinueWatchingItem;
            }

            // Otherwise keep Simkl, but if local has a newer timestamp, use it for ordering
            if (localTs > 0 && localTs > simklTs) {
              return {
                ...it,
                lastUpdated: localTs,
              } as ContinueWatchingItem;
            }

            return it;
          });

          adjustedItems.sort(compareCwItems);
          setContinueWatchingItems(adjustedItems);
        } catch (err) {
          logger.error('[SimklSync] Error in Simkl merge:', err);
        }
      })();

      // Wait for all groups and provider merges to settle, then finalize loading state
      await Promise.allSettled([...groupPromises, traktMergePromise, simklMergePromise]);
    } catch (error) {
      // Continue even if loading fails
    } finally {
      setLoading(false);
      isRefreshingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        setTimeout(() => {
          loadContinueWatching(true);
        }, 0);
      }
    }
  }, [getCachedMetadata]);

  // Clear cache when component unmounts or when needed
  useEffect(() => {
    return () => {
      metadataCache.current = {};
    };
  }, []);

  // Function to handle app state changes
  const handleAppStateChange = useCallback((nextAppState: AppStateStatus) => {
    if (
      appState.current.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      // App has come to the foreground - force Trakt sync by resetting cooldown
      lastTraktSyncRef.current = 0; // Reset cooldown to allow immediate Trakt sync
      loadContinueWatching(true);
    }
    appState.current = nextAppState;
  }, [loadContinueWatching]);

  // Set up storage event listener and app state listener
  useEffect(() => {
    // Add app state change listener
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Add custom event listener for watch progress updates
    const watchProgressUpdateHandler = () => {
      // Debounce updates to avoid too frequent refreshes
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        // Only trigger background refresh for local progress updates, not Trakt sync
        // This prevents the feedback loop where Trakt sync triggers more progress updates
        loadContinueWatching(true);
      }, 2000); // Increased debounce to reduce frequency
    };

    // Try to set up a custom event listener or use a timer as fallback
    if (storageService.subscribeToWatchProgressUpdates) {
      const unsubscribe = storageService.subscribeToWatchProgressUpdates(watchProgressUpdateHandler);
      return () => {
        subscription.remove();
        unsubscribe();
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
        }
      };
    } else {
      // Reduced polling frequency from 30s to 5 minutes to reduce heating and battery drain
      const intervalId = setInterval(() => loadContinueWatching(true), 300000);
      return () => {
        subscription.remove();
        clearInterval(intervalId);
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }
        if (longPressTimeoutRef.current) {
          clearTimeout(longPressTimeoutRef.current);
        }
      };
    }
  }, [loadContinueWatching, handleAppStateChange]);

  // Initial load
  useEffect(() => {
    loadContinueWatching();
    const trailingRefreshId = setTimeout(() => {
      loadContinueWatching(true);
    }, 4000);

    return () => {
      clearTimeout(trailingRefreshId);
    };
  }, [loadContinueWatching]);

  // Refresh on screen focus (lightweight, no polling)
  useFocusEffect(
    useCallback(() => {
      loadContinueWatching(true);
      return () => { };
    }, [loadContinueWatching])
  );

  // Expose the refresh function via the ref
  React.useImperativeHandle(ref, () => ({
    refresh: async () => {
      // Manual refresh bypasses Trakt cooldown to get fresh data
      lastTraktSyncRef.current = 0; // Reset cooldown for manual refresh
      await loadContinueWatching(false);
      return true;
    }
  }));

  const handleContentPress = useCallback(async (item: ContinueWatchingItem) => {
    try {
      logger.log(`🎬 [ContinueWatching] User clicked on: ${item.name} (${item.type}:${item.id})`);

      // Check if cached streams are enabled in settings
      if (!settings.useCachedStreams) {
        logger.log(`📺 [ContinueWatching] Cached streams disabled, navigating to ${settings.openMetadataScreenWhenCacheDisabled ? 'MetadataScreen' : 'StreamsScreen'} for ${item.name}`);

        // Navigate based on the second setting
        if (settings.openMetadataScreenWhenCacheDisabled) {
          // Navigate to MetadataScreen
          if (item.type === 'series' && item.season && item.episode) {
            const episodeId = `${item.id}:${item.season}:${item.episode}`;
            navigation.navigate('Metadata', {
              id: item.id,
              type: item.type,
              episodeId: episodeId,
              addonId: item.addonId
            });
          } else {
            navigation.navigate('Metadata', {
              id: item.id,
              type: item.type,
              addonId: item.addonId
            });
          }
        } else {
          // Navigate to StreamsScreen
          if (item.type === 'series' && item.season && item.episode) {
            const episodeId = `${item.id}:${item.season}:${item.episode}`;
            navigation.navigate('Streams', {
              id: item.id,
              type: item.type,
              episodeId: episodeId
            });
          } else {
            navigation.navigate('Streams', {
              id: item.id,
              type: item.type
            });
          }
        }
        return;
      }

      // Check if we have a cached stream for this content
      const episodeId = item.type === 'series' && item.season && item.episode
        ? `${item.id}:${item.season}:${item.episode}`
        : undefined;

      logger.log(`🔍 [ContinueWatching] Looking for cached stream with episodeId: ${episodeId || 'none'}`);

      const cachedStream = await streamCacheService.getCachedStream(item.id, item.type, episodeId);

      if (cachedStream) {
        // We have a valid cached stream, navigate directly to player
        logger.log(`🚀 [ContinueWatching] Using cached stream for ${item.name}`);

        // Determine the player route based on platform
        const playerRoute = Platform.OS === 'ios' ? 'PlayerIOS' : 'PlayerAndroid';

        // Navigate directly to player with cached stream data
        navigation.navigate(playerRoute as any, {
          uri: cachedStream.stream.url,
          title: cachedStream.metadata?.name || item.name,
          episodeTitle: cachedStream.episodeTitle || (item.type === 'series' ? `Episode ${item.episode}` : undefined),
          season: cachedStream.season || item.season,
          episode: cachedStream.episode || item.episode,
          quality: (cachedStream.stream.title?.match(/(\d+)p/) || [])[1] || undefined,
          year: cachedStream.metadata?.year || item.year,
          streamProvider: cachedStream.stream.addonId || cachedStream.stream.addonName || cachedStream.stream.name,
          streamName: cachedStream.stream.name || cachedStream.stream.title || 'Unnamed Stream',
          headers: cachedStream.stream.headers || undefined,
          id: item.id,
          type: item.type,
          episodeId: episodeId,
          imdbId: cachedStream.imdbId || cachedStream.metadata?.imdbId || item.imdb_id,
          backdrop: cachedStream.metadata?.backdrop || item.banner,
          videoType: undefined, // Let player auto-detect
        } as any);

        return;
      }

      // No cached stream or cache failed, navigate to StreamsScreen
      logger.log(`📺 [ContinueWatching] No cached stream, navigating to StreamsScreen for ${item.name}`);

      if (item.type === 'series' && item.season && item.episode) {
        // For series, navigate to the specific episode
        navigation.navigate('Streams', {
          id: item.id,
          type: item.type,
          episodeId: episodeId,
          addonId: item.addonId
        });
      } else {
        // For movies or series without specific episode, navigate to main content
        navigation.navigate('Streams', {
          id: item.id,
          type: item.type,
          addonId: item.addonId
        });
      }
    } catch (error) {
      logger.warn('[ContinueWatching] Error handling content press:', error);
      // Fallback to StreamsScreen on any error
      if (item.type === 'series' && item.season && item.episode) {
        const episodeId = `${item.id}:${item.season}:${item.episode}`;
        navigation.navigate('Streams', {
          id: item.id,
          type: item.type,
          episodeId: episodeId
        });
      } else {
        navigation.navigate('Streams', {
          id: item.id,
          type: item.type
        });
      }
    }
  }, [navigation, settings.useCachedStreams, settings.openMetadataScreenWhenCacheDisabled]);

  // Handle long press to show action sheet
  const handleLongPress = useCallback((item: ContinueWatchingItem) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      // Ignore haptic errors
    }
    setSelectedItem(item);
    actionSheetRef.current?.present();
  }, []);

  // Handle view details action
  const handleViewDetails = useCallback(() => {
    if (!selectedItem) return;
    actionSheetRef.current?.dismiss();

    setTimeout(() => {
      if (selectedItem.type === 'series' && selectedItem.season && selectedItem.episode) {
        const episodeId = `${selectedItem.id}:${selectedItem.season}:${selectedItem.episode}`;
        navigation.navigate('Metadata', {
          id: selectedItem.id,
          type: selectedItem.type,
          episodeId: episodeId,
          addonId: selectedItem.addonId
        });
      } else {
        navigation.navigate('Metadata', {
          id: selectedItem.id,
          type: selectedItem.type,
          addonId: selectedItem.addonId
        });
      }
    }, 150);
  }, [selectedItem, navigation]);

  // Handle remove action
  const handleRemoveItem = useCallback(async () => {
    if (!selectedItem) return;
    actionSheetRef.current?.dismiss();

    setDeletingItemId(selectedItem.id);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // For series episodes, only remove the specific episode's local progress
      // Don't add a base tombstone which would block all episodes of the series
      const isEpisode = selectedItem.type === 'series' && selectedItem.season && selectedItem.episode;
      if (isEpisode) {
        // Only remove local progress for this specific episode (no base tombstone)
        await storageService.removeAllWatchProgressForContent(
          selectedItem.id,
          selectedItem.type,
          { addBaseTombstone: false }
        );
      } else {
        // For movies or whole series, add the base tombstone
        await storageService.removeAllWatchProgressForContent(
          selectedItem.id,
          selectedItem.type,
          { addBaseTombstone: true }
        );
      }

      const traktService = TraktService.getInstance();
      const isAuthed = await traktService.isAuthenticated();

      // Only remove playback progress from Trakt (not watch history)
      // This ensures "Up Next" items don't affect Trakt watch history
      if (isAuthed && selectedItem.traktPlaybackId) {
        await traktService.removePlaybackItem(selectedItem.traktPlaybackId);
      }
      // For series, make the key episode-specific so dismissing "Up Next" 
      // doesn't affect other episodes
      const itemKey = selectedItem.type === 'series' && selectedItem.season && selectedItem.episode
        ? `${selectedItem.type}:${selectedItem.id}:${selectedItem.season}:${selectedItem.episode}`
        : `${selectedItem.type}:${selectedItem.id}`;

      recentlyRemovedRef.current.add(itemKey);

      // Store with episode-specific ID for series
      const removeId = selectedItem.type === 'series' && selectedItem.season && selectedItem.episode
        ? `${selectedItem.id}:${selectedItem.season}:${selectedItem.episode}`
        : selectedItem.id;
      await storageService.addContinueWatchingRemoved(removeId, selectedItem.type);

      setTimeout(() => {
        recentlyRemovedRef.current.delete(itemKey);
      }, REMOVAL_IGNORE_DURATION);
      setContinueWatchingItems(prev => prev.filter(i => {
        // For series, also check episode match
        if (i.type === 'series' && selectedItem.type === 'series') {
          return !(i.id === selectedItem.id && i.season === selectedItem.season && i.episode === selectedItem.episode);
        }
        return i.id !== selectedItem.id;
      }));
    } catch (error) {
      // Continue even if removal fails
    } finally {
      setDeletingItemId(null);
      setSelectedItem(null);
    }
  }, [selectedItem]);

  // Render backdrop for bottom sheet
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
      />
    ),
    []
  );

  // Compute poster dimensions for poster-style cards
  const computedPosterWidth = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 180;
      case 'largeTablet':
        return 160;
      case 'tablet':
        return 140;
      default:
        return 120;
    }
  }, [deviceType]);

  const computedPosterHeight = useMemo(() => {
    return computedPosterWidth * 1.5; // 2:3 aspect ratio
  }, [computedPosterWidth]);

  // Memoized render function for poster-style continue watching items
  const renderPosterStyleItem = useCallback(({ item }: { item: ContinueWatchingItem }) => {
    return (
    <TouchableOpacity
      style={[
        styles.posterContentItem,
        {
          width: computedPosterWidth,
        }
      ]}
      activeOpacity={0.8}
      onPress={() => handleContentPress(item)}
      onLongPress={() => handleLongPress(item)}
      delayLongPress={800}
    >
      {/* Poster Image */}
      <View style={[
        styles.posterImageContainer,
        {
          height: computedPosterHeight,
          borderRadius: settings.posterBorderRadius ?? 12,
        }
      ]}>
        <FastImage
          source={{
            uri: item.poster || 'https://via.placeholder.com/300x450',
            priority: FastImage.priority.high,
            cache: FastImage.cacheControl.immutable
          }}
          style={[styles.posterImage, { borderRadius: settings.posterBorderRadius ?? 12 }]}
          resizeMode={FastImage.resizeMode.cover}
        />

        {/* Gradient overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={[styles.posterGradient, { borderRadius: settings.posterBorderRadius ?? 12 }]}
        />

        {/* Episode Info Overlay */}
        {item.type === 'series' && item.season && item.episode && (
          <View style={styles.posterEpisodeOverlay}>
            <Text style={[styles.posterEpisodeText, { fontSize: isTV ? 14 : isLargeTablet ? 13 : 12 }]}>
              S{item.season} E{item.episode}
            </Text>
          </View>
        )}

        {/* Up Next Badge */}
        {item.type === 'series' && item.progress === 0 && (
          <View style={[styles.posterUpNextBadge, { backgroundColor: currentTheme.colors.primary }]}>
            <Text style={[styles.posterUpNextText, { fontSize: isTV ? 12 : 10 }]}>{t('home.up_next_caps')}</Text>
          </View>
        )}

        {/* Progress Bar */}
        {item.progress > 0 && (
          <View style={styles.posterProgressContainer}>
            <View style={[styles.posterProgressTrack, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
              <View
                style={[
                  styles.posterProgressBar,
                  {
                    width: `${item.progress}%`,
                    backgroundColor: currentTheme.colors.primary
                  }
                ]}
              />
            </View>
          </View>
        )}

        {/* Delete Indicator Overlay */}
        {deletingItemId === item.id && (
          <View style={[styles.deletingOverlay, { borderRadius: settings.posterBorderRadius ?? 12 }]}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}
      </View>

      {/* Title below poster */}
      <View style={styles.posterTitleContainer}>
        <Text
          style={[
            styles.posterTitle,
            {
              color: currentTheme.colors.highEmphasis,
              fontSize: isTV ? 16 : isLargeTablet ? 15 : 14
            }
          ]}
          numberOfLines={2}
        >
          {item.name}
        </Text>
        {item.progress > 0 && (
          <Text style={[styles.posterProgressLabel, { color: currentTheme.colors.textMuted, fontSize: isTV ? 13 : 11 }]}>
            {Math.round(item.progress)}%
          </Text>
        )}
      </View>
    </TouchableOpacity>
    );
  }, [currentTheme.colors, handleContentPress, handleLongPress, deletingItemId, computedPosterWidth, computedPosterHeight, isTV, isLargeTablet, settings.posterBorderRadius]);

  // Memoized render function for wide-style continue watching items
  const renderWideStyleItem = useCallback(({ item }: { item: ContinueWatchingItem }) => {
    return (
    <TouchableOpacity
      style={[
        styles.wideContentItem,
        {
          backgroundColor: currentTheme.colors.elevation1,
          borderColor: currentTheme.colors.border,
          shadowColor: currentTheme.colors.black,
          width: computedItemWidth,
          height: computedItemHeight,
          borderRadius: settings.posterBorderRadius ?? 12,
        }
      ]}
      activeOpacity={0.8}
      onPress={() => handleContentPress(item)}
      onLongPress={() => handleLongPress(item)}
      delayLongPress={800}
    >
      {/* Poster Image */}
      <View style={[
        styles.posterContainer,
        {
          width: isTV ? 100 : isLargeTablet ? 90 : isTablet ? 85 : 80
        }
      ]}>
        <FastImage
          source={{
            uri: item.poster || 'https://via.placeholder.com/300x450',
            priority: FastImage.priority.high,
            cache: FastImage.cacheControl.immutable
          }}
          style={[styles.continueWatchingPoster, { borderTopLeftRadius: settings.posterBorderRadius ?? 12, borderBottomLeftRadius: settings.posterBorderRadius ?? 12 }]}
          resizeMode={FastImage.resizeMode.cover}
        />

        {/* Delete Indicator Overlay */}
        {deletingItemId === item.id && (
          <View style={styles.deletingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}
      </View>

      {/* Content Details */}
      <View style={[
        styles.contentDetails,
        {
          padding: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
        }
      ]}>
        {(() => {
          const isUpNext = item.type === 'series' && item.progress === 0;
          return (
            <View style={styles.titleRow}>
              <Text
                style={[
                  styles.contentTitle,
                  {
                    color: currentTheme.colors.highEmphasis,
                    fontSize: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 17 : 16
                  }
                ]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {isUpNext && (
                <View style={[
                  styles.progressBadge,
                  {
                    backgroundColor: currentTheme.colors.primary,
                    paddingHorizontal: isTV ? 12 : isLargeTablet ? 10 : isTablet ? 8 : 8,
                    paddingVertical: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 3
                  }
                ]}>
                  <Text style={[
                    styles.progressText,
                    { fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 12 }
                  ]}>{t('home.up_next')}</Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* Episode Info or Year */}
        {(() => {
          if (item.type === 'series' && item.season && item.episode) {
            return (
              <View style={styles.episodeRow}>
                <Text style={[
                  styles.episodeText,
                  {
                    color: currentTheme.colors.mediumEmphasis,
                    fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 13
                  }
                ]}>
                  {t('home.season', { season: item.season })}
                </Text>
                {item.episodeTitle && (
                  <Text
                    style={[
                      styles.episodeTitle,
                      {
                        color: currentTheme.colors.mediumEmphasis,
                        fontSize: isTV ? 15 : isLargeTablet ? 14 : isTablet ? 13 : 12
                      }
                    ]}
                    numberOfLines={1}
                  >
                    {item.episodeTitle}
                  </Text>
                )}
              </View>
            );
          } else {
            return (
              <Text style={[
                styles.yearText,
                {
                  color: currentTheme.colors.mediumEmphasis,
                  fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 13
                }
              ]}>
                {item.year} • {item.type === 'movie' ? t('home.movie') : t('home.series')}
              </Text>
            );
          }
        })()}

        {/* Progress Bar */}
        {item.progress > 0 && (
          <View style={styles.wideProgressContainer}>
            <View style={[
              styles.wideProgressTrack,
              {
                height: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 4
              }
            ]}>
              <View
                style={[
                  styles.wideProgressBar,
                  {
                    width: `${item.progress}%`,
                    backgroundColor: currentTheme.colors.primary
                  }
                ]}
              />
            </View>
            <Text style={[
              styles.progressLabel,
              {
                color: currentTheme.colors.textMuted,
                fontSize: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 11
              }
            ]}>
              {t('home.percent_watched', { percent: Math.round(item.progress) })}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
    );
  }, [currentTheme.colors, handleContentPress, handleLongPress, deletingItemId, computedItemWidth, computedItemHeight, isTV, isLargeTablet, isTablet, settings.posterBorderRadius, t]);

  // Choose the appropriate render function based on settings
  const renderContinueWatchingItem = useCallback(({ item }: { item: ContinueWatchingItem }) => {
    if (settings.continueWatchingCardStyle === 'poster') {
      return renderPosterStyleItem({ item });
    }
    return renderWideStyleItem({ item });
  }, [settings.continueWatchingCardStyle, renderPosterStyleItem, renderWideStyleItem]);

  // Memoized key extractor
  const keyExtractor = useCallback((item: ContinueWatchingItem) => `continue-${item.id}-${item.type}`, []);

  // Memoized item separator
  const ItemSeparator = useCallback(() => <View style={{ width: itemSpacing }} />, [itemSpacing]);

  // If no continue watching items, don't render anything
  if (continueWatchingItems.length === 0) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      style={styles.container}
    >
      <View style={[styles.header, { paddingHorizontal: horizontalPadding }]}>
        <View style={styles.titleContainer}>
          <Text style={[
            styles.title,
            {
              color: currentTheme.colors.text,
              fontSize: isTV ? 32 : isLargeTablet ? 28 : isTablet ? 26 : 24
            }
          ]}>{t('home.continue_watching')}</Text>
          <View style={[
            styles.titleUnderline,
            {
              backgroundColor: currentTheme.colors.primary,
              width: isTV ? 50 : isLargeTablet ? 45 : isTablet ? 40 : 40,
              height: isTV ? 4 : isLargeTablet ? 3.5 : isTablet ? 3 : 3
            }
          ]} />
        </View>
      </View>

      <FlatList
        data={[...continueWatchingItems].sort((a, b) => {
          const aProgress = a.progress ?? 0;
          const bProgress = b.progress ?? 0;
          const aIsUpNext = a.type === 'series' && aProgress <= 0;
          const bIsUpNext = b.type === 'series' && bProgress <= 0;
          if (aIsUpNext !== bIsUpNext) return aIsUpNext ? 1 : -1;
          return (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0);
        })}
        renderItem={renderContinueWatchingItem}
        keyExtractor={keyExtractor}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.wideList,
          {
            paddingLeft: horizontalPadding,
            paddingRight: horizontalPadding
          }
        ]}
        ItemSeparatorComponent={ItemSeparator}
        onEndReachedThreshold={0.7}
        onEndReached={() => { }}
        removeClippedSubviews={true}
      />

      {/* Action Sheet Bottom Sheet */}
      <BottomSheetModal
        ref={actionSheetRef}
        index={0}
        snapPoints={['35%']}
        enablePanDownToClose={true}
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: currentTheme.colors.darkGray || '#0A0C0C',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        }}
        handleIndicatorStyle={{
          backgroundColor: currentTheme.colors.mediumGray,
          width: 40,
        }}
        onDismiss={() => {
          setSelectedItem(null);
          onDismiss(actionSheetRef);
        }}
        onChange={onChange(actionSheetRef)}
      >
        <BottomSheetView style={[styles.actionSheetContent, { paddingBottom: insets.bottom + 16 }]}>
          {selectedItem && (
            <>
              {/* Header with poster and info */}
              <View style={styles.actionSheetHeader}>
                <FastImage
                  source={{
                    uri: selectedItem.poster || 'https://via.placeholder.com/100x150',
                    priority: FastImage.priority.high,
                  }}
                  style={styles.actionSheetPoster}
                  resizeMode={FastImage.resizeMode.cover}
                />
                <View style={styles.actionSheetInfo}>
                  <Text
                    style={[styles.actionSheetTitle, { color: currentTheme.colors.text }]}
                    numberOfLines={2}
                  >
                    {selectedItem.name}
                  </Text>
                  {selectedItem.type === 'series' && selectedItem.season && selectedItem.episode ? (
                    <Text style={[styles.actionSheetSubtitle, { color: currentTheme.colors.textMuted }]}>
                      {t('home.season', { season: selectedItem.season })} · {t('home.episode', { episode: selectedItem.episode })}
                      {selectedItem.episodeTitle && selectedItem.episodeTitle !== `Episode ${selectedItem.episode}` && `\n${selectedItem.episodeTitle}`}
                    </Text>
                  ) : (
                    <Text style={[styles.actionSheetSubtitle, { color: currentTheme.colors.textMuted }]}>
                      {selectedItem.year ? `${selectedItem.type === 'movie' ? t('home.movie') : t('home.series')} · ${selectedItem.year}` : selectedItem.type === 'movie' ? t('home.movie') : t('home.series')}
                    </Text>
                  )}
                  {selectedItem.progress > 0 && (
                    <View style={styles.actionSheetProgressContainer}>
                      <View style={[styles.actionSheetProgressTrack, { backgroundColor: currentTheme.colors.elevation1 }]}>
                        <View
                          style={[
                            styles.actionSheetProgressBar,
                            {
                              width: `${selectedItem.progress}%`,
                              backgroundColor: currentTheme.colors.primary
                            }
                          ]}
                        />
                      </View>
                      <Text style={[styles.actionSheetProgressText, { color: currentTheme.colors.textMuted }]}>
                        {t('home.percent_watched', { percent: Math.round(selectedItem.progress) })}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Action Buttons */}
              <View style={styles.actionSheetButtons}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: currentTheme.colors.primary }]}
                  onPress={handleViewDetails}
                  activeOpacity={0.8}
                >
                  <Ionicons name="information-circle-outline" size={22} color="#fff" />
                  <Text style={styles.actionButtonText}>{t('home.view_details')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonSecondary, { backgroundColor: currentTheme.colors.elevation1 }]}
                  onPress={handleRemoveItem}
                  activeOpacity={0.8}
                >
                  <Ionicons name="trash-outline" size={22} color={currentTheme.colors.error} />
                  <Text style={[styles.actionButtonText, { color: currentTheme.colors.error }]}>{t('home.remove')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </BottomSheetView>
      </BottomSheetModal>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 28,
    paddingTop: 0,
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleContainer: {
    position: 'relative',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  titleUnderline: {
    position: 'absolute',
    bottom: -2,
    left: 0,
    width: 40,
    height: 3,
    borderRadius: 2,
    opacity: 0.8,
  },
  wideList: {
    paddingBottom: 8,
    paddingTop: 4,
  },
  wideContentItem: {
    width: 280,
    height: 120,
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  posterContainer: {
    width: 80,
    height: '100%',
    position: 'relative',
  },
  continueWatchingPoster: {
    width: '100%',
    height: '100%',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  deletingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  contentDetails: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  contentTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  progressBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    minWidth: 44,
    alignItems: 'center',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  episodeRow: {
    marginBottom: 8,
  },
  episodeText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  episodeTitle: {
    fontSize: 12,
  },
  yearText: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  wideProgressContainer: {
    marginTop: 'auto',
  },
  wideProgressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginBottom: 4,
  },
  wideProgressBar: {
    height: '100%',
    borderRadius: 2,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  // Keep old styles for backward compatibility
  list: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 4,
  },
  contentItem: {
    width: POSTER_WIDTH,
    aspectRatio: 2 / 3,
    margin: 0,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
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
  episodeInfoContainer: {
    position: 'absolute',
    bottom: 3,
    left: 0,
    right: 0,
    padding: 4,
    paddingHorizontal: 8,
  },
  episodeInfo: {
    fontSize: 12,
    fontWeight: 'bold',
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
  // Poster-style card styles
  posterContentItem: {
    overflow: 'visible',
  },
  posterImageContainer: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  posterEpisodeOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  posterEpisodeText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  posterUpNextBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  posterUpNextText: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  posterProgressContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  posterProgressTrack: {
    height: 4,
  },
  posterProgressBar: {
    height: '100%',
  },
  posterTitleContainer: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  posterTitle: {
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  posterProgressLabel: {
    fontWeight: '500',
    marginLeft: 6,
  },
  // Action Sheet Styles
  actionSheetContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  actionSheetHeader: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  actionSheetPoster: {
    width: 70,
    height: 105,
    borderRadius: 10,
    marginRight: 16,
  },
  actionSheetInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  actionSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    lineHeight: 22,
  },
  actionSheetSubtitle: {
    fontSize: 14,
    opacity: 0.8,
    lineHeight: 20,
  },
  actionSheetProgressContainer: {
    marginTop: 10,
  },
  actionSheetProgressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  actionSheetProgressBar: {
    height: '100%',
    borderRadius: 2,
  },
  actionSheetProgressText: {
    fontSize: 12,
    marginTop: 4,
  },
  actionSheetButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  actionButtonSecondary: {
    borderWidth: 0,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

export default React.memo(ContinueWatchingSection, (prevProps, nextProps) => {
  // This component has no props that would cause re-renders
  return true;
});
