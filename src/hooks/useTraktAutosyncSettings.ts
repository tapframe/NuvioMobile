import i18n from '../i18n';
import { useState, useEffect, useCallback } from 'react';
import { mmkvStorage } from '../services/mmkvStorage';
import { useTraktIntegration } from './useTraktIntegration';
import { logger } from '../utils/logger';

const TRAKT_AUTOSYNC_ENABLED_KEY = '@trakt_autosync_enabled';
const TRAKT_SYNC_FREQUENCY_KEY = '@trakt_sync_frequency';
const TRAKT_COMPLETION_THRESHOLD_KEY = '@trakt_completion_threshold';

export interface TraktAutosyncSettings {
  enabled: boolean;
  syncFrequency: number; // in milliseconds
  completionThreshold: number; // percentage (80-95)
}

const DEFAULT_SETTINGS: TraktAutosyncSettings = {
  enabled: true,
  syncFrequency: 60000, // 60 seconds
  completionThreshold: 95, // 95%
};

export function useTraktAutosyncSettings() {
  const { 
    isAuthenticated, 
    syncAllProgress, 
    fetchAndMergeTraktProgress 
  } = useTraktIntegration();
  
  const [settings, setSettings] = useState<TraktAutosyncSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Load settings from storage
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const [enabled, frequency, threshold] = await Promise.all([
        mmkvStorage.getItem(TRAKT_AUTOSYNC_ENABLED_KEY),
        mmkvStorage.getItem(TRAKT_SYNC_FREQUENCY_KEY),
        mmkvStorage.getItem(TRAKT_COMPLETION_THRESHOLD_KEY)
      ]);

      setSettings({
        enabled: enabled !== null ? JSON.parse(enabled) : DEFAULT_SETTINGS.enabled,
        syncFrequency: frequency ? parseInt(frequency, 10) : DEFAULT_SETTINGS.syncFrequency,
        completionThreshold: threshold ? parseInt(threshold, 10) : DEFAULT_SETTINGS.completionThreshold,
      });
    } catch (error) {
      logger.error('[useTraktAutosyncSettings] Error loading settings:', error);
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save individual setting
  const saveSetting = useCallback(async (key: string, value: any) => {
    try {
      await mmkvStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      logger.error('[useTraktAutosyncSettings] Error saving setting:', error);
    }
  }, []);

  // Update autosync enabled status
  const setAutosyncEnabled = useCallback(async (enabled: boolean) => {
    try {
      await saveSetting(TRAKT_AUTOSYNC_ENABLED_KEY, enabled);
      setSettings(prev => ({ ...prev, enabled }));
      logger.log(`[useTraktAutosyncSettings] Autosync ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      logger.error('[useTraktAutosyncSettings] Error updating autosync enabled:', error);
    }
  }, [saveSetting]);

  // Update sync frequency
  const setSyncFrequency = useCallback(async (frequency: number) => {
    try {
      await saveSetting(TRAKT_SYNC_FREQUENCY_KEY, frequency);
      setSettings(prev => ({ ...prev, syncFrequency: frequency }));
      logger.log(`[useTraktAutosyncSettings] Sync frequency updated to ${frequency}ms`);
    } catch (error) {
      logger.error('[useTraktAutosyncSettings] Error updating sync frequency:', error);
    }
  }, [saveSetting]);

  // Update completion threshold
  const setCompletionThreshold = useCallback(async (threshold: number) => {
    try {
      await saveSetting(TRAKT_COMPLETION_THRESHOLD_KEY, threshold);
      setSettings(prev => ({ ...prev, completionThreshold: threshold }));
      logger.log(`[useTraktAutosyncSettings] Completion threshold updated to ${threshold}%`);
    } catch (error) {
      logger.error('[useTraktAutosyncSettings] Error updating completion threshold:', error);
    }
  }, [saveSetting]);

  // Manual sync all progress
  const performManualSync = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) {
      logger.warn('[useTraktAutosyncSettings] Cannot sync: not authenticated');
      return false;
    }

    try {
      setIsSyncing(true);
      logger.log('[useTraktAutosyncSettings] Starting manual sync...');
      
      // First, fetch and merge Trakt progress with local
      const fetchSuccess = await fetchAndMergeTraktProgress();
      
      // Then, sync any unsynced local progress to Trakt
      const uploadSuccess = await syncAllProgress();
      
      // Consider sync successful if either:
      // 1. We successfully fetched from Trakt (main purpose of manual sync)
      // 2. We successfully uploaded local progress to Trakt
      // 3. Everything was already in sync (uploadSuccess = false is OK if fetchSuccess = true)
      const overallSuccess = fetchSuccess || uploadSuccess;
      
      logger.log(`[useTraktAutosyncSettings] Manual sync ${overallSuccess ? 'completed' : 'failed'}`);
      return overallSuccess;
    } catch (error) {
      logger.error('[useTraktAutosyncSettings] Error during manual sync:', error);
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated, syncAllProgress, fetchAndMergeTraktProgress]);

  // Get formatted sync frequency options
  const getSyncFrequencyOptions = useCallback(() => [
    { label: i18n.t('settings.every_30_seconds'), value: 30000 },
    { label: i18n.t('settings.every_minute'), value: 60000 },
    { label: i18n.t('settings.every_2_minutes'), value: 120000 },
    { label: i18n.t('settings.every_5_minutes'), value: 300000 },
  ], []);

  // Get formatted completion threshold options
  const getCompletionThresholdOptions = useCallback(() => [
    { label: '80% complete', value: 80 },
    { label: '85% complete', value: 85 },
    { label: '90% complete', value: 90 },
    { label: '95% complete', value: 95 },
  ], []);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return {
    settings,
    isLoading,
    isSyncing,
    isAuthenticated,
    setAutosyncEnabled,
    setSyncFrequency,
    setCompletionThreshold,
    performManualSync,
    getSyncFrequencyOptions,
    getCompletionThresholdOptions,
    loadSettings
  };
} 