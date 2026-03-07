import React, { useState, useEffect, useCallback } from 'react';
import { useLibrary } from './useLibrary';
import { useTraktContext } from '../contexts/TraktContext';
import { robustCalendarCache } from '../services/robustCalendarCache';
import { stremioService } from '../services/stremioService';
import { tmdbService } from '../services/tmdbService';
import { logger } from '../utils/logger';
import { memoryManager } from '../utils/memoryManager';
import { parseISO, isBefore, isAfter, startOfToday, addWeeks, isThisWeek } from 'date-fns';
import { StreamingContent } from '../services/catalogService';

interface CalendarEpisode {
  id: string;
  seriesId: string;
  title: string;
  seriesName: string;
  poster: string;
  releaseDate: string;
  season: number;
  episode: number;
  overview: string;
  vote_average: number;
  still_path: string | null;
  season_poster_path: string | null;
  addonId?: string;
}

interface CalendarSection {
  title: string;
  data: CalendarEpisode[];
}

interface UseCalendarDataReturn {
  calendarData: CalendarSection[];
  loading: boolean;
  refresh: (force?: boolean) => void;
}

export const useCalendarData = (): UseCalendarDataReturn => {
  const [calendarData, setCalendarData] = useState<CalendarSection[]>([]);
  const [loading, setLoading] = useState(true);

  const { libraryItems, loading: libraryLoading } = useLibrary();
  const {
    isAuthenticated: traktAuthenticated,
    isLoading: traktLoading,
    watchedShows,
    watchlistShows,
    continueWatching,
    loadAllCollections,
  } = useTraktContext();

  const fetchCalendarData = useCallback(async (forceRefresh = false) => {
    setLoading(true);

    try {
      // Check memory pressure and cleanup if needed
      memoryManager.checkMemoryPressure();

      if (!forceRefresh) {
        const cachedData = await robustCalendarCache.getCachedCalendarData(
          libraryItems,
          {
            watchlist: watchlistShows,
            continueWatching: continueWatching,
            watched: watchedShows,
          }
        );

        if (cachedData) {
          // Apply watched filter even on cached data
          if (traktAuthenticated && watchedShows && watchedShows.length > 0) {
            const cachedWatchedSet = new Set<string>();
            for (const ws of watchedShows) {
              const imdb = ws.show?.ids?.imdb;
              if (!imdb) continue;
              const showId = imdb.startsWith('tt') ? imdb : `tt${imdb}`;
              const resetAt = ws.reset_at ? new Date(ws.reset_at).getTime() : 0;
              if (ws.seasons) {
                for (const season of ws.seasons) {
                  for (const episode of season.episodes) {
                    if (resetAt > 0 && new Date(episode.last_watched_at).getTime() < resetAt) continue;
                    cachedWatchedSet.add(`${showId}:${season.number}:${episode.number}`);
                  }
                }
              }
            }
            const filtered = cachedData.map(section => {
              if (section.title !== 'This Week') return section;
              return {
                ...section,
                data: section.data.filter((ep: any) => {
                  const showId = ep.seriesId?.startsWith('tt') ? ep.seriesId : `tt${ep.seriesId}`;
                  return !cachedWatchedSet.has(`${showId}:${ep.season}:${ep.episode}`) &&
                         !cachedWatchedSet.has(`${ep.seriesId}:${ep.season}:${ep.episode}`);
                })
              };
            });
            setCalendarData(filtered);
          } else {
            setCalendarData(cachedData);
          }
          setLoading(false);
          return;
        }
      }

      const librarySeries = libraryItems.filter(item => item.type === 'series');

      // Prioritize series sources: Continue Watching > Watchlist > Library > Watched
      // This ensures that shows the user is actively watching or interested in are checked first
      // before hitting the series limit.
      let allSeries: StreamingContent[] = [];
      const addedIds = new Set<string>();

      // Helper to add series if not already added
      const addSeries = (id: string, name: string, year: number, poster: string, source: 'watchlist' | 'continue-watching' | 'watched' | 'library') => {
        if (!addedIds.has(id)) {
          addedIds.add(id);
          allSeries.push({
            id,
            name,
            type: 'series',
            poster,
            year,
            traktSource: source as any // Cast to any to avoid strict type issues with 'library' which might not be in the interface
          });
        }
      };

      if (traktAuthenticated) {
        // 1. Continue Watching (Highest Priority)
        if (continueWatching) {
          for (const item of continueWatching) {
            if (item.type === 'episode' && item.show && item.show.ids.imdb) {
              addSeries(
                item.show.ids.imdb,
                item.show.title,
                item.show.year,
                '', // Poster will be fetched if missing
                'continue-watching'
              );
            }
          }
        }

        // 2. Watchlist
        if (watchlistShows) {
          for (const item of watchlistShows) {
            if (item.show && item.show.ids.imdb) {
              addSeries(
                item.show.ids.imdb,
                item.show.title,
                item.show.year,
                '',
                'watchlist'
              );
            }
          }
        }
      }
      // 3. Library
      for (const item of librarySeries) {
        addSeries(
          item.id,
          item.name,
          item.year || 0,
          item.poster,
          'library'
        );
      }

      // 4. Watched (Lowest Priority)
      if (traktAuthenticated && watchedShows) {
        const recentWatched = watchedShows.slice(0, 20);
        for (const item of recentWatched) {
          if (item.show && item.show.ids.imdb) {
            addSeries(
              item.show.ids.imdb,
              item.show.title,
              item.show.year,
              '',
              'watched'
            );
          }
        }
      }

      // Limit the number of series to prevent memory overflow
      const maxSeries = 300; // Increased from 100 to 300 to accommodate larger libraries
      if (allSeries.length > maxSeries) {
        logger.warn(`[CalendarData] Too many series (${allSeries.length}), limiting to ${maxSeries} to prevent memory issues`);
        allSeries = allSeries.slice(0, maxSeries);
      }

      logger.log(`[CalendarData] Total series to check: ${allSeries.length}`);

      let allEpisodes: CalendarEpisode[] = [];
      let seriesWithoutEpisodes: CalendarEpisode[] = [];

      // Process series in memory-efficient batches to prevent OOM
      const processedSeries = await memoryManager.processArrayInBatches(
        allSeries,
        async (series: StreamingContent, index: number) => {
          try {
            // Use the new memory-efficient method to fetch upcoming and recent episodes
            const episodeData = await stremioService.getUpcomingEpisodes(series.type, series.id, {
              daysBack: 90,  // 3 months back for recently released episodes
              daysAhead: 60, // 2 months ahead for upcoming episodes
              maxEpisodes: 50, // Increased limit to get more episodes per series
            });

            if (episodeData && episodeData.episodes.length > 0) {
              const tmdbId = await tmdbService.findTMDBIdByIMDB(series.id);
              let tmdbEpisodes: { [key: string]: any } = {};

              // Only fetch TMDB data if we need it and limit it
              if (tmdbId && episodeData.episodes.length > 0) {
                try {
                  // Get only current and next season to limit memory usage
                  const seasons = [...new Set(episodeData.episodes.map(ep => ep.season || 1))];
                  const limitedSeasons = seasons.slice(0, 3); // Limit to 3 seasons max

                  for (const seasonNum of limitedSeasons) {
                    const seasonEpisodes = await tmdbService.getSeasonDetails(tmdbId, seasonNum);
                    if (seasonEpisodes?.episodes) {
                      seasonEpisodes.episodes.forEach((episode: any) => {
                        const key = `${episode.season_number}:${episode.episode_number}`;
                        tmdbEpisodes[key] = episode;
                      });
                    }
                  }
                } catch (tmdbError) {
                  logger.warn(`[CalendarData] TMDB fetch failed for ${series.name}, continuing without additional metadata`);
                }
              }

              // Transform episodes with memory-efficient processing
              const transformedEpisodes = episodeData.episodes.map(video => {
                const tmdbEpisode = tmdbEpisodes[`${video.season}:${video.episode}`] || {};
                const episode = {
                  id: video.id,
                  seriesId: series.id,
                  title: tmdbEpisode.name || video.title || `Episode ${video.episode}`,
                  seriesName: series.name || episodeData.seriesName,
                  poster: series.poster || episodeData.poster || '',
                  releaseDate: video.released,
                  season: video.season || 0,
                  episode: video.episode || 0,
                  overview: tmdbEpisode.overview || '',
                  vote_average: tmdbEpisode.vote_average || 0,
                  still_path: tmdbEpisode.still_path || null,
                  season_poster_path: tmdbEpisode.season_poster_path || null,
                  addonId: (episodeData as any).addonId || series.addonId,
                };


                return episode;
              });

              // Clear references to help garbage collection
              memoryManager.clearObjects(tmdbEpisodes);

              return { type: 'episodes', data: transformedEpisodes };
            } else {
              return {
                type: 'no-episodes',
                data: {
                  id: series.id,
                  seriesId: series.id,
                  title: 'No upcoming episodes',
                  seriesName: series.name || episodeData?.seriesName || '',
                  poster: series.poster || episodeData?.poster || '',
                  releaseDate: '',
                  season: 0,
                  episode: 0,
                  overview: '',
                  vote_average: 0,
                  still_path: null,
                  season_poster_path: null,
                  addonId: (episodeData as any)?.addonId || series.addonId,
                }
              };
            }
          } catch (error) {
            logger.error(`[CalendarData] Error fetching episodes for ${series.name}:`, error);
            return {
              type: 'no-episodes',
              data: {
                id: series.id,
                seriesId: series.id,
                title: 'No upcoming episodes',
                seriesName: series.name || '',
                poster: series.poster || '',
                releaseDate: '',
                season: 0,
                episode: 0,
                overview: '',
                vote_average: 0,
                still_path: null,
                season_poster_path: null,
                addonId: series.addonId,
              }
            };
          }
        },
        5, // Small batch size to prevent memory spikes
        100 // Small delay between batches
      );

      // Process results and separate episodes from no-episode series
      for (const result of processedSeries) {
        if (!result) {
          logger.error(`[CalendarData] Null/undefined result in processedSeries`);
          continue;
        }

        if (result.type === 'episodes' && Array.isArray(result.data)) {
          allEpisodes.push(...result.data);
        } else if (result.type === 'no-episodes' && result.data) {
          seriesWithoutEpisodes.push(result.data as CalendarEpisode);
        } else {
          logger.warn(`[CalendarData] Unexpected result type or missing data:`, result);
        }
      }

      // Clear processed series to free memory
      memoryManager.clearObjects(processedSeries);

      // Limit total episodes to prevent memory overflow
      allEpisodes = memoryManager.limitArraySize(allEpisodes, 500);
      seriesWithoutEpisodes = memoryManager.limitArraySize(seriesWithoutEpisodes, 100);

      // Sort episodes by release date with error handling
      allEpisodes.sort((a, b) => {
        try {
          const dateA = new Date(a.releaseDate).getTime();
          const dateB = new Date(b.releaseDate).getTime();
          return dateA - dateB;
        } catch (error) {
          logger.warn(`[CalendarData] Error sorting episodes: ${a.releaseDate} vs ${b.releaseDate}`, error);
          return 0; // Keep original order if sorting fails
        }
      });

      logger.log(`[CalendarData] Total episodes fetched: ${allEpisodes.length}`);

      // Build a set of watched episodes from Trakt so we can filter them out of This Week
      const watchedEpisodeSet = new Set<string>();
      if (traktAuthenticated && watchedShows) {
        for (const ws of watchedShows) {
          const imdb = ws.show?.ids?.imdb;
          if (!imdb) continue;
          const showId = imdb.startsWith('tt') ? imdb : `tt${imdb}`;
          const resetAt = ws.reset_at ? new Date(ws.reset_at).getTime() : 0;
          if (ws.seasons) {
            for (const season of ws.seasons) {
              for (const episode of season.episodes) {
                // Respect reset_at
                if (resetAt > 0) {
                  const watchedAt = new Date(episode.last_watched_at).getTime();
                  if (watchedAt < resetAt) continue;
                }
                watchedEpisodeSet.add(`${showId}:${season.number}:${episode.number}`);
              }
            }
          }
        }
      }

      // Use memory-efficient filtering with error handling
      const thisWeekEpisodes = await memoryManager.filterLargeArray(
        allEpisodes,
        ep => {
          try {
            if (!ep.releaseDate) return false;
            const parsed = parseISO(ep.releaseDate);
            if (!isThisWeek(parsed)) return false;
            // Filter out already-watched episodes when Trakt is authenticated
            if (traktAuthenticated && watchedEpisodeSet.size > 0) {
              const showId = ep.seriesId?.startsWith('tt') ? ep.seriesId : `tt${ep.seriesId}`;
              if (
                watchedEpisodeSet.has(`${showId}:${ep.season}:${ep.episode}`) ||
                watchedEpisodeSet.has(`${ep.seriesId}:${ep.season}:${ep.episode}`)
              ) {
                return false;
              }
            }
            return true;
          } catch (error) {
            logger.warn(`[CalendarData] Error parsing date for this week filtering: ${ep.releaseDate}`, error);
            return false;
          }
        }
      );

      const upcomingEpisodes = await memoryManager.filterLargeArray(
        allEpisodes,
        ep => {
          try {
            if (!ep.releaseDate) return false;
            const parsed = parseISO(ep.releaseDate);
            // Show upcoming episodes that are NOT this week
            return isAfter(parsed, new Date()) && !isThisWeek(parsed);
          } catch (error) {
            logger.warn(`[CalendarData] Error parsing date for upcoming filtering: ${ep.releaseDate}`, error);
            return false;
          }
        }
      );

      const recentEpisodes = await memoryManager.filterLargeArray(
        allEpisodes,
        ep => {
          try {
            if (!ep.releaseDate) return false;
            const parsed = parseISO(ep.releaseDate);
            // Show past episodes that are NOT this week
            return isBefore(parsed, new Date()) && !isThisWeek(parsed);
          } catch (error) {
            logger.warn(`[CalendarData] Error parsing date for recent filtering: ${ep.releaseDate}`, error);
            return false;
          }
        }
      );

      logger.log(`[CalendarData] Episode categorization: This Week: ${thisWeekEpisodes.length}, Upcoming: ${upcomingEpisodes.length}, Recently Released: ${recentEpisodes.length}, Series without episodes: ${seriesWithoutEpisodes.length}`);

      // Debug: Show some example episodes from each category
      if (thisWeekEpisodes && thisWeekEpisodes.length > 0) {
        logger.log(`[CalendarData] This Week examples:`, thisWeekEpisodes.slice(0, 3).map(ep => ({
          title: ep.title,
          date: ep.releaseDate,
          series: ep.seriesName
        })));
      }
      if (recentEpisodes && recentEpisodes.length > 0) {
        logger.log(`[CalendarData] Recently Released examples:`, recentEpisodes.slice(0, 3).map(ep => ({
          title: ep.title,
          date: ep.releaseDate,
          series: ep.seriesName
        })));
      }

      const sections: CalendarSection[] = [];
      if (thisWeekEpisodes.length > 0) {
        sections.push({ title: 'This Week', data: thisWeekEpisodes });
        logger.log(`[CalendarData] Added 'This Week' section with ${thisWeekEpisodes.length} episodes`);
      }
      if (upcomingEpisodes.length > 0) {
        sections.push({ title: 'Upcoming', data: upcomingEpisodes });
        logger.log(`[CalendarData] Added 'Upcoming' section with ${upcomingEpisodes.length} episodes`);
      }
      if (recentEpisodes.length > 0) {
        sections.push({ title: 'Recently Released', data: recentEpisodes });
        logger.log(`[CalendarData] Added 'Recently Released' section with ${recentEpisodes.length} episodes`);
      }
      if (seriesWithoutEpisodes.length > 0) {
        sections.push({ title: 'Series with No Scheduled Episodes', data: seriesWithoutEpisodes });
        logger.log(`[CalendarData] Added 'Series with No Scheduled Episodes' section with ${seriesWithoutEpisodes.length} episodes`);
      }

      // Log section details before setting
      logger.log(`[CalendarData] About to set calendarData with ${sections.length} sections:`);
      sections.forEach((section, index) => {
        logger.log(`  Section ${index}: "${section.title}" with ${section.data?.length || 0} episodes`);
      });

      setCalendarData(sections);

      // Clear large arrays to help garbage collection
      // Note: Don't clear the arrays that are referenced in sections (thisWeekEpisodes, upcomingEpisodes, recentEpisodes, seriesWithoutEpisodes)
      // as they would empty the section data
      memoryManager.clearObjects(allEpisodes);

      await robustCalendarCache.setCachedCalendarData(
        sections,
        libraryItems,
        { watchlist: watchlistShows, continueWatching: continueWatching, watched: watchedShows }
      );

    } catch (error) {
      logger.error('[CalendarData] Error fetching calendar data:', error);
      await robustCalendarCache.setCachedCalendarData(
        [],
        libraryItems,
        { watchlist: watchlistShows, continueWatching: continueWatching, watched: watchedShows },
        true
      );
    } finally {
      // Force garbage collection after processing
      memoryManager.forceGarbageCollection();
      setLoading(false);
    }
  }, [libraryItems, traktAuthenticated, watchlistShows, continueWatching, watchedShows]);

  useEffect(() => {
    if (!libraryLoading && !traktLoading) {
      if (traktAuthenticated && (!watchlistShows || !continueWatching || !watchedShows)) {
        loadAllCollections();
      } else {
        fetchCalendarData();
      }
    } else if (!libraryLoading && !traktAuthenticated) {
      fetchCalendarData();
    }
  }, [libraryItems, libraryLoading, traktLoading, traktAuthenticated, watchlistShows, continueWatching, watchedShows, fetchCalendarData, loadAllCollections]);

  const refresh = useCallback((force = false) => {
    fetchCalendarData(force);
  }, [fetchCalendarData]);

  return {
    calendarData,
    loading,
    refresh,
  };
};

