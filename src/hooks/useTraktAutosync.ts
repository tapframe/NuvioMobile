import { useCallback, useRef, useEffect } from 'react';
import { useTraktIntegration } from './useTraktIntegration';
import { useSimklIntegration } from './useSimklIntegration';
import { useTraktAutosyncSettings } from './useTraktAutosyncSettings';
import { TraktContentData } from '../services/traktService';
import { SimklContentData } from '../services/simklService';
import { storageService } from '../services/storageService';
import { logger } from '../utils/logger';

interface TraktAutosyncOptions {
  id: string;
  type: 'movie' | 'series';
  title: string;
  year: number | string; // Allow both for compatibility
  imdbId: string;
  // For episodes
  season?: number;
  episode?: number;
  showTitle?: string;
  showYear?: number | string; // Allow both for compatibility
  showImdbId?: string;
  episodeId?: string;
}

export function useTraktAutosync(options: TraktAutosyncOptions) {
  const {
    isAuthenticated,
    startWatching,
    updateProgress,
    updateProgressImmediate,
    stopWatching,
    stopWatchingImmediate
  } = useTraktIntegration();

  const {
    isAuthenticated: isSimklAuthenticated,
    startWatching: startSimkl,
    updateProgress: updateSimkl,
    stopWatching: stopSimkl
  } = useSimklIntegration();

  const { settings: autosyncSettings } = useTraktAutosyncSettings();

  const hasStartedWatching = useRef(false);
  const hasStopped = useRef(false); // New: Track if we've already stopped for this session
  const isSessionComplete = useRef(false); // New: Track if session is completely finished (scrobbled)
  const isUnmounted = useRef(false); // New: Track if component has unmounted
  const lastSyncTime = useRef(0);
  const lastSyncProgress = useRef(0);
  const sessionKey = useRef<string | null>(null);
  const unmountCount = useRef(0);
  const lastStopCall = useRef(0); // New: Track last stop call timestamp

  // Generate a unique session key for this content instance
  useEffect(() => {
    const resolvedId = (options.imdbId && options.imdbId.trim()) ? options.imdbId : (options.id || '');
    const contentKey = options.type === 'movie'
      ? `movie:${resolvedId}`
      : `episode:${options.showImdbId || resolvedId}:${options.season}:${options.episode}`;
    sessionKey.current = `${contentKey}:${Date.now()}`;

    // Reset all session state for new content
    hasStartedWatching.current = false;
    hasStopped.current = false;
    isSessionComplete.current = false;
    isUnmounted.current = false; // Reset unmount flag for new mount
    lastStopCall.current = 0;

    logger.log(`[TraktAutosync] Session started for: ${sessionKey.current}`);

    return () => {
      unmountCount.current++;
      isUnmounted.current = true; // Mark as unmounted to prevent post-unmount operations
      logger.log(`[TraktAutosync] Component unmount #${unmountCount.current} for: ${sessionKey.current}`);
    };
  }, [options.imdbId, options.season, options.episode, options.type]);

  // Build Trakt content data from options
  // Returns null if required fields are missing or invalid
  const buildContentData = useCallback((): TraktContentData | null => {
    // Parse and validate year - returns undefined for invalid/missing years
    const parseYear = (year: number | string | undefined): number | undefined => {
      if (year === undefined || year === null || year === '') return undefined;
      if (typeof year === 'number') {
        // Year must be a reasonable value (between 1800 and current year + 10)
        const currentYear = new Date().getFullYear();
        if (year <= 0 || year < 1800 || year > currentYear + 10) {
          logger.warn(`[TraktAutosync] Invalid year value: ${year}`);
          return undefined;
        }
        return year;
      }
      const parsed = parseInt(year.toString(), 10);
      if (isNaN(parsed) || parsed <= 0) {
        logger.warn(`[TraktAutosync] Failed to parse year: ${year}`);
        return undefined;
      }
      // Validate parsed year range
      const currentYear = new Date().getFullYear();
      if (parsed < 1800 || parsed > currentYear + 10) {
        logger.warn(`[TraktAutosync] Year out of valid range: ${parsed}`);
        return undefined;
      }
      return parsed;
    };

    // Validate required fields early
    if (!options.title || options.title.trim() === '') {
      logger.error('[TraktAutosync] Cannot build content data: missing or empty title');
      return null;
    }

    // Resolve the best available ID: prefer a proper IMDb ID, fall back to the Stremio content ID.
    // This allows scrobbling for content with special IDs (e.g. "kitsu:123", "tmdb:456") where
    // the IMDb ID hasn't been resolved yet — Trakt will match by title + season/episode instead.
    const imdbIdRaw = options.imdbId && options.imdbId.trim() ? options.imdbId.trim() : '';
    const stremioIdRaw = options.id && options.id.trim() ? options.id.trim() : '';
    const resolvedImdbId = imdbIdRaw || stremioIdRaw;

    if (!resolvedImdbId) {
      logger.error('[TraktAutosync] Cannot build content data: missing or empty imdbId and id');
      return null;
    }

    if (!imdbIdRaw && stremioIdRaw) {
      logger.warn(`[TraktAutosync] imdbId is empty, falling back to stremio id "${stremioIdRaw}" — Trakt will match by title`);
    }

    const numericYear = parseYear(options.year);
    const numericShowYear = parseYear(options.showYear);

    // Log warning if year is missing (but don't fail - Trakt can sometimes work with IMDb ID alone)
    if (numericYear === undefined) {
      logger.warn('[TraktAutosync] Year is missing or invalid, proceeding without year');
    }

    if (options.type === 'movie') {
      return {
        type: 'movie',
        imdbId: resolvedImdbId,
        title: options.title.trim(),
        year: numericYear // Can be undefined now
      };
    } else {
      // For episodes, also validate season and episode numbers
      if (options.season === undefined || options.season === null || options.season < 0) {
        logger.error('[TraktAutosync] Cannot build episode content data: invalid season');
        return null;
      }
      if (options.episode === undefined || options.episode === null || options.episode < 0) {
        logger.error('[TraktAutosync] Cannot build episode content data: invalid episode');
        return null;
      }

      const resolvedShowImdbId = (options.showImdbId && options.showImdbId.trim())
        ? options.showImdbId.trim()
        : resolvedImdbId;

      return {
        type: 'episode',
        imdbId: resolvedImdbId,
        title: options.title.trim(),
        year: numericYear,
        season: options.season,
        episode: options.episode,
        showTitle: (options.showTitle || options.title).trim(),
        showYear: numericShowYear || numericYear,
        showImdbId: resolvedShowImdbId
      };
    }
  }, [options]);

  const buildSimklContentData = useCallback((): SimklContentData => {
    // Use the same fallback logic: prefer imdbId, fall back to stremio id
    const resolvedId = (options.imdbId && options.imdbId.trim())
      ? options.imdbId.trim()
      : (options.id && options.id.trim()) ? options.id.trim() : '';
    return {
      type: options.type === 'series' ? 'episode' : 'movie',
      title: options.title,
      ids: {
        imdb: resolvedId
      },
      season: options.season,
      episode: options.episode
    };
  }, [options]);

  // Start watching (scrobble start)
  const handlePlaybackStart = useCallback(async (currentTime: number, duration: number) => {
    if (isUnmounted.current) return; // Prevent execution after component unmount

    logger.log(`[TraktAutosync] handlePlaybackStart called: time=${currentTime}, duration=${duration}, authenticated=${isAuthenticated}, enabled=${autosyncSettings.enabled}, alreadyStarted=${hasStartedWatching.current}, alreadyStopped=${hasStopped.current}, sessionComplete=${isSessionComplete.current}, session=${sessionKey.current}`);

    const shouldSyncTrakt = isAuthenticated && autosyncSettings.enabled;
    const shouldSyncSimkl = isSimklAuthenticated;

    if (!shouldSyncTrakt && !shouldSyncSimkl) {
      logger.log(`[TraktAutosync] Skipping handlePlaybackStart: Trakt (auth=${isAuthenticated}, enabled=${autosyncSettings.enabled}), Simkl (auth=${isSimklAuthenticated})`);
      return;
    }

    // PREVENT SESSION RESTART: Don't start if session is complete (scrobbled)
    if (isSessionComplete.current) {
      logger.log(`[TraktAutosync] Skipping handlePlaybackStart: session is complete, preventing any restart`);
      return;
    }

    // PREVENT SESSION RESTART: Don't start if we've already stopped this session
    if (hasStopped.current) {
      logger.log(`[TraktAutosync] Skipping handlePlaybackStart: session already stopped, preventing restart`);
      return;
    }

    if (hasStartedWatching.current) {
      logger.log(`[TraktAutosync] Skipping handlePlaybackStart: already started=${hasStartedWatching.current}`);
      return;
    }

    if (duration <= 0) {
      logger.log(`[TraktAutosync] Skipping handlePlaybackStart: invalid duration (${duration})`);
      return;
    }

    try {
      // Clamp progress between 0 and 100
      const rawProgress = (currentTime / duration) * 100;
      const progressPercent = Math.min(100, Math.max(0, rawProgress));
      const contentData = buildContentData();

      // Skip if content data is invalid
      if (!contentData) {
        logger.warn('[TraktAutosync] Skipping start: invalid content data');
        return;
      }

      if (shouldSyncTrakt) {
        const success = await startWatching(contentData, progressPercent);
        if (success) {
          hasStartedWatching.current = true;
          hasStopped.current = false; // Reset stop flag when starting
          logger.log(`[TraktAutosync] Started watching: ${contentData.title} (session: ${sessionKey.current})`);
        }
      } else {
        // If Trakt is disabled but Simkl is enabled, we still mark stated/stopped flags for local logic
        hasStartedWatching.current = true;
        hasStopped.current = false;
      }

      // Simkl Start
      if (shouldSyncSimkl) {
        const simklData = buildSimklContentData();
        await startSimkl(simklData, progressPercent);
      }
    } catch (error) {
      logger.error('[TraktAutosync] Error starting watch:', error);
    }
  }, [isAuthenticated, isSimklAuthenticated, autosyncSettings.enabled, startWatching, startSimkl, buildContentData, buildSimklContentData]);

  // Sync progress during playback
  const handleProgressUpdate = useCallback(async (
    currentTime: number,
    duration: number,
    force: boolean = false
  ) => {
    if (isUnmounted.current) return; // Prevent execution after component unmount

    const shouldSyncTrakt = isAuthenticated && autosyncSettings.enabled;
    const shouldSyncSimkl = isSimklAuthenticated;

    if ((!shouldSyncTrakt && !shouldSyncSimkl) || duration <= 0) {
      return;
    }

    // Skip if session is already complete
    if (isSessionComplete.current) {
      return;
    }

    try {
      const rawProgress = (currentTime / duration) * 100;
      const progressPercent = Math.min(100, Math.max(0, rawProgress));
      const now = Date.now();

      // IMMEDIATE SYNC: Use immediate method for user-triggered actions (force=true)
      // Use regular queued method for background periodic syncs
      let traktSuccess: boolean = false;

      if (shouldSyncTrakt) {
        if (force) {
          // IMMEDIATE: User action (pause/unpause) - bypass queue
          const contentData = buildContentData();
          if (!contentData) {
            logger.warn('[TraktAutosync] Skipping Trakt progress update: invalid content data');
            return;
          }
          traktSuccess = await updateProgressImmediate(contentData, progressPercent);

          if (traktSuccess) {
            lastSyncTime.current = now;
            lastSyncProgress.current = progressPercent;

            // Update local storage sync status
            await storageService.updateTraktSyncStatus(
              options.id,
              options.type,
              true,
              progressPercent,
              options.episodeId,
              currentTime
            );

            logger.log(`[TraktAutosync] Trakt IMMEDIATE: Progress updated to ${progressPercent.toFixed(1)}%`);
          }
        } else {
          // BACKGROUND: Periodic sync - use queued method
          const progressDiff = Math.abs(progressPercent - lastSyncProgress.current);

          // Only skip if not forced and progress difference is minimal (< 0.5%)
          if (progressDiff < 0.5) {
            logger.log(`[TraktAutosync] Trakt: Skipping periodic progress update, progress diff too small (${progressDiff.toFixed(2)}%)`);
            // If only Trakt is active and we skip, we should return here.
            // If Simkl is also active, we continue to let Simkl update.
            if (!shouldSyncSimkl) return;
          }

          const contentData = buildContentData();
          if (!contentData) {
            logger.warn('[TraktAutosync] Skipping Trakt progress update: invalid content data');
            return;
          }
          traktSuccess = await updateProgress(contentData, progressPercent, force);

          if (traktSuccess) {
            lastSyncTime.current = now;
            lastSyncProgress.current = progressPercent;

            // Update local storage sync status
            await storageService.updateTraktSyncStatus(
              options.id,
              options.type,
              true,
              progressPercent,
              options.episodeId,
              currentTime
            );

            // Progress sync logging removed
            logger.log(`[TraktAutosync] Trakt: Progress updated to ${progressPercent.toFixed(1)}%`);
          }
        }
      }

      // Simkl Update (No immediate/queued differentiation for now in Simkl hook, just call update)
      if (shouldSyncSimkl) {
        // Debounce simkl updates slightly if needed, but hook handles calls.
        // We do basic difference check here
        const simklData = buildSimklContentData();
        await updateSimkl(simklData, progressPercent);

        // Update local storage for Simkl
        await storageService.updateSimklSyncStatus(
          options.id,
          options.type,
          true,
          progressPercent,
          options.episodeId
        );
        logger.log(`[TraktAutosync] Simkl: Progress updated to ${progressPercent.toFixed(1)}%`);
      }

    } catch (error) {
      logger.error('[TraktAutosync] Error syncing progress:', error);
    }
  }, [isAuthenticated, isSimklAuthenticated, autosyncSettings.enabled, updateProgress, updateSimkl, updateProgressImmediate, buildContentData, buildSimklContentData, options]);

  // Handle playback end/pause
  const handlePlaybackEnd = useCallback(async (currentTime: number, duration: number, reason: 'ended' | 'unmount' | 'user_close' = 'ended') => {
    if (isUnmounted.current) return; // Prevent execution after component unmount

    const now = Date.now();

    // Removed excessive logging for handlePlaybackEnd calls

    const shouldSyncTrakt = isAuthenticated && autosyncSettings.enabled;
    const shouldSyncSimkl = isSimklAuthenticated;

    if (!shouldSyncTrakt && !shouldSyncSimkl) {
      logger.log(`[TraktAutosync] Skipping handlePlaybackEnd: Neither Trakt nor Simkl are active.`);
      return;
    }

    // ENHANCED DEDUPLICATION: Check if session is already complete
    if (isSessionComplete.current) {
      logger.log(`[TraktAutosync] Session already complete, skipping end call (reason: ${reason})`);
      return;
    }

    // ENHANCED DEDUPLICATION: Check if we've already stopped this session
    // However, allow updates if the new progress is significantly higher (>5% improvement)
    let isSignificantUpdate = false;
    if (hasStopped.current) {
      const currentProgressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
      const progressImprovement = currentProgressPercent - lastSyncProgress.current;

      if (progressImprovement > 5) {
        logger.log(`[TraktAutosync] Session already stopped, but progress improved significantly by ${progressImprovement.toFixed(1)}% (${lastSyncProgress.current.toFixed(1)}% → ${currentProgressPercent.toFixed(1)}%), allowing update`);
        // Reset stopped flag to allow this significant update
        hasStopped.current = false;
        isSignificantUpdate = true;
      } else {
        // Already stopped this session, skipping duplicate call
        logger.log(`[TraktAutosync] Skipping handlePlaybackEnd: session already stopped and no significant progress improvement.`);
        return;
      }
    }

    // IMMEDIATE SYNC: Use immediate method for user-initiated actions (user_close)
    let useImmediate = reason === 'user_close';

    // IMMEDIATE SYNC: Remove debouncing for instant sync when closing
    // Only prevent truly duplicate calls (within 500ms for regular, 100ms for immediate)
    const debounceThreshold = useImmediate ? 100 : 500;
    if (!isSignificantUpdate && now - lastStopCall.current < debounceThreshold) {
      logger.log(`[TraktAutosync] Ignoring duplicate stop call within ${debounceThreshold}ms (reason: ${reason})`);
      return;
    }

    // Skip rapid unmount calls (likely from React strict mode or component remounts)
    if (reason === 'unmount' && unmountCount.current > 1) {
      logger.log(`[TraktAutosync] Skipping duplicate unmount call #${unmountCount.current}`);
      return;
    }

    try {
      let progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
      // Clamp progress between 0 and 100
      progressPercent = Math.min(100, Math.max(0, progressPercent));
      // Initial progress calculation logging removed

      // For unmount calls, always use the highest available progress
      // Check current progress, last synced progress, and local storage progress
      if (reason === 'unmount') {
        let maxProgress = progressPercent;

        // Check last synced progress
        if (lastSyncProgress.current > maxProgress) {
          maxProgress = lastSyncProgress.current;
        }

        // Also check local storage for the highest recorded progress
        try {
          const savedProgress = await storageService.getWatchProgress(
            options.id,
            options.type,
            options.episodeId
          );

          if (savedProgress && savedProgress.duration > 0) {
            const savedProgressPercent = Math.min(100, Math.max(0, (savedProgress.currentTime / savedProgress.duration) * 100));
            if (savedProgressPercent > maxProgress) {
              maxProgress = savedProgressPercent;
            }
          }
        } catch (error) {
          logger.error('[TraktAutosync] Error checking saved progress:', error);
        }

        if (maxProgress !== progressPercent) {
          // Highest progress logging removed
          progressPercent = maxProgress;
        } else {
          // Current progress logging removed
        }
      }

      // If we have valid progress but no started session, force start one first
      if (!hasStartedWatching.current && progressPercent > 1) {
        const contentData = buildContentData();
        if (contentData) {
          let started = false;
          // Try starting Trakt if enabled
          if (shouldSyncTrakt) {
            const s = await startWatching(contentData, progressPercent);
            if (s) started = true;
          }
          // Try starting Simkl if enabled (always 'true' effectively if authenticated)
          if (shouldSyncSimkl) {
            const simklData = buildSimklContentData();
            await startSimkl(simklData, progressPercent);
            started = true;
          }

          if (started) {
            hasStartedWatching.current = true;
          }
        }
      }

      // Only stop if we have meaningful progress (>= 0.5%) or it's a natural video end
      // Lower threshold for unmount calls to catch more edge cases
      if (reason === 'unmount' && progressPercent < 0.5) {
        // Early unmount stop logging removed
        logger.log(`[TraktAutosync] Skipping unmount stop call due to minimal progress (${progressPercent.toFixed(1)}%)`);
        return;
      }

      // Note: No longer boosting progress since Trakt API handles 80% threshold correctly

      // Mark stop attempt and update timestamp
      lastStopCall.current = now;
      hasStopped.current = true;

      const contentData = buildContentData();

      // Skip if content data is invalid
      if (!contentData) {
        logger.warn('[TraktAutosync] Skipping stop: invalid content data');
        hasStopped.current = false; // Allow retry with valid data
        return;
      }

      let overallSuccess = false;

      // IMMEDIATE: Use immediate method for user-initiated closes, regular method for natural ends
      let traktStopSuccess = false;
      if (shouldSyncTrakt) {
        traktStopSuccess = useImmediate
          ? await stopWatchingImmediate(contentData, progressPercent)
          : await stopWatching(contentData, progressPercent);
        if (traktStopSuccess) {
          logger.log(`[TraktAutosync] Trakt: ${useImmediate ? 'IMMEDIATE: ' : ''}Successfully stopped watching: ${contentData.title} (${progressPercent.toFixed(1)}% - ${reason})`);
          overallSuccess = true;
        } else {
          logger.warn(`[TraktAutosync] Trakt: Failed to stop watching.`);
        }
      }

      if (traktStopSuccess) {
        // Update local storage sync status for Trakt
        await storageService.updateTraktSyncStatus(
          options.id,
          options.type,
          true,
          progressPercent,
          options.episodeId,
          currentTime
        );
      } else if (shouldSyncTrakt) {
        // If Trakt stop failed, reset the stop flag so we can try again later
        hasStopped.current = false;
        logger.warn(`[TraktAutosync] Trakt: Failed to stop watching, reset stop flag for retry`);
      }

      // Simkl Stop
      if (shouldSyncSimkl) {
        const simklData = buildSimklContentData();
        await stopSimkl(simklData, progressPercent);

        // Update local storage sync status for Simkl
        await storageService.updateSimklSyncStatus(
          options.id,
          options.type,
          true,
          progressPercent,
          options.episodeId
        );
        logger.log(`[TraktAutosync] Simkl: Successfully stopped watching: ${simklData.title} (${progressPercent.toFixed(1)}% - ${reason})`);
        overallSuccess = true; // Mark overall success if at least one worked (Simkl doesn't have immediate/queued logic yet)
      }

      if (overallSuccess) {
        // Mark session as complete if >= user completion threshold
        if (progressPercent >= autosyncSettings.completionThreshold) {
          isSessionComplete.current = true;
          logger.log(`[TraktAutosync] Session marked as complete (scrobbled) at ${progressPercent.toFixed(1)}%`);

          // Ensure local watch progress reflects completion so UI shows as watched
          try {
            if (duration > 0) {
              await storageService.setWatchProgress(
                options.id,
                options.type,
                {
                  currentTime: duration,
                  duration,
                  lastUpdated: Date.now(),
                  traktSynced: shouldSyncTrakt ? true : undefined,
                  traktProgress: shouldSyncTrakt ? Math.max(progressPercent, 100) : undefined,
                  simklSynced: shouldSyncSimkl ? true : undefined,
                  simklProgress: shouldSyncSimkl ? Math.max(progressPercent, 100) : undefined,
                } as any,
                options.episodeId,
                { forceNotify: true }
              );
            }
          } catch { }
        }

        // General success log if at least one service succeeded
        if (!shouldSyncTrakt || traktStopSuccess) { // Only log this if Trakt succeeded or wasn't active
          logger.log(`[TraktAutosync] Overall: Successfully processed stop for: ${contentData.title} (${progressPercent.toFixed(1)}% - ${reason})`);
        }
      } else {
        // If neither service succeeded, reset the stop flag
        hasStopped.current = false;
        logger.warn(`[TraktAutosync] Overall: Failed to stop watching, reset stop flag for retry`);
      }

      // Reset state only for natural end or very high progress unmounts
      if (reason === 'ended' || progressPercent >= 80) {
        hasStartedWatching.current = false;
        lastSyncTime.current = 0;
        lastSyncProgress.current = 0;
        logger.log(`[TraktAutosync] Reset session state for ${reason} at ${progressPercent.toFixed(1)}%`);
      }

    } catch (error) {
      logger.error('[TraktAutosync] Error ending watch:', error);
      // Reset stop flag on error so we can try again
      hasStopped.current = false;
    }
  }, [isAuthenticated, isSimklAuthenticated, autosyncSettings.enabled, stopWatching, stopSimkl, stopWatchingImmediate, startWatching, buildContentData, buildSimklContentData, options]);

  // Reset state (useful when switching content)
  const resetState = useCallback(() => {
    hasStartedWatching.current = false;
    hasStopped.current = false;
    isSessionComplete.current = false;
    isUnmounted.current = false;
    lastSyncTime.current = 0;
    lastSyncProgress.current = 0;
    unmountCount.current = 0;
    sessionKey.current = null;
    lastStopCall.current = 0;
    logger.log(`[TraktAutosync] Manual state reset for: ${options.title}`);
  }, [options.title]);

  return {
    isAuthenticated,
    handlePlaybackStart,
    handleProgressUpdate,
    handlePlaybackEnd,
    resetState
  };
}
