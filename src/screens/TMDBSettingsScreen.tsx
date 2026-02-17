import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  StatusBar,
  Platform,
  ActivityIndicator,
  Linking,
  ScrollView,
  Keyboard,
  Clipboard,
  Switch,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { mmkvStorage } from '../services/mmkvStorage';
import FastImage from '@d11/react-native-fast-image';
import { tmdbService } from '../services/tmdbService';
import { useSettings } from '../hooks/useSettings';
import { logger } from '../utils/logger';
import { useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CustomAlert from '../components/CustomAlert';
import { useTranslation } from 'react-i18next';
// (duplicate import removed)

const TMDB_API_KEY_STORAGE_KEY = 'tmdb_api_key';
const USE_CUSTOM_TMDB_API_KEY = 'use_custom_tmdb_api_key';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';

// Define example shows with their IMDB IDs and TMDB IDs
const EXAMPLE_SHOWS = [
  {
    name: 'Breaking Bad',
    imdbId: 'tt0903747',
    tmdbId: '1396',
    type: 'tv' as const
  },
  {
    name: 'Friends',
    imdbId: 'tt0108778',
    tmdbId: '1668',
    type: 'tv' as const
  },
  {
    name: 'Stranger Things',
    imdbId: 'tt4574334',
    tmdbId: '66732',
    type: 'tv' as const
  },
  {
    name: 'Avatar',
    imdbId: 'tt0499549',
    tmdbId: '19995',
    type: 'movie' as const
  },
];

const TMDBSettingsScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isKeySet, setIsKeySet] = useState(false);
  const [useCustomKey, setUseCustomKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<Array<{ label: string; onPress: () => void; style?: object }>>([
    { label: t('common.ok'), onPress: () => setAlertVisible(false) },
  ]);
  const apiKeyInputRef = useRef<TextInput>(null);
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting } = useSettings();
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);
  const [languageSearch, setLanguageSearch] = useState('');

  // Logo preview state
  const [selectedShow, setSelectedShow] = useState(EXAMPLE_SHOWS[0]);
  const [tmdbLogo, setTmdbLogo] = useState<string | null>(null);
  const [tmdbBanner, setTmdbBanner] = useState<string | null>(null);
  const [loadingLogos, setLoadingLogos] = useState(true);
  const [previewLanguage, setPreviewLanguage] = useState<string>('');
  const [isPreviewFallback, setIsPreviewFallback] = useState<boolean>(false);
  const [cacheSize, setCacheSize] = useState<string>('0 KB');

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

  useEffect(() => {
    logger.log('[TMDBSettingsScreen] Component mounted');
    loadSettings();
    calculateCacheSize();
    return () => {
      logger.log('[TMDBSettingsScreen] Component unmounted');
    };
  }, []);

  const calculateCacheSize = async () => {
    try {
      const keys = await mmkvStorage.getAllKeys();
      const tmdbKeys = keys.filter(key => key.startsWith('tmdb_cache_'));

      let totalSize = 0;
      for (const key of tmdbKeys) {
        const value = mmkvStorage.getString(key);
        if (value) {
          totalSize += value.length;
        }
      }

      // Convert to KB/MB
      let sizeStr = '';
      if (totalSize < 1024) {
        sizeStr = `${totalSize} B`;
      } else if (totalSize < 1024 * 1024) {
        sizeStr = `${(totalSize / 1024).toFixed(2)} KB`;
      } else {
        sizeStr = `${(totalSize / (1024 * 1024)).toFixed(2)} MB`;
      }

      setCacheSize(sizeStr);
    } catch (error) {
      logger.error('[TMDBSettingsScreen] Error calculating cache size:', error);
      setCacheSize('Unknown');
    }
  };

  const handleClearCache = () => {
    openAlert(
      t('tmdb_settings.clear_cache_title'),
      t('tmdb_settings.clear_cache_msg', { size: cacheSize }),
      [
        {
          label: t('common.cancel'),
          onPress: () => logger.log('[TMDBSettingsScreen] Clear cache cancelled'),
        },
        {
          label: t('tmdb_settings.clear_cache'),
          onPress: async () => {
            logger.log('[TMDBSettingsScreen] Proceeding with cache clear');
            try {
              await tmdbService.clearAllCache();
              setCacheSize('0 KB');
              logger.log('[TMDBSettingsScreen] Cache cleared successfully');
              openAlert(t('common.success'), t('tmdb_settings.clear_cache_success'));
            } catch (error) {
              logger.error('[TMDBSettingsScreen] Failed to clear cache:', error);
              openAlert(t('common.error'), t('tmdb_settings.clear_cache_error'));
            }
          },
        },
      ]
    );
  };

  const loadSettings = async () => {
    logger.log('[TMDBSettingsScreen] Loading settings from storage');
    try {
      const [savedKey, savedUseCustomKey] = await Promise.all([
        mmkvStorage.getItem(TMDB_API_KEY_STORAGE_KEY),
        mmkvStorage.getItem(USE_CUSTOM_TMDB_API_KEY)
      ]);

      logger.log('[TMDBSettingsScreen] API key status:', savedKey ? 'Found' : 'Not found');
      logger.log('[TMDBSettingsScreen] Use custom API setting:', savedUseCustomKey);

      if (savedKey) {
        setApiKey(savedKey);
        setIsKeySet(true);
      } else {
        setIsKeySet(false);
      }

      setUseCustomKey(savedUseCustomKey === 'true');
    } catch (error) {
      logger.error('[TMDBSettingsScreen] Failed to load settings:', error);
      setIsKeySet(false);
      setUseCustomKey(false);
    } finally {
      setIsLoading(false);
      logger.log('[TMDBSettingsScreen] Finished loading settings');
    }
  };

  const saveApiKey = async () => {
    logger.log('[TMDBSettingsScreen] Starting API key save');
    Keyboard.dismiss();

    try {
      const trimmedKey = apiKey.trim();
      if (!trimmedKey) {
        logger.warn('[TMDBSettingsScreen] Empty API key provided');
        setTestResult({ success: false, message: t('tmdb_settings.empty_api_key') });
        return;
      }

      // Test the API key to make sure it works
      if (await testApiKey(trimmedKey)) {
        logger.log('[TMDBSettingsScreen] API key test successful, saving key');
        await mmkvStorage.setItem(TMDB_API_KEY_STORAGE_KEY, trimmedKey);
        await mmkvStorage.setItem(USE_CUSTOM_TMDB_API_KEY, 'true');
        setIsKeySet(true);
        setUseCustomKey(true);
        setTestResult({ success: true, message: t('tmdb_settings.key_verified') });
        logger.log('[TMDBSettingsScreen] API key saved successfully');
      } else {
        logger.warn('[TMDBSettingsScreen] API key test failed');
        setTestResult({ success: false, message: t('tmdb_settings.invalid_api_key') });
      }
    } catch (error) {
      logger.error('[TMDBSettingsScreen] Error saving API key:', error);
      setTestResult({
        success: false,
        message: t('tmdb_settings.save_error')
      });
    }
  };

  const testApiKey = async (key: string): Promise<boolean> => {
    try {
      // Simple API call to test the key using the API key parameter method
      const response = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${key}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        }
      );
      return response.ok;
    } catch (error) {
      logger.error('[TMDBSettingsScreen] API key test error:', error);
      return false;
    }
  };

  const clearApiKey = async () => {
    logger.log('[TMDBSettingsScreen] Clear API key requested');
    openAlert(
      t('tmdb_settings.clear_api_key_title'),
      t('tmdb_settings.clear_api_key_msg'),
      [
        {
          label: t('common.cancel'),
          onPress: () => logger.log('[TMDBSettingsScreen] Clear API key cancelled'),
        },
        {
          label: t('mdblist.clear'),
          onPress: async () => {
            logger.log('[TMDBSettingsScreen] Proceeding with API key clear');
            try {
              await mmkvStorage.removeItem(TMDB_API_KEY_STORAGE_KEY);
              await mmkvStorage.setItem(USE_CUSTOM_TMDB_API_KEY, 'false');
              setApiKey('');
              setIsKeySet(false);
              setUseCustomKey(false);
              setTestResult(null);
              logger.log('[TMDBSettingsScreen] API key cleared successfully');
            } catch (error) {
              logger.error('[TMDBSettingsScreen] Failed to clear API key:', error);
              openAlert(t('common.error'), t('tmdb_settings.clear_api_key_error'));
            }
          },
        },
      ]
    );
  };

  const toggleUseCustomKey = async (value: boolean) => {
    logger.log('[TMDBSettingsScreen] Toggle use custom key:', value);
    try {
      await mmkvStorage.setItem(USE_CUSTOM_TMDB_API_KEY, value ? 'true' : 'false');
      setUseCustomKey(value);

      if (!value) {
        // If switching to built-in key, show confirmation
        logger.log('[TMDBSettingsScreen] Switching to built-in API key');
        setTestResult({
          success: true,
          message: t('tmdb_settings.using_builtin_key')
        });
      } else if (apiKey && isKeySet) {
        // If switching to custom key and we have a key
        logger.log('[TMDBSettingsScreen] Switching to custom API key');
        setTestResult({
          success: true,
          message: t('tmdb_settings.using_custom_key')
        });
      } else {
        // If switching to custom key but don't have a key yet
        logger.log('[TMDBSettingsScreen] No custom key available yet');
        setTestResult({
          success: false,
          message: t('tmdb_settings.enter_custom_key')
        });
      }
    } catch (error) {
      logger.error('[TMDBSettingsScreen] Failed to toggle custom key setting:', error);
    }
  };

  const pasteFromClipboard = async () => {
    logger.log('[TMDBSettingsScreen] Attempting to paste from clipboard');
    try {
      const clipboardContent = await Clipboard.getString();
      if (clipboardContent) {
        logger.log('[TMDBSettingsScreen] Content pasted from clipboard');
        setApiKey(clipboardContent);
        setTestResult(null);
      } else {
        logger.warn('[TMDBSettingsScreen] No content in clipboard');
      }
    } catch (error) {
      logger.error('[TMDBSettingsScreen] Error pasting from clipboard:', error);
    }
  };

  const openTMDBWebsite = () => {
    logger.log('[TMDBSettingsScreen] Opening TMDb website');
    Linking.openURL('https://www.themoviedb.org/settings/api').catch(error => {
      logger.error('[TMDBSettingsScreen] Error opening website:', error);
    });
  };

  // Logo preview functions
  const fetchExampleLogos = async (show: typeof EXAMPLE_SHOWS[0]) => {
    setLoadingLogos(true);
    setTmdbLogo(null);
    setTmdbBanner(null);

    try {
      const tmdbId = show.tmdbId;
      const contentType = show.type;

      logger.log(`[TMDBSettingsScreen] Fetching ${show.name} with TMDB ID: ${tmdbId}`);

      const preferredTmdbLanguage = settings.tmdbLanguagePreference || 'en';

      const apiKey = TMDB_API_KEY;
      const endpoint = contentType === 'tv' ? 'tv' : 'movie';
      const response = await fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}/images?api_key=${apiKey}`);
      const imagesData = await response.json();

      if (imagesData.logos && imagesData.logos.length > 0) {
        let logoPath: string | null = null;
        let logoLanguage = preferredTmdbLanguage;

        // Try to find logo in preferred language
        const preferredLogo = imagesData.logos.find((logo: { iso_639_1: string; file_path: string }) => logo.iso_639_1 === preferredTmdbLanguage);

        if (preferredLogo) {
          logoPath = preferredLogo.file_path;
          logoLanguage = preferredTmdbLanguage;
          setIsPreviewFallback(false);
        } else {
          // Fallback to English
          const englishLogo = imagesData.logos.find((logo: { iso_639_1: string; file_path: string }) => logo.iso_639_1 === 'en');

          if (englishLogo) {
            logoPath = englishLogo.file_path;
            logoLanguage = 'en';
            setIsPreviewFallback(true);
          } else if (imagesData.logos[0]) {
            // Fallback to first available
            logoPath = imagesData.logos[0].file_path;
            logoLanguage = imagesData.logos[0].iso_639_1 || 'unknown';
            setIsPreviewFallback(true);
          }
        }

        if (logoPath) {
          setTmdbLogo(`https://image.tmdb.org/t/p/original${logoPath}`);
          setPreviewLanguage(logoLanguage);
        } else {
          setPreviewLanguage('');
          setIsPreviewFallback(false);
        }
      } else {
        setPreviewLanguage('');
        setIsPreviewFallback(false);
      }

      // Get TMDB banner (backdrop)
      if (imagesData.backdrops && imagesData.backdrops.length > 0) {
        const backdropPath = imagesData.backdrops[0].file_path;
        setTmdbBanner(`https://image.tmdb.org/t/p/original${backdropPath}`);
      } else {
        const detailsResponse = await fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${apiKey}`);
        const details = await detailsResponse.json();

        if (details.backdrop_path) {
          setTmdbBanner(`https://image.tmdb.org/t/p/original${details.backdrop_path}`);
        }
      }
    } catch (err) {
      logger.error(`[TMDBSettingsScreen] Error fetching ${show.name} preview:`, err);
    } finally {
      setLoadingLogos(false);
    }
  };

  const handleShowSelect = (show: typeof EXAMPLE_SHOWS[0]) => {
    setSelectedShow(show);
    try {
      mmkvStorage.setItem('tmdb_settings_selected_show', show.imdbId);
    } catch (e) {
      if (__DEV__) console.error('Error saving selected show:', e);
    }
  };

  const renderLogoExample = (logo: string | null, banner: string | null, isLoading: boolean) => {
    if (isLoading) {
      return (
        <View style={[styles.exampleImage, styles.loadingContainer]}>
          <ActivityIndicator size="small" color={currentTheme.colors.primary} />
        </View>
      );
    }

    return (
      <View style={styles.bannerContainer}>
        <FastImage
          source={{ uri: banner || undefined }}
          style={styles.bannerImage}
          resizeMode={FastImage.resizeMode.cover}
        />
        <View style={styles.bannerOverlay} />
        {logo && (
          <FastImage
            source={{ uri: logo }}
            style={styles.logoOverBanner}
            resizeMode={FastImage.resizeMode.contain}
          />
        )}
        {!logo && (
          <View style={styles.noLogoContainer}>
            <Text style={styles.noLogoText}>{t('tmdb_settings.no_logo')}</Text>
          </View>
        )}
      </View>
    );
  };

  // Load example logos when show or language changes
  useEffect(() => {
    if (settings.enrichMetadataWithTMDB && settings.useTmdbLocalizedMetadata) {
      fetchExampleLogos(selectedShow);
    }
  }, [selectedShow, settings.enrichMetadataWithTMDB, settings.useTmdbLocalizedMetadata, settings.tmdbLanguagePreference]);

  // Load selected show from AsyncStorage on mount
  useEffect(() => {
    const loadSelectedShow = async () => {
      try {
        const savedShowId = await mmkvStorage.getItem('tmdb_settings_selected_show');
        if (savedShowId) {
          const foundShow = EXAMPLE_SHOWS.find(show => show.imdbId === savedShowId);
          if (foundShow) {
            setSelectedShow(foundShow);
          }
        }
      } catch (e) {
        if (__DEV__) console.error('Error loading selected show:', e);
      }
    };

    loadSelectedShow();
  }, []);

  const headerBaseHeight = Platform.OS === 'android' ? 80 : 60;
  const topSpacing = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : insets.top;
  const headerHeight = headerBaseHeight + topSpacing;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={currentTheme.colors.primary} />
          <Text style={[styles.loadingText, { color: currentTheme.colors.text }]}>{t('common.loading')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.headerContainer, { paddingTop: topSpacing }]}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <MaterialIcons name="chevron-left" size={28} color={currentTheme.colors.primary} />
            <Text style={[styles.backText, { color: currentTheme.colors.primary }]}>{t('settings.settings_title')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>
          {t('tmdb_settings.title')}
        </Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Metadata Enrichment Section */}
        <View style={[styles.sectionCard, { backgroundColor: currentTheme.colors.elevation2 }]}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="movie" size={20} color={currentTheme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.metadata_enrichment')}</Text>
          </View>
          <Text style={[styles.sectionDescription, { color: currentTheme.colors.mediumEmphasis }]}>
            {t('tmdb_settings.metadata_enrichment_desc')}
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.enable_enrichment')}</Text>
              <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                {t('tmdb_settings.enable_enrichment_desc')}
              </Text>
            </View>
            <Switch
              value={settings.enrichMetadataWithTMDB}
              onValueChange={(v) => updateSetting('enrichMetadataWithTMDB', v)}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
              thumbColor={Platform.OS === 'android' ? (settings.enrichMetadataWithTMDB ? currentTheme.colors.white : currentTheme.colors.white) : ''}
              ios_backgroundColor={'rgba(255,255,255,0.1)'}
            />
          </View>

          {settings.enrichMetadataWithTMDB && (
            <>
              <View style={styles.divider} />

              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.localized_text')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.localized_text_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.useTmdbLocalizedMetadata}
                  onValueChange={(v) => updateSetting('useTmdbLocalizedMetadata', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? (settings.useTmdbLocalizedMetadata ? currentTheme.colors.white : currentTheme.colors.white) : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {settings.useTmdbLocalizedMetadata && (
                <>
                  <View style={styles.divider} />

                  <View style={styles.settingRow}>
                    <View style={styles.settingTextContainer}>
                      <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.language')}</Text>
                      <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                        Current: {(settings.tmdbLanguagePreference || 'en').toUpperCase()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setLanguagePickerVisible(true)}
                      style={[styles.languageButton, { backgroundColor: currentTheme.colors.primary }]}
                    >
                      <Text style={[styles.languageButtonText, { color: currentTheme.colors.white }]}>{t('tmdb_settings.change')}</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Logo Preview */}
                  <View style={styles.divider} />

                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text, marginBottom: 8 }]}>{t('tmdb_settings.logo_preview')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis, marginBottom: 12 }]}>
                    {t('tmdb_settings.logo_preview_desc')}
                  </Text>

                  {/* Show selector */}
                  <Text style={[styles.selectorLabel, { color: currentTheme.colors.mediumEmphasis }]}>{t('tmdb_settings.example')}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.showsScrollContent}
                    style={styles.showsScrollView}
                  >
                    {EXAMPLE_SHOWS.map((show) => (
                      <TouchableOpacity
                        key={show.imdbId}
                        style={[
                          styles.showItem,
                          { backgroundColor: currentTheme.colors.elevation1 },
                          selectedShow.imdbId === show.imdbId && [styles.selectedShowItem, { borderColor: currentTheme.colors.primary }]
                        ]}
                        onPress={() => handleShowSelect(show)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.showItemText,
                            { color: currentTheme.colors.mediumEmphasis },
                            selectedShow.imdbId === show.imdbId && [styles.selectedShowItemText, { color: currentTheme.colors.white }]
                          ]}
                        >
                          {show.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Preview card */}
                  <View style={[styles.logoPreviewCard, { backgroundColor: currentTheme.colors.elevation1 }]}>
                    {renderLogoExample(tmdbLogo, tmdbBanner, loadingLogos)}
                    {tmdbLogo && (
                      <Text style={[styles.logoSourceLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                        {`Language: ${(previewLanguage || '').toUpperCase() || 'N/A'}${isPreviewFallback ? ' (fallback to available)' : ''}`}
                      </Text>
                    )}
                  </View>
                </>
              )}

              {/* Granular Enrichment Options */}
              <View style={styles.divider} />

              <Text style={[styles.settingTitle, { color: currentTheme.colors.text, marginBottom: 4 }]}>{t('tmdb_settings.enrichment_options')}</Text>
              <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis, marginBottom: 16 }]}>
                {t('tmdb_settings.enrichment_options_desc')}
              </Text>

              {/* Cast & Crew */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.cast_crew')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.cast_crew_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichCast}
                  onValueChange={(v) => updateSetting('tmdbEnrichCast', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Title & Description */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.title_description')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.title_description_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichTitleDescription}
                  onValueChange={(v) => updateSetting('tmdbEnrichTitleDescription', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Title Logos */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.title_logos')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.title_logos_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichLogos}
                  onValueChange={(v) => updateSetting('tmdbEnrichLogos', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Banners/Backdrops */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.banners_backdrops')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.banners_backdrops_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichBanners}
                  onValueChange={(v) => updateSetting('tmdbEnrichBanners', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Certification */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.certification')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.certification_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichCertification}
                  onValueChange={(v) => updateSetting('tmdbEnrichCertification', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Recommendations */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.recommendations')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.recommendations_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichRecommendations}
                  onValueChange={(v) => updateSetting('tmdbEnrichRecommendations', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Episode Data */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.episode_data')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.episode_data_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichEpisodes}
                  onValueChange={(v) => updateSetting('tmdbEnrichEpisodes', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Season Posters */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>{t('tmdb_settings.season_posters')}</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('tmdb_settings.season_posters_desc')}
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichSeasonPosters}
                  onValueChange={(v) => updateSetting('tmdbEnrichSeasonPosters', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Production Info */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>Production Info</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    Networks & production companies with logos
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichProductionInfo}
                  onValueChange={(v) => updateSetting('tmdbEnrichProductionInfo', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Movie Details */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>Movie Details</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    Budget, revenue, runtime, tagline
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichMovieDetails}
                  onValueChange={(v) => updateSetting('tmdbEnrichMovieDetails', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* TV Details */}
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>TV Show Details</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    Status, seasons count, networks, creators
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichTvDetails}
                  onValueChange={(v) => updateSetting('tmdbEnrichTvDetails', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>

              {/* Collections */}
              <View style={[styles.settingRow, { marginBottom: 0 }]}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>Movie Collections</Text>
                  <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                    Franchise movies (Marvel, Star Wars, etc.)
                  </Text>
                </View>
                <Switch
                  value={settings.tmdbEnrichCollections}
                  onValueChange={(v) => updateSetting('tmdbEnrichCollections', v)}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? currentTheme.colors.white : ''}
                  ios_backgroundColor={'rgba(255,255,255,0.1)'}
                />
              </View>
            </>
          )}
        </View>

        {/* API Configuration Section */}
        <View style={[styles.sectionCard, { backgroundColor: currentTheme.colors.elevation2 }]}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="api" size={20} color={currentTheme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>API Configuration</Text>
          </View>
          <Text style={[styles.sectionDescription, { color: currentTheme.colors.mediumEmphasis }]}>
            Configure your TMDb API access for enhanced functionality.
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>Custom API Key</Text>
              <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                Use your own TMDb API key for better performance and dedicated rate limits.
              </Text>
            </View>
            <Switch
              value={useCustomKey}
              onValueChange={toggleUseCustomKey}
              trackColor={{ false: 'rgba(255,255,255,0.1)', true: currentTheme.colors.primary }}
              thumbColor={Platform.OS === 'android' ? (useCustomKey ? currentTheme.colors.white : currentTheme.colors.white) : ''}
              ios_backgroundColor={'rgba(255,255,255,0.1)'}
            />
          </View>

          {useCustomKey && (
            <>
              <View style={styles.divider} />

              {/* API Key Status */}
              <View style={styles.statusRow}>
                <MaterialIcons
                  name={isKeySet ? "check-circle" : "error-outline"}
                  size={20}
                  color={isKeySet ? currentTheme.colors.success : currentTheme.colors.warning}
                />
                <Text style={[styles.statusText, {
                  color: isKeySet ? currentTheme.colors.success : currentTheme.colors.warning
                }]}>
                  {isKeySet ? "Custom API key active" : "API key required"}
                </Text>
              </View>

              {/* API Key Input */}
              <View style={styles.apiKeyContainer}>
                <View style={styles.inputContainer}>
                  <TextInput
                    ref={apiKeyInputRef}
                    style={[
                      styles.input,
                      {
                        backgroundColor: currentTheme.colors.elevation1,
                        color: currentTheme.colors.text,
                        borderColor: isInputFocused ? currentTheme.colors.primary : 'transparent'
                      }
                    ]}
                    value={apiKey}
                    onChangeText={(text) => {
                      setApiKey(text);
                      if (testResult) setTestResult(null);
                    }}
                    placeholder="Paste your TMDb API key (v3)"
                    placeholderTextColor={currentTheme.colors.mediumEmphasis}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                  />
                  <TouchableOpacity
                    style={styles.pasteButton}
                    onPress={pasteFromClipboard}
                  >
                    <MaterialIcons name="content-paste" size={20} color={currentTheme.colors.primary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: currentTheme.colors.primary }]}
                    onPress={saveApiKey}
                  >
                    <Text style={[styles.buttonText, { color: currentTheme.colors.white }]}>Save</Text>
                  </TouchableOpacity>

                  {isKeySet && (
                    <TouchableOpacity
                      style={[styles.button, styles.clearButton, { borderColor: currentTheme.colors.error }]}
                      onPress={clearApiKey}
                    >
                      <Text style={[styles.buttonText, { color: currentTheme.colors.error }]}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {testResult && (
                  <View style={[
                    styles.resultMessage,
                    { backgroundColor: testResult.success ? currentTheme.colors.success + '1A' : currentTheme.colors.error + '1A' }
                  ]}>
                    <MaterialIcons
                      name={testResult.success ? "check-circle" : "error"}
                      size={16}
                      color={testResult.success ? currentTheme.colors.success : currentTheme.colors.error}
                      style={styles.resultIcon}
                    />
                    <Text style={[
                      styles.resultText,
                      { color: testResult.success ? currentTheme.colors.success : currentTheme.colors.error }
                    ]}>
                      {testResult.message}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.helpLink}
                  onPress={openTMDBWebsite}
                >
                  <MaterialIcons name="help" size={16} color={currentTheme.colors.primary} style={styles.helpIcon} />
                  <Text style={[styles.helpText, { color: currentTheme.colors.primary }]}>
                    How to get a TMDb API key?
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {!useCustomKey && (
            <View style={styles.infoContainer}>
              <MaterialIcons name="info-outline" size={18} color={currentTheme.colors.primary} />
              <Text style={[styles.infoText, { color: currentTheme.colors.mediumEmphasis }]}>
                Currently using built-in API key. Consider using your own key for better performance.
              </Text>
            </View>
          )}

          {/* Cache Management Section */}
          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: currentTheme.colors.text }]}>Cache Size</Text>
              <Text style={[styles.settingDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                {cacheSize}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: currentTheme.colors.error }]}
            onPress={handleClearCache}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="delete-outline" size={18} color={currentTheme.colors.white} />
              <Text style={[styles.buttonText, { color: currentTheme.colors.white, marginLeft: 8 }]}>Clear Cache</Text>
            </View>
          </TouchableOpacity>

          <View style={[styles.infoContainer, { marginTop: 12 }]}>
            <MaterialIcons name="info-outline" size={18} color={currentTheme.colors.primary} />
            <Text style={[styles.infoText, { color: currentTheme.colors.mediumEmphasis }]}>
              TMDB responses are cached for 7 days to improve performance
            </Text>
          </View>
        </View>

        {/* TMDB Attribution */}
        <View style={styles.attributionContainer}>
          <FastImage
            source={require('../assets/tmdb_logo.png')}
            style={styles.tmdbLogo}
            resizeMode={FastImage.resizeMode.contain}
          />
          <View style={{ width: '90%' }}>
            <Text style={[styles.attributionText, { color: currentTheme.colors.mediumEmphasis }]}>
              This product uses the TMDB API but is not
            </Text>
            <Text style={[styles.attributionText, { color: currentTheme.colors.mediumEmphasis }]}>
              endorsed or certified by TMDB.
            </Text>
          </View>
        </View>

        {/* Language Picker Modal */}
        <Modal
          visible={languagePickerVisible}
          transparent
          animationType="slide"
          supportedOrientations={['portrait', 'landscape']}
          onRequestClose={() => setLanguagePickerVisible(false)}
        >
          <TouchableWithoutFeedback onPress={() => setLanguagePickerVisible(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: currentTheme.colors.darkBackground }]}>
                  {/* Header */}
                  <View style={styles.modalHeader}>
                    <View style={[styles.dragHandle, { backgroundColor: currentTheme.colors.elevation3 }]} />
                    <Text style={[styles.modalTitle, { color: currentTheme.colors.text }]}>Choose Language</Text>
                    <Text style={[styles.modalSubtitle, { color: currentTheme.colors.mediumEmphasis }]}>Select your preferred language for TMDb content</Text>
                  </View>

                  {/* Search Section */}
                  <View style={styles.searchSection}>
                    <View style={[styles.searchContainer, { backgroundColor: currentTheme.colors.elevation1 }]}>
                      <MaterialIcons name="search" size={20} color={currentTheme.colors.mediumEmphasis} style={styles.searchIcon} />
                      <TextInput
                        placeholder="Search languages..."
                        placeholderTextColor={currentTheme.colors.mediumEmphasis}
                        style={[styles.searchInput, { color: currentTheme.colors.text }]}
                        value={languageSearch}
                        onChangeText={setLanguageSearch}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {languageSearch.length > 0 && (
                        <TouchableOpacity onPress={() => setLanguageSearch('')} style={styles.searchClearButton}>
                          <MaterialIcons name="close" size={20} color={currentTheme.colors.mediumEmphasis} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Popular Languages */}
                  {languageSearch.length === 0 && (
                    <View style={styles.popularSection}>
                      <Text style={[styles.sectionTitle, { color: currentTheme.colors.mediumEmphasis }]}>Popular</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.popularChips}
                      >
                        {[
                          { code: 'en', label: 'EN' },
                          { code: 'ar', label: 'AR' },
                          { code: 'es', label: 'ES' },
                          { code: 'fr', label: 'FR' },
                          { code: 'de', label: 'DE' },
                          { code: 'tr', label: 'TR' },
                        ].map(({ code, label }) => (
                          <TouchableOpacity
                            key={code}
                            onPress={() => { updateSetting('tmdbLanguagePreference', code); setLanguagePickerVisible(false); }}
                            style={[
                              styles.popularChip,
                              settings.tmdbLanguagePreference === code && styles.selectedChip,
                              {
                                backgroundColor: settings.tmdbLanguagePreference === code ? currentTheme.colors.primary : currentTheme.colors.elevation1,
                                borderColor: settings.tmdbLanguagePreference === code ? currentTheme.colors.primary : 'rgba(255,255,255,0.1)',
                              }
                            ]}
                          >
                            <Text style={[
                              styles.popularChipText,
                              settings.tmdbLanguagePreference === code && styles.selectedChipText,
                              { color: settings.tmdbLanguagePreference === code ? currentTheme.colors.white : currentTheme.colors.text }
                            ]}>
                              {label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* All Languages */}
                  <View style={styles.languagesSection}>
                    <Text style={[
                      styles.sectionTitle,
                      languageSearch.length > 0 && styles.searchResultsTitle,
                      { color: languageSearch.length > 0 ? currentTheme.colors.text : currentTheme.colors.mediumEmphasis }
                    ]}>
                      {languageSearch.length > 0 ? 'Search Results' : 'All Languages'}
                    </Text>

                    <ScrollView style={styles.languageList} showsVerticalScrollIndicator={false}>
                      {(() => {
                        const languages = [
                          { code: 'en', label: 'English', native: 'English' },
                          { code: 'ar', label: 'العربية', native: 'Arabic' },
                          { code: 'es', label: 'Español', native: 'Spanish' },
                          { code: 'fr', label: 'Français', native: 'French' },
                          { code: 'de', label: 'Deutsch', native: 'German' },
                          { code: 'it', label: 'Italiano', native: 'Italian' },
                          { code: 'pt', label: 'Português', native: 'Portuguese' },
                          { code: 'ru', label: 'Русский', native: 'Russian' },
                          { code: 'tr', label: 'Türkçe', native: 'Turkish' },
                          { code: 'ja', label: '日本語', native: 'Japanese' },
                          { code: 'ko', label: '한국어', native: 'Korean' },
                          { code: 'zh', label: '中文', native: 'Chinese' },
                          { code: 'hi', label: 'हिन्दी', native: 'Hindi' },
                          { code: 'he', label: 'עברית', native: 'Hebrew' },
                          { code: 'id', label: 'Bahasa Indonesia', native: 'Indonesian' },
                          { code: 'nl', label: 'Nederlands', native: 'Dutch' },
                          { code: 'sv', label: 'Svenska', native: 'Swedish' },
                          { code: 'no', label: 'Norsk', native: 'Norwegian' },
                          { code: 'da', label: 'Dansk', native: 'Danish' },
                          { code: 'fi', label: 'Suomi', native: 'Finnish' },
                          { code: 'pl', label: 'Polski', native: 'Polish' },
                          { code: 'cs', label: 'Čeština', native: 'Czech' },
                          { code: 'ro', label: 'Română', native: 'Romanian' },
                          { code: 'uk', label: 'Українська', native: 'Ukrainian' },
                          { code: 'vi', label: 'Tiếng Việt', native: 'Vietnamese' },
                          { code: 'th', label: 'ไทย', native: 'Thai' },
                          { code: 'hr', label: 'Hrvatski', native: 'Croatian' },
                          { code: 'sr', label: 'Српски', native: 'Serbian' }, 
                          { code: 'bg', label: 'български', native: 'Bulgarian' }, 
                          { code: 'sl', label: 'Slovenščina', native: 'Slovenian' },
                          { code: 'mk', label: 'Македонски', native: 'Macedonian' },
                          { code: 'fil', label: 'Filipino', native: 'Filipino' },
                          { code: 'sq', label: 'Shqipe', native: 'Albanian' }, 
                        ];

                        const filteredLanguages = languages.filter(({ label, code, native }) =>
                          (languageSearch || '').length === 0 ||
                          label.toLowerCase().includes(languageSearch.toLowerCase()) ||
                          native.toLowerCase().includes(languageSearch.toLowerCase()) ||
                          code.toLowerCase().includes(languageSearch.toLowerCase())
                        );

                        return (
                          <>
                            {filteredLanguages.map(({ code, label, native }) => (
                              <TouchableOpacity
                                key={code}
                                onPress={() => { updateSetting('tmdbLanguagePreference', code); setLanguagePickerVisible(false); }}
                                style={[
                                  styles.languageItem,
                                  settings.tmdbLanguagePreference === code && styles.selectedLanguageItem
                                ]}
                                activeOpacity={0.7}
                              >
                                <View style={styles.languageContent}>
                                  <View style={styles.languageInfo}>
                                    <Text style={[
                                      styles.languageName,
                                      settings.tmdbLanguagePreference === code && styles.selectedLanguageName,
                                      {
                                        color: settings.tmdbLanguagePreference === code ? currentTheme.colors.primary : currentTheme.colors.text,
                                      }
                                    ]}>
                                      {native}
                                    </Text>
                                    <Text style={[
                                      styles.languageCode,
                                      settings.tmdbLanguagePreference === code && styles.selectedLanguageCode,
                                      {
                                        color: settings.tmdbLanguagePreference === code ? currentTheme.colors.primary : currentTheme.colors.mediumEmphasis,
                                      }
                                    ]}>
                                      {label} • {code.toUpperCase()}
                                    </Text>
                                  </View>
                                  {settings.tmdbLanguagePreference === code && (
                                    <View style={styles.checkmarkContainer}>
                                      <MaterialIcons name="check-circle" size={24} color={currentTheme.colors.primary} />
                                    </View>
                                  )}
                                </View>
                              </TouchableOpacity>
                            ))}
                            {languageSearch.length > 0 && filteredLanguages.length === 0 && (
                              <View style={styles.noResultsContainer}>
                                <MaterialIcons name="search-off" size={48} color={currentTheme.colors.mediumEmphasis} />
                                <Text style={[styles.noResultsText, { color: currentTheme.colors.mediumEmphasis }]}>
                                  No languages found for "{languageSearch}"
                                </Text>
                                <TouchableOpacity
                                  onPress={() => setLanguageSearch('')}
                                  style={[styles.clearSearchButton, { backgroundColor: currentTheme.colors.elevation1 }]}
                                >
                                  <Text style={[styles.clearSearchButtonText, { color: currentTheme.colors.primary }]}>Clear search</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </>
                        );
                      })()}
                    </ScrollView>
                  </View>

                  {/* Footer Actions */}
                  <View style={styles.modalFooter}>
                    <TouchableOpacity
                      onPress={() => setLanguagePickerVisible(false)}
                      style={styles.cancelButton}
                    >
                      <Text style={[styles.cancelButtonText, { color: currentTheme.colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setLanguagePickerVisible(false)}
                      style={[styles.doneButton, { backgroundColor: currentTheme.colors.primary }]}
                    >
                      <Text style={[styles.doneButtonText, { color: currentTheme.colors.white }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </ScrollView>
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        onClose={() => setAlertVisible(false)}
        actions={alertActions}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: 'transparent',
    zIndex: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 4,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.3,
    paddingLeft: 4,
  },
  scrollView: {
    flex: 1,
    zIndex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionCard: {
    borderRadius: 16,
    marginBottom: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
  },
  languageButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  languageButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  apiKeyContainer: {
    marginTop: 16,
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    borderWidth: 2,
  },
  pasteButton: {
    position: 'absolute',
    right: 12,
    padding: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  buttonText: {
    fontWeight: '600',
    fontSize: 15,
  },
  resultMessage: {
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultIcon: {
    marginRight: 12,
  },
  resultText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  helpLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  helpIcon: {
    marginRight: 8,
  },
  helpText: {
    fontSize: 14,
    fontWeight: '500',
  },
  infoText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
    opacity: 0.8,
    marginLeft: 8,
  },
  clearButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    marginRight: 0,
    marginLeft: 8,
    flex: 0,
    paddingHorizontal: 16,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    minHeight: '70%', // Increased minimum height
    flex: 1,
  },
  modalHeader: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  searchSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  searchClearButton: {
    padding: 4,
    marginLeft: 8,
  },
  popularSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  searchResultsTitle: {
    color: '#FFFFFF',
  },
  popularChips: {
    paddingVertical: 2,
  },
  popularChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  selectedChip: {
    // Border color handled by inline styles
  },
  popularChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  selectedChipText: {
    color: '#FFFFFF',
  },
  languagesSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  languageList: {
    flex: 1,
  },
  languageItem: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 4,
    minHeight: 60,
  },
  selectedLanguageItem: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  languageContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  languageInfo: {
    flex: 1,
    marginRight: 12,
  },
  languageName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  selectedLanguageName: {
    fontWeight: '600',
  },
  languageCode: {
    fontSize: 12,
  },
  selectedLanguageCode: {
  },
  checkmarkContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResultsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  noResultsText: {
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
  clearSearchButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  clearSearchButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  doneButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },

  // Logo Source Styles
  selectorLabel: {
    fontSize: 13,
    marginBottom: 8,
    marginTop: 4,
  },
  showsScrollView: {
    marginBottom: 16,
  },
  showsScrollContent: {
    paddingRight: 16,
    paddingVertical: 2,
  },
  showItem: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedShowItem: {
    borderWidth: 2,
  },
  showItemText: {
    fontSize: 13,
  },
  selectedShowItemText: {
    fontWeight: '600',
  },
  logoPreviewCard: {
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  exampleImage: {
    height: 60,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
  },
  bannerContainer: {
    height: 80,
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 4,
  },
  bannerImage: {
    ...StyleSheet.absoluteFillObject,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  logoOverBanner: {
    position: 'absolute',
    width: '80%',
    height: '70%',
    alignSelf: 'center',
    top: '15%',
  },
  noLogoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noLogoText: {
    color: '#fff',
    fontSize: 13,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  logoSourceLabel: {
    fontSize: 11,
    marginTop: 6,
  },
  attributionContainer: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 8,
    paddingHorizontal: 24,
    width: '100%',
  },
  tmdbLogo: {
    width: 80,
    height: 60,
    marginBottom: 8,
  },
  attributionText: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    opacity: 0.7,
  },

});

export default TMDBSettingsScreen; 