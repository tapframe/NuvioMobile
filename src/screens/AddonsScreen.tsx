import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Image,
  Dimensions,
  ScrollView,
  useColorScheme,
  Switch,
  Linking
} from 'react-native';
import { stremioService, Manifest } from '../services/stremioService';
import { MaterialIcons } from '@expo/vector-icons';
import FastImage from '@d11/react-native-fast-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { logger } from '../utils/logger';
import { mmkvStorage } from '../services/mmkvStorage';
import { BlurView as ExpoBlurView } from 'expo-blur';
import CustomAlert from '../components/CustomAlert';
import { useTranslation } from 'react-i18next';

// Optional iOS Glass effect (expo-glass-effect) with safe fallback for AddonsScreen
let GlassViewComp: any = null;
let liquidGlassAvailable = false;
if (Platform.OS === 'ios') {
  try {
    // Dynamically require so app still runs if the package isn't installed yet
    const glass = require('expo-glass-effect');
    GlassViewComp = glass.GlassView;
    liquidGlassAvailable = typeof glass.isLiquidGlassAvailable === 'function' ? glass.isLiquidGlassAvailable() : false;
  } catch {
    GlassViewComp = null;
    liquidGlassAvailable = false;
  }
}
// Removed community blur and expo-constants for Android overlay
import axios from 'axios';
import { useTheme } from '../contexts/ThemeContext';

// Extend Manifest type to include logo only (remove disabled status)
interface ExtendedManifest extends Manifest {
  logo?: string;
  transport?: string;
  behaviorHints?: {
    configurable?: boolean;
    configurationRequired?: boolean;
    configurationURL?: string;
  };
}

const { width } = Dimensions.get('window');

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;

// Create a styles creator function that accepts the theme colors
const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.darkBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUSBAR_HEIGHT + 8 : 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  activeHeaderButton: {
    backgroundColor: 'rgba(45, 156, 219, 0.2)',
    borderRadius: 6,
  },
  reorderModeText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '400',
  },
  reorderInfoBanner: {
    backgroundColor: 'rgba(45, 156, 219, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  reorderInfoText: {
    color: colors.white,
    fontSize: 14,
    marginLeft: 8,
  },
  reorderButtons: {
    position: 'absolute',
    left: -12,
    top: '50%',
    marginTop: -40,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  reorderButton: {
    backgroundColor: colors.elevation3,
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  disabledButton: {
    opacity: 0.5,
    backgroundColor: colors.elevation2,
  },
  priorityBadge: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priorityText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  backText: {
    fontSize: 17,
    fontWeight: '400',
    color: colors.primary,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.white,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.mediumGray,
    marginHorizontal: 16,
    marginBottom: 8,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statsCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsDivider: {
    width: 1,
    height: '80%',
    backgroundColor: 'rgba(150, 150, 150, 0.2)',
    alignSelf: 'center',
  },
  statsValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.white,
    marginBottom: 4,
  },
  statsLabel: {
    fontSize: 13,
    color: colors.mediumGray,
  },
  addAddonContainer: {
    marginHorizontal: 16,
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  addonInput: {
    backgroundColor: colors.elevation1,
    borderRadius: 8,
    padding: 12,
    color: colors.white,
    marginBottom: 16,
    fontSize: 15,
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 16,
  },
  addonList: {
    paddingHorizontal: 16,
  },
  emptyContainer: {
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  emptyText: {
    marginTop: 8,
    color: colors.mediumGray,
    fontSize: 15,
  },
  addonItem: {
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  addonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  addonIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.elevation3,
  },
  addonIconPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.elevation3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addonTitleContainer: {
    flex: 1,
    marginLeft: 12,
    marginRight: 16,
  },
  addonName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 2,
  },
  addonMetaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addonVersion: {
    fontSize: 13,
    color: colors.mediumGray,
  },
  addonDot: {
    fontSize: 13,
    color: colors.mediumGray,
    marginHorizontal: 4,
  },
  addonCategory: {
    fontSize: 13,
    color: colors.mediumGray,
    flex: 1,
  },
  addonDescription: {
    fontSize: 14,
    color: colors.mediumEmphasis,
    marginTop: 6,
    marginBottom: 4,
    lineHeight: 20,
    marginLeft: 48, // Align with title, accounting for icon width
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.elevation2,
    borderRadius: 14,
    width: '85%',
    maxHeight: '85%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.elevation3,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: colors.white,
  },
  modalScrollContent: {
    maxHeight: 400,
  },
  addonDetailHeader: {
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.elevation3,
  },
  addonLogo: {
    width: 64,
    height: 64,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: colors.elevation3,
  },
  addonLogoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: colors.elevation3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  addonDetailName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.white,
    marginBottom: 4,
    textAlign: 'center',
  },
  addonDetailVersion: {
    fontSize: 14,
    color: colors.mediumGray,
  },
  addonDetailSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.elevation3,
  },
  addonDetailSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 8,
  },
  addonDetailDescription: {
    fontSize: 15,
    color: colors.mediumEmphasis,
    lineHeight: 20,
  },
  addonDetailChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addonDetailChip: {
    backgroundColor: colors.elevation3,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  addonDetailChipText: {
    fontSize: 13,
    color: colors.white,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.elevation3,
  },
  modalButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.elevation3,
    marginRight: 8,
  },
  installButton: {
    backgroundColor: colors.success,
    borderRadius: 6,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  addonActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteButton: {
    padding: 6,
  },
  configButton: {
    padding: 6,
    marginRight: 8,
  },
  separator: {
    height: 10,
  },
  sectionSeparator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 20,
    marginVertical: 20,
  },
  emptyMessage: {
    textAlign: 'center',
    color: colors.mediumGray,
    marginTop: 20,
    fontSize: 16,
    paddingHorizontal: 20,
  },
  errorMessage: {
    textAlign: 'center',
    color: colors.error,
    marginTop: 20,
    fontSize: 16,
    paddingHorizontal: 20,
  },
  loader: {
    marginTop: 30,
    alignSelf: 'center',
  },
  addonActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.transparentDark,
  },
  androidBlurContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  androidBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  androidFallbackBlur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.darkBackground,
  },
});



const AddonsScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [addons, setAddons] = useState<ExtendedManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [addonUrl, setAddonUrl] = useState('');
  const [addonDetails, setAddonDetails] = useState<ExtendedManifest | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [catalogCount, setCatalogCount] = useState(0);
  // Add state for reorder mode
  // Custom alert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<any[]>([]);
  const [reorderMode, setReorderMode] = useState(false);
  // Use ThemeContext
  const { currentTheme } = useTheme();
  const colors = currentTheme.colors;
  const styles = createStyles(colors);


  useEffect(() => {
    loadAddons();
  }, []);

  const loadAddons = async () => {
    try {
      setLoading(true);
      // Use the regular method without disabled state
      const installedAddons = await stremioService.getInstalledAddonsAsync();

      setAddons(installedAddons as ExtendedManifest[]);

      // Kept variable for compatibility with existing counting logic below
      const filteredAddons = installedAddons;

      // Count catalogs
      let totalCatalogs = 0;
      filteredAddons.forEach(addon => {
        if (addon.catalogs && addon.catalogs.length > 0) {
          totalCatalogs += addon.catalogs.length;
        }
      });

      // Get catalog settings to determine enabled count
      const catalogSettingsJson = await mmkvStorage.getItem('catalog_settings');
      if (catalogSettingsJson) {
        const catalogSettings = JSON.parse(catalogSettingsJson);
        const disabledCount = Object.entries(catalogSettings)
          .filter(([key, value]) => key !== '_lastUpdate' && value === false)
          .length;
        setCatalogCount(totalCatalogs - disabledCount);
      } else {
        setCatalogCount(totalCatalogs);
      }
    } catch (error) {
      logger.error('Failed to load addons:', error);
      setAlertTitle(t('common.error'));
      setAlertMessage(t('addons.load_error'));
      setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    } finally {
      setLoading(false);
    }
  };



  const handleAddAddon = async (url?: string) => {
    let urlToInstall = url || addonUrl;
    if (!urlToInstall) {
      setAlertTitle(t('common.error'));
      setAlertMessage(t('addons.invalid_url'));
      setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
      return;
    }

    // Replace stremio:// with https:// if present
    if (urlToInstall.startsWith('stremio://')) {
      urlToInstall = urlToInstall.replace(/^stremio:\/\//, 'https://');
    }

    try {
      setInstalling(true);
      const manifest = await stremioService.getManifest(urlToInstall);

      // Check if this addon is already installed
      const installedAddons = await stremioService.getInstalledAddonsAsync();
      const existingInstallations = installedAddons.filter(a => a.id === manifest.id);
      const isAlreadyInstalled = existingInstallations.length > 0;

      // Check if addon provides streams or catalogs
      const providesStreams = (manifest.catalogs && manifest.catalogs.length > 0) || manifest.resources?.some(resource => {
        if (typeof resource === 'string') {
          return resource === 'stream';
        } else if (typeof resource === 'object' && resource !== null && 'name' in resource) {
          return (resource as any).name === 'stream';
        }
        return false;
      }) || false;

      
      if (isAlreadyInstalled && !providesStreams) {
        setAlertTitle(t('common.error'));
        setAlertMessage('This addon is already installed. Multiple installations are only allowed for stream and catalog providers.');
        setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
        setAlertVisible(true);
        return;
      }

      setAddonDetails(manifest);
      setAddonUrl(urlToInstall);
      setShowConfirmModal(true);
    } catch (error: any) {
      logger.error('Failed to fetch addon details:', error);
      setAlertTitle(t('common.error'));
     
      const errorMessage = error?.message || `${t('addons.fetch_error')} ${urlToInstall}`;
      setAlertMessage(errorMessage);
      setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    } finally {
      setInstalling(false);
    }
  };

  const confirmInstallAddon = async () => {
    if (!addonDetails || !addonUrl) return;

    try {
      setInstalling(true);
      await stremioService.installAddon(addonUrl);
      setAddonUrl('');
      setShowConfirmModal(false);
      setAddonDetails(null);
      loadAddons();
      setAlertTitle(t('common.success'));
      setAlertMessage(t('addons.install_success'));
      setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    } catch (error: any) {
      logger.error('Failed to install addon:', error);
      setAlertTitle(t('common.error'));
      // Show specific error message if available, otherwise use generic message
      const errorMessage = error?.message || t('addons.install_error');
      setAlertMessage(errorMessage);
      setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    } finally {
      setInstalling(false);
    }
  };

  const refreshAddons = async () => {
    loadAddons();
    loadAddons();
  };

  const moveAddonUp = (addon: ExtendedManifest) => {
    if (addon.installationId && stremioService.moveAddonUp(addon.installationId)) {
      // Refresh the list to reflect the new order
      loadAddons();
    }
  };

  const moveAddonDown = (addon: ExtendedManifest) => {
    if (addon.installationId && stremioService.moveAddonDown(addon.installationId)) {
      // Refresh the list to reflect the new order
      loadAddons();
    }
  };

  const handleRemoveAddon = (addon: ExtendedManifest) => {
    setAlertTitle(t('addons.uninstall_title'));
    setAlertMessage(t('addons.uninstall_message', { name: addon.name }));
    setAlertActions([
      { label: t('common.cancel'), onPress: () => setAlertVisible(false), style: { color: colors.mediumGray } },
      {
        label: t('addons.uninstall_button'),
        onPress: async () => {
          if (addon.installationId) {
            await stremioService.removeAddon(addon.installationId);
            setAddons(prev => prev.filter(a => a.installationId !== addon.installationId));
            // Ensure we re-read from storage/order to avoid reappearing on next load
            await loadAddons();
          }
        },
        style: { color: colors.error }
      },
    ]);
    setAlertVisible(true);
  };

  // Add function to handle configuration
 const ensureSlash = (url: string) =>
  url.endsWith('/') ? url : url + '/';

const handleConfigureAddon = (addon: ExtendedManifest, transportUrl?: string) => {
  let configUrl = '';

  logger.info(`Configure addon: ${addon.name}, ID: ${addon.id}`);
  if (transportUrl) logger.info(`TransportUrl provided: ${transportUrl}`);

  // 1. behaviorHints.configurationURL
  if (addon.behaviorHints?.configurationURL) {
    configUrl = addon.behaviorHints.configurationURL;
    logger.info(`Using configurationURL from behaviorHints: ${configUrl}`);
  }

  // 2. transportUrl
  else if (transportUrl) {
    const baseUrl = transportUrl.replace(/\/[^\/]+\.json$/, '/');
    configUrl = `${ensureSlash(baseUrl)}configure`;
    logger.info(`Using transportUrl to create config URL: ${configUrl}`);
  }

  // 3. addon.url
  else if (addon.url) {
    configUrl = `${ensureSlash(addon.url)}configure`;
    logger.info(`Using addon.url property: ${configUrl}`);
  }

 
  else if (addon.id && addon.id.startsWith('http')) {
    const baseUrl = addon.id.replace(/\/[^\/]+\.json$/, '/');
    configUrl = `${ensureSlash(baseUrl)}configure`;
    logger.info(`Using addon.id as HTTP URL: ${configUrl}`);
  }

  // 5. stremio:// containing http/https
  else if (addon.id && (addon.id.includes('https://') || addon.id.includes('http://'))) {
    const match = addon.id.match(/(https?:\/\/[^\/]+)(\/[^\s]*)?/);
    if (match) {
      const domain = match[1];
      const path = match[2] ? match[2].replace(/\/[^\/]+\.json$/, '/') : '/';
      configUrl = `${ensureSlash(domain + path)}configure`;
      logger.info(`Extracted HTTP URL from stremio:// format: ${configUrl}`);
    }
  }

  // 6. stremio://domain.com
  if (!configUrl && addon.id && addon.id.startsWith('stremio://')) {
    const match = addon.id.match(/stremio:\/\/([^\/]+)(\/[^\s]*)?/);
    if (match) {
      const domain = match[1];
      const path = match[2] ? match[2].replace(/\/[^\/]+\.json$/, '/') : '/';
      configUrl = `${ensureSlash(`https://${domain}${path}`)}configure`;
      logger.info(`Converted stremio:// protocol to https:// for config URL: ${configUrl}`);
    }
  }

  // 7. addon.transport
  if (!configUrl && addon.transport && addon.transport.includes('http')) {
    const baseUrl = addon.transport.replace(/\/[^\/]+\.json$/, '/');
    configUrl = `${ensureSlash(baseUrl)}configure`;
    logger.info(`Using addon.transport for config URL: ${configUrl}`);
  }

  // 8. originalUrl
  if (!configUrl && (addon as any).originalUrl) {
    const baseUrl = (addon as any).originalUrl.replace(/\/[^\/]+\.json$/, '/');
    configUrl = `${ensureSlash(baseUrl)}configure`;
    logger.info(`Using originalUrl property: ${configUrl}`);
  }

  // 9. Failure
  if (!configUrl) {
    logger.error(`Failed to determine config URL for addon: ${addon.name}, ID: ${addon.id}`);
    setAlertTitle(t('addons.config_unavailable_title'));
    setAlertMessage(t('addons.config_unavailable_msg'));
    setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
    setAlertVisible(true);
    return;
  }

  logger.info(`Opening configuration for addon: ${addon.name} at URL: ${configUrl}`);

  Linking.canOpenURL(configUrl)
    .then(supported => {
      if (supported) {
        Linking.openURL(configUrl);
      } else {
        logger.error(`URL cannot be opened: ${configUrl}`);
        setAlertTitle(t('addons.cannot_open_config_title'));
        setAlertMessage(t('addons.cannot_open_config_msg', { url: configUrl }));
        setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
        setAlertVisible(true);
      }
    })
    .catch(err => {
      logger.error(`Error checking if URL can be opened: ${configUrl}`, err);
      setAlertTitle(t('common.error'));
      setAlertMessage(t('addons.cannot_open_config_msg', { url: configUrl }));
      setAlertActions([{ label: t('common.ok'), onPress: () => setAlertVisible(false) }]);
      setAlertVisible(true);
    });
};


  const toggleReorderMode = () => {
    setReorderMode(!reorderMode);
  };

  const renderAddonItem = ({ item, index }: { item: ExtendedManifest, index: number }) => {
    const types = item.types || [];
    const description = item.description || '';
    // @ts-ignore - some addons might have logo property even though it's not in the type
    const logo = item.logo || null;
    // Check if addon is configurable
    const isConfigurable = item.behaviorHints?.configurable === true;
    // Check if addon is pre-installed
    const isPreInstalled = stremioService.isPreInstalledAddon(item.id);

    // Check if there are multiple installations of this addon
    const sameAddonInstallations = addons.filter(a => a.id === item.id);
    const hasMultipleInstallations = sameAddonInstallations.length > 1;
    const installationNumber = sameAddonInstallations.findIndex(a => a.installationId === item.installationId) + 1;

    // Format the types into a simple category text
    const categoryText = types.length > 0
      ? types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' • ')
      : t('addons.no_categories');

    const isFirstItem = index === 0;
    const isLastItem = index === addons.length - 1;

    return (
      <View style={styles.addonItem}>
        {reorderMode && (
          <View style={styles.reorderButtons}>
            <TouchableOpacity
              style={[styles.reorderButton, isFirstItem && styles.disabledButton]}
              onPress={() => moveAddonUp(item)}
              disabled={isFirstItem}
            >
              <MaterialIcons
                name="arrow-upward"
                size={20}
                color={isFirstItem ? colors.mediumGray : colors.white}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reorderButton, isLastItem && styles.disabledButton]}
              onPress={() => moveAddonDown(item)}
              disabled={isLastItem}
            >
              <MaterialIcons
                name="arrow-downward"
                size={20}
                color={isLastItem ? colors.mediumGray : colors.white}
              />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.addonHeader}>
          {logo ? (
            <FastImage
              source={{ uri: logo }}
              style={styles.addonIcon}
              resizeMode={FastImage.resizeMode.contain}
            />
          ) : (
            <View style={styles.addonIconPlaceholder}>
              <MaterialIcons name="extension" size={22} color={colors.mediumGray} />
            </View>
          )}
          <View style={styles.addonTitleContainer}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}>
              <Text style={styles.addonName}>{item.name}</Text>
              {isPreInstalled && (
                <View style={[styles.priorityBadge, { marginLeft: 8, backgroundColor: colors.success }]}>
                  <Text style={[styles.priorityText, { fontSize: 10 }]}>{t('addons.pre_installed')}</Text>
                </View>
              )}
              {hasMultipleInstallations && (
                <View style={[styles.priorityBadge, { marginLeft: 8, backgroundColor: colors.primary }]}>
                  <Text style={[styles.priorityText, { fontSize: 10 }]}>#{installationNumber}</Text>
                </View>
              )}
            </View>
            <View style={styles.addonMetaContainer}>
              <Text style={styles.addonVersion}>{t('addons.version', { version: item.version || '1.0.0' })}</Text>
              <Text style={styles.addonDot}>•</Text>
              <Text style={styles.addonCategory}>{categoryText}</Text>
            </View>
          </View>
          <View style={styles.addonActions}>
            {!reorderMode ? (
              <>
                {isConfigurable && (
                  <TouchableOpacity
                    style={styles.configButton}
                    onPress={() => handleConfigureAddon(item, item.transport)}
                  >
                    <MaterialIcons name="settings" size={20} color={colors.primary} />
                  </TouchableOpacity>
                )}
                {!stremioService.isPreInstalledAddon(item.id) && (
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleRemoveAddon(item)}
                  >
                    <MaterialIcons name="delete" size={20} color={colors.error} />
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <View style={styles.priorityBadge}>
                <Text style={styles.priorityText}>#{index + 1}</Text>
              </View>
            )}
          </View>
        </View>

        <Text style={styles.addonDescription}>
          {description.length > 100 ? description.substring(0, 100) + '...' : description}
        </Text>
        {hasMultipleInstallations && item.originalUrl && (
          <Text style={[styles.addonDescription, { fontSize: 11, marginTop: 4, color: colors.mediumGray }]}>
            {item.originalUrl}
          </Text>
        )}
      </View>
    );
  };

  const StatsCard = ({ value, label }: { value: number; label: string }) => (
    <View style={styles.statsCard}>
      <Text style={styles.statsValue}>{value}</Text>
      <Text style={styles.statsLabel}>{label}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="chevron-left" size={28} color={colors.white} />
          <Text style={styles.backText}>{t('settings.settings_title')}</Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Reorder Mode Toggle Button */}
          <TouchableOpacity
            style={[styles.headerButton, reorderMode && styles.activeHeaderButton]}
            onPress={toggleReorderMode}
          >
            <MaterialIcons
              name="swap-vert"
              size={24}
              color={reorderMode ? colors.primary : colors.white}
            />
          </TouchableOpacity>

          {/* Refresh Button */}
          <TouchableOpacity
            style={styles.headerButton}
            onPress={refreshAddons}
            disabled={loading}
          >
            <MaterialIcons
              name="refresh"
              size={24}
              color={loading ? colors.mediumGray : colors.white}
            />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.headerTitle}>
        {t('addons.title')}
        {reorderMode && <Text style={styles.reorderModeText}>{t('addons.reorder_mode')}</Text>}
      </Text>

      {reorderMode && (
        <View style={styles.reorderInfoBanner}>
          <MaterialIcons name="info-outline" size={18} color={colors.primary} />
          <Text style={styles.reorderInfoText}>
            {t('addons.reorder_info')}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
        >

          {/* Overview Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('addons.overview')}</Text>
            <View style={styles.statsContainer}>
              <StatsCard value={addons.length} label={t('addons.title')} />
              <View style={styles.statsDivider} />
              <StatsCard value={addons.length} label={t('settings.items.active')} />
              <View style={styles.statsDivider} />
              <StatsCard value={catalogCount} label={t('settings.items.catalogs')} />
            </View>
          </View>

          {/* Hide Add Addon Section in reorder mode */}
          {!reorderMode && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('addons.add_button').toUpperCase()}</Text>
              <View style={styles.addAddonContainer}>
                <TextInput
                  style={styles.addonInput}
                  placeholder={t('addons.add_addon_placeholder')}
                  placeholderTextColor={colors.mediumGray}
                  value={addonUrl}
                  onChangeText={setAddonUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.addButton, { opacity: installing || !addonUrl ? 0.6 : 1 }]}
                  onPress={() => handleAddAddon()}
                  disabled={installing || !addonUrl}
                >
                  <Text style={styles.addButtonText}>
                    {installing ? t('common.loading') : t('addons.add_button')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Installed Addons Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {reorderMode ? t('addons.reorder_drag_title') : t('addons.installed_addons')}
            </Text>
            <View style={styles.addonList}>
              {addons.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <MaterialIcons name="extension-off" size={32} color={colors.mediumGray} />
                  <Text style={styles.emptyText}>{t('addons.no_addons')}</Text>
                </View>
              ) : (
                addons.map((addon, index) => (
                  <View
                    key={addon.installationId || addon.id}
                    style={{ marginBottom: index === addons.length - 1 ? 32 : 0 }}
                  >
                    {renderAddonItem({ item: addon, index })}
                  </View>
                ))
              )}
            </View>
          </View>

        </ScrollView >
      )}

      {/* Addon Details Confirmation Modal */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => {
          setShowConfirmModal(false);
          setAddonDetails(null);
        }}
      >
        <View style={styles.modalContainer}>
          {Platform.OS === 'ios' ? (
            GlassViewComp && liquidGlassAvailable ? (
              <GlassViewComp style={styles.blurOverlay} glassEffectStyle="regular" />
            ) : (
              <ExpoBlurView intensity={80} style={styles.blurOverlay} tint="dark" />
            )
          ) : (
            // Android: use solid themed background instead of semi-transparent overlay
            <View style={[styles.androidBlurContainer, { backgroundColor: colors.darkBackground }]} />
          )}
          <View style={styles.modalContent}>
            {addonDetails && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{t('addons.install')}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowConfirmModal(false);
                      setAddonDetails(null);
                    }}
                  >
                    <MaterialIcons name="close" size={24} color={colors.white} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                  bounces={true}
                >
                  <View style={styles.addonDetailHeader}>
                    {/* @ts-ignore */}
                    {addonDetails.logo ? (
                      <FastImage
                        source={{ uri: addonDetails.logo }}
                        style={styles.addonLogo}
                        resizeMode={FastImage.resizeMode.contain}
                      />
                    ) : (
                      <View style={styles.addonLogoPlaceholder}>
                        <MaterialIcons name="extension" size={40} color={colors.mediumGray} />
                      </View>
                    )}
                    <Text style={styles.addonDetailName}>{addonDetails.name}</Text>
                    <Text style={styles.addonDetailVersion}>{t('addons.version', { version: addonDetails.version || '1.0.0' })}</Text>
                  </View>

                  <View style={styles.addonDetailSection}>
                    <Text style={styles.addonDetailSectionTitle}>{t('addons.description')}</Text>
                    <Text style={styles.addonDetailDescription}>
                      {addonDetails.description || t('addons.no_description')}
                    </Text>
                  </View>

                  {addonDetails.types && addonDetails.types.length > 0 && (
                    <View style={styles.addonDetailSection}>
                      <Text style={styles.addonDetailSectionTitle}>{t('addons.supported_types')}</Text>
                      <View style={styles.addonDetailChips}>
                        {addonDetails.types.map((type, index) => (
                          <View key={index} style={styles.addonDetailChip}>
                            <Text style={styles.addonDetailChipText}>{type}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {addonDetails.catalogs && addonDetails.catalogs.length > 0 && (
                    <View style={styles.addonDetailSection}>
                      <Text style={styles.addonDetailSectionTitle}>{t('addons.catalogs')}</Text>
                      <View style={styles.addonDetailChips}>
                        {addonDetails.catalogs.map((catalog, index) => (
                          <View key={index} style={styles.addonDetailChip}>
                            <Text style={styles.addonDetailChipText}>
                              {catalog.type} - {catalog.id}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </ScrollView>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.cancelButton]}
                    onPress={() => {
                      setShowConfirmModal(false);
                      setAddonDetails(null);
                    }}
                  >
                    <Text style={styles.modalButtonText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.installButton]}
                    onPress={confirmInstallAddon}
                    disabled={installing}
                  >
                    {installing ? (
                      <ActivityIndicator size="small" color={colors.white} />
                    ) : (
                      <Text style={styles.modalButtonText}>{t('addons.install')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      {/* Custom Alert Modal */}
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        onClose={() => setAlertVisible(false)}
        actions={alertActions}
      />
    </SafeAreaView >
  );
};

export default AddonsScreen;
