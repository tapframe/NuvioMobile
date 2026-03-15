import { useState, useEffect, useRef } from 'react';
import { introService, SkipInterval } from '../../../services/introService';
import { logger } from '../../../utils/logger';

interface UseSkipSegmentsProps {
    imdbId?: string;
    type?: string;
    season?: number;
    episode?: number;
    malId?: string;
    kitsuId?: string;
    releaseDate?: string;
    tmdbId?: number;
    enabled: boolean;
}

export const useSkipSegments = ({
    imdbId,
    type,
    season,
    episode,
    malId,
    kitsuId,
    releaseDate,
    tmdbId,
    enabled
}: UseSkipSegmentsProps) => {
    const [segments, setSegments] = useState<SkipInterval[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const fetchedRef = useRef(false);
    const lastKeyRef = useRef('');

    useEffect(() => {
        const key = `${imdbId}-${season}-${episode}-${malId}-${kitsuId}-${releaseDate}-${tmdbId}`;

        if (!enabled || type !== 'series' || (!imdbId && !malId && !kitsuId && !tmdbId) || !season || !episode) {
            setSegments([]);
            setIsLoading(false);
            fetchedRef.current = false;
            lastKeyRef.current = '';
            return;
        }

        if (lastKeyRef.current === key && fetchedRef.current) {
            return;
        }

        // Clear stale intervals while resolving a new episode/key.
        if (lastKeyRef.current !== key) {
            setSegments([]);
            fetchedRef.current = false;
        }

        lastKeyRef.current = key;
        setIsLoading(true);
        let cancelled = false;

        const fetchSegments = async () => {
            try {
                const intervals = await introService.getSkipTimes(imdbId, season, episode, malId, kitsuId, releaseDate, tmdbId);

                // Ignore stale responses from old requests.
                if (cancelled || lastKeyRef.current !== key) return;
                setSegments(intervals);
                fetchedRef.current = true;
            } catch (error) {
                if (cancelled || lastKeyRef.current !== key) return;
                logger.error('[useSkipSegments] Error fetching skip data:', error);
                setSegments([]);
                // Keep this key retryable on transient failures.
                fetchedRef.current = false;
            } finally {
                if (cancelled || lastKeyRef.current !== key) return;
                setIsLoading(false);
            }
        };

        fetchSegments();

        return () => {
            cancelled = true;
        };
    }, [imdbId, type, season, episode, malId, kitsuId, releaseDate, tmdbId, enabled]);

    const getActiveSegment = (currentTime: number) => {
        return segments.find(
            s => currentTime >= s.startTime && currentTime < (s.endTime - 0.5)
        );
    };

    const outroSegment = segments
        .filter(s => ['ed', 'outro', 'mixed-ed'].includes(s.type))
        .reduce<SkipInterval | null>((latest, interval) => {
            if (!latest || interval.endTime > latest.endTime) return interval;
            return latest;
        }, null);

    return {
        segments,
        getActiveSegment,
        outroSegment,
        isLoading
    };
};
