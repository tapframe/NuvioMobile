import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Platform,
  Linking,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { makeRedirectUri, useAuthRequest, ResponseType, Prompt, CodeChallengeMethod } from 'expo-auth-session';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import FastImage from '@d11/react-native-fast-image';
import { traktService, TraktUser, TraktUserStats } from '../services/traktService';
import { useSettings } from '../hooks/useSettings';
import { logger } from '../utils/logger';
import TraktIcon from '../../assets/rating-icons/trakt.svg';
import { useTheme } from '../contexts/ThemeContext';
import { useTraktIntegration } from '../hooks/useTraktIntegration';
import { useTraktAutosyncSettings } from '../hooks/useTraktAutosyncSettings';
import { useSimklIntegration } from '../hooks/useSimklIntegration';
import { colors } from '../styles';
import CustomAlert from '../components/CustomAlert';
import { useTranslation } from 'react-i18next';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { mmkvStorage } from '../services/mmkvStorage';

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;

// Trakt configuration
const TRAKT_CLIENT_ID = process.env.EXPO_PUBLIC_TRAKT_CLIENT_ID as string;

if (!TRAKT_CLIENT_ID) {
  throw new Error('Missing EXPO_PUBLIC_TRAKT_CLIENT_ID environment variable');
}

const discovery = {
  authorizationEndpoint: 'https://trakt.tv/oauth/authorize',
  tokenEndpoint: 'https://api.trakt.tv/oauth/token',
};

// For use with deep linking
const redirectUri = makeRedirectUri({
  scheme: 'nuvio',
  path: 'auth/trakt',
});

// Library Sync Mode constants
const TRAKT_LIBRARY_SYNC_MODE_KEY = 'trakt_library_sync_mode';

const LIBRARY_SYNC_MODE_OPTIONS = [
  { value: 'off', label: 'Off', description: 'Disable Trakt library sync completely' },
  { value: 'manual', label: 'Manual', description: 'Sync only when you tap the sync button' },
  { value: 'automatic', label: 'Automatic', description: 'Sync automatically when you open Library' },
];

const TraktSettingsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const isDarkMode = settings.enableDarkMode;
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState<TraktUser | null>(null);
  const [userStats, setUserStats] = useState<TraktUserStats | null>(null);
  const { currentTheme } = useTheme();

  const {
    settings: autosyncSettings,
    isSyncing,
    setAutosyncEnabled,
    performManualSync
  } = useTraktAutosyncSettings();

  const {
    isLoading: traktLoading,
    refreshAuthStatus
  } = useTraktIntegration();
  const { isAuthenticated: isSimklAuthenticated } = useSimklIntegration();

  const [showSyncFrequencyModal, setShowSyncFrequencyModal] = useState(false);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<Array<{ label: string; onPress: () => void; style?: object }>>([
    { label: t('common.ok'), onPress: () => setAlertVisible(false) },
  ]);

  // Library Sync Mode state
  const [librarySyncMode, setLibrarySyncMode] = useState<'off' | 'manual' | 'automatic'>('off');
  const librarySyncSheetRef = useRef<BottomSheetModal>(null);
  const librarySyncSnapPoints = useMemo(() => ['45%'], []);

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

  const checkAuthStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const authenticated = await traktService.isAuthenticated();
      setIsAuthenticated(authenticated);

      if (authenticated) {
        const profile = await traktService.getUserProfile();
        setUserProfile(profile);
        try {
          const stats = await traktService.getUserStats();
          setUserStats(stats);
        } catch (statsError) {
          logger.warn('[TraktSettingsScreen] Failed to load stats:', statsError);
          setUserStats(null);
        }
      } else {
        setUserProfile(null);
        setUserStats(null);
      }
    } catch (error) {
      logger.error('[TraktSettingsScreen] Error checking auth status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Load library sync mode on mount
  useEffect(() => {
    const loadLibrarySyncMode = async () => {
      if (isAuthenticated) {
        try {
          const mode = await mmkvStorage.getItem(TRAKT_LIBRARY_SYNC_MODE_KEY);
          if (mode === 'manual' || mode === 'automatic') {
            setLibrarySyncMode(mode);
          } else {
            setLibrarySyncMode('off');
          }
        } catch (error) {
          logger.error('[TraktSettingsScreen] Failed to load library sync mode:', error);
        }
      }
    };
    
    loadLibrarySyncMode();
  }, [isAuthenticated]);

  // Setup expo-auth-session hook with PKCE
  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: TRAKT_CLIENT_ID,
      scopes: [],
      redirectUri: redirectUri,
      responseType: ResponseType.Code,
      usePKCE: true,
      codeChallengeMethod: CodeChallengeMethod.S256,
    },
    discovery
  );

  const [isExchangingCode, setIsExchangingCode] = useState(false);

  // Handle the response from the auth request
  useEffect(() => {
    if (response) {
      setIsExchangingCode(true);
      if (response.type === 'success' && request?.codeVerifier) {
        const { code } = response.params;
        logger.log('[TraktSettingsScreen] Auth code received:', code);
        traktService.exchangeCodeForToken(code, request.codeVerifier)
          .then(success => {
            if (success) {
              logger.log('[TraktSettingsScreen] Token exchange successful');
              checkAuthStatus().then(() => {
                // Show success message
                openAlert(
                  t('trakt.auth_success_title'),
                  t('trakt.auth_success_msg'),
                  [
                    {
                      label: t('common.ok'),
                      onPress: () => navigation.goBack(),
                    }
                  ]
                );
              });
            } else {
              logger.error('[TraktSettingsScreen] Token exchange failed');
              openAlert(t('trakt.auth_error_title'), t('trakt.auth_error_msg'));
            }
          })
          .catch(error => {
            logger.error('[TraktSettingsScreen] Token exchange error:', error);
            openAlert(t('trakt.auth_error_title'), t('trakt.auth_error_generic'));
          })
          .finally(() => {
            setIsExchangingCode(false);
          });
      } else if (response.type === 'error') {
        logger.error('[TraktSettingsScreen] Authentication error:', response.error);
        openAlert(t('trakt.auth_error_title'), response.error?.message || t('trakt.auth_error_generic'));
        setIsExchangingCode(false);
      } else {
        logger.log('[TraktSettingsScreen] Auth response type:', response.type);
        setIsExchangingCode(false);
      }
    }
  }, [response, checkAuthStatus, request?.codeVerifier, navigation]);

  const handleSignIn = () => {
    if (isSimklAuthenticated) {
      openAlert('Conflict', 'You cannot connect to Trakt while Simkl is connected. Please disconnect Simkl first.');
      return;
    }
    promptAsync(); // Trigger the authentication flow
  };

  const handleSignOut = async () => {
    openAlert(
      t('trakt.sign_out'),
      t('trakt.sign_out_confirm'),
      [
        { label: t('common.cancel'), onPress: () => { } },
        {
          label: t('trakt.sign_out'),
          onPress: async () => {
            setIsLoading(true);
            try {
              await traktService.logout();
              setIsAuthenticated(false);
              setUserProfile(null);
              // Refresh auth status in the integration hook to ensure UI consistency
              await refreshAuthStatus();
            } catch (error) {
              logger.error('[TraktSettingsScreen] Error signing out:', error);
              openAlert(t('common.error'), t('trakt.sign_out_error'));
            } finally {
              setIsLoading(false);
            }
          }
        }
      ]
    );
  };

  // Library Sync Mode handlers
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  const handleSelectLibrarySyncMode = async (mode: 'off' | 'manual' | 'automatic') => {
    try {
      setLibrarySyncMode(mode);
      await mmkvStorage.setItem(TRAKT_LIBRARY_SYNC_MODE_KEY, mode);
      librarySyncSheetRef.current?.dismiss();
      
      // Show confirmation
      const modeLabel = LIBRARY_SYNC_MODE_OPTIONS.find(o => o.value === mode)?.label || mode;
      openAlert(
        'Library Sync Mode Updated',
        `Trakt library sync is now set to: ${modeLabel}`
      );
    } catch (error) {
      logger.error('[TraktSettingsScreen] Failed to save library sync mode:', error);
      openAlert('Error', 'Failed to update library sync mode');
    }
  };

  const getLibrarySyncModeLabel = (mode: string): string => {
    const option = LIBRARY_SYNC_MODE_OPTIONS.find(o => o.value === mode);
    return option?.label || 'Off';
  };

  return (
    <SafeAreaView style={[
      styles.container,
      { backgroundColor: isDarkMode ? currentTheme.colors.darkBackground : '#F2F2F7' }
    ]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons
            name="arrow-back"
            size={24}
            color={isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark}
          />
          <Text style={[styles.backText, { color: isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark }]}>
            {t('settings.title')}
          </Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Empty for now, but ready for future actions */}
        </View>
      </View>

      <Text style={[styles.headerTitle, { color: isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark }]}>
        {t('trakt.settings_title')}
      </Text>

      {/* Maintenance Mode Banner */}
      {traktService.isMaintenanceMode() && (
        <View style={styles.maintenanceBanner}>
          <MaterialIcons name="engineering" size={24} color="#FFF" />
          <View style={styles.maintenanceBannerTextContainer}>
            <Text style={styles.maintenanceBannerTitle}>{t('trakt.maintenance_title')}</Text>
            <Text style={styles.maintenanceBannerMessage}>
              {traktService.getMaintenanceMessage()}
            </Text>
          </View>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={[
          styles.card,
          { backgroundColor: currentTheme.colors.elevation2 }
        ]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={currentTheme.colors.primary} />
            </View>
          ) : traktService.isMaintenanceMode() ? (
            <View style={styles.signInContainer}>
              <TraktIcon
                width={120}
                height={120}
                style={[styles.traktLogo, { opacity: 0.5 }]}
              />
              <Text style={[
                styles.signInTitle,
                { color: isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark }
              ]}>
                {t('trakt.maintenance_unavailable')}
              </Text>
              <Text style={[
                styles.signInDescription,
                { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }
              ]}>
                {t('trakt.maintenance_desc')}
              </Text>
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: currentTheme.colors.border, opacity: 0.6 }
                ]}
                disabled={true}
              >
                <MaterialIcons name="engineering" size={20} color={currentTheme.colors.mediumEmphasis} style={{ marginRight: 8 }} />
                <Text style={[styles.buttonText, { color: currentTheme.colors.mediumEmphasis }]}>
                  {t('trakt.maintenance_button')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : isAuthenticated && userProfile ? (
            <View style={styles.profileContainer}>
              <View style={styles.profileHeader}>
                {userProfile.avatar ? (
                  <FastImage
                    source={{ uri: userProfile.avatar }}
                    style={styles.avatar}
                    resizeMode={FastImage.resizeMode.cover}
                  />
                ) : (
                  <View style={[styles.avatarPlaceholder, { backgroundColor: currentTheme.colors.primary }]}>
                    <Text style={styles.avatarText}>
                      {userProfile.name?.charAt(0) || userProfile.username.charAt(0)}
                    </Text>
                  </View>
                )}
                <View style={styles.profileInfo}>
                  <Text style={[
                    styles.profileName,
                    { color: isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark }
                  ]}>
                    {userProfile.name || userProfile.username}
                  </Text>
                  <Text style={[
                    styles.profileUsername,
                    { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }
                  ]}>
                    @{userProfile.username}
                  </Text>
                  {userProfile.vip && (
                    <View style={styles.vipBadge}>
                      <MaterialIcons name="star" size={14} color="#FFF" />
                      <Text style={styles.vipText}>VIP</Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.statsContainer}>
                <Text style={[
                  styles.joinedDate,
                  { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }
                ]}>
                  {t('trakt.joined', { date: new Date(userProfile.joined_at).toLocaleDateString() })}
                </Text>
                {userStats && (
                  <View style={[styles.statsGrid, { borderTopColor: currentTheme.colors.border, borderBottomColor: currentTheme.colors.border }]}> 
                    <View style={styles.statItem}>
                      <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}> 
                        {userStats.movies?.watched ?? 0}
                      </Text>
                      <Text style={[styles.statLabel, { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }]}>
                        Movies
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}> 
                        {userStats.shows?.watched ?? 0}
                      </Text>
                      <Text style={[styles.statLabel, { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }]}> 
                        Shows
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}> 
                        {userStats.episodes?.watched ?? 0}
                      </Text>
                      <Text style={[styles.statLabel, { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }]}> 
                        Episodes
                      </Text>
                    </View>
                    <View style={styles.statItem}>
                      <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}> 
                        {Math.round(((userStats.minutes ?? 0) + (userStats.movies?.minutes ?? 0) + (userStats.shows?.minutes ?? 0) + (userStats.episodes?.minutes ?? 0)) / 60)}h
                      </Text>
                      <Text style={[styles.statLabel, { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }]}> 
                        Watched
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[
                  styles.button,
                  styles.signOutButton,
                  { backgroundColor: currentTheme.colors.error }
                ]}
                onPress={handleSignOut}
              >
                <Text style={styles.buttonText}>{t('trakt.sign_out')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.signInContainer}>
              <TraktIcon
                width={120}
                height={120}
                style={styles.traktLogo}
              />
              <Text style={[
                styles.signInTitle,
                { color: isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark }
              ]}>
                {t('trakt.connect_title')}
              </Text>
              <Text style={[
                styles.signInDescription,
                { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }
              ]}>
                {t('trakt.connect_desc')}
              </Text>
              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: isDarkMode ? currentTheme.colors.primary : currentTheme.colors.primary }
                ]}
                onPress={handleSignIn}
                disabled={!request || isExchangingCode} // Disable while waiting for response or exchanging code
              >
                {isExchangingCode ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.buttonText}>
                    {t('trakt.sign_in')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {isAuthenticated && (
          <View style={[
            styles.card,
            { backgroundColor: isDarkMode ? currentTheme.colors.elevation2 : currentTheme.colors.white }
          ]}>
            <View style={styles.settingsSection}>
              <Text style={[
                styles.sectionTitle,
                { color: currentTheme.colors.highEmphasis }
              ]}>
                {t('trakt.sync_settings_title')}
              </Text>
              <View style={[
                styles.infoBox,
                { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.border }
              ]}>
                <Text style={[
                  styles.infoText,
                  { color: currentTheme.colors.mediumEmphasis }
                ]}>
                  {t('trakt.sync_info')}
                </Text>
              </View>
              <View style={styles.settingItem}>
                <View style={styles.settingContent}>
                  <View style={styles.settingTextContainer}>
                    <Text style={[
                      styles.settingLabel,
                      { color: currentTheme.colors.highEmphasis }
                    ]}>
                      {t('trakt.auto_sync_label')}
                    </Text>
                    <Text style={[
                      styles.settingDescription,
                      { color: currentTheme.colors.mediumEmphasis }
                    ]}>
                      {t('trakt.auto_sync_desc')}
                    </Text>
                  </View>
                  <View style={styles.settingToggleContainer}>
                    <Switch
                      value={autosyncSettings.enabled}
                      onValueChange={setAutosyncEnabled}
                      trackColor={{
                        false: currentTheme.colors.border,
                        true: currentTheme.colors.primary + '80'
                      }}
                      thumbColor={autosyncSettings.enabled ? currentTheme.colors.white : currentTheme.colors.mediumEmphasis}
                    />
                  </View>
                </View>
              </View>

              {/* Library Sync Mode Setting */}
              <View style={styles.settingItem}>
                <TouchableOpacity
                  style={styles.settingContent}
                  onPress={() => librarySyncSheetRef.current?.present()}
                >
                  <View style={styles.settingTextContainer}>
                    <Text style={[
                      styles.settingLabel,
                      { color: currentTheme.colors.highEmphasis }
                    ]}>
                      Library Sync Mode
                    </Text>
                    <Text style={[
                      styles.settingDescription,
                      { color: currentTheme.colors.mediumEmphasis }
                    ]}>
                      {getLibrarySyncModeLabel(librarySyncMode)} - Sync your Trakt watchlist to local library
                    </Text>
                  </View>
                  <MaterialIcons
                    name="chevron-right"
                    size={24}
                    color={currentTheme.colors.mediumEmphasis}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.settingItem}>
                <View style={styles.settingContent}>
                  <View style={styles.settingTextContainer}>
                    <Text style={[
                      styles.settingLabel,
                      { color: currentTheme.colors.highEmphasis }
                    ]}>
                      {t('trakt.import_history_label')}
                    </Text>
                    <Text style={[
                      styles.settingDescription,
                      { color: currentTheme.colors.mediumEmphasis }
                    ]}>
                      {t('trakt.import_history_desc')}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  styles.button,
                  {
                    backgroundColor: currentTheme.colors.card,
                    opacity: isSyncing ? 0.6 : 1
                  }
                ]}
                disabled={isSyncing}
                onPress={async () => {
                  const success = await performManualSync();
                  openAlert(
                    t('trakt.sync_complete_title'),
                    success ? t('trakt.sync_success_msg') : t('trakt.sync_error_msg')
                  );
                }}
              >
                {isSyncing ? (
                  <ActivityIndicator
                    size="small"
                    color={currentTheme.colors.primary}
                  />
                ) : (
                  <Text style={[
                    styles.buttonText,
                    { color: currentTheme.colors.primary }
                  ]}>
                    {t('trakt.sync_now_button')}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Display Settings Section */}
              <Text style={[
                styles.sectionTitle,
                { color: currentTheme.colors.highEmphasis, marginTop: 24 }
              ]}>
                {t('trakt.display_settings_title')}
              </Text>

              <View style={styles.settingItem}>
                <View style={styles.settingContent}>
                  <View style={styles.settingTextContainer}>
                    <Text style={[
                      styles.settingLabel,
                      { color: currentTheme.colors.highEmphasis }
                    ]}>
                      {t('trakt.show_comments_label')}
                    </Text>
                    <Text style={[
                      styles.settingDescription,
                      { color: currentTheme.colors.mediumEmphasis }
                    ]}>
                      {t('trakt.show_comments_desc')}
                    </Text>
                  </View>
                  <View style={styles.settingToggleContainer}>
                    <Switch
                      value={settings.showTraktComments}
                      onValueChange={(value) => updateSetting('showTraktComments', value)}
                      trackColor={{
                        false: currentTheme.colors.border,
                        true: currentTheme.colors.primary + '80'
                      }}
                      thumbColor={settings.showTraktComments ? currentTheme.colors.white : currentTheme.colors.mediumEmphasis}
                    />
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}
        <Text style={[styles.disclaimer, { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }]}>
          This product uses the Trakt API but is not endorsed or certified by Trakt.
        </Text>
      </ScrollView>

      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        onClose={() => setAlertVisible(false)}
        actions={alertActions}
      />

      {/* Library Sync Mode Bottom Sheet */}
      <BottomSheetModal
        ref={librarySyncSheetRef}
        index={0}
        snapPoints={librarySyncSnapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose={true}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: '#1a1a1a' }}
        handleIndicatorStyle={{ backgroundColor: 'rgba(255,255,255,0.3)' }}
      >
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: currentTheme.colors.highEmphasis }]}>
            Library Sync Mode
          </Text>
        </View>
        <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
          {LIBRARY_SYNC_MODE_OPTIONS.map((option) => {
            const isSelected = option.value === librarySyncMode;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.sourceItem,
                  isSelected && {
                    backgroundColor: currentTheme.colors.primary + '20',
                    borderColor: currentTheme.colors.primary
                  }
                ]}
                onPress={() => handleSelectLibrarySyncMode(option.value as 'off' | 'manual' | 'automatic')}
              >
                <View style={styles.sourceItemContent}>
                  <Text style={[
                    styles.sourceLabel,
                    { color: isSelected ? currentTheme.colors.primary : currentTheme.colors.highEmphasis }
                  ]}>
                    {option.label}
                  </Text>
                  <Text style={[
                    styles.sourceDescription,
                    { color: currentTheme.colors.mediumEmphasis }
                  ]}>
                    {option.description}
                  </Text>
                </View>
                {isSelected && (
                  <MaterialIcons
                    name="check"
                    size={20}
                    color={currentTheme.colors.primary}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheetModal>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInContainer: {
    padding: 24,
    alignItems: 'center',
  },
  traktLogo: {
    width: 120,
    height: 120,
    marginBottom: 20,
  },
  signInTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  signInDescription: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  button: {
    width: '100%',
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  signOutButton: {
    marginTop: 20,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
  },
  profileContainer: {
    padding: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 26,
    fontWeight: 'bold',
    color: 'white',
  },
  profileInfo: {
    marginLeft: 16,
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  profileUsername: {
    fontSize: 14,
  },
  vipBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#FFD700',
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  vipText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000',
  },
  statsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  joinedDate: {
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    marginTop: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  settingsSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    marginTop: 8,
  },
  settingItem: {
    marginBottom: 16,
  },
  settingContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 60,
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  settingToggleContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
  },
  infoBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Maintenance mode styles
  maintenanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E67E22',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  maintenanceBannerTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  maintenanceBannerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  maintenanceBannerMessage: {
    fontSize: 13,
    color: '#FFF',
    opacity: 0.9,
  },
  disclaimer: {
    fontSize: 12,
    textAlign: 'center',
    marginVertical: 20,
    paddingHorizontal: 20,
  },
  // Bottom Sheet styles
  sheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  sheetContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 12,
  },
  sourceItemContent: {
    flex: 1,
    marginRight: 12,
  },
  sourceLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  sourceDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
});

export default TraktSettingsScreen; 