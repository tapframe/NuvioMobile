import axios from 'axios';
import { logger } from '../utils/logger';
import { tmdbService } from './tmdbService';

/**
 * IntroDB API service for fetching TV show intro timestamps
 * API Documentation: https://api.introdb.app
 */

const INTRODB_API_URL = process.env.EXPO_PUBLIC_INTRODB_API_URL;
const ANISKIP_API_URL = 'https://api.aniskip.com/v2';
const KITSU_API_URL = 'https://kitsu.io/api/edge';
const ARM_IMDB_URL = 'https://arm.haglund.dev/api/v2/imdb';

export type SkipType = 'op' | 'ed' | 'recap' | 'intro' | 'outro' | 'mixed-op' | 'mixed-ed';

export interface SkipInterval {
    startTime: number;
    endTime: number;
    type: SkipType;
    provider: 'introdb' | 'aniskip';
    skipId?: string;
}

export interface IntroTimestamps {
    imdb_id: string;
    season: number;
    episode: number;
    intro?: {
        start_sec: number;
        end_sec: number;
        confidence: number;
    };
    recap?: {
        start_sec: number;
        end_sec: number;
        confidence: number;
    };
    outro?: {
        start_sec: number;
        end_sec: number;
        confidence: number;
    };
}

async function getMalIdFromArm(imdbId: string): Promise<string | null> {
    try {
        const response = await axios.get(ARM_IMDB_URL, {
            params: {
                id: imdbId,
                include: 'myanimelist'
            }
        });
        
        // ARM returns an array of matches (e.g. for different seasons)
        // We typically take the first one or try to match logic if possible
        if (Array.isArray(response.data) && response.data.length > 0) {
            const result = response.data[0];
            if (result && result.myanimelist) {
                logger.log(`[IntroService] Found MAL ID via ARM: ${result.myanimelist}`);
                return result.myanimelist.toString();
            }
        }
    } catch (error) {
        // Silent fail as this is just one of the resolution methods
        // logger.warn('[IntroService] Failed to fetch MAL ID from ARM', error);
    }
    return null;
}

async function getMalIdFromKitsu(kitsuId: string): Promise<string | null> {
    try {
        const response = await axios.get(`${KITSU_API_URL}/anime/${kitsuId}/mappings`);
        const data = response.data;
        if (data && data.data) {
            const malMapping = data.data.find((m: any) => m.attributes.externalSite === 'myanimelist/anime');
            if (malMapping) {
                return malMapping.attributes.externalId;
            }
        }
    } catch (error) {
        logger.warn('[IntroService] Failed to fetch MAL ID from Kitsu:', error);
    }
    return null;
}

async function getMalIdFromImdb(imdbId: string): Promise<string | null> {
    try {
        // 1. Try direct Kitsu mapping (IMDb -> Kitsu)
        const kitsuDirectResponse = await axios.get(`${KITSU_API_URL}/mappings`, {
            params: {
                'filter[external_site]': 'imdb',
                'filter[external_id]': imdbId,
                'include': 'item'
            }
        });

        if (kitsuDirectResponse.data?.data?.length > 0) {
            const kitsuId = kitsuDirectResponse.data.data[0].relationships?.item?.data?.id;
            if (kitsuId) {
                return await getMalIdFromKitsu(kitsuId);
            }
        }

        // 2. Try TMDB -> TVDB -> Kitsu path (Robust for Cinemeta users)
        const tmdbId = await tmdbService.findTMDBIdByIMDB(imdbId);
        
        if (tmdbId) {
            const extIds = await tmdbService.getShowExternalIds(tmdbId);
            const tvdbId = extIds?.tvdb_id;
            
            if (tvdbId) {
                // Search Kitsu for TVDB mapping
                const kitsuTvdbResponse = await axios.get(`${KITSU_API_URL}/mappings`, {
                    params: {
                        'filter[external_site]': 'thetvdb/series',
                        'filter[external_id]': tvdbId.toString(),
                        'include': 'item'
                    }
                });

                if (kitsuTvdbResponse.data?.data?.length > 0) {
                    const kitsuId = kitsuTvdbResponse.data.data[0].relationships?.item?.data?.id;
                    if (kitsuId) {
                        logger.log(`[IntroService] Resolved Kitsu ID ${kitsuId} from TVDB ID ${tvdbId} (via IMDb ${imdbId})`);
                        return await getMalIdFromKitsu(kitsuId);
                    }
                }
            }
        }
    } catch (error) {
        // Silent fail - it might just not be an anime or API limit reached
    }
    return null;
}

async function fetchFromAniSkip(malId: string, episode: number): Promise<SkipInterval[]> {
    try {
        // Fetch OP, ED, and Recap
        // AniSkip expects repeated 'types' parameters without brackets: ?types=op&types=ed...
        // episodeLength=0 is required for validation
        const types = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed'];
        const queryParams = types.map(t => `types=${t}`).join('&');
        const url = `${ANISKIP_API_URL}/skip-times/${malId}/${episode}?${queryParams}&episodeLength=0`;
        
        const response = await axios.get(url);
        
        if (response.data.found && response.data.results) {
            return response.data.results.map((res: any) => ({
                startTime: res.interval.startTime,
                endTime: res.interval.endTime,
                type: res.skipType, 
                provider: 'aniskip',
                skipId: res.skipId
            }));
        }
    } catch (error) {
         if (axios.isAxiosError(error) && error.response?.status !== 404) {
             logger.error('[IntroService] Error fetching AniSkip:', error);
         }
    }
    return [];
}

async function fetchFromIntroDb(imdbId: string, season: number, episode: number): Promise<SkipInterval[]> {
    try {
        const response = await axios.get<IntroTimestamps>(`${INTRODB_API_URL}/segments`, {
            params: {
                imdb_id: imdbId,
                season,
                episode,
            },
            timeout: 5000,
        });

        const intervals: SkipInterval[] = [];

        if (response.data.intro) {
            intervals.push({
                startTime: response.data.intro.start_sec,
                endTime: response.data.intro.end_sec,
                type: 'intro',
                provider: 'introdb'
            });
        }

        if (response.data.recap) {
            intervals.push({
                startTime: response.data.recap.start_sec,
                endTime: response.data.recap.end_sec,
                type: 'recap',
                provider: 'introdb'
            });
        }

        if (response.data.outro) {
            intervals.push({
                startTime: response.data.outro.start_sec,
                endTime: response.data.outro.end_sec,
                type: 'outro',
                provider: 'introdb'
            });
        }

        if (intervals.length > 0) {
            logger.log(`[IntroService] Found ${intervals.length} segments for ${imdbId} S${season}E${episode}`);
        }

        return intervals;
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            // No intro data available for this episode - this is expected
            logger.log(`[IntroService] No segment data for ${imdbId} S${season}E${episode}`);
            return [];
        }

        logger.error('[IntroService] Error fetching segments from IntroDB:', error?.message || error);
        return [];
    }
}

/**
 * Verifies an IntroDB API key
 */
export async function verifyApiKey(apiKey: string): Promise<boolean> {
    try {
        if (!apiKey) return false;

        const response = await axios.post(`${INTRODB_API_URL}/submit`, {}, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000,
            validateStatus: (status) => true // Handle status codes manually
        });

        // 400 means Auth passed but payload was empty/invalid -> Key is Valid
        if (response.status === 400) return true;
        
        // 200/201 would also mean valid (though unexpected with empty body)
        if (response.status === 200 || response.status === 201) return true;

        // Explicitly handle auth failures
        if (response.status === 401 || response.status === 403) return false;

        // Log warning for unexpected states (500, 429, etc.) but fail safe
        logger.warn(`[IntroService] Verification received unexpected status: ${response.status}`);
        return false;
    } catch (error: any) {
        logger.log('[IntroService] API Key verification failed:', error.message);
        return false;
    }
}

/**
 * Submits an intro timestamp to IntroDB
 */
export async function submitIntro(
    apiKey: string,
    imdbId: string,
    season: number,
    episode: number,
    startTime: number, // in seconds
    endTime: number,   // in seconds
    segmentType: SkipType = 'intro'
): Promise<boolean> {
    try {
        if (!apiKey) {
            logger.warn('[IntroService] Missing API key for submission');
            return false;
        }

        const response = await axios.post(`${INTRODB_API_URL}/submit`, {
            imdb_id: imdbId,
            segment_type: segmentType === 'op' ? 'intro' : (segmentType === 'ed' ? 'outro' : segmentType),
            season,
            episode,
            start_sec: startTime,
            end_sec: endTime,
            // Keep start_ms/end_ms for backward compatibility if the server still expects it
            start_ms: Math.round(startTime * 1000),
            end_ms: Math.round(endTime * 1000),
        }, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000,
        });

        return response.status === 200 || response.status === 201;
    } catch (error: any) {
        logger.error('[IntroService] Error submitting intro:', error?.response?.data || error?.message || error);
        return false;
    }
}

/**
 * Fetches skip intervals (intro, outro, recap) from available providers
 */
export async function getSkipTimes(
    imdbId: string | undefined,
    season: number,
    episode: number,
    malId?: string,
    kitsuId?: string
): Promise<SkipInterval[]> {
    // 1. Try IntroDB (TV Shows) first
    if (imdbId) {
        const introDbIntervals = await fetchFromIntroDb(imdbId, season, episode);
        if (introDbIntervals.length > 0) {
            return introDbIntervals;
        }
    }

    // 2. Try AniSkip (Anime) if we have MAL ID or Kitsu ID
    let finalMalId = malId;
    
    // If we have Kitsu ID but no MAL ID, try to resolve it
    if (!finalMalId && kitsuId) {
        logger.log(`[IntroService] Resolving MAL ID from Kitsu ID: ${kitsuId}`);
        finalMalId = await getMalIdFromKitsu(kitsuId) || undefined;
    }

    // If we still don't have MAL ID but have IMDb ID (e.g. Cinemeta), try to resolve it
    if (!finalMalId && imdbId) {
        // Priority 1: ARM API (Fastest)
        logger.log(`[IntroService] Attempting to resolve MAL ID via ARM for: ${imdbId}`);
        finalMalId = await getMalIdFromArm(imdbId) || undefined;

        // Priority 2: Kitsu/TMDB Chain (Fallback)
        if (!finalMalId) {
            logger.log(`[IntroService] ARM failed, falling back to Kitsu/TMDB chain for: ${imdbId}`);
            finalMalId = await getMalIdFromImdb(imdbId) || undefined;
        }
    }

    if (finalMalId) {
        logger.log(`[IntroService] Fetching AniSkip for MAL ID: ${finalMalId} Ep: ${episode}`);
        const aniSkipIntervals = await fetchFromAniSkip(finalMalId, episode);
        if (aniSkipIntervals.length > 0) {
            logger.log(`[IntroService] Found ${aniSkipIntervals.length} skip intervals from AniSkip`);
            return aniSkipIntervals;
        }
    }

    return [];
}

/**
 * Legacy function for backward compatibility
 * Fetches intro timestamps for a TV show episode
 */
export async function getIntroTimestamps(
    imdbId: string,
    season: number,
    episode: number
): Promise<any | null> {
    const intervals = await fetchFromIntroDb(imdbId, season, episode);
    const intro = intervals.find(i => i.type === 'intro');
    if (intro) {
        return {
            imdb_id: imdbId,
            season,
            episode,
            start_sec: intro.startTime,
            end_sec: intro.endTime,
            start_ms: intro.startTime * 1000,
            end_ms: intro.endTime * 1000,
            confidence: 1.0,
            intro: {
                start_sec: intro.startTime,
                end_sec: intro.endTime,
                confidence: 1.0
            }
        };
    }
    return null;
}

export const introService = {
    getIntroTimestamps,
    getSkipTimes,
    submitIntro,
    verifyApiKey
};

export default introService;
