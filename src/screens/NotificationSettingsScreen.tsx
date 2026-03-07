import i18n from '../i18n';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import CustomAlert from '../components/CustomAlert';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { notificationService, NotificationSettings } from '../services/notificationService';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { logger } from '../utils/logger';
import { useTranslation } from 'react-i18next';

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;

const NotificationSettingsScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { currentTheme } = useTheme();
  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: true,
    newEpisodeNotifications: true,
    reminderNotifications: true,
    upcomingShowsNotifications: true,
    timeBeforeAiring: 24,
  });
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [testNotificationId, setTestNotificationId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notificationStats, setNotificationStats] = useState({ total: 0, upcoming: 0, thisWeek: 0 });

  // Custom alert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<any[]>([]);
  // Load settings and stats on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedSettings = await notificationService.getSettings();
        setSettings(savedSettings);

        // Load notification stats
        const stats = notificationService.getNotificationStats();
        setNotificationStats(stats);
      } catch (error) {
        logger.error('Error loading notification settings:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Refresh stats when settings change
  useEffect(() => {
    if (!loading) {
      const stats = notificationService.getNotificationStats();
      setNotificationStats(stats);
    }
  }, [settings, loading]);

  // Add countdown effect
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (countdown !== null && countdown > 0) {
      intervalId = setInterval(() => {
        setCountdown(prev => prev !== null ? prev - 1 : null);
      }, 1000);
    } else if (countdown === 0) {
      setCountdown(null);
      setTestNotificationId(null);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [countdown]);

  // Update a setting
  const updateSetting = async (key: keyof NotificationSettings, value: boolean | number) => {
    try {
      const updatedSettings = {
        ...settings,
        [key]: value,
      };

      // Special case: if enabling notifications, make sure permissions are granted
      if (key === 'enabled' && value === true) {
        // Permissions are handled in the service
      }

      // Update settings in the service
      await notificationService.updateSettings({ [key]: value });

      // Update local state
      setSettings(updatedSettings);
    } catch (error) {
      logger.error('Error updating notification settings:', error);
      setAlertTitle('Error');
      setAlertMessage('Failed to update notification settings');
      setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    }
  };

  // Set time before airing
  const setTimeBeforeAiring = (hours: number) => {
    updateSetting('timeBeforeAiring', hours);
  };

  const resetAllNotifications = async () => {
    setAlertTitle(t('notification.alert_reset_title'));
    setAlertMessage(t('notification.alert_reset_msg'));
    setAlertActions([
      { label: 'Cancel', onPress: () => setAlertVisible(false), style: { color: currentTheme.colors.mediumGray } },
      {
        label: t('mdblist.reset_confirm') || 'Reset', // Using mdblist or common if available, fallback for safely
        onPress: async () => {
          try {
            const scheduledNotifications = notificationService.getScheduledNotifications?.() || [];
            for (const notification of scheduledNotifications) {
              await notificationService.cancelNotification(notification.id);
            }
            setAlertTitle(t('common.success') || 'Success');
            setAlertMessage(t('notification.alert_reset_success'));
            setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
            setAlertVisible(true);
          } catch (error) {
            logger.error('Error resetting notifications:', error);
            setAlertTitle('Error');
            setAlertMessage('Failed to reset notifications');
            setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
            setAlertVisible(true);
          }
        },
        style: { color: currentTheme.colors.error }
      },
    ]);
    setAlertVisible(true);
  };

  const handleSyncNotifications = async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    try {
      await notificationService.syncAllNotifications();

      // Refresh stats after sync
      const stats = notificationService.getNotificationStats();
      setNotificationStats(stats);

      setAlertTitle(t('notification.alert_sync_complete'));
      setAlertMessage(t('notification.alert_sync_msg', { upcoming: stats.upcoming, thisWeek: stats.thisWeek }));
      setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    } catch (error) {
      logger.error('Error syncing notifications:', error);
      setAlertTitle('Error');
      setAlertMessage('Failed to sync notifications. Please try again.');
      setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      // Remove all previous test notifications before scheduling a new one
      const scheduled = notificationService.getScheduledNotifications?.() || [];
      const testNotifications = scheduled.filter(n => n.id.startsWith('test-notification-'));
      if (testNotifications.length > 0 && typeof notificationService.cancelNotification === 'function') {
        for (const n of testNotifications) {
          await notificationService.cancelNotification(n.id);
        }
      }


      // Temporarily override timeBeforeAiring to 0 for the test notification
      let originalTimeBeforeAiring: number | undefined = undefined;
      if (typeof notificationService.getSettings === 'function') {
        const currentSettings = await notificationService.getSettings();
        originalTimeBeforeAiring = currentSettings.timeBeforeAiring;
        if (typeof notificationService.updateSettings === 'function') {
          await notificationService.updateSettings({ timeBeforeAiring: 0 });
        }
      }

      const testNotification = {
        id: 'test-notification-' + Date.now(),
        seriesId: 'test-series',
        seriesName: 'Test Show',
        episodeTitle: 'Test Episode',
        season: 1,
        episode: 1,
        releaseDate: new Date(Date.now() + 5000).toISOString(), // 5 seconds from now
        notified: false
      };

      const notificationId = await notificationService.scheduleEpisodeNotification(testNotification);

      // Restore original timeBeforeAiring
      if (
        typeof notificationService.updateSettings === 'function' &&
        originalTimeBeforeAiring !== undefined
      ) {
        await notificationService.updateSettings({ timeBeforeAiring: originalTimeBeforeAiring });
      }

      if (notificationId) {
        setTestNotificationId(notificationId);
        setCountdown(0); // No countdown for instant notification
        setAlertTitle(t('common.success') || 'Success');
        setAlertMessage(t('notification.alert_test_scheduled'));
        setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
        setAlertVisible(true);
      } else {
        setAlertTitle('Error');
        setAlertMessage('Failed to schedule test notification. Make sure notifications are enabled.');
        setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
        setAlertVisible(true);
      }
    } catch (error) {
      logger.error('Error scheduling test notification:', error);
      setAlertTitle('Error');
      setAlertMessage('Failed to schedule test notification');
      setAlertActions([{ label: i18n.t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
        <View style={[styles.header, { borderBottomColor: currentTheme.colors.border }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="arrow-back" size={24} color={currentTheme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>{t('notification.title')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: currentTheme.colors.text }]}>{t('components.loading_settings')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color={currentTheme.colors.text} />
          <Text style={[styles.backText, { color: currentTheme.colors.text }]}>
            {t('common.settings') || 'Settings'}
          </Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Empty for now, but ready for future actions */}
        </View>
      </View>

      <Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>
        {t('notification.title')}
      </Text>

      <ScrollView style={styles.content}>
        <Animated.View
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
        >
          <View style={[styles.section, { borderBottomColor: currentTheme.colors.border }]}>
            <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>{t('notification.section_general')}</Text>

            <View style={[styles.settingItem, { borderBottomColor: currentTheme.colors.border + '50' }]}>
              <View style={styles.settingInfo}>
                <MaterialIcons name="notifications" size={24} color={currentTheme.colors.text} />
                <Text style={[styles.settingText, { color: currentTheme.colors.text }]}>{t('notification.enable_notifications')}</Text>
              </View>
              <Switch
                value={settings.enabled}
                onValueChange={(value) => updateSetting('enabled', value)}
                trackColor={{ false: currentTheme.colors.border, true: currentTheme.colors.primary + '80' }}
                thumbColor={settings.enabled ? currentTheme.colors.primary : currentTheme.colors.lightGray}
              />
            </View>
          </View>

          {settings.enabled && (
            <>
              <View style={[styles.section, { borderBottomColor: currentTheme.colors.border }]}>
                <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>{t('notification.section_types')}</Text>

                <View style={[styles.settingItem, { borderBottomColor: currentTheme.colors.border + '50' }]}>
                  <View style={styles.settingInfo}>
                    <MaterialIcons name="new-releases" size={24} color={currentTheme.colors.text} />
                    <Text style={[styles.settingText, { color: currentTheme.colors.text }]}>{t('notification.new_episodes')}</Text>
                  </View>
                  <Switch
                    value={settings.newEpisodeNotifications}
                    onValueChange={(value) => updateSetting('newEpisodeNotifications', value)}
                    trackColor={{ false: currentTheme.colors.border, true: currentTheme.colors.primary + '80' }}
                    thumbColor={settings.newEpisodeNotifications ? currentTheme.colors.primary : currentTheme.colors.lightGray}
                  />
                </View>

                <View style={[styles.settingItem, { borderBottomColor: currentTheme.colors.border + '50' }]}>
                  <View style={styles.settingInfo}>
                    <MaterialIcons name="event" size={24} color={currentTheme.colors.text} />
                    <Text style={[styles.settingText, { color: currentTheme.colors.text }]}>{t('notification.upcoming_shows')}</Text>
                  </View>
                  <Switch
                    value={settings.upcomingShowsNotifications}
                    onValueChange={(value) => updateSetting('upcomingShowsNotifications', value)}
                    trackColor={{ false: currentTheme.colors.border, true: currentTheme.colors.primary + '80' }}
                    thumbColor={settings.upcomingShowsNotifications ? currentTheme.colors.primary : currentTheme.colors.lightGray}
                  />
                </View>

                <View style={[styles.settingItem, { borderBottomColor: currentTheme.colors.border + '50' }]}>
                  <View style={styles.settingInfo}>
                    <MaterialIcons name="alarm" size={24} color={currentTheme.colors.text} />
                    <Text style={[styles.settingText, { color: currentTheme.colors.text }]}>{t('notification.reminders')}</Text>
                  </View>
                  <Switch
                    value={settings.reminderNotifications}
                    onValueChange={(value) => updateSetting('reminderNotifications', value)}
                    trackColor={{ false: currentTheme.colors.border, true: currentTheme.colors.primary + '80' }}
                    thumbColor={settings.reminderNotifications ? currentTheme.colors.primary : currentTheme.colors.lightGray}
                  />
                </View>
              </View>

              <View style={[styles.section, { borderBottomColor: currentTheme.colors.border }]}>
                <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>{t('notification.section_timing')}</Text>

                <Text style={[styles.settingDescription, { color: currentTheme.colors.lightGray }]}>
                  {t('notification.timing_desc')}
                </Text>

                <View style={styles.timingOptions}>
                  {[1, 6, 12, 24].map((hours) => (
                    <TouchableOpacity
                      key={hours}
                      style={[
                        styles.timingOption,
                        {
                          backgroundColor: currentTheme.colors.elevation1,
                          borderColor: currentTheme.colors.border
                        },
                        settings.timeBeforeAiring === hours && {
                          backgroundColor: currentTheme.colors.primary + '30',
                          borderColor: currentTheme.colors.primary,
                        }
                      ]}
                      onPress={() => setTimeBeforeAiring(hours)}
                    >
                      <Text style={[
                        styles.timingText,
                        { color: currentTheme.colors.text },
                        settings.timeBeforeAiring === hours && {
                          color: currentTheme.colors.primary,
                          fontWeight: 'bold',
                        }
                      ]}>
                        {hours === 1 ? t('notification.hours_1') : `${hours} ${t('notification.hours_suffix')}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={[styles.section, { borderBottomColor: currentTheme.colors.border }]}>
                <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>{t('notification.section_status')}</Text>

                <View style={[styles.statsContainer, { backgroundColor: currentTheme.colors.elevation1 }]}>
                  <View style={styles.statItem}>
                    <MaterialIcons name="schedule" size={20} color={currentTheme.colors.primary} />
                    <Text style={[styles.statLabel, { color: currentTheme.colors.textMuted }]}>{t('notification.stats_upcoming')}</Text>
                    <Text style={[styles.statValue, { color: currentTheme.colors.text }]}>{notificationStats.upcoming}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <MaterialIcons name="today" size={20} color={currentTheme.colors.primary} />
                    <Text style={[styles.statLabel, { color: currentTheme.colors.textMuted }]}>{t('notification.stats_this_week')}</Text>
                    <Text style={[styles.statValue, { color: currentTheme.colors.text }]}>{notificationStats.thisWeek}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <MaterialIcons name="notifications-active" size={20} color={currentTheme.colors.primary} />
                    <Text style={[styles.statLabel, { color: currentTheme.colors.textMuted }]}>{t('notification.stats_total')}</Text>
                    <Text style={[styles.statValue, { color: currentTheme.colors.text }]}>{notificationStats.total}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.resetButton,
                    {
                      backgroundColor: currentTheme.colors.primary + '20',
                      borderColor: currentTheme.colors.primary + '50'
                    }
                  ]}
                  onPress={handleSyncNotifications}
                  disabled={isSyncing}
                >
                  <MaterialIcons
                    name={isSyncing ? "sync" : "sync"}
                    size={24}
                    color={currentTheme.colors.primary}
                    style={isSyncing ? { transform: [{ rotate: '360deg' }] } : {}}
                  />
                  <Text style={[styles.resetButtonText, { color: currentTheme.colors.primary }]}>
                    {isSyncing ? t('notification.syncing') : t('notification.sync_button')}
                  </Text>
                </TouchableOpacity>

                <Text style={[styles.resetDescription, { color: currentTheme.colors.lightGray }]}>
                  {t('notification.sync_desc')}
                </Text>
              </View>

              <View style={[styles.section, { borderBottomColor: currentTheme.colors.border }]}>
                <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>{t('notification.section_advanced')}</Text>

                <TouchableOpacity
                  style={[
                    styles.resetButton,
                    {
                      backgroundColor: currentTheme.colors.error + '20',
                      borderColor: currentTheme.colors.error + '50'
                    }
                  ]}
                  onPress={resetAllNotifications}
                >
                  <MaterialIcons name="refresh" size={24} color={currentTheme.colors.error} />
                  <Text style={[styles.resetButtonText, { color: currentTheme.colors.error }]}>{t('notification.reset_button')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.resetButton,
                    {
                      marginTop: 12,
                      backgroundColor: currentTheme.colors.primary + '20',
                      borderColor: currentTheme.colors.primary + '50'
                    }
                  ]}
                  onPress={handleTestNotification}
                  disabled={countdown !== null}
                >
                  <MaterialIcons name="bug-report" size={24} color={currentTheme.colors.primary} />
                  <Text style={[styles.resetButtonText, { color: currentTheme.colors.primary }]}>
                    {countdown !== null
                      ? t('notification.test_notification_in', { seconds: countdown })
                      : t('notification.test_button')}
                  </Text>
                </TouchableOpacity>

                {countdown !== null && (
                  <View style={styles.countdownContainer}>
                    <MaterialIcons
                      name="timer"
                      size={16}
                      color={currentTheme.colors.primary}
                      style={styles.countdownIcon}
                    />
                    <Text style={[styles.countdownText, { color: currentTheme.colors.primary }]}>
                      {t('notification.test_notification_text', { seconds: countdown })}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}
        </Animated.View>
      </ScrollView>
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
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUSBAR_HEIGHT + 8 : 8,
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
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingText: {
    fontSize: 16,
    marginLeft: 12,
  },
  settingDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  timingOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  timingOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    width: '48%',
    alignItems: 'center',
  },
  timingText: {
    fontSize: 14,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  resetDescription: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  countdownContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderRadius: 4,
  },
  countdownIcon: {
    marginRight: 8,
  },
  countdownText: {
    fontSize: 14,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 2,
  },
});

export default NotificationSettingsScreen;