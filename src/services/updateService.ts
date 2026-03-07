import i18n from '../i18n';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

export interface UpdateInfo {
  isAvailable: boolean;
  manifest?: Partial<Updates.Manifest>;
  isNew?: boolean;
  isEmbeddedLaunch?: boolean;
}

export type UpdateCheckCallback = (updateInfo: UpdateInfo) => void;

export class UpdateService {
  private static instance: UpdateService;
  private updateCheckInterval: NodeJS.Timeout | null = null;
  // Removed automatic periodic checks - only check on app start and manual trigger
  private logs: string[] = [];
  private readonly MAX_LOGS = 100; // Keep last 100 logs
  private updateCheckCallbacks: UpdateCheckCallback[] = [];

  private constructor() { }

  public static getInstance(): UpdateService {
    if (!UpdateService.instance) {
      UpdateService.instance = new UpdateService();
    }
    return UpdateService.instance;
  }

  /**
   * Add a log entry with timestamp - always log to console for adb logcat visibility
   */
  private addLog(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] UpdateService: ${message}`;

    // Keep logs for debugging (limited to prevent memory issues)
    if (this.logs.length >= this.MAX_LOGS) {
      this.logs.shift(); // Remove oldest log
    }
    this.logs.push(logEntry);

    // Always log to console for visibility
    console.log(logEntry);
  }

  /**
   * Get all logs
   */
  public getLogs(): string[] {
    return [...this.logs];
  }

  /**
   * Clear all logs
   */
  public clearLogs(): void {
    this.addLog('Clearing all logs', 'INFO');
    this.logs = [];
  }

  /**
   * Add a test log entry (useful for debugging)
   */
  public addTestLog(message: string): void {
    this.addLog(`TEST: ${message}`, 'INFO');
  }

  /**
   * Register a callback to be notified when update checks complete
   */
  public onUpdateCheck(callback: UpdateCheckCallback): void {
    this.updateCheckCallbacks.push(callback);
    this.addLog(`Registered update check callback (${this.updateCheckCallbacks.length} total)`, 'INFO');
  }

  /**
   * Unregister an update check callback
   */
  public offUpdateCheck(callback: UpdateCheckCallback): void {
    const index = this.updateCheckCallbacks.indexOf(callback);
    if (index > -1) {
      this.updateCheckCallbacks.splice(index, 1);
      this.addLog(`Unregistered update check callback (${this.updateCheckCallbacks.length} remaining)`, 'INFO');
    }
  }

  /**
   * Notify all registered callbacks about an update check result
   */
  private notifyUpdateCheckCallbacks(updateInfo: UpdateInfo): void {
    this.addLog(`Notifying ${this.updateCheckCallbacks.length} callback(s) about update check result`, 'INFO');
    this.updateCheckCallbacks.forEach(callback => {
      try {
        callback(updateInfo);
      } catch (error) {
        this.addLog(`Callback notification failed: ${error instanceof Error ? error.message : String(error)}`, 'ERROR');
      }
    });
  }

  /**
   * Test the update URL connectivity
   */
  public async testUpdateConnectivity(): Promise<boolean> {
    this.addLog('Testing update server connectivity...', 'INFO');

    try {
      const updateUrl = this.getUpdateUrl();
      this.addLog(`Testing URL: ${updateUrl}`, 'INFO');

      const response = await fetch(updateUrl, {
        method: 'GET',
        headers: {
          'expo-runtime-version': Updates.runtimeVersion || '0.6.0-beta.8',
          'expo-platform': Platform.OS,
          'expo-protocol-version': '1',
          'expo-api-version': '1',
        },
      });

      this.addLog(`Response status: ${response.status}`, 'INFO');
      this.addLog(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`, 'INFO');

      if (response.ok) {
        this.addLog('Update server is reachable', 'INFO');

        // Try to get the response body to see what we're getting
        try {
          const responseText = await response.text();
          this.addLog(`Response body preview: ${responseText.substring(0, 500)}...`, 'INFO');
        } catch (bodyError) {
          this.addLog(`Could not read response body: ${bodyError instanceof Error ? bodyError.message : String(bodyError)}`, 'WARN');
        }

        return true;
      } else {
        this.addLog(`Update server returned error: ${response.status} ${response.statusText}`, 'ERROR');
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`Connectivity test failed: ${errorMessage}`, 'ERROR');
      return false;
    }
  }

  /**
   * Test individual asset URL accessibility
   */
  public async testAssetUrl(assetUrl: string): Promise<boolean> {
    this.addLog(`Testing asset URL: ${assetUrl}`, 'INFO');

    try {
      const response = await fetch(assetUrl, {
        method: 'HEAD', // Use HEAD to avoid downloading the full asset
      });

      this.addLog(`Asset response status: ${response.status}`, 'INFO');
      this.addLog(`Asset response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`, 'INFO');

      if (response.ok) {
        this.addLog('Asset URL is accessible', 'INFO');
        return true;
      } else {
        this.addLog(`Asset URL returned error: ${response.status} ${response.statusText}`, 'ERROR');
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`Asset URL test failed: ${errorMessage}`, 'ERROR');
      return false;
    }
  }

  /**
   * Test all asset URLs from the latest update manifest
   */
  public async testAllAssetUrls(): Promise<void> {
    this.addLog('Testing all asset URLs from latest update...', 'INFO');

    try {
      const update = await Updates.checkForUpdateAsync();

      if (!update.isAvailable || !update.manifest) {
        this.addLog('No update available or no manifest found', 'WARN');
        return;
      }

      this.addLog(`Found update with ${update.manifest.assets?.length || 0} assets`, 'INFO');

      if (update.manifest.assets && update.manifest.assets.length > 0) {
        for (let i = 0; i < update.manifest.assets.length; i++) {
          const asset = update.manifest.assets[i];
          if (asset.url) {
            this.addLog(`Testing asset ${i + 1}/${update.manifest.assets.length}: ${asset.key || 'unknown'}`, 'INFO');
            const isAccessible = await this.testAssetUrl(asset.url);
            if (!isAccessible) {
              this.addLog(`Asset ${i + 1} is not accessible: ${asset.url}`, 'ERROR');
            }
          } else {
            this.addLog(`Asset ${i + 1} has no URL`, 'ERROR');
          }
        }
      }

      // Test launch asset (check if it exists in the manifest)
      const manifest = update.manifest as any; // Type assertion to access launchAsset
      if (manifest.launchAsset?.url) {
        this.addLog('Testing launch asset...', 'INFO');
        const isAccessible = await this.testAssetUrl(manifest.launchAsset.url);
        if (!isAccessible) {
          this.addLog(`Launch asset is not accessible: ${manifest.launchAsset.url}`, 'ERROR');
        }
      } else {
        this.addLog('No launch asset URL found', 'ERROR');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`Failed to test asset URLs: ${errorMessage}`, 'ERROR');
    }
  }

  /**
   * Initialize the update service
   */
  public async initialize(): Promise<void> {
    this.addLog('Initializing UpdateService...', 'INFO');
    this.addLog(`Environment: ${__DEV__ ? 'Development' : 'Production'}`, 'INFO');
    this.addLog(`Platform: ${Platform.OS}`, 'INFO');
    this.addLog(`Updates enabled: ${Updates.isEnabled}`, 'INFO');
    this.addLog(`Runtime version: ${Updates.runtimeVersion || 'unknown'}`, 'INFO');
    this.addLog(`Update URL: ${this.getUpdateUrl()}`, 'INFO');

    try {
      // Check if we're running in a development environment
      if (__DEV__) {
        this.addLog('Running in development mode', 'WARN');
        this.addLog('UpdateService initialization completed (dev mode)', 'INFO');
        return;
      }

      // Check if updates are enabled
      if (!Updates.isEnabled) {
        this.addLog('Updates are not enabled in this environment', 'WARN');
        this.addLog('UpdateService initialization completed (updates disabled)', 'INFO');
        return;
      }

      this.addLog('Updates are enabled, performing initial update check...', 'INFO');

      // Perform an initial update check on app startup (non-blocking)
      // Use setTimeout to defer the check and prevent blocking the main thread
      setTimeout(async () => {
        try {
          this.addLog('Starting deferred update check...', 'INFO');
          const updateInfo = await this.checkForUpdates();
          this.addLog(`Initial update check completed - Updates available: ${updateInfo.isAvailable}`, 'INFO');

          if (updateInfo.isAvailable) {
            this.addLog('Update available! The popup will be shown to the user.', 'INFO');
          } else {
            this.addLog('No updates available at startup', 'INFO');
          }

          // Notify registered callbacks about the update check result
          this.notifyUpdateCheckCallbacks(updateInfo);
        } catch (checkError) {
          this.addLog(`Initial update check failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`, 'ERROR');

          // Notify callbacks about the failed check
          this.notifyUpdateCheckCallbacks({ isAvailable: false });

          // Don't fail initialization if update check fails
        }
      }, 1000); // Defer by 1 second to let the app fully initialize

      this.addLog('UpdateService initialization completed successfully', 'INFO');
    } catch (error) {
      this.addLog(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`, 'ERROR');
      console.error('Update service initialization failed:', error);
    }
  }

  /**
   * Check for available updates
   */
  public async checkForUpdates(): Promise<UpdateInfo> {
    this.addLog('Starting update check...', 'INFO');
    this.addLog(`Update URL: ${this.getUpdateUrl()}`, 'INFO');
    this.addLog(`Runtime version: ${Updates.runtimeVersion || 'unknown'}`, 'INFO');
    this.addLog(`Platform: ${Platform.OS}`, 'INFO');
    this.addLog(`Updates enabled: ${Updates.isEnabled}`, 'INFO');

    try {
      // Always attempt the check for debugging purposes
      this.addLog('Calling Updates.checkForUpdateAsync()...', 'INFO');
      const startTime = Date.now();

      const update = await Updates.checkForUpdateAsync();
      const duration = Date.now() - startTime;

      this.addLog(`Update check completed in ${duration}ms`, 'INFO');
      this.addLog(`Check result - isAvailable: ${update.isAvailable}`, 'INFO');

      if (update.isAvailable) {
        this.addLog(`Update available! ID: ${update.manifest?.id || 'unknown'}`, 'INFO');

        if (update.manifest) {
          this.addLog(`Manifest ID: ${update.manifest.id || 'unknown'}`, 'INFO');
        }

        // Check if we can actually install updates
        if (__DEV__) {
          this.addLog('WARNING: Update found but in development mode - installation will be skipped', 'WARN');
        } else if (!Updates.isEnabled) {
          this.addLog('WARNING: Update found but updates disabled - installation will be skipped', 'WARN');
        } else {
          this.addLog('Update found and installation is possible', 'INFO');
        }

        return {
          isAvailable: true,
          manifest: update.manifest,
          isNew: false, // Default value since isNew is not available in the type
          isEmbeddedLaunch: false // Default value since isEmbeddedLaunch is not available in the type
        };
      }

      this.addLog('No updates available', 'INFO');
      return { isAvailable: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`Update check failed: ${errorMessage}`, 'ERROR');
      console.error('Failed to check for updates:', error);
      return { isAvailable: false };
    }
  }

  /**
   * Download and install the latest update
   */
  public async downloadAndInstallUpdate(): Promise<boolean> {
    this.addLog('Starting update download and installation...', 'INFO');

    try {
      // Check environment and updates status first
      if (__DEV__) {
        this.addLog('Running in development mode - update installation may have limitations', 'WARN');
        this.addLog('In development mode, Updates.checkForUpdateAsync() may not work properly', 'WARN');
        // Don't return false - allow attempting updates in dev mode for testing
      }

      if (!Updates.isEnabled) {
        this.addLog('Update installation skipped (updates disabled)', 'WARN');
        this.addLog('Updates.isEnabled is false - this is why installation fails', 'ERROR');
        return false;
      }

      this.addLog('Environment checks passed, proceeding with installation', 'INFO');
      this.addLog('Checking for available updates before installation...', 'INFO');
      this.addLog(`Update URL: ${this.getUpdateUrl()}`, 'INFO');
      this.addLog(`Runtime version: ${Updates.runtimeVersion || 'unknown'}`, 'INFO');
      this.addLog(`Platform: ${Platform.OS}`, 'INFO');

      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        this.addLog(`Update found, starting download. ID: ${update.manifest?.id || 'unknown'}`, 'INFO');
        this.addLog(`Manifest details: ${JSON.stringify(update.manifest, null, 2)}`, 'INFO');

        const downloadStartTime = Date.now();
        this.addLog('Calling Updates.fetchUpdateAsync()...', 'INFO');

        try {
          await Updates.fetchUpdateAsync();
          const downloadDuration = Date.now() - downloadStartTime;

          this.addLog(`Update downloaded successfully in ${downloadDuration}ms`, 'INFO');
          this.addLog('Calling Updates.reloadAsync() to apply update...', 'INFO');

          await Updates.reloadAsync();

          this.addLog('Update installation completed successfully', 'INFO');
          return true;
        } catch (fetchError) {
          const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
          this.addLog(`Update fetch failed: ${errorMessage}`, 'ERROR');
          this.addLog(`Fetch error stack: ${fetchError instanceof Error ? fetchError.stack : i18n.t('errors.update_no_stack')}`, 'ERROR');
          throw fetchError; // Re-throw to be caught by outer catch block
        }
      }

      this.addLog('No update available for installation', 'WARN');
      this.addLog('Updates.checkForUpdateAsync() returned isAvailable: false', 'INFO');
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`Update installation failed: ${errorMessage}`, 'ERROR');
      this.addLog(`Error stack: ${error instanceof Error ? error.stack : i18n.t('errors.update_no_stack')}`, 'ERROR');
      console.error('Failed to download/install update:', error);
      return false;
    }
  }

  /**
   * Get current update info
   */
  public async getCurrentUpdateInfo(): Promise<UpdateInfo> {
    try {
      this.addLog('Getting current update info...', 'INFO');
      this.addLog(`Updates.isEnabled: ${Updates.isEnabled}`, 'INFO');
      this.addLog(`Updates.isEmbeddedLaunch: ${Updates.isEmbeddedLaunch}`, 'INFO');

      if (__DEV__) {
        this.addLog('In development mode - update info may not be accurate', 'WARN');
      }

      if (!Updates.isEnabled) {
        this.addLog('Updates disabled - returning false for isAvailable', 'WARN');
        return { isAvailable: false };
      }

      const info = {
        isAvailable: Updates.isEmbeddedLaunch === false,
        manifest: Updates.manifest,
        isNew: false, // Default value since Updates.isNew is not available
        isEmbeddedLaunch: Updates.isEmbeddedLaunch
      };

      this.addLog(`Current update info - Available: ${info.isAvailable}, Embedded: ${info.isEmbeddedLaunch}`, 'INFO');

      if (info.manifest) {
        this.addLog(`Current manifest ID: ${info.manifest.id || 'unknown'}`, 'INFO');
      } else {
        this.addLog('No manifest available', 'INFO');
      }

      return info;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`Failed to get current update info: ${errorMessage}`, 'ERROR');
      console.error('Failed to get current update info:', error);
      return { isAvailable: false };
    }
  }

  /**
   * Start periodic update checks - DISABLED
   * Updates are now only checked on app start and manual trigger
   */
  private startPeriodicUpdateChecks(): void {
    this.addLog('Periodic update checks are disabled - only checking on app start and manual trigger', 'INFO');
    // Method kept for compatibility but no longer starts automatic checks
  }

  /**
   * Stop periodic update checks - DISABLED
   * No periodic checks are running, so this is a no-op
   */
  public stopPeriodicUpdateChecks(): void {
    this.addLog('Periodic update checks are disabled - nothing to stop', 'INFO');
    // Method kept for compatibility but no longer stops automatic checks
  }

  /**
   * Get the update URL for the current platform
   */
  public getUpdateUrl(): string {
    // Use the URL from app.json configuration
    return 'https://ota.nuvioapp.space/api/manifest';
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.addLog('Cleaning up UpdateService resources...', 'INFO');
    this.stopPeriodicUpdateChecks();
    this.addLog('UpdateService cleanup completed', 'INFO');
  }
}

export default UpdateService.getInstance();



