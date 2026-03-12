import i18n from '../i18n';
import { useState, useEffect } from 'react';
import { mdblistService, MDBListRatings } from '../services/mdblistService';
import { logger } from '../utils/logger';
import { isMDBListEnabled } from '../screens/MDBListSettingsScreen';

export const useMDBListRatings = (imdbId: string, mediaType: 'movie' | 'show') => {
  const [ratings, setRatings] = useState<MDBListRatings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRatings = async () => {
      if (!imdbId) {
        logger.warn('[useMDBListRatings] No IMDB ID provided');
        return;
      }
      
      // Check if MDBList is enabled before proceeding
      const enabled = await isMDBListEnabled();
      if (!enabled) {
        logger.log('[useMDBListRatings] MDBList is disabled, not fetching ratings');
        setRatings(null);
        setLoading(false);
        return;
      }
      
      logger.log(`[useMDBListRatings] Starting to fetch ratings for ${mediaType}:`, imdbId);
      setLoading(true);
      setError(null);
      
      try {
        const data = await mdblistService.getRatings(imdbId, mediaType);
        logger.log('[useMDBListRatings] Received ratings:', data);
        setRatings(data);
      } catch (err) {
        const errorMessage = i18n.t('errors.failed_to_fetch_ratings');
        logger.error('[useMDBListRatings] Error:', err);
        setError(errorMessage);
      } finally {
        setLoading(false);
        logger.log('[useMDBListRatings] Finished fetching ratings');
      }
    };

    fetchRatings();
  }, [imdbId, mediaType]);

  return { ratings, loading, error };
}; 