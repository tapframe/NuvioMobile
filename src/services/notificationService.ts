import i18n from '../i18n';
import * as Notifications from 'expo-notifications';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { mmkvStorage } from './mmkvStorage';
import { parseISO, differenceInHours, isToday, addDays, isAfter, startOfToday } from 'date-fns';
import { stremioService } from './stremioService';
import { catalogService } from './catalogService';
import { traktService } from './traktService';
import { tmdbService } from './tmdbService';
import { logger } from '../utils/logger';
import { memoryManager } from '../utils/memoryManager';

// Define notification storage keys
const NOTIFICATION_STORAGE_KEY = 'stremio-notifications';
const NOTIFICATION_SETTINGS_KEY = 'stremio-notification-settings';

// Import the correct type from Notifications
const { SchedulableTriggerInputTypes } = Notifications;

// Notification settings interface
export interface NotificationSettings {
  enabled: boolean;
  newEpisodeNotifications: boolean;
  reminderNotifications: boolean;
  upcomingShowsNotifications: boolean;
  timeBeforeAiring: number; // in hours
}

// Default notification settings
const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  newEpisodeNotifications: true,
  reminderNotifications: true,
  upcomingShowsNotifications: true,
  timeBeforeAiring: 24, // 24 hours before airing
};

// Episode notification item
export interface NotificationItem {
  id: string;
  seriesId: string;
  seriesName: string;
  episodeTitle: string;
  season: number;
  episode: number;
  releaseDate: string;
  notified: boolean;
  poster?: string;
}

class NotificationService {
  private static instance: NotificationService;
  private settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS;
  private scheduledNotifications: NotificationItem[] = [];
  private backgroundSyncInterval: NodeJS.Timeout | null = null;
  private librarySubscription: (() => void) | null = null;
  private appStateSubscription: any = null;
  private lastSyncTime: number = 0;
  private readonly MIN_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes minimum between syncs
  // Download notification tracking - stores progress value (50) when notified
  private lastDownloadNotificationTime: Map<string, number> = new Map();

  private constructor() {
    // Initialize notifications
    this.configureNotifications();
    this.loadSettings();
    this.loadScheduledNotifications();
    this.setupLibraryIntegration();
    this.setupBackgroundSync();
    this.setupAppStateHandling();
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  private async configureNotifications() {
    // Configure notification behavior
    await Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // Request permissions if needed
    const { status: existingStatus } = await Notifications.getPermissionsAsync();

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        // Handle permission denied
        this.settings.enabled = false;
        await this.saveSettings();
      }
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const storedSettings = await mmkvStorage.getItem(NOTIFICATION_SETTINGS_KEY);

      if (storedSettings) {
        this.settings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(storedSettings) };
      }
    } catch (error) {
      logger.error('Error loading notification settings:', error);
    }
  }

  private async saveSettings(): Promise<void> {
    try {
      await mmkvStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (error) {
      logger.error('Error saving notification settings:', error);
    }
  }

  private async loadScheduledNotifications(): Promise<void> {
    try {
      const storedNotifications = await mmkvStorage.getItem(NOTIFICATION_STORAGE_KEY);

      if (storedNotifications) {
        this.scheduledNotifications = JSON.parse(storedNotifications);
      }
    } catch (error) {
      logger.error('Error loading scheduled notifications:', error);
    }
  }

  private async saveScheduledNotifications(): Promise<void> {
    try {
      await mmkvStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(this.scheduledNotifications));
    } catch (error) {
      logger.error('Error saving scheduled notifications:', error);
    }
  }

  async updateSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    this.settings = { ...this.settings, ...settings };
    await this.saveSettings();
    return this.settings;
  }

  async getSettings(): Promise<NotificationSettings> {
    return this.settings;
  }

  async scheduleEpisodeNotification(item: NotificationItem): Promise<string | null> {
    if (!this.settings.enabled || !this.settings.newEpisodeNotifications) {
      return null;
    }

    // Check if notification already exists for this episode
    const existingNotification = this.scheduledNotifications.find(
      notification => notification.seriesId === item.seriesId &&
        notification.season === item.season &&
        notification.episode === item.episode
    );
    if (existingNotification) {
      return null; // Don't schedule duplicate notifications
    }

    const releaseDate = parseISO(item.releaseDate);
    const now = new Date();

    // If release date has already passed, don't schedule
    if (releaseDate < now) {
      return null;
    }

    try {
      // Calculate notification time (default to 24h before air time)
      const notificationTime = new Date(releaseDate);
      notificationTime.setHours(notificationTime.getHours() - this.settings.timeBeforeAiring);

      // If notification time has already passed, don't schedule the notification
      if (notificationTime < now) {
        return null;
      }

      // Schedule the notification
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `New Episode: ${item.seriesName}`,
          body: `S${item.season}:E${item.episode} - ${item.episodeTitle} is airing soon!`,
          data: {
            seriesId: item.seriesId,
            episodeId: item.id,
          },
        },
        trigger: {
          date: notificationTime,
          type: SchedulableTriggerInputTypes.DATE,
        },
      });

      // Add to scheduled notifications
      this.scheduledNotifications.push({
        ...item,
        notified: false,
      });

      // Save to storage
      await this.saveScheduledNotifications();

      return notificationId;
    } catch (error) {
      logger.error('Error scheduling notification:', error);
      return null;
    }
  }

  async scheduleMultipleEpisodeNotifications(items: NotificationItem[]): Promise<number> {
    if (!this.settings.enabled) {
      return 0;
    }

    let scheduledCount = 0;

    for (const item of items) {
      const notificationId = await this.scheduleEpisodeNotification(item);
      if (notificationId) {
        scheduledCount++;
      }
    }

    return scheduledCount;
  }

  async cancelNotification(id: string): Promise<void> {
    try {
      // Cancel with Expo
      await Notifications.cancelScheduledNotificationAsync(id);

      // Remove from our tracked notifications
      this.scheduledNotifications = this.scheduledNotifications.filter(
        notification => notification.id !== id
      );

      // Save updated list
      await this.saveScheduledNotifications();
    } catch (error) {
      logger.error('Error canceling notification:', error);
    }
  }

  async cancelAllNotifications(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      this.scheduledNotifications = [];
      await this.saveScheduledNotifications();
    } catch (error) {
      logger.error('Error canceling all notifications:', error);
    }
  }

  getScheduledNotifications(): NotificationItem[] {
    return [...this.scheduledNotifications];
  }

  // Setup library integration - automatically sync notifications when library changes
  private setupLibraryIntegration(): void {
    try {
      // Subscribe to library updates from catalog service
      this.librarySubscription = catalogService.subscribeToLibraryUpdates(async (libraryItems) => {
        if (!this.settings.enabled) return;

        const now = Date.now();
        const timeSinceLastSync = now - this.lastSyncTime;

        // Only sync if enough time has passed since last sync
        if (timeSinceLastSync >= this.MIN_SYNC_INTERVAL) {
          // Reduced logging verbosity
          // logger.log('[NotificationService] Library updated, syncing notifications for', libraryItems.length, 'items');
          await this.syncNotificationsForLibrary(libraryItems);
        } else {
          // logger.log(`[NotificationService] Library updated, but skipping sync (last sync ${Math.round(timeSinceLastSync / 1000)}s ago)`);
        }
      });
    } catch (error) {
      logger.error('[NotificationService] Error setting up library integration:', error);
    }
  }

  // Setup background sync for notifications
  private setupBackgroundSync(): void {
    // Sync notifications every 12 hours to reduce background CPU usage
    this.backgroundSyncInterval = setInterval(async () => {
      if (this.settings.enabled) {
        // Reduced logging verbosity
        // logger.log('[NotificationService] Running background notification sync');
        await this.performBackgroundSync();
      }
    }, 12 * 60 * 60 * 1000); // 12 hours
  }

  // Setup app state handling for foreground sync
  private setupAppStateHandling(): void {
    const subscription = AppState.addEventListener('change', this.handleAppStateChange);
    // Store subscription for cleanup
    this.appStateSubscription = subscription;
  }

  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active' && this.settings.enabled) {
      const now = Date.now();
      const timeSinceLastSync = now - this.lastSyncTime;

      // Only sync if enough time has passed since last sync
      if (timeSinceLastSync >= this.MIN_SYNC_INTERVAL) {
        // App came to foreground, sync notifications
        // Reduced logging verbosity
        // logger.log('[NotificationService] App became active, syncing notifications');
        await this.performBackgroundSync();
      } else {
        // logger.log(`[NotificationService] App became active, but skipping sync (last sync ${Math.round(timeSinceLastSync / 1000)}s ago)`);
      }
    }
  };

  // Immediate notifications for download progress (background only)
  public async notifyDownloadProgress(title: string, progress: number, downloadedBytes?: number, totalBytes?: number): Promise<void> {
    try {
      if (!this.settings.enabled) return;
      if (AppState.currentState === 'active') return;

      // Only notify at 50% progress
      if (progress < 50) {
        return; // Skip notifications before 50%
      }

      // Check if we've already notified at 50% for this download
      const lastNotifiedProgress = this.lastDownloadNotificationTime.get(title) || 0;
      if (lastNotifiedProgress >= 50) {
        return; // Already notified at 50%, don't notify again
      }

      // Mark that we've notified at 50%
      this.lastDownloadNotificationTime.set(title, 50);

      const downloadedMb = Math.floor((downloadedBytes || 0) / (1024 * 1024));
      const totalMb = totalBytes ? Math.floor(totalBytes / (1024 * 1024)) : undefined;
      const body = `${progress}%` + (totalMb !== undefined ? ` • ${downloadedMb}MB / ${totalMb}MB` : '');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Downloading ${title}`,
          body,
          data: { kind: 'download-progress' },
        },
        trigger: null,
      });
    } catch (error) {
      logger.error('[NotificationService] notifyDownloadProgress error:', error);
    }
  }

  // Immediate notification for download completion (background only)
  public async notifyDownloadComplete(title: string): Promise<void> {
    try {
      if (!this.settings.enabled) return;
      if (AppState.currentState === 'active') return;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: i18n.t('success.download_complete'),
          body: title,
          data: { kind: 'download-complete' },
        },
        trigger: null,
      });

      // Clean up tracking entry after completion to prevent memory leaks
      this.lastDownloadNotificationTime.delete(title);
    } catch (error) {
      logger.error('[NotificationService] notifyDownloadComplete error:', error);
    }
  }

  // Sync notifications for all library items using memory-efficient batching
  private async syncNotificationsForLibrary(libraryItems: any[]): Promise<void> {
    try {
      const seriesItems = libraryItems.filter(item => item.type === 'series');

      // Limit series to prevent memory overflow during notifications sync
      const limitedSeries = memoryManager.limitArraySize(seriesItems, 50);

      if (limitedSeries.length < seriesItems.length) {
        logger.warn(`[NotificationService] Limited series sync from ${seriesItems.length} to ${limitedSeries.length} to prevent memory issues`);
      }

      // Process in small batches with memory management
      await memoryManager.processArrayInBatches(
        limitedSeries,
        async (series) => {
          try {
            await this.updateNotificationsForSeries(series.id);
          } catch (error) {
            logger.error(`[NotificationService] Failed to sync notifications for ${series.name || series.id}:`, error);
          }
        },
        3, // Very small batch size to prevent memory spikes
        800 // Longer delay to prevent API overwhelming and reduce heating
      );

      // Force cleanup after processing
      memoryManager.forceGarbageCollection();

      // Reduced logging verbosity
      // logger.log(`[NotificationService] Synced notifications for ${limitedSeries.length} series from library`);
    } catch (error) {
      logger.error('[NotificationService] Error syncing library notifications:', error);
    }
  }

  // Perform comprehensive background sync including Trakt integration
  private async performBackgroundSync(): Promise<void> {
    try {
      // Update last sync time at the start
      this.lastSyncTime = Date.now();

      // Reduced logging verbosity
      // logger.log('[NotificationService] Starting comprehensive background sync');

      // Get library items
      const libraryItems = await catalogService.getLibraryItems();
      await this.syncNotificationsForLibrary(libraryItems);

      // Sync Trakt items if authenticated
      await this.syncTraktNotifications();

      // Clean up old notifications
      await this.cleanupOldNotifications();

      // Reduced logging verbosity
      // logger.log('[NotificationService] Background sync completed');
    } catch (error) {
      logger.error('[NotificationService] Error in background sync:', error);
    }
  }

  // Sync notifications for comprehensive Trakt data (same as calendar screen)
  private async syncTraktNotifications(): Promise<void> {
    try {
      const isAuthenticated = await traktService.isAuthenticated();
      if (!traktService.isAuthenticated()) {
        // Reduced logging verbosity
        // logger.log('[NotificationService] Trakt not authenticated, skipping Trakt sync');
        return;
      }

      // Reduced logging verbosity
      // logger.log('[NotificationService] Syncing comprehensive Trakt notifications');

      // Get all Trakt data sources (same as calendar screen uses)
      const [watchlistShows, continueWatching, watchedShows, collectionShows] = await Promise.all([
        traktService.getWatchlistShows(),
        traktService.getPlaybackProgress('shows'), // This is the continue watching data
        traktService.getWatchedShows(),
        traktService.getCollectionShows()
      ]);

      // Combine and deduplicate shows using the same logic as calendar screen
      const allTraktShows = new Map();

      // Add watchlist shows
      if (watchlistShows) {
        watchlistShows.forEach((item: any) => {
          if (item.show && item.show.ids.imdb) {
            allTraktShows.set(item.show.ids.imdb, {
              id: item.show.ids.imdb,
              name: item.show.title,
              type: 'series',
              year: item.show.year,
              source: 'trakt-watchlist'
            });
          }
        });
      }

      // Add continue watching shows (in-progress shows)
      if (continueWatching) {
        continueWatching.forEach((item: any) => {
          if (item.type === 'episode' && item.show && item.show.ids.imdb) {
            const imdbId = item.show.ids.imdb;
            if (!allTraktShows.has(imdbId)) {
              allTraktShows.set(imdbId, {
                id: imdbId,
                name: item.show.title,
                type: 'series',
                year: item.show.year,
                source: 'trakt-continue-watching'
              });
            }
          }
        });
      }

      // Add recently watched shows (top 20, same as calendar)
      if (watchedShows) {
        const recentWatched = watchedShows.slice(0, 20);
        recentWatched.forEach((item: any) => {
          if (item.show && item.show.ids.imdb) {
            const imdbId = item.show.ids.imdb;
            if (!allTraktShows.has(imdbId)) {
              allTraktShows.set(imdbId, {
                id: imdbId,
                name: item.show.title,
                type: 'series',
                year: item.show.year,
                source: 'trakt-watched'
              });
            }
          }
        });
      }

      // Add collection shows
      if (collectionShows) {
        collectionShows.forEach((item: any) => {
          if (item.show && item.show.ids.imdb) {
            const imdbId = item.show.ids.imdb;
            if (!allTraktShows.has(imdbId)) {
              allTraktShows.set(imdbId, {
                id: imdbId,
                name: item.show.title,
                type: 'series',
                year: item.show.year,
                source: 'trakt-collection'
              });
            }
          }
        });
      }

      // Reduced logging verbosity
      // logger.log(`[NotificationService] Found ${allTraktShows.size} unique Trakt shows from all sources`);

      // Sync notifications for each Trakt show using memory-efficient batching
      const traktShows = Array.from(allTraktShows.values());
      const limitedTraktShows = memoryManager.limitArraySize(traktShows, 30); // Limit Trakt shows

      if (limitedTraktShows.length < traktShows.length) {
        logger.warn(`[NotificationService] Limited Trakt shows sync from ${traktShows.length} to ${limitedTraktShows.length} to prevent memory issues`);
      }

      let syncedCount = 0;
      await memoryManager.processArrayInBatches(
        limitedTraktShows,
        async (show) => {
          try {
            await this.updateNotificationsForSeries(show.id);
            syncedCount++;
          } catch (error) {
            logger.error(`[NotificationService] Failed to sync notifications for ${show.name}:`, error);
          }
        },
        2, // Even smaller batch size for Trakt shows
        1000 // Longer delay to prevent API rate limiting
      );

      // Clear Trakt shows array to free memory
      memoryManager.clearObjects(traktShows, limitedTraktShows);

      // Reduced logging verbosity
      // logger.log(`[NotificationService] Successfully synced notifications for ${syncedCount}/${allTraktShows.size} Trakt shows`);
    } catch (error) {
      logger.error('[NotificationService] Error syncing Trakt notifications:', error);
    }
  }

  // Enhanced series notification update with memory-efficient episode fetching
  async updateNotificationsForSeries(seriesId: string): Promise<void> {
    try {
      // Check memory pressure before processing
      memoryManager.checkMemoryPressure();

      // Use the new memory-efficient method to fetch only upcoming episodes
      const episodeData = await stremioService.getUpcomingEpisodes('series', seriesId, {
        daysBack: 7,   // 1 week back for notifications
        daysAhead: 28, // 4 weeks ahead for notifications
        maxEpisodes: 10, // Limit to 10 episodes per series for notifications
      });

      let upcomingEpisodes: any[] = [];
      let metadata: any = null;

      if (episodeData && episodeData.episodes.length > 0) {
        metadata = {
          name: episodeData.seriesName,
          poster: episodeData.poster,
        };

        upcomingEpisodes = episodeData.episodes
          .filter(video => {
            if (!video.released) return false;
            const releaseDate = parseISO(video.released);
            const now = new Date();
            return releaseDate > now; // Only truly upcoming episodes for notifications
          })
          .map(video => ({
            id: video.id,
            title: video.title || `Episode ${video.episode}`,
            season: video.season || 0,
            episode: video.episode || 0,
            released: video.released,
          }));
      }

      // If no upcoming episodes from Stremio, try TMDB
      if (upcomingEpisodes.length === 0) {
        try {
          // Extract TMDB ID if it's a TMDB format ID
          let tmdbId = seriesId;
          if (seriesId.startsWith('tmdb:')) {
            tmdbId = seriesId.split(':')[1];
          }

          const tmdbDetails = await tmdbService.getTVShowDetails(parseInt(tmdbId));
          if (tmdbDetails) {
            metadata = {
              id: seriesId,
              type: 'series' as const,
              name: tmdbDetails.name,
              poster: tmdbService.getImageUrl(tmdbDetails.poster_path) || '',
            };

            // Get upcoming episodes from TMDB
            const now = new Date();
            const fourWeeksLater = addDays(now, 28);

            // Check current and next seasons for upcoming episodes
            for (let seasonNum = tmdbDetails.number_of_seasons; seasonNum >= Math.max(1, tmdbDetails.number_of_seasons - 2); seasonNum--) {
              try {
                const seasonDetails = await tmdbService.getSeasonDetails(parseInt(tmdbId), seasonNum);
                if (seasonDetails && seasonDetails.episodes) {
                  const seasonUpcoming = seasonDetails.episodes.filter((episode: any) => {
                    if (!episode.air_date) return false;
                    const airDate = parseISO(episode.air_date);
                    return airDate > now && airDate < fourWeeksLater;
                  });

                  upcomingEpisodes.push(...seasonUpcoming.map((episode: any) => ({
                    id: `${tmdbId}-s${seasonNum}e${episode.episode_number}`,
                    title: episode.name,
                    season: seasonNum,
                    episode: episode.episode_number,
                    released: episode.air_date,
                  })));
                }
              } catch (seasonError) {
                // Continue with other seasons if one fails
              }
            }
          }
        } catch (tmdbError) {
          logger.warn(`[NotificationService] TMDB fallback failed for ${seriesId}:`, tmdbError);
        }
      }

      if (!metadata) {
        return;
      }

      // Cancel existing notifications for this series
      const existingNotifications = await Notifications.getAllScheduledNotificationsAsync();
      for (const notification of existingNotifications) {
        if (notification.content.data?.seriesId === seriesId) {
          await Notifications.cancelScheduledNotificationAsync(notification.identifier);
        }
      }

      // Remove from our tracked notifications
      this.scheduledNotifications = this.scheduledNotifications.filter(
        notification => notification.seriesId !== seriesId
      );

      // Schedule new notifications for upcoming episodes with memory limits
      if (upcomingEpisodes.length > 0 && metadata) {
        // Limit notifications per series to prevent memory overflow
        const limitedEpisodes = memoryManager.limitArraySize(upcomingEpisodes, 5);

        const notificationItems: NotificationItem[] = limitedEpisodes.map(episode => ({
          id: episode.id,
          seriesId,
          seriesName: metadata.name,
          episodeTitle: episode.title,
          season: episode.season || 0,
          episode: episode.episode || 0,
          releaseDate: episode.released,
          notified: false,
          poster: metadata.poster,
        }));

        const scheduledCount = await this.scheduleMultipleEpisodeNotifications(notificationItems);

        // Clear notification items array to free memory
        memoryManager.clearObjects(notificationItems, upcomingEpisodes);

        // Reduced logging verbosity
        // logger.log(`[NotificationService] Scheduled ${scheduledCount} notifications for ${metadata.name}`);
      } else {
        // logger.log(`[NotificationService] No upcoming episodes found for ${metadata?.name || seriesId}`);
      }

      // Clear episode data to free memory
      if (episodeData) {
        memoryManager.clearObjects(episodeData.episodes);
      }

    } catch (error) {
      logger.error(`[NotificationService] Error updating notifications for series ${seriesId}:`, error);
    } finally {
      // Force cleanup after each series to prevent accumulation
      memoryManager.forceGarbageCollection();
    }
  }

  // Clean up old and expired notifications
  private async cleanupOldNotifications(): Promise<void> {
    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Remove notifications for episodes that have already aired
      const validNotifications = this.scheduledNotifications.filter(notification => {
        const releaseDate = parseISO(notification.releaseDate);
        return releaseDate > oneDayAgo;
      });

      if (validNotifications.length !== this.scheduledNotifications.length) {
        this.scheduledNotifications = validNotifications;
        await this.saveScheduledNotifications();
        // Reduced logging verbosity
        // logger.log(`[NotificationService] Cleaned up ${this.scheduledNotifications.length - validNotifications.length} old notifications`);
      }
    } catch (error) {
      logger.error('[NotificationService] Error cleaning up notifications:', error);
    }
  }

  // Public method to manually trigger sync for all library items
  public async syncAllNotifications(): Promise<void> {
    // Reduced logging verbosity
    // logger.log('[NotificationService] Manual sync triggered');
    await this.performBackgroundSync();
  }

  // Public method to get notification stats
  public getNotificationStats(): { total: number; upcoming: number; thisWeek: number } {
    const now = new Date();
    const oneWeekLater = addDays(now, 7);

    const upcoming = this.scheduledNotifications.filter(notification => {
      const releaseDate = parseISO(notification.releaseDate);
      return releaseDate > now;
    });

    const thisWeek = upcoming.filter(notification => {
      const releaseDate = parseISO(notification.releaseDate);
      return releaseDate < oneWeekLater;
    });

    return {
      total: this.scheduledNotifications.length,
      upcoming: upcoming.length,
      thisWeek: thisWeek.length
    };
  }

  // Cleanup method for proper disposal
  public destroy(): void {
    if (this.backgroundSyncInterval) {
      clearInterval(this.backgroundSyncInterval);
      this.backgroundSyncInterval = null;
    }

    if (this.librarySubscription) {
      this.librarySubscription();
      this.librarySubscription = null;
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();