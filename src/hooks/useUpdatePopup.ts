import i18n from '../i18n';
import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import { toastService } from '../services/toastService';
import UpdateService, { UpdateInfo } from '../services/updateService';
import { mmkvStorage } from '../services/mmkvStorage';

interface UseUpdatePopupReturn {
  showUpdatePopup: boolean;
  updateInfo: UpdateInfo;
  isInstalling: boolean;
  checkForUpdates: () => Promise<void>;
  handleUpdateNow: () => Promise<void>;
  handleUpdateLater: () => void;
  handleDismiss: () => void;
}

const UPDATE_POPUP_STORAGE_KEY = '@update_popup_dismissed';
const UPDATE_LATER_STORAGE_KEY = '@update_later_timestamp';
const UPDATE_LAST_CHECK_TS_KEY = '@update_last_check_ts';
const UPDATE_BADGE_KEY = '@update_badge_pending';

export const useUpdatePopup = (): UseUpdatePopupReturn => {
  const [showUpdatePopup, setShowUpdatePopup] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ isAvailable: false });
  const [isInstalling, setIsInstalling] = useState(false);
  const [hasCheckedOnStartup, setHasCheckedOnStartup] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);

  const checkForUpdates = useCallback(async (forceCheck = false) => {
    try {
      // Check if OTA update alerts are disabled
      const otaAlertsEnabled = await mmkvStorage.getItem('@ota_updates_alerts_enabled');
      if (otaAlertsEnabled === 'false' && !forceCheck) {
        return; // OTA alerts are disabled by user
      }

      // Check if user has dismissed the popup for this version
      const dismissedVersion = await mmkvStorage.getItem(UPDATE_POPUP_STORAGE_KEY);
      const currentVersion = updateInfo.manifest?.id;

      if (dismissedVersion === currentVersion && !forceCheck) {
        return; // User already dismissed this version
      }

      // Check if user chose "later" recently (within 6 hours)
      const updateLaterTimestamp = await mmkvStorage.getItem(UPDATE_LATER_STORAGE_KEY);
      if (updateLaterTimestamp && !forceCheck) {
        const laterTime = parseInt(updateLaterTimestamp);
        const now = Date.now();
        const sixHours = 6 * 60 * 60 * 1000; // Reduced from 24 hours

        if (now - laterTime < sixHours) {
          return; // User chose "later" recently
        }
      }

      const info = await UpdateService.checkForUpdates();
      setUpdateInfo(info);

      if (info.isAvailable) {
        // Show popup (Android checks are handled earlier in the function)
        setShowUpdatePopup(true);
      }
    } catch (error) {
      if (__DEV__) console.error('Error checking for updates:', error);
      // Don't show popup on error, just log it
    }
  }, [updateInfo.manifest?.id, isAppReady]);

  const handleUpdateNow = useCallback(async () => {
    try {
      setIsInstalling(true);
      setShowUpdatePopup(false);

      const success = await UpdateService.downloadAndInstallUpdate();

      if (success) {
        // Update installed successfully - no restart alert needed
        // The app will automatically reload with the new version
        console.log('Update installed successfully');
      } else {
        toastService.error(i18n.t('errors.installation_failed'), i18n.t('errors.installation_failed_desc'));
        // Show popup again after failed installation
        setShowUpdatePopup(true);
      }
    } catch (error) {
      if (__DEV__) console.error('Error installing update:', error);
      toastService.error(i18n.t('errors.installation_error'), i18n.t('errors.installation_error_desc'));
      // Show popup again after error
      setShowUpdatePopup(true);
    } finally {
      setIsInstalling(false);
    }
  }, []);

  const handleUpdateLater = useCallback(async () => {
    try {
      // Store timestamp when user chose "later"
      await mmkvStorage.setItem(UPDATE_LATER_STORAGE_KEY, Date.now().toString());
      setShowUpdatePopup(false);
    } catch (error) {
      if (__DEV__) console.error('Error storing update later preference:', error);
      setShowUpdatePopup(false);
    }
  }, []);

  const handleDismiss = useCallback(async () => {
    try {
      // Store the current version ID so we don't show popup again for this version
      const currentVersion = updateInfo.manifest?.id;
      if (currentVersion) {
        await mmkvStorage.setItem(UPDATE_POPUP_STORAGE_KEY, currentVersion);
      }
      setShowUpdatePopup(false);
    } catch (error) {
      if (__DEV__) console.error('Error storing dismiss preference:', error);
      setShowUpdatePopup(false);
    }
  }, [updateInfo.manifest?.id]);

  // Handle startup update check results
  useEffect(() => {

    const handleStartupUpdateCheck = async (updateInfo: UpdateInfo) => {
      console.log('UpdatePopup: Received startup update check result', updateInfo);
      setUpdateInfo(updateInfo);
      setHasCheckedOnStartup(true);

      if (updateInfo.isAvailable) {
        // Check setting before showing
        try {
          const otaAlertsEnabled = await mmkvStorage.getItem('@ota_updates_alerts_enabled');
          if (otaAlertsEnabled === 'false') {
            console.log('OTA alerts disabled, suppressing popup');
            return;
          }
          setShowUpdatePopup(true);
        } catch {
          setShowUpdatePopup(true);
        }
      }
    };

    // Register callback for startup update check
    UpdateService.onUpdateCheck(handleStartupUpdateCheck);

    // Cleanup callback on unmount
    return () => {
      UpdateService.offUpdateCheck(handleStartupUpdateCheck);
    };
  }, []);

  // Mark app as ready after a delay (Android safety)
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAppReady(true);
    }, Platform.OS === 'android' ? 3000 : 1000);

    return () => clearTimeout(timer);
  }, []);

  // Show popup when app becomes ready on Android (if update is available)
  useEffect(() => {
    if (Platform.OS === 'android' && isAppReady && updateInfo.isAvailable && !showUpdatePopup) {
      // Check if user hasn't dismissed this version
      (async () => {
        try {
          const otaAlertsEnabled = await mmkvStorage.getItem('@ota_updates_alerts_enabled');
          if (otaAlertsEnabled === 'false') return;

          const dismissedVersion = await mmkvStorage.getItem(UPDATE_POPUP_STORAGE_KEY);
          const currentVersion = updateInfo.manifest?.id;

          if (dismissedVersion !== currentVersion) {
            setShowUpdatePopup(true);
          }
        } catch (error) {
          // If we can't check, show the popup anyway
          setShowUpdatePopup(true);
        }
      })();
    }
  }, [isAppReady, updateInfo.isAvailable, updateInfo.manifest?.id, showUpdatePopup]);

  // Auto-check for updates when hook is first used (fallback if startup check fails)
  useEffect(() => {
    if (hasCheckedOnStartup) {
      return; // Already checked on startup
    }


    // Add a small delay to ensure the app is fully loaded
    const timer = setTimeout(() => {
      (async () => {
        try {
          const lastCheckTs = await mmkvStorage.getItem(UPDATE_LAST_CHECK_TS_KEY);
          const last = lastCheckTs ? parseInt(lastCheckTs, 10) : 0;
          const now = Date.now();
          const sixHours = 6 * 60 * 60 * 1000; // Reduced from 24 hours
          if (now - last < sixHours) {
            return; // Throttle: only auto-check once per 6h
          }
          await checkForUpdates();
          await mmkvStorage.setItem(UPDATE_LAST_CHECK_TS_KEY, String(now));
        } catch {
          // ignore
        }
      })();
    }, 3000); // Increased delay to 3 seconds to give startup check time

    return () => clearTimeout(timer);
  }, [checkForUpdates, hasCheckedOnStartup]);

  return {
    showUpdatePopup,
    updateInfo,
    isInstalling,
    checkForUpdates,
    handleUpdateNow,
    handleUpdateLater,
    handleDismiss,
  };
};
