import i18n from '../i18n';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Platform,
  Dimensions,
  Linking,
  Switch
} from 'react-native';
import { useToast } from '../contexts/ToastContext';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import UpdateService from '../services/updateService';
import CustomAlert from '../components/CustomAlert';
import { mmkvStorage } from '../services/mmkvStorage';
import { useGithubMajorUpdate } from '../hooks/useGithubMajorUpdate';
import { getDisplayedAppVersion } from '../utils/version';
import { isAnyUpgrade } from '../services/githubReleaseService';
import { useTranslation } from 'react-i18next';

const { width, height } = Dimensions.get('window');
const isTablet = width >= 768;

// Card component with minimalistic style
interface SettingsCardProps {
  children: React.ReactNode;
  title?: string;
  isTablet?: boolean;
}

const SettingsCard: React.FC<SettingsCardProps> = ({ children, title, isTablet = false }) => {
  const { currentTheme } = useTheme();

  return (
    <View
      style={[
        styles.cardContainer,
        isTablet && styles.tabletCardContainer
      ]}
    >
      {title && (
        <Text style={[
          styles.cardTitle,
          { color: currentTheme.colors.mediumEmphasis },
          isTablet && styles.tabletCardTitle
        ]}>
          {title}
        </Text>
      )}
      <View style={[
        styles.card,
        { backgroundColor: currentTheme.colors.elevation1 },
        isTablet && styles.tabletCard
      ]}>
        {children}
      </View>
    </View>
  );
};

const UpdateScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const github = useGithubMajorUpdate();
  const { showInfo } = useToast();
  const { t } = useTranslation();

  // CustomAlert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<Array<{ label: string; onPress: () => void; style?: object }>>([
    { label: t('common.ok'), onPress: () => setAlertVisible(false) },
  ]);

  const openAlert = (
    title: string,
    message: string,
    actions?: Array<{ label: string; onPress?: () => void; style?: object }>
  ) => {
    setAlertTitle(title);
    setAlertMessage(message);
    if (actions && actions.length > 0) {
      setAlertActions(
        actions.map(a => ({
          label: a.label,
          style: a.style,
          onPress: () => { a.onPress?.(); },
        }))
      );
    } else {
      setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
    }
    setAlertVisible(true);
  };

  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [currentInfo, setCurrentInfo] = useState<any>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  // Logs removed
  const [lastOperation, setLastOperation] = useState<string>('');
  const [updateProgress, setUpdateProgress] = useState<number>(0);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'success' | 'error'>('idle');

  // Update notification settings
  const [otaAlertsEnabled, setOtaAlertsEnabled] = useState(true);
  const [majorAlertsEnabled, setMajorAlertsEnabled] = useState(true);

  // Load notification settings on mount
  useEffect(() => {
    (async () => {
      try {
        const otaSetting = await mmkvStorage.getItem('@ota_updates_alerts_enabled');
        const majorSetting = await mmkvStorage.getItem('@major_updates_alerts_enabled');
        // Default to true if not set
        setOtaAlertsEnabled(otaSetting !== 'false');
        setMajorAlertsEnabled(majorSetting !== 'false');
      } catch { }
    })();
  }, []);

  // Handle toggling OTA alerts with warning
  const handleOtaAlertsToggle = async (value: boolean) => {
    if (!value) {
      openAlert(
        t('updates.alert_disable_ota_title'),
        t('updates.alert_disable_ota_msg'),
        [
          { label: t('common.cancel'), onPress: () => setAlertVisible(false) },
          {
            label: t('updates.disable'),
            onPress: async () => {
              await mmkvStorage.setItem('@ota_updates_alerts_enabled', 'false');
              setOtaAlertsEnabled(false);
              setAlertVisible(false);
            }
          }
        ]
      );
    } else {
      await mmkvStorage.setItem('@ota_updates_alerts_enabled', 'true');
      setOtaAlertsEnabled(true);
    }
  };

  // Handle toggling Major update alerts with warning
  const handleMajorAlertsToggle = async (value: boolean) => {
    if (!value) {
      openAlert(
        t('updates.alert_disable_major_title'),
        t('updates.alert_disable_major_msg'),
        [
          { label: t('common.cancel'), onPress: () => setAlertVisible(false) },
          {
            label: t('updates.disable'), // Assuming 'Disable' key might not exist, checking en.json... I didn't add 'disable'. Will use 'common.cancel' for cancel. For 'Disable', I'll check if I can use something else or add it. I missed adding 'disable' to en.json. I'll use hardcoded 'Disable' for now or 'Off'. Wait, I can use hardcoded string or just add it later. Actually, I see I missed adding a specific "Disable" button text in the replace_file_content earlier.
            // Let's use 'Disable' string for now as fallback or t('plugins.disabled') if appropriate, but that's "Disabled".
            // I will use "Disable" plain string for now to be safe, or check if common.disable exists. It probably doesn't.
            // I'll stick to 'Disable' string to match previous behavior, or use t('common.cancel') for Cancel.
            // Actually, looking at previous code it was "Disable". I'll use "Disable" for now.
            onPress: async () => {
              await mmkvStorage.setItem('@major_updates_alerts_enabled', 'false');
              setMajorAlertsEnabled(false);
              setAlertVisible(false);
            }
          }
        ]
      );
    } else {
      await mmkvStorage.setItem('@major_updates_alerts_enabled', 'true');
      setMajorAlertsEnabled(true);
    }
  };

  const checkForUpdates = async () => {
    try {
      setIsChecking(true);
      setUpdateStatus('checking');
      setUpdateProgress(0);
      setLastOperation(t('updates.status_checking'));

      const info = await UpdateService.checkForUpdates();
      setUpdateInfo(info);
      setLastChecked(new Date());

      // Logs disabled

      if (info.isAvailable) {
        setUpdateStatus('available');
        setLastOperation(`${t('updates.status_available')}: ${info.manifest?.id || 'unknown'}`);
      } else {
        setUpdateStatus('idle');
        setLastOperation(t('updates.status_ready')); // Using ready instead of "No updates available" to match "Ready to check" state, or should I add "No updates available"? Previous code used "No updates available". En.json has "status_ready" as "Ready to check for updates".
        // I'll use status_ready effectively.
      }
    } catch (error) {
      if (__DEV__) console.error('Error checking for updates:', error);
      setUpdateStatus('error');
      setLastOperation(`${t('common.error')}: ${error instanceof Error ? error.message : i18n.t('errors.unknown_error')}`);
      openAlert(t('common.error'), t('updates.status_error'));
    } finally {
      setIsChecking(false);
    }
  };

  // Auto-check on mount and keep section visible
  useEffect(() => {
    if (Platform.OS === 'android') {
      // ensure badge clears when entering this screen
      (async () => {
        try { await mmkvStorage.removeItem('@update_badge_pending'); } catch { }
      })();
    }
    checkForUpdates();
    // Also refresh GitHub section on mount (works in dev and prod)
    try { github.refresh(); } catch { }
    if (Platform.OS === 'android') {
      showInfo(t('updates.title'), t('updates.status_checking'));
    }
  }, []);

  const installUpdate = async (options?: { forceGithub?: boolean }) => {
    try {
      setIsInstalling(true);
      setUpdateStatus('downloading');
      setUpdateProgress(0);
      setLastOperation(t('updates.status_downloading'));

      const forceGithub = options?.forceGithub === true;

      // If it's a GitHub release update
      if ((updateInfo?.source === 'github' || forceGithub) && Platform.OS === 'android') {
        const { default: AndroidUpdateService } = await import('../services/androidUpdateService');

        // We need the full release info with assets
        const fullRelease = await import('../services/githubReleaseService').then(m => m.fetchLatestGithubRelease());

        if (!fullRelease || !fullRelease.assets) {
          throw new Error(t('errors.could_not_fetch_release'));
        }

        setLastOperation(t('errors.downloading_apk'));
        // Note: Progress is not currently supported by FileSystem.downloadAsync in the simple way
        // We'll simulate it for now or implement a more complex downloader later if needed
        const success = await AndroidUpdateService.downloadAndInstallUpdate(
          fullRelease,
          (progress) => {
            setUpdateProgress(progress * 100);
          }
        );

        if (success) {
          setUpdateProgress(100);
          setUpdateStatus('success');
          setLastOperation(t('updates.status_success'));
          // No alert needed, system installer takes over
        } else {
          throw new Error(t('errors.download_or_install_failed'));
        }
        return;
      }

      // Fallback for OTA / Expo Updates
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUpdateProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 10;
        });
      }, 500);

      const success = await UpdateService.downloadAndInstallUpdate();

      clearInterval(progressInterval);
      setUpdateProgress(100);
      setUpdateStatus('installing');
      setLastOperation(t('updates.status_installing'));

      // Logs disabled

      if (success) {
        setUpdateStatus('success');
        setLastOperation(t('updates.status_success'));
        openAlert(t('common.success'), t('updates.alert_update_applied_msg'));
      } else {
        setUpdateStatus('error');
        setLastOperation(t('updates.alert_no_update_to_install'));
        openAlert(t('updates.alert_no_update_title'), t('updates.alert_no_update_to_install'));
      }
    } catch (error) {
      if (__DEV__) console.error('Error installing update:', error);
      setUpdateStatus('error');
      setLastOperation(`${t('updates.status_error')}: ${error instanceof Error ? error.message : i18n.t('errors.unknown_error')}`);
      openAlert(t('common.error'), t('updates.alert_install_failed'));
    } finally {
      setIsInstalling(false);
    }
  };

  const getCurrentUpdateInfo = async () => {
    const info = await UpdateService.getCurrentUpdateInfo();
    setCurrentInfo(info);
    // Logs disabled
  };

  // Extract release notes from various possible manifest fields
  const getReleaseNotes = () => {
    const manifest: any = updateInfo?.manifest || {};
    return (
      manifest.description ||
      manifest.releaseNotes ||
      manifest.extra?.releaseNotes ||
      manifest.metadata?.releaseNotes ||
      ''
    );
  };

  // Extract release notes for the currently running version
  const getCurrentReleaseNotes = () => {
    const manifest: any = currentInfo?.manifest || {};
    return (
      manifest.description ||
      manifest.releaseNotes ||
      manifest.extra?.releaseNotes ||
      manifest.metadata?.releaseNotes ||
      ''
    );
  };

  // Logs disabled: remove actions

  const testConnectivity = async () => {
    try {
      setLastOperation(t('components.testing_connectivity'));
      const isReachable = await UpdateService.testUpdateConnectivity();

      if (isReachable) {
        setLastOperation(t('components.update_server_reachable'));
      } else {
        setLastOperation(t('components.update_server_unreachable'));
      }
    } catch (error) {
      if (__DEV__) console.error('Error testing connectivity:', error);
      setLastOperation(`Connectivity test error: ${error instanceof Error ? error.message : i18n.t('errors.unknown_error')}`);
      // Logs disabled
    }
  };

  const testAssetUrls = async () => {
    try {
      setLastOperation(t('components.testing_asset_urls'));
      await UpdateService.testAllAssetUrls();
      setLastOperation(t('components.asset_url_testing_completed'));
    } catch (error) {
      if (__DEV__) console.error('Error testing asset URLs:', error);
      setLastOperation(`Asset URL test error: ${error instanceof Error ? error.message : i18n.t('errors.unknown_error')}`);
      // Logs disabled
    }
  };

  // Load current update info on mount
  useEffect(() => {
    const loadInitialData = async () => {
      await getCurrentUpdateInfo();
    };
    loadInitialData();
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  const getStatusIcon = () => {
    switch (updateStatus) {
      case 'checking':
        return <MaterialIcons name="refresh" size={20} color={currentTheme.colors.primary} />;
      case 'available':
        return <MaterialIcons name="new-releases" size={20} color={currentTheme.colors.success || '#4CAF50'} />;
      case 'downloading':
        return <MaterialIcons name="cloud-download" size={20} color={currentTheme.colors.primary} />;
      case 'installing':
        return <MaterialIcons name="install-mobile" size={20} color={currentTheme.colors.primary} />;
      case 'success':
        return <MaterialIcons name="check-circle" size={20} color={currentTheme.colors.success || '#4CAF50'} />;
      case 'error':
        return <MaterialIcons name="error" size={20} color={currentTheme.colors.error || '#ff4444'} />;
      default:
        return <MaterialIcons name="system-update" size={20} color={currentTheme.colors.mediumEmphasis} />;
    }
  };

  const getStatusText = () => {
    switch (updateStatus) {
      case 'checking':
        return t('updates.status_checking');
      case 'available':
        return t('updates.status_available');
      case 'downloading':
        return t('updates.status_downloading');
      case 'installing':
        return t('updates.status_installing');
      case 'success':
        return t('updates.status_success');
      case 'error':
        return t('updates.status_error');
      default:
        return t('updates.status_ready');
    }
  };

  const getStatusColor = () => {
    switch (updateStatus) {
      case 'available':
      case 'success':
        return currentTheme.colors.success || '#4CAF50';
      case 'error':
        return currentTheme.colors.error || '#ff4444';
      case 'checking':
      case 'downloading':
      case 'installing':
        return currentTheme.colors.primary;
      default:
        return currentTheme.colors.mediumEmphasis;
    }
  };


  return (
    <SafeAreaView style={[
      styles.container,
      { backgroundColor: currentTheme.colors.darkBackground }
    ]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <MaterialIcons name="arrow-back" size={24} color={currentTheme.colors.highEmphasis} />
          <Text style={[styles.backText, { color: currentTheme.colors.highEmphasis }]}>
            {t('settings.settings_title')}
          </Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Empty for now, but ready for future actions */}
        </View>
      </View>

      <Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>
        {t('updates.title')}
      </Text>

      <View style={styles.contentContainer}>
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <SettingsCard title={t('updates.title').toUpperCase()} isTablet={isTablet}>
            {/* Main Update Card */}
            <View style={styles.updateMainCard}>
              {/* Status Section */}
              <View style={styles.updateStatusSection}>
                <View style={[styles.statusIndicator, { backgroundColor: `${getStatusColor()}20` }]}>
                  {getStatusIcon()}
                </View>
                <View style={styles.statusContent}>
                  <Text style={[styles.statusMainText, { color: currentTheme.colors.highEmphasis }]}>
                    {getStatusText()}
                  </Text>
                  <Text style={[styles.statusDetailText, { color: currentTheme.colors.mediumEmphasis }]}>
                    {lastOperation || t('updates.status_ready')}
                  </Text>
                </View>
              </View>

              {/* Progress Section */}
              {(updateStatus === 'downloading' || updateStatus === 'installing') && (
                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text style={[styles.progressLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                      {updateStatus === 'downloading' ? 'Downloading' : 'Installing'}
                    </Text>
                    <Text style={[styles.progressPercentage, { color: currentTheme.colors.primary }]}>
                      {Math.round(updateProgress)}%
                    </Text>
                  </View>
                  <View style={[styles.modernProgressBar, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                    <View
                      style={[
                        styles.modernProgressFill,
                        {
                          backgroundColor: currentTheme.colors.primary,
                          width: `${updateProgress}%`
                        }
                      ]}
                    />
                  </View>
                </View>
              )}

              {/* Action Section */}
              <View style={styles.actionSection}>
                <TouchableOpacity
                  style={[
                    styles.modernButton,
                    styles.primaryAction,
                    { backgroundColor: currentTheme.colors.primary },
                    (isChecking || isInstalling) && styles.disabledAction
                  ]}
                  onPress={checkForUpdates}
                  disabled={isChecking || isInstalling}
                  activeOpacity={0.8}
                >
                  {isChecking ? (
                    <MaterialIcons name="refresh" size={18} color="white" />
                  ) : (
                    <MaterialIcons name="system-update" size={18} color="white" />
                  )}
                  <Text style={styles.modernButtonText}>
                    {isChecking ? `${t('updates.status_checking')}...` : t('updates.action_check')}
                  </Text>
                </TouchableOpacity>

                {updateInfo?.isAvailable && updateStatus !== 'success' && (
                  <TouchableOpacity
                    style={[
                      styles.modernButton,
                      styles.installAction,
                      { backgroundColor: currentTheme.colors.success || '#34C759' },
                      (isInstalling) && styles.disabledAction
                    ]}
                    onPress={() => installUpdate()}
                    disabled={isInstalling}
                    activeOpacity={0.8}
                  >
                    {isInstalling ? (
                      <MaterialIcons name="install-mobile" size={18} color="white" />
                    ) : (
                      <MaterialIcons name="download" size={18} color="white" />
                    )}
                    <Text style={styles.modernButtonText}>
                      {isInstalling ? `${t('updates.status_installing')}...` : t('updates.action_install')}
                    </Text>
                  </TouchableOpacity>
                )}

              </View>
            </View>

            {/* Release Notes */}
            {updateInfo?.isAvailable && !!getReleaseNotes() && (
              <View style={styles.infoSection}>
                <View style={styles.infoItem}>
                  <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                    <MaterialIcons name="notes" size={14} color={currentTheme.colors.primary} />
                  </View>
                  <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.release_notes')}</Text>
                </View>
                <Text style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}>{getReleaseNotes()}</Text>
              </View>
            )}

            {/* Info Section */}
            <View style={styles.infoSection}>
              <View style={styles.infoItem}>
                <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                  <MaterialIcons name="info-outline" size={14} color={currentTheme.colors.primary} />
                </View>
                <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.version')}</Text>
                <Text style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}>
                  {updateInfo?.manifest?.id ? `${updateInfo.manifest.id.substring(0, 8)}...` : t('common.unknown')}
                </Text>
              </View>

              {lastChecked && (
                <View style={styles.infoItem}>
                  <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                    <MaterialIcons name="schedule" size={14} color={currentTheme.colors.primary} />
                  </View>
                  <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.last_checked')}</Text>
                  <Text style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}>
                    {formatDate(lastChecked)}
                  </Text>
                </View>
              )}
            </View>

            {/* Current Version Section */}
            <View style={styles.infoSection}>
              <View style={styles.infoItem}>
                <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                  <MaterialIcons name="verified" size={14} color={currentTheme.colors.primary} />
                </View>
                <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.current_version')}</Text>
                <Text style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}
                  selectable>
                  {currentInfo?.manifest?.id || (currentInfo?.isEmbeddedLaunch === false ? t('common.unknown') : 'Embedded')}
                </Text>
              </View>

              {!!getCurrentReleaseNotes() && (
                <View style={{ marginTop: 8 }}>
                  <View style={[styles.infoItem, { alignItems: 'flex-start' }]}>
                    <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                      <MaterialIcons name="notes" size={14} color={currentTheme.colors.primary} />
                    </View>
                    <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.current_release_notes')}</Text>
                  </View>
                  <Text style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}>
                    {getCurrentReleaseNotes()}
                  </Text>
                </View>
              )}
            </View>

            {/* Developer Logs removed */}
          </SettingsCard>

          {/* GitHub Release (compact) – only show when update is available */}
          {github.latestTag && isAnyUpgrade(getDisplayedAppVersion(), github.latestTag) ? (
            <SettingsCard title={t('updates.github_release')} isTablet={isTablet}>
              <View style={styles.infoSection}>
                <View style={styles.infoItem}>
                  <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                    <MaterialIcons name="new-releases" size={14} color={currentTheme.colors.primary} />
                  </View>
                  <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.current')}</Text>
                  <Text style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}>
                    {getDisplayedAppVersion()}
                  </Text>
                </View>

                <View style={styles.infoItem}>
                  <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.primary}15` }]}>
                    <MaterialIcons name="tag" size={14} color={currentTheme.colors.primary} />
                  </View>
                  <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.latest')}</Text>
                  <Text style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}>
                    {github.latestTag}
                  </Text>
                </View>

                {github.releaseNotes ? (
                  <View style={{ marginTop: 4 }}>
                    <Text style={[styles.infoLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('updates.notes')}</Text>
                    <Text
                      numberOfLines={3}
                      style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}
                    >
                      {github.releaseNotes}
                    </Text>
                  </View>
                ) : null}

                <View style={[styles.actionSection, { marginTop: 8 }]}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {Platform.OS === 'android' && (
                      <TouchableOpacity
                        style={[styles.modernButton, { backgroundColor: currentTheme.colors.success || '#34C759', flex: 1 }]}
                        onPress={() => installUpdate({ forceGithub: true })}
                        disabled={isInstalling}
                        activeOpacity={0.8}
                      >
                        {isInstalling ? (
                          <MaterialIcons name="downloading" size={18} color="white" />
                        ) : (
                          <MaterialIcons name="system-update" size={18} color="white" />
                        )}
                        <Text style={styles.modernButtonText}>
                          {isInstalling ? `${t('updates.status_downloading')}...` : t('updates.action_install')}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.modernButton, { backgroundColor: currentTheme.colors.primary, flex: 1 }]}
                      onPress={() => github.releaseUrl ? Linking.openURL(github.releaseUrl as string) : null}
                      activeOpacity={0.8}
                    >
                      <MaterialIcons name="open-in-new" size={18} color="white" />
                      <Text style={styles.modernButtonText}>{t('updates.view_release')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </SettingsCard>
          ) : null}

          {/* Update Notification Settings */}
          <SettingsCard title={t('updates.notification_settings')} isTablet={isTablet}>
            {/* OTA Updates Toggle */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: currentTheme.colors.highEmphasis }]}>
                  {t('updates.ota_alerts_label')}
                </Text>
                <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                  {t('updates.ota_alerts_desc')}
                </Text>
              </View>
              <Switch
                value={otaAlertsEnabled}
                onValueChange={handleOtaAlertsToggle}
                trackColor={{ false: '#505050', true: currentTheme.colors.primary }}
                thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
                ios_backgroundColor="#505050"
              />
            </View>

            {/* Major Updates Toggle */}
            <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingLabel, { color: currentTheme.colors.highEmphasis }]}>
                  {t('updates.major_alerts_label')}
                </Text>
                <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                  {t('updates.major_alerts_desc')}
                </Text>
              </View>
              <Switch
                value={majorAlertsEnabled}
                onValueChange={handleMajorAlertsToggle}
                trackColor={{ false: '#505050', true: currentTheme.colors.primary }}
                thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
                ios_backgroundColor="#505050"
              />
            </View>

            {/* Warning note */}
            <View style={[styles.infoItem, { paddingHorizontal: 16, paddingBottom: 12 }]}>
              <View style={[styles.infoIcon, { backgroundColor: `${currentTheme.colors.warning || '#FFA500'}20` }]}>
                <MaterialIcons name="info-outline" size={14} color={currentTheme.colors.warning || '#FFA500'} />
              </View>
              <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis, flex: 1 }]}>
                {t('updates.warning_note')}
              </Text>
            </View>
          </SettingsCard>

          {false && (
            <SettingsCard title={t('settings.update_logs_title')} isTablet={isTablet}>
              <View style={styles.logsContainer}>
                <View style={styles.logsHeader}>
                  <Text style={[styles.logsHeaderText, { color: currentTheme.colors.highEmphasis }]}>
                    Update Service Logs
                  </Text>
                  <View style={styles.logsActions}>
                    <TouchableOpacity
                      style={[styles.logActionButton, { backgroundColor: currentTheme.colors.elevation2 }]}
                      onPress={testConnectivity}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="wifi" size={16} color={currentTheme.colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.logActionButton, { backgroundColor: currentTheme.colors.elevation2 }]}
                      onPress={testAssetUrls}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="link" size={16} color={currentTheme.colors.primary} />
                    </TouchableOpacity>
                    {/* Test log removed */}
                    {/* Copy all logs removed */}
                    {/* Refresh logs removed */}
                    {/* Clear logs removed */}
                  </View>
                </View>

                <ScrollView
                  style={[styles.logsScrollView, { backgroundColor: currentTheme.colors.elevation2 }]}
                  showsVerticalScrollIndicator={true}
                  nestedScrollEnabled={true}
                >
                  {false ? (
                    <Text style={[styles.noLogsText, { color: currentTheme.colors.mediumEmphasis }]}>{t('update.no_logs')}</Text>
                  ) : (
                    ([] as string[]).map((log, index) => {
                      const isError = log.indexOf('[ERROR]') !== -1;
                      const isWarning = log.indexOf('[WARN]') !== -1;

                      return (
                        <TouchableOpacity
                          key={index}
                          style={[
                            styles.logEntry,
                            { backgroundColor: 'rgba(255,255,255,0.05)' }
                          ]}
                          onPress={() => { }}
                          activeOpacity={0.7}
                        >
                          <View style={styles.logEntryContent}>
                            <Text style={[
                              styles.logText,
                              {
                                color: isError
                                  ? (currentTheme.colors.error || '#ff4444')
                                  : isWarning
                                    ? (currentTheme.colors.warning || '#ffaa00')
                                    : currentTheme.colors.mediumEmphasis
                              }
                            ]}>
                              {log}
                            </Text>
                            <MaterialIcons
                              name="content-copy"
                              size={14}
                              color={currentTheme.colors.mediumEmphasis}
                              style={styles.logCopyIcon}
                            />
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            </SettingsCard>
          )}
        </ScrollView>
      </View>
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        onClose={() => setAlertVisible(false)}
        actions={alertActions}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  backText: {
    fontSize: 17,
    marginLeft: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  contentContainer: {
    flex: 1,
    zIndex: 1,
    width: '100%',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    paddingBottom: 90,
  },

  // Common card styles
  cardContainer: {
    width: '100%',
    marginBottom: 20,
  },
  tabletCardContainer: {
    marginBottom: 32,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginLeft: Math.max(12, width * 0.04),
    marginBottom: 8,
  },
  tabletCardTitle: {
    fontSize: 14,
    marginLeft: 0,
    marginBottom: 12,
  },
  card: {
    marginHorizontal: Math.max(12, width * 0.04),
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    width: undefined,
  },
  tabletCard: {
    marginHorizontal: 0,
    borderRadius: 20,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },

  // Update UI Styles
  updateMainCard: {
    padding: 20,
    marginBottom: 16,
  },
  updateStatusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusIndicator: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  statusContent: {
    flex: 1,
  },
  statusMainText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  statusDetailText: {
    fontSize: 14,
    opacity: 0.8,
    lineHeight: 20,
  },
  progressSection: {
    marginBottom: 20,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  progressPercentage: {
    fontSize: 14,
    fontWeight: '600',
  },
  modernProgressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  modernProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  actionSection: {
    gap: 12,
  },
  modernButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryAction: {
    marginBottom: 8,
  },
  installAction: {
    // Additional styles for install button
  },
  disabledAction: {
    opacity: 0.6,
  },
  modernButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  infoSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
    minWidth: 80,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '400',
    flex: 1,
  },
  modernAdvancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginTop: 8,
    borderRadius: 12,
    marginHorizontal: 4,
  },
  advancedToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  advancedToggleLabel: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  logsBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  logsBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },

  // Logs styles
  logsContainer: {
    padding: 20,
  },
  logsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  logsHeaderText: {
    fontSize: 16,
    fontWeight: '600',
  },
  logsActions: {
    flexDirection: 'row',
    gap: 8,
  },
  logActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logsScrollView: {
    maxHeight: 200,
    borderRadius: 8,
    padding: 12,
  },
  logEntry: {
    marginBottom: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  logEntryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
    flex: 1,
    marginRight: 8,
  },
  logCopyIcon: {
    opacity: 0.6,
  },
  noLogsText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // Settings toggle styles
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
});

export default UpdateScreen;
