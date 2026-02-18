import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useRealtimeConfig } from '../hooks/useRealtimeConfig';

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
  Dimensions,
  Linking,
  FlatList,
} from 'react-native';
import { BottomSheetModal, BottomSheetView, BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { mmkvStorage } from '../services/mmkvStorage';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import FastImage from '@d11/react-native-fast-image';
import LottieView from 'lottie-react-native';
import { Feather } from '@expo/vector-icons';
import { useSettings, DEFAULT_SETTINGS } from '../hooks/useSettings';
import { RootStackParamList } from '../navigation/AppNavigator';
import { stremioService } from '../services/stremioService';
import { useCatalogContext } from '../contexts/CatalogContext';
import { useTraktContext } from '../contexts/TraktContext';
import { useTheme } from '../contexts/ThemeContext';
import { fetchTotalDownloads } from '../services/githubReleaseService';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDisplayedAppVersion } from '../utils/version';
import CustomAlert from '../components/CustomAlert';
import ScreenHeader from '../components/common/ScreenHeader';
import TraktIcon from '../components/icons/TraktIcon';
import { campaignService } from '../services/campaignService';
import { useScrollToTop } from '../contexts/ScrollToTopContext';

// Import reusable content components from settings screens
import { PlaybackSettingsContent } from './settings/PlaybackSettingsScreen';
import { ContentDiscoverySettingsContent } from './settings/ContentDiscoverySettingsScreen';
import { AppearanceSettingsContent } from './settings/AppearanceSettingsScreen';
import { IntegrationsSettingsContent } from './settings/IntegrationsSettingsScreen';
import { AboutSettingsContent, AboutFooter } from './settings/AboutSettingsScreen';
import { PrivacySettingsContent } from './settings/PrivacySettingsScreen';
import { SettingsCard, SettingItem, ChevronRight, CustomSwitch } from './settings/SettingsComponents';
import { useBottomSheetBackHandler } from '../hooks/useBottomSheetBackHandler';
import { LOCALES } from '../constants/locales';
import { useSimklIntegration } from '../hooks/useSimklIntegration';
import SimklIcon from '../components/icons/SimklIcon';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

// Settings categories for tablet sidebar
// Settings categories moved inside component for translation


// Tablet Sidebar Component
interface SidebarProps {
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
  currentTheme: any;
  categories: any[];
  extraTopPadding?: number;
}

const Sidebar: React.FC<SidebarProps> = ({ selectedCategory, onCategorySelect, currentTheme, categories, extraTopPadding = 0 }) => {
  return (
    <View style={[
      styles.sidebar,
      {
        backgroundColor: currentTheme.colors.elevation1,
        borderRightColor: currentTheme.colors.elevation2,
      }
    ]}>
      <View style={[
        styles.sidebarHeader,
        {
          paddingTop: (Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 24 : 48) + extraTopPadding,
          borderBottomColor: currentTheme.colors.elevation2,
        }
      ]}>
        <Text style={[styles.sidebarTitle, { color: currentTheme.colors.highEmphasis }]}>
          Settings
        </Text>
      </View>

      <ScrollView style={styles.sidebarContent} showsVerticalScrollIndicator={false}>
        {categories.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.sidebarItem,
              selectedCategory === category.id && [
                styles.sidebarItemActive,
                { backgroundColor: currentTheme.colors.primary + '10' }
              ]
            ]}
            onPress={() => onCategorySelect(category.id)}
            activeOpacity={0.6}
          >
            <View style={[
              styles.sidebarItemIconContainer,
              {
                backgroundColor: selectedCategory === category.id
                  ? currentTheme.colors.primary + '15'
                  : 'transparent',
              }
            ]}>
              <Feather
                name={category.icon as any}
                size={20}
                color={
                  selectedCategory === category.id
                    ? currentTheme.colors.primary
                    : currentTheme.colors.mediumEmphasis
                }
              />
            </View>
            <Text style={[
              styles.sidebarItemText,
              {
                color: selectedCategory === category.id
                  ? currentTheme.colors.highEmphasis
                  : currentTheme.colors.mediumEmphasis,
                fontWeight: selectedCategory === category.id ? '600' : '500',
              }
            ]}>
              {category.title}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const SettingsScreen: React.FC = () => {
  const { t, i18n } = useTranslation();

  const SETTINGS_CATEGORIES = [
    { id: 'account', title: t('settings.account'), icon: 'user' },
    { id: 'content', title: t('settings.content_discovery'), icon: 'compass' },
    { id: 'appearance', title: t('settings.appearance'), icon: 'sliders' },
    { id: 'integrations', title: t('settings.integrations'), icon: 'layers' },
    { id: 'playback', title: t('settings.playback'), icon: 'play-circle' },
    { id: 'backup', title: t('settings.backup_restore'), icon: 'archive' },
    { id: 'updates', title: t('settings.updates'), icon: 'refresh-ccw' },
    { id: 'privacy', title: t('privacy.title'), icon: 'shield' },
    { id: 'about', title: t('settings.about'), icon: 'info' },
    { id: 'developer', title: t('settings.developer'), icon: 'code' },
    { id: 'cache', title: t('settings.cache'), icon: 'database' },
  ];
  const { settings, updateSetting } = useSettings();
  const [hasUpdateBadge, setHasUpdateBadge] = useState(false);
  const languageSheetRef = useRef<BottomSheetModal>(null);
  const { onChange, onDismiss } = useBottomSheetBackHandler();
  const insets = useSafeAreaInsets();

  // Render backdrop for bottom sheet
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
      />
    ),
    []
  );

  // CustomAlert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<Array<{ label: string; onPress: () => void; style?: object }>>([]);

  const openAlert = (
    title: string,
    message: string,
    actions?: Array<{ label: string; onPress: () => void; style?: object }>
  ) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertActions(actions && actions.length > 0 ? actions : [{ label: 'OK', onPress: () => { } }]);
    setAlertVisible(true);
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let mounted = true;
    (async () => {
      try {
        const flag = await mmkvStorage.getItem('@update_badge_pending');
        if (mounted) setHasUpdateBadge(flag === 'true');
      } catch { }
    })();
    return () => { mounted = false; };
  }, []);

  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { lastUpdate } = useCatalogContext();
  const { isAuthenticated, userProfile, refreshAuthStatus } = useTraktContext();
  const { isAuthenticated: isSimklAuthenticated } = useSimklIntegration();
  const { currentTheme } = useTheme();

  // Tablet-specific state
  const [selectedCategory, setSelectedCategory] = useState('account');

  // States for dynamic content
  const [mdblistKeySet, setMdblistKeySet] = useState<boolean>(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState<boolean>(false);
  const [totalDownloads, setTotalDownloads] = useState<number>(0);
  const [displayDownloads, setDisplayDownloads] = useState<number | null>(null);

  // Use Realtime Config Hook
  const settingsConfig = useRealtimeConfig();

  // Load developer mode state
  useEffect(() => {
    const loadDevModeState = async () => {
      try {
        const devModeEnabled = await mmkvStorage.getItem('developer_mode_enabled');
        setDeveloperModeEnabled(devModeEnabled === 'true');
      } catch (error) {
        if (__DEV__) console.error('Failed to load developer mode state:', error);
      }
    };
    loadDevModeState();
  }, []);

  // Scroll to top ref and handler
  const mobileScrollViewRef = useRef<ScrollView>(null);
  const tabletScrollViewRef = useRef<ScrollView>(null);

  const scrollToTop = useCallback(() => {
    mobileScrollViewRef.current?.scrollTo({ y: 0, animated: true });
    tabletScrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  useScrollToTop('Settings', scrollToTop);

  // Refresh Trakt auth status on focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      refreshAuthStatus();
    });
    return unsubscribe;
  }, [navigation, refreshAuthStatus]);

  const loadData = useCallback(async () => {
    try {
      // Check MDBList API key status
      const mdblistKey = await mmkvStorage.getItem('mdblist_api_key');
      setMdblistKeySet(!!mdblistKey);

      // Check developer mode status
      const devModeEnabled = await mmkvStorage.getItem('developer_mode_enabled');
      setDeveloperModeEnabled(devModeEnabled === 'true');

      // Load GitHub total downloads
      const downloads = await fetchTotalDownloads();
      if (downloads !== null) {
        setTotalDownloads(downloads);
        setDisplayDownloads(downloads);
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading settings data:', error);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, lastUpdate]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation, loadData]);

  // Poll GitHub downloads
  useEffect(() => {
    const shouldPoll = isTablet ? selectedCategory === 'about' : true;
    if (!shouldPoll) return;

    const pollInterval = setInterval(async () => {
      try {
        const downloads = await fetchTotalDownloads();
        if (downloads !== null && downloads !== totalDownloads) {
          setTotalDownloads(downloads);
        }
      } catch (error) {
        if (__DEV__) console.error('Error polling downloads:', error);
      }
    }, 3600000);

    return () => clearInterval(pollInterval);
  }, [selectedCategory, totalDownloads]);

  // Animate counting up when totalDownloads changes
  useEffect(() => {
    if (totalDownloads === null || displayDownloads === null) return;
    if (totalDownloads === displayDownloads) return;

    const start = displayDownloads;
    const end = totalDownloads;
    const duration = 2000;
    const startTime = Date.now();

    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 2);
      const current = Math.floor(start + (end - start) * easeProgress);

      setDisplayDownloads(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayDownloads(end);
      }
    };

    requestAnimationFrame(animate);
  }, [totalDownloads]);

  const handleClearMDBListCache = () => {
    openAlert(
      'Clear MDBList Cache',
      'Are you sure you want to clear all cached MDBList data? This cannot be undone.',
      [
        { label: 'Cancel', onPress: () => { } },
        {
          label: 'Clear',
          onPress: async () => {
            try {
              await mmkvStorage.removeItem('mdblist_cache');
              openAlert('Success', 'MDBList cache has been cleared.');
            } catch (error) {
              openAlert('Error', 'Could not clear MDBList cache.');
              if (__DEV__) console.error('Error clearing MDBList cache:', error);
            }
          }
        }
      ]
    );
  };

  // Helper to check item visibility
  const isItemVisible = (itemId: string) => {
    if (!settingsConfig?.items) return true;
    const item = settingsConfig.items[itemId];
    if (item && item.visible === false) return false;
    return true;
  };
  const showTraktItem = isItemVisible('trakt');
  const showSimklItem = isItemVisible('simkl');
  const showCloudSyncItem = isItemVisible('cloud_sync');

  // Filter categories based on conditions
  const visibleCategories = SETTINGS_CATEGORIES.filter(category => {
    if (settingsConfig?.categories?.[category.id]?.visible === false) return false;
    if (category.id === 'developer' && !__DEV__ && !developerModeEnabled) return false;
    if (category.id === 'cache' && !mdblistKeySet) return false;
    return true;
  });

  // Render tablet category content using reusable components
  const renderCategoryContent = (categoryId: string) => {
    switch (categoryId) {
      case 'account':
        return (
          <SettingsCard title={t('settings.sections.account')} isTablet={isTablet}>
            {showCloudSyncItem && (
              <SettingItem
                title="Nuvio Sync"
                description="Sync data across your Nuvio devices"
                customIcon={
                  <FastImage
                    source={require('../../assets/nuvio-sync-icon-og.png')}
                    style={[styles.syncLogoIcon, isTablet ? styles.syncLogoIconTablet : null]}
                    resizeMode={FastImage.resizeMode.contain}
                  />
                }
                renderControl={() => <ChevronRight />}
                onPress={() => (navigation as any).navigate('SyncSettings')}
                isLast={!showTraktItem && !showSimklItem}
                isTablet={isTablet}
              />
            )}
            {showTraktItem && (
              <SettingItem
                title={t('trakt.title')}
                description={isAuthenticated ? `@${userProfile?.username || 'User'}` : t('settings.sign_in_sync')}
                customIcon={<TraktIcon size={isTablet ? 24 : 20} />}
                renderControl={() => <ChevronRight />}
                onPress={() => navigation.navigate('TraktSettings')}
                isLast={!showSimklItem}
                isTablet={isTablet}
              />
            )}
            {showSimklItem && (
              <SettingItem
                title={t('settings.items.simkl')}
                description={isSimklAuthenticated ? t('settings.items.simkl_connected') : t('settings.items.simkl_desc')}
                customIcon={<SimklIcon size={isTablet ? 24 : 20} />}
                renderControl={() => <ChevronRight />}
                onPress={() => navigation.navigate('SimklSettings')}
                isLast={true}
                isTablet={isTablet}
              />
            )}
          </SettingsCard>
        );

      case 'content':
        return <ContentDiscoverySettingsContent isTablet={isTablet} />;

      case 'appearance':
        return (
          <>
            <SettingsCard title="GENERAL" isTablet={isTablet}>
              <SettingItem
                title={t('settings.language')}
                description={t(`settings.${LOCALES.find(l => l.code === i18n.language)?.key}`)}
                icon="globe"
                renderControl={() => <ChevronRight />}
                onPress={() => languageSheetRef.current?.present()}
                isLast={true}
                isTablet={isTablet}
              />
            </SettingsCard>
            <AppearanceSettingsContent isTablet={isTablet} />
          </>
        );

      case 'integrations':
        return <IntegrationsSettingsContent isTablet={isTablet} />;

      case 'playback':
        return <PlaybackSettingsContent isTablet={isTablet} />;

      case 'about':
        return <AboutSettingsContent isTablet={isTablet} displayDownloads={displayDownloads} />;

      case 'privacy':
        return <PrivacySettingsContent isTablet={isTablet} />;

      case 'developer':
        return (__DEV__ || developerModeEnabled) ? (
          <SettingsCard title={t('settings.sections.testing')} isTablet={isTablet}>
            <SettingItem
              title={t('settings.items.test_onboarding')}
              icon="play-circle"
              onPress={() => navigation.navigate('Onboarding')}
              renderControl={() => <ChevronRight />}
              isTablet={isTablet}
            />
            <SettingItem
              title={'Plugin Tester'}
              description={'Run a plugin and inspect logs/streams'}
              icon="terminal"
              onPress={() => navigation.navigate('PluginTester')}
              renderControl={() => <ChevronRight />}
              isTablet={isTablet}
            />
            <SettingItem
              title={t('settings.items.reset_onboarding')}
              icon="refresh-ccw"
              onPress={async () => {
                try {
                  await mmkvStorage.removeItem('hasCompletedOnboarding');
                  openAlert('Success', 'Onboarding has been reset. Restart the app to see the onboarding flow.');
                } catch (error) {
                  openAlert('Error', 'Failed to reset onboarding.');
                }
              }}
              renderControl={() => <ChevronRight />}
              isTablet={isTablet}
            />
            <SettingItem
              title={t('settings.items.reset_campaigns')}
              description={t('settings.items.reset_campaigns_desc')}
              icon="refresh-cw"
              onPress={async () => {
                await campaignService.resetCampaigns();
                openAlert('Success', 'Campaign history reset. Restart app to see posters again.');
              }}
              renderControl={() => <ChevronRight />}
              isTablet={isTablet}
            />
            <SettingItem
              title={t('settings.items.clear_all_data')}
              icon="trash-2"
              onPress={() => {
                openAlert(
                  t('settings.clear_data'),
                  t('settings.clear_data_desc'),
                  [
                    { label: 'Cancel', onPress: () => { } },
                    {
                      label: 'Clear',
                      onPress: async () => {
                        try {
                          await mmkvStorage.clear();
                          openAlert('Success', 'All data cleared. Please restart the app.');
                        } catch (error) {
                          openAlert('Error', 'Failed to clear data.');
                        }
                      }
                    }
                  ]
                );
              }}
              isLast={true}
              isTablet={isTablet}
            />
          </SettingsCard>
        ) : null;

      case 'cache':
        return mdblistKeySet ? (
          <SettingsCard title={t('settings.sections.cache_management')} isTablet={isTablet}>
            <SettingItem
              title={t('settings.clear_mdblist_cache')}
              icon="database"
              onPress={handleClearMDBListCache}
              isLast={true}
              isTablet={isTablet}
            />
          </SettingsCard>
        ) : null;

      case 'backup':
        return (
          <SettingsCard title={t('settings.backup_restore').toUpperCase()} isTablet={isTablet}>
            <SettingItem
              title={t('settings.backup_restore')}
              description="Create and restore app backups"
              icon="archive"
              renderControl={() => <ChevronRight />}
              onPress={() => navigation.navigate('Backup')}
              isLast={true}
              isTablet={isTablet}
            />
          </SettingsCard>
        );

      case 'updates':
        return (
          <SettingsCard title={t('settings.updates').toUpperCase()} isTablet={isTablet}>
            <SettingItem
              title={t('settings.app_updates')}
              description={t('settings.check_updates')}
              icon="refresh-ccw"
              renderControl={() => <ChevronRight />}
              badge={Platform.OS === 'android' && hasUpdateBadge ? 1 : undefined}
              onPress={async () => {
                if (Platform.OS === 'android') {
                  try { await mmkvStorage.removeItem('@update_badge_pending'); } catch { }
                  setHasUpdateBadge(false);
                }
                navigation.navigate('Update');
              }}
              isLast={true}
              isTablet={isTablet}
            />
          </SettingsCard>
        );

      default:
        return null;
    }
  };

  // Keep headers below floating top navigator on tablets
  const tabletNavOffset = isTablet ? 64 : 0;

  // TABLET LAYOUT
  if (isTablet) {
    return (
      <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
        <StatusBar barStyle={'light-content'} />
        <View style={styles.tabletContainer}>
          <Sidebar
            selectedCategory={selectedCategory}
            onCategorySelect={setSelectedCategory}
            currentTheme={currentTheme}
            categories={visibleCategories}
            extraTopPadding={tabletNavOffset}
          />

          <View style={[
            styles.tabletContent,
            {
              paddingTop: (Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 24 : 48) + tabletNavOffset,
            }
          ]}>
            <ScrollView
              ref={tabletScrollViewRef}
              style={styles.tabletScrollView}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.tabletScrollContent}
            >
              {renderCategoryContent(selectedCategory)}

              {selectedCategory === 'about' && (
                <AboutFooter displayDownloads={displayDownloads} />
              )}
            </ScrollView>
          </View>
        </View>
        <CustomAlert
          visible={alertVisible}
          title={alertTitle}
          message={alertMessage}
          actions={alertActions}
          onClose={() => setAlertVisible(false)}
        />

        <BottomSheetModal
          ref={languageSheetRef}
          index={0}
          snapPoints={['65%']}
          enablePanDownToClose={true}
          backdropComponent={renderBackdrop}
          backgroundStyle={{
            backgroundColor: currentTheme.colors.darkGray || '#0A0C0C',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
          handleIndicatorStyle={{
            backgroundColor: currentTheme.colors.mediumGray,
            width: 40,
          }}
          onChange={onChange(languageSheetRef)}
          onDismiss={onDismiss(languageSheetRef)}
        >
          <View style={[styles.bottomSheetHeader, { backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }]}>
            <Text style={[styles.bottomSheetTitle, { color: currentTheme.colors.white }]}>
              {t('settings.select_language')}
            </Text>
            <TouchableOpacity onPress={() => languageSheetRef.current?.dismiss()}>
              <Feather name="x" size={24} color={currentTheme.colors.lightGray} />
            </TouchableOpacity>
          </View>
          <BottomSheetScrollView
            style={{ backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }}
            contentContainerStyle={[styles.bottomSheetContent, { paddingBottom: insets.bottom + 16 }]}
          >
            {
              LOCALES.sort((a, b) => a.key.localeCompare(b.key)).map(l =>
                <TouchableOpacity
                  key={l.key}
                  style={[
                    styles.languageOption,
                    i18n.language === l.code && { backgroundColor: currentTheme.colors.primary + '20' }
                  ]}
                  onPress={() => {
                    i18n.changeLanguage(l.code);
                    languageSheetRef.current?.dismiss();
                  }}
                >
                  <Text style={[
                    styles.languageText,
                    { color: currentTheme.colors.highEmphasis },
                    i18n.language === l.code && { color: currentTheme.colors.primary, fontWeight: 'bold' }
                  ]}>
                    {t(`settings.${l.key}`)}
                  </Text>
                  {i18n.language === l.code && (
                    <Feather name="check" size={20} color={currentTheme.colors.primary} />
                  )}
                </TouchableOpacity>
              )
            }
          </BottomSheetScrollView>
        </BottomSheetModal>
      </View>
    );
  }

  // MOBILE LAYOUT - Simplified navigation hub
  return (
    <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar barStyle={'light-content'} />
      <ScreenHeader title={t('settings.settings_title')} />
      <View style={{ flex: 1 }}>
        <View style={styles.contentContainer}>
          <ScrollView
            ref={mobileScrollViewRef}
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Account */}
            {(settingsConfig?.categories?.['account']?.visible !== false) && (showTraktItem || showSimklItem || showCloudSyncItem) && (
              <SettingsCard title={t('settings.account').toUpperCase()}>
                {showCloudSyncItem && (
                  <SettingItem
                    title="Nuvio Sync"
                    description="Sync data across your Nuvio devices"
                    customIcon={
                      <FastImage
                        source={require('../../assets/nuvio-sync-icon-og.png')}
                        style={styles.syncLogoIcon}
                        resizeMode={FastImage.resizeMode.contain}
                      />
                    }
                    renderControl={() => <ChevronRight />}
                    onPress={() => (navigation as any).navigate('SyncSettings')}
                    isLast={!showTraktItem && !showSimklItem}
                  />
                )}
                {showTraktItem && (
                  <SettingItem
                    title={t('trakt.title')}
                    description={isAuthenticated ? `@${userProfile?.username || 'User'}` : t('settings.sign_in_sync')}
                    customIcon={<TraktIcon size={20} />}
                    renderControl={() => <ChevronRight />}
                    onPress={() => navigation.navigate('TraktSettings')}
                    isLast={!showSimklItem}
                  />
                )}
                {showSimklItem && (
                  <SettingItem
                    title={t('settings.items.simkl')}
                    description={isSimklAuthenticated ? t('settings.items.simkl_connected') : t('settings.items.simkl_desc')}
                    customIcon={<SimklIcon size={20} />}
                    renderControl={() => <ChevronRight />}
                    onPress={() => navigation.navigate('SimklSettings')}
                    isLast={true}
                  />
                )}
              </SettingsCard>
            )}

            {/* General Settings */}
            {(
              (settingsConfig?.categories?.['content']?.visible !== false) ||
              (settingsConfig?.categories?.['appearance']?.visible !== false) ||
              (settingsConfig?.categories?.['integrations']?.visible !== false) ||
              (settingsConfig?.categories?.['playback']?.visible !== false)
            ) && (
                <SettingsCard title="GENERAL">
                  <SettingItem
                    title={t('settings.language')}
                    description={t(`settings.${LOCALES.find(l => l.code === i18n.language)?.key}`)
                    }
                    icon="globe"
                    renderControl={() => <ChevronRight />}
                    onPress={() => languageSheetRef.current?.present()}
                  />
                  {(settingsConfig?.categories?.['content']?.visible !== false) && (
                    <SettingItem
                      title={t('settings.content_discovery')}
                      description={t('settings.add_catalogs_sources')}
                      icon="compass"
                      renderControl={() => <ChevronRight />}
                      onPress={() => navigation.navigate('ContentDiscoverySettings')}
                    />
                  )}
                  {(settingsConfig?.categories?.['appearance']?.visible !== false) && (
                    <SettingItem
                      title={t('settings.appearance')}
                      description={currentTheme.name}
                      icon="sliders"
                      renderControl={() => <ChevronRight />}
                      onPress={() => navigation.navigate('AppearanceSettings')}
                    />
                  )}
                  {(settingsConfig?.categories?.['integrations']?.visible !== false) && (
                    <SettingItem
                      title={t('settings.integrations')}
                      description={t('settings.mdblist_tmdb_ai')}
                      icon="layers"
                      renderControl={() => <ChevronRight />}
                      onPress={() => navigation.navigate('IntegrationsSettings')}
                    />
                  )}
                  {(settingsConfig?.categories?.['playback']?.visible !== false) && (
                    <SettingItem
                      title={t('settings.playback')}
                      description={t('settings.player_trailers_downloads')}
                      icon="play-circle"
                      renderControl={() => <ChevronRight />}
                      onPress={() => navigation.navigate('PlaybackSettings')}
                      isLast
                    />
                  )}
                </SettingsCard>
              )}

            {/* Data */}
            {(
              (settingsConfig?.categories?.['backup']?.visible !== false) ||
              (settingsConfig?.categories?.['updates']?.visible !== false)
            ) && (
                <SettingsCard title="DATA">
                  {(settingsConfig?.categories?.['backup']?.visible !== false) && (
                    <SettingItem
                      title={t('settings.backup_restore')}
                      description="Create and restore app backups"
                      icon="archive"
                      renderControl={() => <ChevronRight />}
                      onPress={() => navigation.navigate('Backup')}
                    />
                  )}
                  {(settingsConfig?.categories?.['updates']?.visible !== false) && (
                    <SettingItem
                      title={t('settings.app_updates')}
                      description={t('settings.check_updates')}
                      icon="refresh-ccw"
                      badge={Platform.OS === 'android' && hasUpdateBadge ? 1 : undefined}
                      renderControl={() => <ChevronRight />}
                      onPress={async () => {
                        if (Platform.OS === 'android') {
                          try { await mmkvStorage.removeItem('@update_badge_pending'); } catch { }
                          setHasUpdateBadge(false);
                        }
                        navigation.navigate('Update');
                      }}
                      isLast
                    />
                  )}
                </SettingsCard>
              )}

            {/* Cache - only if MDBList is set */}
            {mdblistKeySet && (
              <SettingsCard title="CACHE">
                <SettingItem
                  title={t('settings.clear_mdblist_cache')}
                  icon="database"
                  onPress={handleClearMDBListCache}
                  isLast
                />
              </SettingsCard>
            )}

            {/* About */}
            <SettingsCard title={t('settings.about').toUpperCase()}>
              <SettingItem
                title={t('settings.items.contributors')}
                description={t('settings.items.view_contributors')}
                icon="users"
                renderControl={() => <ChevronRight />}
                onPress={() => navigation.navigate('Contributors')}
              />
              <SettingItem
                title={t('privacy.title')}
                description={t('privacy.settings_desc')}
                icon="shield"
                renderControl={() => <ChevronRight />}
                onPress={() => navigation.navigate('PrivacySettings')}
              />
              <SettingItem
                title={t('settings.about_nuvio')}
                description={getDisplayedAppVersion()}
                icon="info"
                renderControl={() => <ChevronRight />}
                onPress={() => navigation.navigate('AboutSettings')}
                isLast
              />
            </SettingsCard>

            {/* Developer - visible in DEV mode or when developer mode is enabled */}
            {(__DEV__ || developerModeEnabled) && (
              <SettingsCard title={t('settings.sections.testing')}>
                <SettingItem
                  title={t('settings.items.developer_tools')}
                  description={t('settings.items.developer_tools_desc')}
                  icon="code"
                  renderControl={() => <ChevronRight />}
                  onPress={() => navigation.navigate('DeveloperSettings')}
                  isLast
                />
              </SettingsCard>
            )}

            {/* Downloads Counter */}
            {settingsConfig?.items?.['downloads_counter']?.visible !== false && displayDownloads !== null && (
              <View style={styles.downloadsContainer}>
                <Text style={[styles.downloadsNumber, { color: currentTheme.colors.primary }]}>
                  {displayDownloads.toLocaleString()}
                </Text>
                <Text style={[styles.downloadsLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                  {t('settings.downloads_counter')}
                </Text>
              </View>
            )}

            {/* Support & Community Buttons */}
            <View style={styles.discordContainer}>
              <TouchableOpacity
                style={[styles.discordButton, { backgroundColor: 'transparent', paddingVertical: 0, paddingHorizontal: 0, marginBottom: 8 }]}
                onPress={() => WebBrowser.openBrowserAsync('https://ko-fi.com/tapframe', {
                  presentationStyle: Platform.OS === 'ios' ? WebBrowser.WebBrowserPresentationStyle.FORM_SHEET : WebBrowser.WebBrowserPresentationStyle.FORM_SHEET
                })}
                activeOpacity={0.7}
              >
                <FastImage
                  source={require('../../assets/support_me_on_kofi_red.png')}
                  style={styles.kofiImage}
                  resizeMode={FastImage.resizeMode.contain}
                />
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                <TouchableOpacity
                  style={[styles.discordButton, { backgroundColor: currentTheme.colors.elevation1 }]}
                  onPress={() => Linking.openURL('https://discord.gg/KVgDTjhA4H')}
                  activeOpacity={0.7}
                >
                  <View style={styles.discordButtonContent}>
                    <FastImage
                      source={{ uri: 'https://pngimg.com/uploads/discord/discord_PNG3.png' }}
                      style={styles.discordLogo}
                      resizeMode={FastImage.resizeMode.contain}
                    />
                    <Text style={[styles.discordButtonText, { color: currentTheme.colors.highEmphasis }]}>
                      Discord
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.discordButton, { backgroundColor: '#FF4500' + '15' }]}
                  onPress={() => Linking.openURL('https://www.reddit.com/r/Nuvio/')}
                  activeOpacity={0.7}
                >
                  <View style={styles.discordButtonContent}>
                    <FastImage
                      source={{ uri: 'https://www.iconpacks.net/icons/2/free-reddit-logo-icon-2436-thumb.png' }}
                      style={styles.discordLogo}
                      resizeMode={FastImage.resizeMode.contain}
                    />
                    <Text style={[styles.discordButtonText, { color: '#FF4500' }]}>
                      Reddit
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Monkey Animation */}
            <View style={styles.monkeyContainer}>
              <LottieView
                source={require('../assets/lottie/monito.json')}
                autoPlay
                loop
                style={styles.monkeyAnimation}
                resizeMode="contain"
              />
            </View>

            <View style={styles.brandLogoContainer}>
              <FastImage
                source={require('../../assets/text_only_og.png')}
                style={styles.brandLogo}
                resizeMode={FastImage.resizeMode.contain}
              />
            </View>

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: currentTheme.colors.mediumEmphasis }]}>
                {t('settings.made_with_love')}
              </Text>
            </View>

            <View style={{ height: 50 }} />
          </ScrollView>
        </View>
      </View>
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        actions={alertActions}
        onClose={() => setAlertVisible(false)}
      />

      <BottomSheetModal
        ref={languageSheetRef}
        index={0}
        snapPoints={['65%']}
        enablePanDownToClose={true}
        backdropComponent={renderBackdrop}
        backgroundStyle={{
          backgroundColor: currentTheme.colors.darkGray || '#0A0C0C',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        }}
        handleIndicatorStyle={{
          backgroundColor: currentTheme.colors.mediumGray,
          width: 40,
        }}
        onChange={onChange(languageSheetRef)}
        onDismiss={onDismiss(languageSheetRef)}
      >
        <View style={[styles.bottomSheetHeader, { backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }]}>
          <Text style={[styles.bottomSheetTitle, { color: currentTheme.colors.white }]}>
            {t('settings.select_language')}
          </Text>
          <TouchableOpacity onPress={() => languageSheetRef.current?.dismiss()}>
            <Feather name="x" size={24} color={currentTheme.colors.lightGray} />
          </TouchableOpacity>
        </View>
        <BottomSheetScrollView
          style={{ backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }}
          contentContainerStyle={[styles.bottomSheetContent, { paddingBottom: insets.bottom + 16 }]}
        >
          {
            LOCALES.sort((a, b) => a.key.localeCompare(b.key)).map(l =>
              <TouchableOpacity
                key={l.key}
                style={[
                  styles.languageOption,
                  i18n.language === l.code && { backgroundColor: currentTheme.colors.primary + '20' }
                ]}
                onPress={() => {
                  i18n.changeLanguage(l.code);
                  languageSheetRef.current?.dismiss();
                }}
              >
                <Text style={[
                  styles.languageText,
                  { color: currentTheme.colors.highEmphasis },
                  i18n.language === l.code && { color: currentTheme.colors.primary, fontWeight: 'bold' }
                ]}>
                  {t(`settings.${l.key}`)}
                </Text>
                {i18n.language === l.code && (
                  <Feather name="check" size={20} color={currentTheme.colors.primary} />
                )}
              </TouchableOpacity>
            )
          }
        </BottomSheetScrollView>
      </BottomSheetModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  actionSheetContent: {
    flex: 1,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  bottomSheetContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  languageText: {
    fontSize: 16,
  },
  // Mobile styles
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
    paddingTop: 8,
    paddingBottom: 32,
  },
  // Tablet-specific styles
  tabletContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 280,
    borderRightWidth: 1,
  },
  sidebarHeader: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 24 : 48,
    borderBottomWidth: 1,
  },
  sidebarTitle: {
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sidebarContent: {
    flex: 1,
    paddingTop: 12,
    paddingBottom: 24,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginVertical: 2,
    borderRadius: 10,
  },
  sidebarItemActive: {
    borderRadius: 10,
  },
  sidebarItemIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarItemText: {
    fontSize: 15,
    marginLeft: 12,
  },
  tabletContent: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 24 : 48,
  },
  tabletScrollView: {
    flex: 1,
    paddingHorizontal: 40,
  },
  tabletScrollContent: {
    paddingTop: 8,
    paddingBottom: 40,
  },
  // Footer and social styles
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 48,
  },
  footerText: {
    fontSize: 13,
    opacity: 0.5,
    letterSpacing: 0.2,
  },
  discordContainer: {
    marginTop: 12,
    marginBottom: 24,
    alignItems: 'center',
  },
  discordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    maxWidth: 200,
  },
  discordButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  discordLogo: {
    width: 18,
    height: 18,
    marginRight: 10,
  },
  discordButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  kofiImage: {
    height: 34,
    width: 155,
  },
  downloadsContainer: {
    marginTop: 32,
    marginBottom: 16,
    alignItems: 'center',
  },
  downloadsNumber: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  downloadsLabel: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.5,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  monkeyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 16,
  },
  monkeyAnimation: {
    width: 180,
    height: 180,
  },
  syncLogoIcon: {
    width: 20,
    height: 20,
  },
  syncLogoIconTablet: {
    width: 24,
    height: 24,
  },
  brandLogoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 16,
    opacity: 0.8,
  },
  brandLogo: {
    width: 120,
    height: 40,
  },
});

export default SettingsScreen;
