import { TraktService } from './traktService';
import { SimklService } from './simklService';
import { storageService } from './storageService';
import { mmkvStorage } from './mmkvStorage';
import { logger } from '../utils/logger';

export interface LocalWatchedItem {
    content_id: string;
    content_type: 'movie' | 'series';
    title: string;
    season: number | null;
    episode: number | null;
    watched_at: number;
}

/**
 * WatchedService - Manages "watched" status for movies, episodes, and seasons.
 * Handles both local storage and Trakt sync transparently.
 *
 * When Trakt is authenticated, it syncs to Trakt.
 * When not authenticated, it stores locally.
 */
class WatchedService {
    private static instance: WatchedService;
    private traktService: TraktService;
    private simklService: SimklService;
    private readonly WATCHED_ITEMS_KEY = '@user:local:watched_items';
    private watchedSubscribers: Array<() => void> = [];

    private constructor() {
        this.traktService = TraktService.getInstance();
        this.simklService = SimklService.getInstance();
    }

    public static getInstance(): WatchedService {
        if (!WatchedService.instance) {
            WatchedService.instance = new WatchedService();
        }
        return WatchedService.instance;
    }

    private watchedKey(item: Pick<LocalWatchedItem, 'content_id' | 'season' | 'episode'>): string {
        return `${item.content_id}::${item.season ?? -1}::${item.episode ?? -1}`;
    }

    private normalizeWatchedItem(item: LocalWatchedItem): LocalWatchedItem {
        return {
            content_id: String(item.content_id || ''),
            content_type: item.content_type === 'movie' ? 'movie' : 'series',
            title: item.title || '',
            season: item.season == null ? null : Number(item.season),
            episode: item.episode == null ? null : Number(item.episode),
            watched_at: Number(item.watched_at || Date.now()),
        };
    }

    private notifyWatchedSubscribers(): void {
        if (this.watchedSubscribers.length === 0) return;
        this.watchedSubscribers.forEach((cb) => cb());
    }

    public subscribeToWatchedUpdates(callback: () => void): () => void {
        this.watchedSubscribers.push(callback);
        return () => {
            const index = this.watchedSubscribers.indexOf(callback);
            if (index > -1) {
                this.watchedSubscribers.splice(index, 1);
            }
        };
    }

    private async loadWatchedItems(): Promise<LocalWatchedItem[]> {
        try {
            const json = await mmkvStorage.getItem(this.WATCHED_ITEMS_KEY);
            if (!json) return [];
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) return [];

            const deduped = new Map<string, LocalWatchedItem>();
            parsed.forEach((raw) => {
                if (!raw || typeof raw !== 'object') return;
                const normalized = this.normalizeWatchedItem(raw as LocalWatchedItem);
                if (!normalized.content_id) return;
                const key = this.watchedKey(normalized);
                const existing = deduped.get(key);
                if (!existing || normalized.watched_at > existing.watched_at) {
                    deduped.set(key, normalized);
                }
            });

            return Array.from(deduped.values());
        } catch (error) {
            logger.error('[WatchedService] Failed to load local watched items:', error);
            return [];
        }
    }

    private async saveWatchedItems(items: LocalWatchedItem[]): Promise<void> {
        try {
            await mmkvStorage.setItem(this.WATCHED_ITEMS_KEY, JSON.stringify(items));
        } catch (error) {
            logger.error('[WatchedService] Failed to save local watched items:', error);
        }
    }

    public async getAllWatchedItems(): Promise<LocalWatchedItem[]> {
        return await this.loadWatchedItems();
    }

    private async upsertLocalWatchedItems(items: LocalWatchedItem[]): Promise<void> {
        if (items.length === 0) return;

        const current = await this.loadWatchedItems();
        const byKey = new Map<string, LocalWatchedItem>(
            current.map((item) => [this.watchedKey(item), item])
        );

        let changed = false;
        for (const raw of items) {
            const normalized = this.normalizeWatchedItem(raw);
            if (!normalized.content_id) continue;

            const key = this.watchedKey(normalized);
            const existing = byKey.get(key);
            if (!existing || normalized.watched_at > existing.watched_at || (normalized.title && normalized.title !== existing.title)) {
                byKey.set(key, normalized);
                changed = true;
            }
        }

        if (changed) {
            await this.saveWatchedItems(Array.from(byKey.values()));
            this.notifyWatchedSubscribers();
        }
    }

    private async removeLocalWatchedItems(items: Array<Pick<LocalWatchedItem, 'content_id' | 'season' | 'episode'>>): Promise<void> {
        if (items.length === 0) return;

        const current = await this.loadWatchedItems();
        const toRemove = new Set(items.map((item) => this.watchedKey({ content_id: item.content_id, season: item.season ?? null, episode: item.episode ?? null })));
        const filtered = current.filter((item) => !toRemove.has(this.watchedKey(item)));

        if (filtered.length !== current.length) {
            await this.saveWatchedItems(filtered);
            this.notifyWatchedSubscribers();
        }
    }

    public async mergeRemoteWatchedItems(items: LocalWatchedItem[]): Promise<void> {
        const normalized = items
            .map((item) => this.normalizeWatchedItem(item))
            .filter((item) => Boolean(item.content_id));

        await this.upsertLocalWatchedItems(normalized);

        for (const item of normalized) {
            if (item.content_type === 'movie') {
                await this.setLocalWatchedStatus(item.content_id, 'movie', true, undefined, new Date(item.watched_at));
                continue;
            }

            if (item.season == null || item.episode == null) continue;
            const episodeId = `${item.content_id}:${item.season}:${item.episode}`;
            await this.setLocalWatchedStatus(item.content_id, 'series', true, episodeId, new Date(item.watched_at));
        }
    }

    public async reconcileRemoteWatchedItems(items: LocalWatchedItem[]): Promise<void> {
        const normalizedRemote = items
            .map((item) => this.normalizeWatchedItem(item))
            .filter((item) => Boolean(item.content_id));

        // Guard: do not wipe local watched data if backend temporarily returns empty.
        if (normalizedRemote.length === 0) {
            return;
        }

        await this.saveWatchedItems(normalizedRemote);
        this.notifyWatchedSubscribers();

        for (const item of normalizedRemote) {
            if (item.content_type === 'movie') {
                await this.setLocalWatchedStatus(item.content_id, 'movie', true, undefined, new Date(item.watched_at));
                continue;
            }

            if (item.season == null || item.episode == null) continue;
            const episodeId = `${item.content_id}:${item.season}:${item.episode}`;
            await this.setLocalWatchedStatus(item.content_id, 'series', true, episodeId, new Date(item.watched_at));
        }
    }

    /**
     * Mark a movie as watched
     * @param imdbId - The IMDb ID of the movie
     * @param watchedAt - Optional date when watched
     */
    public async markMovieAsWatched(
        imdbId: string,
        watchedAt: Date = new Date()
    ): Promise<{ success: boolean; syncedToTrakt: boolean }> {
        try {
            logger.log(`[WatchedService] Marking movie as watched: ${imdbId}`);

            // Check if Trakt is authenticated
            const isTraktAuth = await this.traktService.isAuthenticated();
            let syncedToTrakt = false;

            if (isTraktAuth) {
                // Sync to Trakt
                syncedToTrakt = await this.traktService.addToWatchedMovies(imdbId, watchedAt);
                logger.log(`[WatchedService] Trakt sync result for movie: ${syncedToTrakt}`);
            }

            // Sync to Simkl
            const isSimklAuth = await this.simklService.isAuthenticated();
            if (isSimklAuth) {
                await this.simklService.addToHistory({ movies: [{ ids: { imdb: imdbId }, watched_at: watchedAt.toISOString() }] });
                logger.log(`[WatchedService] Simkl sync request sent for movie`);
            }

            // Also store locally as "completed" (100% progress)
            await this.setLocalWatchedStatus(imdbId, 'movie', true, undefined, watchedAt);
            await this.upsertLocalWatchedItems([
                {
                    content_id: imdbId,
                    content_type: 'movie',
                    title: imdbId,
                    season: null,
                    episode: null,
                    watched_at: watchedAt.getTime(),
                },
            ]);

            return { success: true, syncedToTrakt };
        } catch (error) {
            logger.error('[WatchedService] Failed to mark movie as watched:', error);
            return { success: false, syncedToTrakt: false };
        }
    }

    /**
     * Mark a single episode as watched
     * @param showImdbId - The IMDb ID of the show
     * @param showId - The Stremio ID of the show (for local storage)
     * @param season - Season number
     * @param episode - Episode number
     * @param watchedAt - Optional date when watched
     */
    public async markEpisodeAsWatched(
        showImdbId: string,
        showId: string,
        season: number,
        episode: number,
        watchedAt: Date = new Date()
    ): Promise<{ success: boolean; syncedToTrakt: boolean }> {
        try {
            logger.log(`[WatchedService] Marking episode as watched: ${showImdbId} S${season}E${episode}`);

            // Check if Trakt is authenticated
            const isTraktAuth = await this.traktService.isAuthenticated();
            let syncedToTrakt = false;

            if (isTraktAuth) {
                // Sync to Trakt
                syncedToTrakt = await this.traktService.addToWatchedEpisodes(
                    showImdbId,
                    season,
                    episode,
                    watchedAt
                );
                logger.log(`[WatchedService] Trakt sync result for episode: ${syncedToTrakt}`);
            }

            // Sync to Simkl
            const isSimklAuth = await this.simklService.isAuthenticated();
            if (isSimklAuth) {
                // Simkl structure: shows -> seasons -> episodes
                await this.simklService.addToHistory({
                    shows: [{
                        ids: { imdb: showImdbId },
                        seasons: [{
                            number: season,
                            episodes: [{ number: episode, watched_at: watchedAt.toISOString() }]
                        }]
                    }]
                });
                logger.log(`[WatchedService] Simkl sync request sent for episode`);
            }

            // Store locally as "completed"
            const episodeId = `${showId}:${season}:${episode}`;
            await this.setLocalWatchedStatus(showId, 'series', true, episodeId, watchedAt);
            await this.upsertLocalWatchedItems([
                {
                    content_id: showImdbId,
                    content_type: 'series',
                    title: showImdbId,
                    season,
                    episode,
                    watched_at: watchedAt.getTime(),
                },
            ]);

            return { success: true, syncedToTrakt };
        } catch (error) {
            logger.error('[WatchedService] Failed to mark episode as watched:', error);
            return { success: false, syncedToTrakt: false };
        }
    }

    /**
     * Mark multiple episodes as watched (batch operation)
     * @param showImdbId - The IMDb ID of the show
     * @param showId - The Stremio ID of the show (for local storage)
     * @param episodes - Array of { season, episode } objects
     * @param watchedAt - Optional date when watched
     */
    public async markEpisodesAsWatched(
        showImdbId: string,
        showId: string,
        episodes: Array<{ season: number; episode: number }>,
        watchedAt: Date = new Date()
    ): Promise<{ success: boolean; syncedToTrakt: boolean; count: number }> {
        try {
            if (episodes.length === 0) {
                return { success: true, syncedToTrakt: false, count: 0 };
            }

            logger.log(`[WatchedService] Marking ${episodes.length} episodes as watched for ${showImdbId}`);

            // Check if Trakt is authenticated
            const isTraktAuth = await this.traktService.isAuthenticated();
            let syncedToTrakt = false;

            if (isTraktAuth) {
                // Sync to Trakt (batch operation)
                syncedToTrakt = await this.traktService.markEpisodesAsWatched(
                    showImdbId,
                    episodes,
                    watchedAt
                );
                logger.log(`[WatchedService] Trakt batch sync result: ${syncedToTrakt}`);
            }

            // Sync to Simkl
            const isSimklAuth = await this.simklService.isAuthenticated();
            if (isSimklAuth) {
                // Group by season for Simkl payload efficiency
                const seasonMap = new Map<number, any[]>();
                episodes.forEach(ep => {
                    if (!seasonMap.has(ep.season)) seasonMap.set(ep.season, []);
                    seasonMap.get(ep.season)?.push({ number: ep.episode, watched_at: watchedAt.toISOString() });
                });

                const seasons = Array.from(seasonMap.entries()).map(([num, eps]) => ({ number: num, episodes: eps }));

                await this.simklService.addToHistory({
                    shows: [{
                        ids: { imdb: showImdbId },
                        seasons: seasons
                    }]
                });
                logger.log(`[WatchedService] Simkl batch sync request sent`);
            }

            // Store locally as "completed" for each episode
            for (const ep of episodes) {
                const episodeId = `${showId}:${ep.season}:${ep.episode}`;
                await this.setLocalWatchedStatus(showId, 'series', true, episodeId, watchedAt);
            }

            await this.upsertLocalWatchedItems(
                episodes.map((ep) => ({
                    content_id: showImdbId,
                    content_type: 'series' as const,
                    title: showImdbId,
                    season: ep.season,
                    episode: ep.episode,
                    watched_at: watchedAt.getTime(),
                }))
            );

            return { success: true, syncedToTrakt, count: episodes.length };
        } catch (error) {
            logger.error('[WatchedService] Failed to mark episodes as watched:', error);
            return { success: false, syncedToTrakt: false, count: 0 };
        }
    }

    /**
     * Mark an entire season as watched
     * @param showImdbId - The IMDb ID of the show
     * @param showId - The Stremio ID of the show (for local storage)
     * @param season - Season number
     * @param episodeNumbers - Array of episode numbers in the season
     * @param watchedAt - Optional date when watched
     */
    public async markSeasonAsWatched(
        showImdbId: string,
        showId: string,
        season: number,
        episodeNumbers: number[],
        watchedAt: Date = new Date()
    ): Promise<{ success: boolean; syncedToTrakt: boolean; count: number }> {
        try {
            logger.log(`[WatchedService] Marking season ${season} as watched for ${showImdbId}`);

            // Check if Trakt is authenticated
            const isTraktAuth = await this.traktService.isAuthenticated();
            let syncedToTrakt = false;

            if (isTraktAuth) {
                // Sync entire season to Trakt
                syncedToTrakt = await this.traktService.markSeasonAsWatched(
                    showImdbId,
                    season,
                    watchedAt
                );
                logger.log(`[WatchedService] Trakt season sync result: ${syncedToTrakt}`);
            }

            // Sync to Simkl
            const isSimklAuth = await this.simklService.isAuthenticated();
            if (isSimklAuth) {
                // Simkl doesn't have a direct "mark season" generic endpoint in the same way, but we can construct it
                const episodes = episodeNumbers.map(num => ({ number: num, watched_at: watchedAt.toISOString() }));
                await this.simklService.addToHistory({
                    shows: [{
                        ids: { imdb: showImdbId },
                        seasons: [{
                            number: season,
                            episodes: episodes
                        }]
                    }]
                });
                logger.log(`[WatchedService] Simkl season sync request sent`);
            }

            // Store locally as "completed" for each episode in the season
            for (const epNum of episodeNumbers) {
                const episodeId = `${showId}:${season}:${epNum}`;
                await this.setLocalWatchedStatus(showId, 'series', true, episodeId, watchedAt);
            }

            await this.upsertLocalWatchedItems(
                episodeNumbers.map((episode) => ({
                    content_id: showImdbId,
                    content_type: 'series' as const,
                    title: showImdbId,
                    season,
                    episode,
                    watched_at: watchedAt.getTime(),
                }))
            );

            return { success: true, syncedToTrakt, count: episodeNumbers.length };
        } catch (error) {
            logger.error('[WatchedService] Failed to mark season as watched:', error);
            return { success: false, syncedToTrakt: false, count: 0 };
        }
    }

    /**
     * Unmark a movie as watched (remove from history)
     */
    public async unmarkMovieAsWatched(
        imdbId: string
    ): Promise<{ success: boolean; syncedToTrakt: boolean }> {
        try {
            logger.log(`[WatchedService] Unmarking movie as watched: ${imdbId}`);

            const isTraktAuth = await this.traktService.isAuthenticated();
            let syncedToTrakt = false;

            if (isTraktAuth) {
                syncedToTrakt = await this.traktService.removeMovieFromHistory(imdbId);
                logger.log(`[WatchedService] Trakt remove result for movie: ${syncedToTrakt}`);
            }

            // Simkl Unmark
            const isSimklAuth = await this.simklService.isAuthenticated();
            if (isSimklAuth) {
                await this.simklService.removeFromHistory({ movies: [{ ids: { imdb: imdbId } }] });
                logger.log(`[WatchedService] Simkl remove request sent for movie`);
            }

            // Remove local progress
            await storageService.removeWatchProgress(imdbId, 'movie');
            await mmkvStorage.removeItem(`watched:movie:${imdbId}`);
            await this.removeLocalWatchedItems([
                { content_id: imdbId, season: null, episode: null },
            ]);

            return { success: true, syncedToTrakt };
        } catch (error) {
            logger.error('[WatchedService] Failed to unmark movie as watched:', error);
            return { success: false, syncedToTrakt: false };
        }
    }

    /**
     * Unmark an episode as watched (remove from history)
     */
    public async unmarkEpisodeAsWatched(
        showImdbId: string,
        showId: string,
        season: number,
        episode: number
    ): Promise<{ success: boolean; syncedToTrakt: boolean }> {
        try {
            logger.log(`[WatchedService] Unmarking episode as watched: ${showImdbId} S${season}E${episode}`);

            const isTraktAuth = await this.traktService.isAuthenticated();
            let syncedToTrakt = false;

            if (isTraktAuth) {
                syncedToTrakt = await this.traktService.removeEpisodeFromHistory(
                    showImdbId,
                    season,
                    episode
                );
                logger.log(`[WatchedService] Trakt remove result for episode: ${syncedToTrakt}`);
            }

            // Simkl Unmark
            const isSimklAuth = await this.simklService.isAuthenticated();
            if (isSimklAuth) {
                await this.simklService.removeFromHistory({
                    shows: [{
                        ids: { imdb: showImdbId },
                        seasons: [{
                            number: season,
                            episodes: [{ number: episode }]
                        }]
                    }]
                });
                logger.log(`[WatchedService] Simkl remove request sent for episode`);
            }

            // Remove local progress
            const episodeId = `${showId}:${season}:${episode}`;
            await storageService.removeWatchProgress(showId, 'series', episodeId);
            await this.removeLocalWatchedItems([
                { content_id: showImdbId, season, episode },
            ]);

            return { success: true, syncedToTrakt };
        } catch (error) {
            logger.error('[WatchedService] Failed to unmark episode as watched:', error);
            return { success: false, syncedToTrakt: false };
        }
    }

    /**
     * Unmark an entire season as watched (remove from history)
     * @param showImdbId - The IMDb ID of the show
     * @param showId - The Stremio ID of the show (for local storage)
     * @param season - Season number
     * @param episodeNumbers - Array of episode numbers in the season
     */
    public async unmarkSeasonAsWatched(
        showImdbId: string,
        showId: string,
        season: number,
        episodeNumbers: number[]
    ): Promise<{ success: boolean; syncedToTrakt: boolean; count: number }> {
        try {
            logger.log(`[WatchedService] Unmarking season ${season} as watched for ${showImdbId}`);

            const isTraktAuth = await this.traktService.isAuthenticated();
            let syncedToTrakt = false;

            if (isTraktAuth) {
                // Remove entire season from Trakt
                syncedToTrakt = await this.traktService.removeSeasonFromHistory(
                    showImdbId,
                    season
                );
                logger.log(`[WatchedService] Trakt season removal result: ${syncedToTrakt}`);
            }

            // Sync to Simkl
            const isSimklAuth = await this.simklService.isAuthenticated();
            if (isSimklAuth) {
                const episodes = episodeNumbers.map(num => ({ number: num }));
                await this.simklService.removeFromHistory({
                    shows: [{
                        ids: { imdb: showImdbId },
                        seasons: [{
                            number: season,
                            episodes: episodes
                        }]
                    }]
                });
                logger.log(`[WatchedService] Simkl season removal request sent`);
            }

            // Remove local progress for each episode in the season
            for (const epNum of episodeNumbers) {
                const episodeId = `${showId}:${season}:${epNum}`;
                await storageService.removeWatchProgress(showId, 'series', episodeId);
            }

            await this.removeLocalWatchedItems(
                episodeNumbers.map((episode) => ({
                    content_id: showImdbId,
                    season,
                    episode,
                }))
            );

            return { success: true, syncedToTrakt, count: episodeNumbers.length };
        } catch (error) {
            logger.error('[WatchedService] Failed to unmark season as watched:', error);
            return { success: false, syncedToTrakt: false, count: 0 };
        }
    }

    /**
     * Check if a movie is marked as watched (locally)
     */
    public async isMovieWatched(imdbId: string): Promise<boolean> {
        try {
            const isAuthed = await this.traktService.isAuthenticated();

            if (isAuthed) {
                const traktWatched =
                    await this.traktService.isMovieWatchedAccurate(imdbId);
                if (traktWatched) return true;
            }

            const local = await mmkvStorage.getItem(`watched:movie:${imdbId}`);
            return local === 'true';
        } catch {
            return false;
        }
    }


    /**
     * Check if an episode is marked as watched (locally)
     */
    public async isEpisodeWatched(
        showId: string,
        season: number,
        episode: number
    ): Promise<boolean> {
        try {
            const isAuthed = await this.traktService.isAuthenticated();

            if (isAuthed) {
                const traktWatched =
                    await this.traktService.isEpisodeWatchedAccurate(
                        showId,
                        season,
                        episode
                    );
                if (traktWatched) return true;
            }

            const episodeId = `${showId}:${season}:${episode}`;
            const progress = await storageService.getWatchProgress(
                showId,
                'series',
                episodeId
            );

            if (!progress) return false;

            const pct = (progress.currentTime / progress.duration) * 100;
            return pct >= 99;
        } catch {
            return false;
        }
    }

    /**
     * Set local watched status by creating a "completed" progress entry
     */
    private async setLocalWatchedStatus(
        id: string,
        type: 'movie' | 'series',
        watched: boolean,
        episodeId?: string,
        watchedAt: Date = new Date()
    ): Promise<void> {
        try {
            if (watched) {
                // Create a "completed" progress entry (100% watched)
                const progress = {
                    currentTime: 1, // Minimal values to indicate completion
                    duration: 1,
                    lastUpdated: watchedAt.getTime(),
                    traktSynced: false, // Will be set to true if Trakt sync succeeded
                    traktProgress: 100,
                };
                await storageService.setWatchProgress(id, type, progress, episodeId, {
                    forceWrite: true,
                    forceNotify: true
                });

                // Also set the legacy watched flag for movies
                if (type === 'movie') {
                    await mmkvStorage.setItem(`watched:${type}:${id}`, 'true');
                }
            } else {
                // Remove progress
                await storageService.removeWatchProgress(id, type, episodeId);
                if (type === 'movie') {
                    await mmkvStorage.removeItem(`watched:${type}:${id}`);
                }
            }
        } catch (error) {
            logger.error('[WatchedService] Error setting local watched status:', error);
        }
    }
}

export const watchedService = WatchedService.getInstance();
