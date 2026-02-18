import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
  ScrollView,
  RefreshControl,
  StatusBar,
  Platform,
  ActivityIndicator,
  Modal,
  Dimensions,
  Animated,
  Image,
} from 'react-native';
import CustomAlert from '../components/CustomAlert';
import FastImage from '@d11/react-native-fast-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useSettings } from '../hooks/useSettings';
import { localScraperService, pluginService, ScraperInfo, RepositoryInfo } from '../services/pluginService';
import { logger } from '../utils/logger';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';

const { width: screenWidth } = Dimensions.get('window');

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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  backText: {
    fontSize: 17,
    color: colors.primary,
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: colors.text,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    backgroundColor: colors.elevation1,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionDescription: {
    fontSize: 14,
    color: colors.mediumGray,
    marginBottom: 16,
    lineHeight: 20,
  },
  emptyContainer: {
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
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
  pluginItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.elevation2,
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  pluginLogo: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 6,
    backgroundColor: colors.elevation3,
  },
  pluginInfo: {
    flex: 1,
  },
  pluginName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 2,
  },
  pluginDescription: {
    fontSize: 13,
    color: colors.mediumGray,
    marginBottom: 4,
    lineHeight: 18,
  },
  pluginMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pluginVersion: {
    fontSize: 12,
    color: colors.mediumGray,
  },
  pluginDot: {
    fontSize: 12,
    color: colors.mediumGray,
    marginHorizontal: 8,
  },
  pluginTypes: {
    fontSize: 12,
    color: colors.mediumGray,
  },
  pluginLanguage: {
    fontSize: 12,
    color: colors.mediumGray,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 14,
    color: colors.mediumEmphasis,
    lineHeight: 20,
  },
  textInput: {
    backgroundColor: colors.darkBackground,
    borderRadius: 8,
    padding: 12,
    color: colors.white,
    marginBottom: 16,
    fontSize: 15,
  },
  button: {
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.elevation3,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderColor: colors.elevation3,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.white,
    textAlign: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.white,
    textAlign: 'center',
  },
  clearButton: {
    backgroundColor: '#ff3b30',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  currentRepoContainer: {
    backgroundColor: colors.elevation1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  currentRepoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 4,
  },
  currentRepoUrl: {
    fontSize: 14,
    color: colors.white,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 18,
  },
  urlHint: {
    fontSize: 12,
    color: colors.mediumGray,
    marginBottom: 8,
    lineHeight: 16,
  },
  defaultRepoButton: {
    backgroundColor: colors.elevation3,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  defaultRepoButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  infoText: {
    fontSize: 14,
    color: colors.mediumEmphasis,
    lineHeight: 20,
  },
  content: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.white,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateDescription: {
    fontSize: 14,
    color: colors.mediumGray,
    textAlign: 'center',
    lineHeight: 20,
  },
  pluginsList: {
    gap: 12,
  },
  pluginsContainer: {
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  disabledSection: {
    opacity: 0.5,
  },
  disabledText: {
    color: colors.elevation3,
  },
  disabledContainer: {
    opacity: 0.5,
  },
  disabledInput: {
    backgroundColor: colors.elevation1,
    opacity: 0.5,
  },
  disabledButton: {
    opacity: 0.5,
  },
  disabledImage: {
    opacity: 0.3,
  },
  availableIndicator: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  availableIndicatorText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '600',
  },
  qualityChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  qualityChip: {
    backgroundColor: colors.elevation2,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.elevation3,
  },
  qualityChipSelected: {
    backgroundColor: '#ff3b30',
    borderColor: '#ff3b30',
  },
  qualityChipText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '500',
  },
  qualityChipTextSelected: {
    color: colors.white,
    fontWeight: '600',
  },
  // New styles for improved UX
  collapsibleSection: {
    backgroundColor: colors.darkBackground,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.elevation2,
  },
  collapsibleTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.white,
  },
  collapsibleContent: {
    padding: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.darkBackground,
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    color: colors.white,
    fontSize: 16,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.elevation2,
    borderWidth: 1,
    borderColor: colors.elevation3,
  },
  filterChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
  filterChipTextSelected: {
    color: colors.white,
    fontWeight: '600',
  },
  // Repository tabs
  repositoryTabsContainer: {
    marginBottom: 16,
  },
  repositoryTabsScroll: {
    flexDirection: 'row',
    gap: 8,
  },
  repositoryTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.elevation2,
    borderWidth: 1,
    borderColor: colors.elevation3,
    minWidth: 80,
    alignItems: 'center',
  },
  repositoryTabSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  repositoryTabText: {
    color: colors.mediumGray,
    fontSize: 14,
    fontWeight: '500',
  },
  repositoryTabTextSelected: {
    color: colors.white,
    fontWeight: '600',
  },
  repositoryTabCount: {
    fontSize: 12,
    color: colors.mediumGray,
    marginTop: 2,
  },
  repositoryTabCountSelected: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
  },
  bulkActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  bulkActionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderWidth: 1,
  },
  bulkActionButtonEnabled: {
    backgroundColor: 'transparent',
    borderColor: '#34C759',
  },
  bulkActionButtonDisabled: {
    backgroundColor: 'transparent',
    borderColor: colors.elevation3,
  },
  bulkActionButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1E1E1E', // Match CustomAlert
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignSelf: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.51,
        shadowRadius: 13.16,
      },
      android: {
        elevation: 20,
      },
    }),
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 15,
    color: '#AAAAAA',
    lineHeight: 22,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 48,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Compact modal styles
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  compactTextInput: {
    backgroundColor: colors.darkBackground,
    borderRadius: 8,
    padding: 12,
    color: colors.white,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.elevation3,
    marginBottom: 12,
  },
  compactExamples: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.elevation2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.elevation3,
  },
  quickButtonText: {
    fontSize: 12,
    color: colors.white,
    fontWeight: '500',
  },
  formatHint: {
    fontSize: 12,
    color: colors.mediumGray,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 16,
    lineHeight: 16,
  },
  compactActions: {
    flexDirection: 'row',
    gap: 8,
  },
  compactButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  cancelButton: {
    backgroundColor: colors.elevation2,
    borderWidth: 1,
    borderColor: colors.elevation3,
  },
  cancelButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
  addButton: {
    backgroundColor: colors.primary,
  },
  addButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  quickSetupContainer: {
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  quickSetupTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 8,
  },
  quickSetupText: {
    fontSize: 14,
    color: colors.mediumGray,
    lineHeight: 20,
    marginBottom: 12,
  },
  quickSetupButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  quickSetupButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '500',
  },
  pluginCard: {
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.elevation3,
    minHeight: 120,
  },
  pluginCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  pluginCardInfo: {
    flex: 1,
    marginRight: 12,
  },
  pluginCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  pluginCardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 4,
  },
  pluginCardMetaText: {
    fontSize: 12,
    color: colors.mediumGray,
  },
  emptyStateContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyStateIcon: {
    marginBottom: 16,
  },
  // Repository management styles
  repositoriesList: {
    marginBottom: 16,
  },
  repositoryItem: {
    backgroundColor: colors.elevation2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.elevation3,
  },
  repositoryInfo: {
    flex: 1,
    marginBottom: 12,
  },
  repositoryName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginRight: 8,
  },
  repositoryDescription: {
    fontSize: 14,
    color: colors.mediumGray,
    marginBottom: 4,
    lineHeight: 18,
  },
  repositoryUrl: {
    fontSize: 12,
    color: colors.mediumGray,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 4,
  },
  repositoryMeta: {
    fontSize: 12,
    color: colors.mediumGray,
  },
  repositoryActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  repositoryActionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  repositoryActionButtonPrimary: {
    backgroundColor: 'transparent',
    borderColor: colors.primary,
  },
  repositoryActionButtonSecondary: {
    backgroundColor: 'transparent',
    borderColor: colors.elevation3,
  },
  repositoryActionButtonDanger: {
    backgroundColor: 'transparent',
    borderColor: '#ff3b30',
  },
  repositoryActionButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.white,
  },
  repositoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  repositoryNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  pluginRepositoryBadge: {
    backgroundColor: colors.elevation3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  pluginRepositoryBadgeText: {
    fontSize: 10,
    color: colors.mediumGray,
    fontWeight: '500',
  },
});

// Helper component for collapsible sections
const CollapsibleSection: React.FC<{
  title: string;
  children: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  colors: any;
  styles: any;
}> = ({ title, children, isExpanded, onToggle, colors, styles }) => (
  <View style={styles.collapsibleSection}>
    <TouchableOpacity style={styles.collapsibleHeader} onPress={onToggle}>
      <Text style={styles.collapsibleTitle}>{title}</Text>
      <Ionicons
        name={isExpanded ? "chevron-up" : "chevron-down"}
        size={20}
        color={colors.mediumGray}
      />
    </TouchableOpacity>
    {isExpanded && <View style={styles.collapsibleContent}>{children}</View>}
  </View>
);

// Helper component for info tooltips
const InfoTooltip: React.FC<{ text: string; colors: any }> = ({ text, colors }) => (
  <TouchableOpacity style={{ marginLeft: 8 }}>
    <Ionicons name="information-circle-outline" size={16} color={colors.mediumGray} />
  </TouchableOpacity>
);

// Helper component for status badges
const StatusBadge: React.FC<{
  status: 'enabled' | 'disabled' | 'available' | 'platform-disabled' | 'error' | 'limited';
  colors: any;
}> = ({ status, colors }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'enabled':
        return { color: '#34C759', text: 'Active' };
      case 'disabled':
        return { color: colors.mediumGray, text: 'Disabled' };
      case 'available':
        return { color: colors.primary, text: 'Available' };
      case 'platform-disabled':
        return { color: '#FF9500', text: 'Platform Disabled' };
      case 'limited':
        return { color: '#FF9500', text: 'Limited' };
      case 'error':
        return { color: '#FF3B30', text: 'Error' };
      default:
        return { color: colors.mediumGray, text: 'Unknown' };
    }
  };

  const config = getStatusConfig();

  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 9999,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: config.color,
      gap: 6,
    }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: config.color }} />
      <Text style={{ color: config.color, fontSize: 11, fontWeight: '600' }}>{config.text}</Text>
    </View>
  );
};

const PluginsScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ScraperSettings'>>();
  const { settings, updateSetting } = useSettings();
  const { currentTheme } = useTheme();
  const { t } = useTranslation();
  const colors = currentTheme.colors;
  const styles = createStyles(colors);

  // Deep Link Handler
  useEffect(() => {
    // Check if opened via deep link with URL param
    if (route.params && (route.params as any).url) {
      const url = (route.params as any).url;
      // Small delay to ensure UI is ready
      setTimeout(() => {
        openAlert(
          'Add Repository',
          `Do you want to add the repository from:\n${url}`,
          [
            {
              label: 'Cancel',
              onPress: () => { },
              style: { color: colors.error }
            },
            {
              label: 'Add',
              onPress: () => {
                handleAddRepository(url);
              }
            }
          ]
        );
      }, 500);
    }
  }, [route.params]);

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

  // Core state
  const [repositoryUrl, setRepositoryUrl] = useState(settings.scraperRepositoryUrl);
  const [installedPlugins, setInstalledPlugins] = useState<ScraperInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasRepository, setHasRepository] = useState(false);
  const [showboxUiToken, setShowboxUiToken] = useState<string>('');
  const [showboxSavedToken, setShowboxSavedToken] = useState<string>('');
  const [showboxScraperId, setShowboxScraperId] = useState<string | null>(null);
  const [showboxTokenVisible, setShowboxTokenVisible] = useState<boolean>(false);

  // Multiple repositories state
  const [repositories, setRepositories] = useState<RepositoryInfo[]>([]);
  const [currentRepositoryId, setCurrentRepositoryId] = useState<string>('');
  const [showAddRepositoryModal, setShowAddRepositoryModal] = useState(false);
  const [newRepositoryUrl, setNewRepositoryUrl] = useState('');
  const [switchingRepository, setSwitchingRepository] = useState<string | null>(null);

  // New UX state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [selectedRepositoryTab, setSelectedRepositoryTab] = useState<string>('all'); // 'all' or repository ID
  const [expandedSections, setExpandedSections] = useState({
    repository: true,
    plugins: true,
    settings: false,
    quality: false,
  });
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showRepositoryModal, setShowRepositoryModal] = useState(false);
  const [showScraperDetails, setShowScraperDetails] = useState<string | null>(null);
  const regionOptions = [
    { value: 'USA7', label: 'US East' },
    { value: 'USA6', label: 'US West' },
    { value: 'USA5', label: 'US Middle' },
    { value: 'UK3', label: 'United Kingdom' },
    { value: 'CA1', label: 'Canada' },
    { value: 'FR1', label: 'France' },
    { value: 'DE2', label: 'Germany' },
    { value: 'HK1', label: 'Hong Kong' },
    { value: 'IN1', label: 'India' },
    { value: 'AU1', label: 'Australia' },
    { value: 'SZ', label: 'China' },
  ];

  // Get enabled repositories for tabs
  const enabledRepositories = useMemo(() => {
    return repositories.filter(r => r.enabled !== false);
  }, [repositories]);

  // Filtered plugins based on search, type filter, and repository tab
  const filteredPlugins = useMemo(() => {
    let filtered = installedPlugins;

    // Filter by repository tab
    if (selectedRepositoryTab !== 'all') {
      filtered = filtered.filter(plugin => plugin.repositoryId === selectedRepositoryTab);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(plugin =>
        plugin.name.toLowerCase().includes(query) ||
        plugin.description.toLowerCase().includes(query) ||
        plugin.id.toLowerCase().includes(query)
      );
    }

    // Filter by type
    if (selectedFilter !== 'all') {
      filtered = filtered.filter(plugin =>
        plugin.supportedTypes?.includes(selectedFilter as 'movie' | 'tv')
      );
    }

    return filtered;
  }, [installedPlugins, searchQuery, selectedFilter, selectedRepositoryTab]);

  // Helper functions
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const getPluginStatus = (plugin: ScraperInfo): 'enabled' | 'disabled' | 'available' | 'platform-disabled' | 'error' | 'limited' => {
    if (plugin.manifestEnabled === false) return 'disabled';
    if (plugin.disabledPlatforms?.includes(Platform.OS as 'ios' | 'android')) return 'platform-disabled';
    if (plugin.limited) return 'limited';
    if (plugin.enabled) return 'enabled';
    return 'available';
  };

  const handleBulkToggle = async (enabled: boolean) => {
    try {
      setIsRefreshing(true);
      const promises = filteredPlugins.map(plugin =>
        pluginService.setScraperEnabled(plugin.id, enabled)
      );
      await Promise.all(promises);
      await loadPlugins();
      openAlert(t('plugins.success'), `${enabled ? t('plugins.enabled') : t('plugins.disabled')} ${filteredPlugins.length} extensions`);
    } catch (error) {
      logger.error('[PluginSettings] Failed to bulk toggle:', error);
      openAlert(t('plugins.error'), 'Failed to update extensions');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleUrlChange = (url: string) => {
    setNewRepositoryUrl(url);
  };

  const handleAddRepository = async (urlOverride?: string | any) => {
    // Check if urlOverride is a string (to avoid event objects)
    const validUrlOverride = typeof urlOverride === 'string' ? urlOverride : undefined;
    const inputUrl = validUrlOverride || newRepositoryUrl;

    if (!inputUrl.trim()) {
      openAlert('Error', 'Please enter a valid repository URL');
      return;
    }

    // Validate URL format
    const url = inputUrl.trim();
    if (!url.startsWith('https://raw.githubusercontent.com/') && !url.startsWith('http://')) {
      openAlert(
        t('plugins.alert_invalid_url'),
        'Please use a valid GitHub raw URL format:\n\nhttps://raw.githubusercontent.com/username/repo/refs/heads/branch\n\nor include manifest.json:\nhttps://raw.githubusercontent.com/username/repo/refs/heads/branch/manifest.json\n\nExample:\nhttps://raw.githubusercontent.com/your-username/your-repo/refs/heads/main'
      );
      return;
    }

    // Check if URL already includes manifest.json
    const isManifestUrl = url.includes('/manifest.json');

    // Normalize URL - if it's a manifest URL, extract the base repository URL
    let normalizedUrl = url;
    if (isManifestUrl) {
      normalizedUrl = url.replace('/manifest.json', '');
      logger.log('[PluginsScreen] Detected manifest URL, extracting base repository URL:', normalizedUrl);
    }

    // Check for duplicates
    // Fetch latest repositories directly to ensure we have up-to-date state
    // The state 'repositories' might be stale if the screen was just opened or in background
    const latestRepos = await pluginService.getRepositories();

    // We normalize the input URL to compare against existing repositories
    const existingRepo = latestRepos.find(r => {
      // Simple exact match or normalized match
      return r.url === normalizedUrl || r.url === url || r.url.replace('/manifest.json', '') === normalizedUrl;
    });

    if (existingRepo) {
      openAlert(
        t('plugins.error'),
        `Repository already installed:\n${existingRepo.name}\n(${existingRepo.url})`
      );
      return;
    }

    try {
      setIsLoading(true);
      // Optional: You could show a specialized 'Adding...' UI here if you had a separate state for it
      // But isLoading is generally used for the spinner.

      const repoId = await pluginService.addRepository({
        name: '', // Let the service fetch from manifest
        url: normalizedUrl, // Use normalized URL (without manifest.json)
        description: '',
        enabled: true
      });

      // Refresh all enabled repositories to include the new one
      await pluginService.refreshRepository();
      await loadRepositories();
      await loadPlugins();

      setNewRepositoryUrl('');
      setShowAddRepositoryModal(false);
      openAlert(t('plugins.success'), t('plugins.alert_repo_added'));
    } catch (error) {
      logger.error('[PluginsScreen] Failed to add repository:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      openAlert(t('plugins.error'), `Failed to add repository: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleRepositoryEnabled = async (repoId: string, enabled: boolean) => {
    try {
      setSwitchingRepository(repoId);
      await pluginService.toggleRepositoryEnabled(repoId, enabled);

      if (enabled) {
        // When enabling, refresh just this repository to fetch its plugins
        await pluginService.refreshSingleRepository(repoId);
      }

      // Reload the data
      await loadRepositories();
      await loadPlugins();

      const repo = repositories.find(r => r.id === repoId);
      openAlert(t('plugins.success'), `Repository "${repo?.name || t('plugins.unknown')}" ${enabled ? t('plugins.enabled').toLowerCase() : t('plugins.disabled').toLowerCase()} successfully`);
    } catch (error) {
      logger.error('[PluginSettings] Failed to toggle repository:', error);
      openAlert(t('plugins.error'), 'Failed to update repository');
    } finally {
      setSwitchingRepository(null);
    }
  };

  const handleRemoveRepository = async (repoId: string) => {
    const repo = repositories.find(r => r.id === repoId);
    if (!repo) return;

    // Special handling for the last repository
    const isLastRepository = repositories.length === 1;

    const alertTitle = isLastRepository ? 'Remove Last Repository' : 'Remove Repository';
    const alertMessage = isLastRepository
      ? `Are you sure you want to remove "${repo.name}"? This is your only repository, so you'll have no extensions available until you add a new repository.`
      : `Are you sure you want to remove "${repo.name}"? This will also remove all extensions from this repository.`;

    openAlert(
      alertTitle,
      alertMessage,
      [
        { label: 'Cancel', onPress: () => { } },
        {
          label: 'Remove',
          onPress: async () => {
            try {
              await pluginService.removeRepository(repoId);
              await loadRepositories();
              await loadPlugins();
              const successMessage = isLastRepository
                ? 'Repository removed successfully. You can add a new repository using the "Add Repository" button.'
                : 'Repository removed successfully';
              openAlert('Success', successMessage);
            } catch (error) {
              logger.error('[PluginSettings] Failed to remove repository:', error);
              openAlert('Error', error instanceof Error ? error.message : 'Failed to remove repository');
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    loadPlugins();
    loadRepositories();
  }, []);

  const loadPlugins = async () => {
    try {
      const scrapers = await pluginService.getAvailableScrapers();


      setInstalledPlugins(scrapers);
      // Detect ShowBox scraper dynamically and preload settings
      const sb = scrapers.find(s => {
        const id = (s.id || '').toLowerCase();
        const name = (s.name || '').toLowerCase();
        const filename = (s.filename || '').toLowerCase();
        return id.includes('showbox') || name.includes('showbox') || filename.includes('showbox');
      });
      if (sb) {
        setShowboxScraperId(sb.id);
        const s = await pluginService.getScraperSettings(sb.id);
        // Check for multiple possible key names for the token
        const token = s.uiToken || s.cookie || s.token || '';
        setShowboxUiToken(token);
        setShowboxSavedToken(token);
        setShowboxTokenVisible(false);
      } else {
        setShowboxScraperId(null);
        setShowboxUiToken('');
        setShowboxSavedToken('');
        setShowboxTokenVisible(false);
      }
    } catch (error) {
      logger.error('[PluginSettings] Failed to load plugins:', error);
    }
  };

  const loadRepositories = async () => {
    try {
      // First refresh repository names from manifests for existing repositories
      await pluginService.refreshRepositoryNamesFromManifests();

      const repos = await pluginService.getRepositories();
      setRepositories(repos);
      setHasRepository(repos.length > 0);

      const currentRepoId = pluginService.getCurrentRepositoryId();
      setCurrentRepositoryId(currentRepoId);

      const currentRepo = repos.find(r => r.id === currentRepoId);
      if (currentRepo) {
        setRepositoryUrl(currentRepo.url);
      }
    } catch (error) {
      logger.error('[PluginSettings] Failed to load repositories:', error);
    }
  };

  const checkRepository = async () => {
    try {
      const repoUrl = await pluginService.getRepositoryUrl();
      setHasRepository(!!repoUrl);
      if (repoUrl && repoUrl !== repositoryUrl) {
        setRepositoryUrl(repoUrl);
      }
    } catch (error) {
      logger.error('[PluginSettings] Failed to check repository:', error);
    }
  };

  const handleSaveRepository = async () => {
    if (!repositoryUrl.trim()) {
      openAlert('Error', 'Please enter a valid repository URL');
      return;
    }

    // Validate URL format
    const url = repositoryUrl.trim();
    if (!url.startsWith('https://raw.githubusercontent.com/') && !url.startsWith('http://')) {
      openAlert(
        'Invalid URL Format',
        'Please use a valid GitHub raw URL format:\n\nhttps://raw.githubusercontent.com/username/repo/refs/heads/branch\n\nExample:\nhttps://raw.githubusercontent.com/your-username/your-repo/refs/heads/main'
      );
      return;
    }

    try {
      setIsLoading(true);
      await pluginService.setRepositoryUrl(url);
      await updateSetting('scraperRepositoryUrl', url);
      setHasRepository(true);
      openAlert(t('plugins.success'), t('plugins.alert_repo_saved'));
    } catch (error) {
      logger.error('[PluginSettings] Failed to save repository:', error);
      openAlert(t('plugins.error'), 'Failed to save repository URL');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshRepository = async () => {
    if (!repositoryUrl.trim()) {
      openAlert('Error', 'Please set a repository URL first');
      return;
    }

    try {
      setIsRefreshing(true);
      logger.log('[PluginsScreen] Starting hard refresh of repository...');

      // Force a complete hard refresh by clearing any cached data first
      await pluginService.refreshRepository();

      // Load fresh plugins from the updated repository
      await loadPlugins();

      openAlert(t('plugins.success'), t('plugins.alert_repo_refreshed'));
    } catch (error) {
      logger.error('[PluginsScreen] Failed to refresh repository:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      openAlert(
        'Repository Error',
        `Failed to refresh repository: ${errorMessage}\n\nPlease ensure your URL is correct and follows this format:\nhttps://raw.githubusercontent.com/username/repo/refs/heads/branch`
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTogglePlugin = async (pluginId: string, enabled: boolean) => {
    try {
      if (enabled) {
        // If enabling a plugin, ensure it's installed first
        const installedPluginsList = await pluginService.getInstalledScrapers();
        const isInstalled = installedPluginsList.some(plugin => plugin.id === pluginId);

        if (!isInstalled) {
          // Need to install the plugin first
          setIsRefreshing(true);
          await pluginService.refreshRepository();
          setIsRefreshing(false);
        }
      }

      await pluginService.setScraperEnabled(pluginId, enabled);
      await loadPlugins();
    } catch (error) {
      logger.error('[PluginSettings] Failed to toggle plugin:', error);
      openAlert(t('plugins.error'), 'Failed to update extension status');
      setIsRefreshing(false);
    }
  };

  const handleClearPlugins = () => {
    openAlert(
      t('plugins.clear_all'),
      t('plugins.clear_all_desc'),
      [
        { label: 'Cancel', onPress: () => { } },
        {
          label: 'Clear',
          onPress: async () => {
            try {
              await pluginService.clearScrapers();
              await loadPlugins();
              openAlert(t('plugins.success'), t('plugins.alert_plugins_cleared'));
            } catch (error) {
              logger.error('[PluginSettings] Failed to clear plugins:', error);
              openAlert(t('plugins.error'), 'Failed to clear extensions');
            }
          },
        },
      ]
    );
  };

  const handleClearPluginCache = () => {
    openAlert(
      t('plugins.clear_cache'),
      t('plugins.clear_cache_desc'),
      [
        { label: 'Cancel', onPress: () => { } },
        {
          label: 'Clear Cache',
          onPress: async () => {
            try {
              await pluginService.clearScrapers();
              await pluginService.setRepositoryUrl('');
              await updateSetting('scraperRepositoryUrl', '');
              setRepositoryUrl('');
              setHasRepository(false);
              await loadPlugins();
              openAlert(t('plugins.success'), t('plugins.alert_cache_cleared'));
            } catch (error) {
              logger.error('[PluginSettings] Failed to clear cache:', error);
              openAlert(t('plugins.error'), 'Failed to clear repository cache');
            }
          },
        },
      ]
    );
  };

  const handleToggleLocalScrapers = async (enabled: boolean) => {
    await updateSetting('enableLocalScrapers', enabled);

    // If enabling plugins, refresh repository and reload plugins
    if (enabled) {
      try {
        setIsRefreshing(true);
        logger.log('[PluginsScreen] Enabling plugins - refreshing repository...');

        // Refresh repository to ensure plugins are available
        await pluginService.refreshRepository();

        // Reload plugins to get the latest state
        await loadPlugins();

        logger.log('[PluginsScreen] Plugins enabled and repository refreshed');
      } catch (error) {
        logger.error('[PluginsScreen] Failed to refresh repository when enabling plugins:', error);
        // Don't show error to user as the toggle still succeeded
      } finally {
        setIsRefreshing(false);
      }
    }
  };

  const handleToggleQualityExclusion = async (quality: string) => {
    const currentExcluded = settings.excludedQualities || [];
    const isExcluded = currentExcluded.includes(quality);

    let newExcluded: string[];
    if (isExcluded) {
      // Remove from excluded list
      newExcluded = currentExcluded.filter(q => q !== quality);
    } else {
      // Add to excluded list
      newExcluded = [...currentExcluded, quality];
    }

    await updateSetting('excludedQualities', newExcluded);
  };

  const handleToggleLanguageExclusion = async (language: string) => {
    const currentExcluded = settings.excludedLanguages || [];
    const isExcluded = currentExcluded.includes(language);

    let newExcluded: string[];
    if (isExcluded) {
      // Remove from excluded list
      newExcluded = currentExcluded.filter(l => l !== language);
    } else {
      // Add to excluded list
      newExcluded = [...currentExcluded, language];
    }

    await updateSetting('excludedLanguages', newExcluded);
  };

  // Define available quality options
  const qualityOptions = ['Auto', 'Adaptive', '2160p', '4K', '1080p', '720p', '360p', 'DV', 'HDR', 'REMUX', '480p', 'CAM', 'TS'];

  // Define available language options
  const languageOptions = ['Original', 'English', 'Spanish', 'Latin', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Japanese', 'Korean', 'Chinese', 'Arabic', 'Hindi', 'Turkish', 'Dutch', 'Polish'];



  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.reset({
                index: 0,
                routes: [{ name: 'MainTabs' }],
              } as any);
            }
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
          <Text style={styles.backText}>{t('settings.title')}</Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Help Button */}
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowHelpModal(true)}
          >
            <Ionicons name="help-circle-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.headerTitle}>{t('plugins.title')}</Text>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={async () => {
              try {
                setIsRefreshing(true);
                logger.log('[PluginsScreen] Pull-to-refresh: Starting hard refresh...');

                // Force hard refresh of repository
                await pluginService.refreshRepository();
                await loadPlugins();

                logger.log('[PluginsScreen] Pull-to-refresh completed');
              } catch (error) {
                logger.error('[PluginsScreen] Pull-to-refresh failed:', error);
              } finally {
                setIsRefreshing(false);
              }
            }}
          />
        }
      >
        {/* Quick Setup banner removed */}

        {/* Enable Plugins */}
        <CollapsibleSection
          title={t('plugins.enable_title')}
          isExpanded={expandedSections.repository}
          onToggle={() => toggleSection('repository')}
          colors={colors}
          styles={styles}
        >
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('plugins.enable_title')}</Text>
              <Text style={styles.settingDescription}>
                {t('plugins.enable_desc')}
              </Text>
            </View>
            <Switch
              value={settings.enableLocalScrapers}
              onValueChange={handleToggleLocalScrapers}
              trackColor={{ false: colors.elevation3, true: colors.primary }}
              thumbColor={settings.enableLocalScrapers ? colors.white : '#f4f3f4'}
            />
          </View>
        </CollapsibleSection>

        {/* Repository Configuration */}
        <CollapsibleSection
          title={t('plugins.repo_config_title')}
          isExpanded={expandedSections.repository}
          onToggle={() => toggleSection('repository')}
          colors={colors}
          styles={styles}
        >
          <Text style={styles.sectionDescription}>
            {t('plugins.repo_config_desc')}
          </Text>

          {/* Repository List */}
          {repositories.length > 0 && (
            <View style={styles.repositoriesList}>
              <Text style={[styles.settingTitle, { marginBottom: 8 }]}>{t('plugins.your_repos')}</Text>
              <Text style={[styles.settingDescription, { marginBottom: 12 }]}>
                {t('plugins.your_repos_desc')}
              </Text>
              {repositories.map((repo) => (
                <View key={repo.id} style={[styles.repositoryItem, repo.enabled === false && { opacity: 0.6 }]}>
                  <View style={styles.repositoryHeader}>
                    <View style={styles.repositoryNameContainer}>
                      <Text style={styles.repositoryName}>{repo.name}</Text>
                      {repo.enabled !== false && (
                        <View style={[styles.statusBadge, { backgroundColor: '#34C759' }]}>
                          <Ionicons name="checkmark-circle" size={12} color="white" />
                          <Text style={styles.statusBadgeText}>{t('plugins.enabled')}</Text>
                        </View>
                      )}
                      {switchingRepository === repo.id && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.primary }]}>
                          <ActivityIndicator size={12} color="white" />
                          <Text style={styles.statusBadgeText}>{t('plugins.updating')}</Text>
                        </View>
                      )}
                    </View>
                    <Switch
                      value={repo.enabled !== false}
                      onValueChange={(enabled) => handleToggleRepositoryEnabled(repo.id, enabled)}
                      trackColor={{ false: colors.elevation3, true: colors.primary }}
                      thumbColor={repo.enabled !== false ? colors.white : '#f4f3f4'}
                      disabled={!settings.enableLocalScrapers || switchingRepository !== null}
                    />
                  </View>
                  <View style={styles.repositoryInfo}>
                    {repo.description && (
                      <Text style={styles.repositoryDescription}>{repo.description}</Text>
                    )}
                    <Text style={styles.repositoryUrl}>{repo.url}</Text>
                    <Text style={styles.repositoryMeta}>
                      {repo.scraperCount || 0} plugins • Last updated: {repo.lastUpdated ? new Date(repo.lastUpdated).toLocaleDateString() : 'Never'}
                    </Text>
                  </View>
                  <View style={styles.repositoryActions}>
                    <TouchableOpacity
                      style={[styles.repositoryActionButton, styles.repositoryActionButtonSecondary]}
                      onPress={() => handleRefreshRepository()}
                      disabled={isRefreshing || switchingRepository !== null || repo.enabled === false}
                    >
                      {isRefreshing ? (
                        <ActivityIndicator size="small" color={colors.mediumGray} />
                      ) : (
                        <Text style={styles.repositoryActionButtonText}>{t('plugins.refresh')}</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.repositoryActionButton, styles.repositoryActionButtonDanger]}
                      onPress={() => handleRemoveRepository(repo.id)}
                      disabled={switchingRepository !== null}
                    >
                      <Text style={styles.repositoryActionButtonText}>{t('plugins.remove')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}


          {/* Add Repository Button */}
          <TouchableOpacity
            style={[styles.button, styles.primaryButton, { marginTop: 16 }]}
            onPress={() => setShowAddRepositoryModal(true)}
            disabled={!settings.enableLocalScrapers || switchingRepository !== null}
          >
            <Text style={styles.buttonText}>{t('plugins.add_new_repo')}</Text>
          </TouchableOpacity>

        </CollapsibleSection>

        {/* Available Plugins */}
        <CollapsibleSection
          title={t('plugins.available_plugins', { count: filteredPlugins.length })}
          isExpanded={expandedSections.plugins}
          onToggle={() => toggleSection('plugins')}
          colors={colors}
          styles={styles}
        >
          {installedPlugins.length > 0 && (
            <>
              {/* Search and Filter */}
              <View style={styles.searchContainer}>
                <Ionicons name="search" size={20} color={colors.mediumGray} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={t('plugins.search_placeholder')}
                  placeholderTextColor={colors.mediumGray}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Ionicons name="close-circle" size={20} color={colors.mediumGray} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Repository Tabs - only show if multiple repositories */}
              {enabledRepositories.length > 1 && (
                <View style={styles.repositoryTabsContainer}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.repositoryTabsScroll}
                  >
                    {/* All tab */}
                    <TouchableOpacity
                      style={[
                        styles.repositoryTab,
                        selectedRepositoryTab === 'all' && styles.repositoryTabSelected
                      ]}
                      onPress={() => setSelectedRepositoryTab('all')}
                    >
                      <Text style={[
                        styles.repositoryTabText,
                        selectedRepositoryTab === 'all' && styles.repositoryTabTextSelected
                      ]}>
                        {t('plugins.all')}
                      </Text>
                      <Text style={[
                        styles.repositoryTabCount,
                        selectedRepositoryTab === 'all' && styles.repositoryTabCountSelected
                      ]}>
                        {installedPlugins.length}
                      </Text>
                    </TouchableOpacity>

                    {/* Repository tabs */}
                    {enabledRepositories.map((repo) => {
                      const repoPluginCount = installedPlugins.filter(p => p.repositoryId === repo.id).length;
                      return (
                        <TouchableOpacity
                          key={repo.id}
                          style={[
                            styles.repositoryTab,
                            selectedRepositoryTab === repo.id && styles.repositoryTabSelected
                          ]}
                          onPress={() => setSelectedRepositoryTab(repo.id)}
                        >
                          <Text
                            style={[
                              styles.repositoryTabText,
                              selectedRepositoryTab === repo.id && styles.repositoryTabTextSelected
                            ]}
                            numberOfLines={1}
                          >
                            {repo.name}
                          </Text>
                          <Text style={[
                            styles.repositoryTabCount,
                            selectedRepositoryTab === repo.id && styles.repositoryTabCountSelected
                          ]}>
                            {repoPluginCount}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Filter Chips */}
              <View style={styles.filterContainer}>
                {['all', 'movie', 'tv'].map((filter) => (
                  <TouchableOpacity
                    key={filter}
                    style={[
                      styles.filterChip,
                      selectedFilter === filter && styles.filterChipSelected
                    ]}
                    onPress={() => setSelectedFilter(filter as any)}
                  >
                    <Text style={[
                      styles.filterChipText,
                      selectedFilter === filter && styles.filterChipTextSelected
                    ]}>
                      {filter === 'all' ? t('plugins.filter_all') : filter === 'movie' ? t('plugins.filter_movies') : t('plugins.filter_tv')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Bulk Actions */}
              {filteredPlugins.length > 0 && (
                <View style={styles.bulkActionsContainer}>
                  <TouchableOpacity
                    style={[styles.bulkActionButton, styles.bulkActionButtonEnabled]}
                    onPress={() => handleBulkToggle(true)}
                    disabled={isRefreshing}
                  >
                    <Text style={[styles.bulkActionButtonText, { color: '#34C759' }]}>{t('plugins.enable_all')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.bulkActionButton, styles.bulkActionButtonDisabled]}
                    onPress={() => handleBulkToggle(false)}
                    disabled={isRefreshing}
                  >
                    <Text style={[styles.bulkActionButtonText, { color: colors.mediumGray }]}>{t('plugins.disable_all')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {filteredPlugins.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <Ionicons
                name={searchQuery ? "search" : "download-outline"}
                size={48}
                color={colors.mediumGray}
                style={styles.emptyStateIcon}
              />
              <Text style={styles.emptyStateTitle}>
                {searchQuery ? t('plugins.no_plugins_found') : t('plugins.no_plugins_available')}
              </Text>
              <Text style={styles.emptyStateDescription}>
                {searchQuery
                  ? t('plugins.no_match_desc', { query: searchQuery })
                  : t('plugins.configure_repo_desc')
                }
              </Text>
              {searchQuery && (
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton]}
                  onPress={() => setSearchQuery('')}
                >
                  <Text style={styles.secondaryButtonText}>{t('plugins.clear_search')}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.pluginsContainer}>
              {filteredPlugins.map((plugin) => (
                <View key={plugin.id} style={styles.pluginCard}>
                  <View style={styles.pluginCardHeader}>
                    {plugin.logo ? (
                      (plugin.logo.toLowerCase().endsWith('.svg') || plugin.logo.toLowerCase().includes('.svg?')) ? (
                        <Image
                          source={{ uri: plugin.logo }}
                          style={styles.pluginLogo}
                          resizeMode="contain"
                        />
                      ) : (
                        <FastImage
                          source={{ uri: plugin.logo }}
                          style={styles.pluginLogo}
                          resizeMode={FastImage.resizeMode.contain}
                        />
                      )
                    ) : (
                      <View style={styles.pluginLogo} />
                    )}
                    <View style={styles.pluginCardInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
                        <Text style={styles.pluginName}>{plugin.name}</Text>
                        <StatusBadge status={getPluginStatus(plugin)} colors={colors} />
                      </View>
                      <Text style={styles.pluginDescription}>{plugin.description}</Text>
                    </View>
                    <Switch
                      value={plugin.enabled && settings.enableLocalScrapers}
                      onValueChange={(enabled) => handleTogglePlugin(plugin.id, enabled)}
                      trackColor={{ false: colors.elevation3, true: colors.primary }}
                      thumbColor={plugin.enabled && settings.enableLocalScrapers ? colors.white : '#f4f3f4'}
                      disabled={!settings.enableLocalScrapers || plugin.manifestEnabled === false || (plugin.disabledPlatforms && plugin.disabledPlatforms.includes(Platform.OS as 'ios' | 'android'))}
                    />
                  </View>

                  <View style={styles.pluginCardMeta}>
                    <View style={styles.pluginCardMetaItem}>
                      <Ionicons name="information-circle" size={12} color={colors.mediumGray} />
                      <Text style={styles.pluginCardMetaText}>v{plugin.version}</Text>
                    </View>
                    <View style={styles.pluginCardMetaItem}>
                      <Ionicons name="film" size={12} color={colors.mediumGray} />
                      <Text style={styles.pluginCardMetaText}>
                        {plugin.supportedTypes?.join(', ') || 'Unknown'}
                      </Text>
                    </View>
                    {plugin.contentLanguage && plugin.contentLanguage.length > 0 && (
                      <View style={styles.pluginCardMetaItem}>
                        <Ionicons name="globe" size={12} color={colors.mediumGray} />
                        <Text style={styles.pluginCardMetaText}>
                          {plugin.contentLanguage.map((lang: string) => lang.toUpperCase()).join(', ')}
                        </Text>
                      </View>
                    )}
                    {plugin.supportsExternalPlayer === false && (
                      <View style={styles.pluginCardMetaItem}>
                        <Ionicons name="play-circle" size={12} color={colors.mediumGray} />
                        <Text style={styles.pluginCardMetaText}>
                          {t('plugins.no_external_player')}
                        </Text>
                      </View>
                    )}
                    {/* Repository badge */}
                    {plugin.repositoryId && repositories.length > 1 && (
                      <View style={styles.pluginRepositoryBadge}>
                        <Text style={styles.pluginRepositoryBadgeText}>
                          {repositories.find(r => r.id === plugin.repositoryId)?.name || 'Unknown'}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* ShowBox Settings - only visible when ShowBox plugin is available */}
                  {showboxScraperId && plugin.id === showboxScraperId && settings.enableLocalScrapers && (
                    <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.elevation3 }}>
                      <Text style={[styles.settingTitle, { marginBottom: 8 }]}>{t('plugins.showbox_token')}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                        <TextInput
                          style={[styles.textInput, { flex: 1, marginBottom: 0 }]}
                          value={showboxUiToken}
                          onChangeText={setShowboxUiToken}
                          placeholder={t('plugins.showbox_placeholder')}
                          placeholderTextColor={colors.mediumGray}
                          autoCapitalize="none"
                          autoCorrect={false}
                          secureTextEntry={showboxSavedToken.length > 0 && !showboxTokenVisible}
                          multiline={false}
                          numberOfLines={1}
                        />
                        {showboxSavedToken.length > 0 && (
                          <TouchableOpacity onPress={() => setShowboxTokenVisible(v => !v)} accessibilityRole="button" accessibilityLabel={showboxTokenVisible ? 'Hide token' : 'Show token'} style={{ marginLeft: 10 }}>
                            <Ionicons name={showboxTokenVisible ? 'eye-off' : 'eye'} size={18} color={colors.primary} />
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.buttonRow}>
                        {showboxUiToken !== showboxSavedToken && (
                          <TouchableOpacity
                            style={[styles.button, styles.primaryButton]}
                            onPress={async () => {
                              if (showboxScraperId) {
                                // Save with multiple keys to ensure the scraper finds it regardless of what key it checks
                                await pluginService.setScraperSettings(showboxScraperId, {
                                  uiToken: showboxUiToken,
                                  cookie: showboxUiToken,
                                  token: showboxUiToken
                                });
                              }
                              setShowboxSavedToken(showboxUiToken);
                              openAlert('Saved', 'ShowBox settings updated');
                            }}
                          >
                            <Text style={styles.buttonText}>{t('plugins.save')}</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[styles.button, styles.secondaryButton]}
                          onPress={async () => {
                            setShowboxUiToken('');
                            setShowboxSavedToken('');
                            if (showboxScraperId) {
                              await pluginService.setScraperSettings(showboxScraperId, {});
                            }
                          }}
                        >
                          <Text style={styles.secondaryButtonText}>{t('plugins.clear')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </CollapsibleSection>

        {/* Additional Settings */}
        <CollapsibleSection
          title={t('plugins.additional_settings')}
          isExpanded={expandedSections.settings}
          onToggle={() => toggleSection('settings')}
          colors={colors}
          styles={styles}
        >
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('plugins.group_streams')}</Text>
              <Text style={styles.settingDescription}>
                {t('plugins.group_streams_desc')}
              </Text>
            </View>
            <Switch
              value={settings.streamDisplayMode === 'grouped'}
              onValueChange={(value) => {
                updateSetting('streamDisplayMode', value ? 'grouped' : 'separate');
                // Auto-disable quality sorting when grouping is disabled
                if (!value && settings.streamSortMode === 'quality-then-scraper') {
                  updateSetting('streamSortMode', 'scraper-then-quality');
                }
              }}
              trackColor={{ false: colors.elevation3, true: colors.primary }}
              thumbColor={settings.streamDisplayMode === 'grouped' ? colors.white : '#f4f3f4'}
              disabled={!settings.enableLocalScrapers}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('plugins.sort_quality')}</Text>
              <Text style={styles.settingDescription}>
                {t('plugins.sort_quality_desc')}
              </Text>
            </View>
            <Switch
              value={settings.streamSortMode === 'quality-then-scraper'}
              onValueChange={(value) => updateSetting('streamSortMode', value ? 'quality-then-scraper' : 'scraper-then-quality')}
              trackColor={{ false: colors.elevation3, true: colors.primary }}
              thumbColor={settings.streamSortMode === 'quality-then-scraper' ? colors.white : '#f4f3f4'}
              disabled={!settings.enableLocalScrapers || settings.streamDisplayMode !== 'grouped'}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingTitle}>{t('plugins.show_logos')}</Text>
              <Text style={styles.settingDescription}>
                {t('plugins.show_logos_desc')}
              </Text>
            </View>
            <Switch
              value={settings.showScraperLogos && settings.enableLocalScrapers}
              onValueChange={(value) => updateSetting('showScraperLogos', value)}
              trackColor={{ false: colors.elevation3, true: colors.primary }}
              thumbColor={settings.showScraperLogos && settings.enableLocalScrapers ? colors.white : '#f4f3f4'}
              disabled={!settings.enableLocalScrapers}
            />
          </View>
        </CollapsibleSection>

        {/* Quality Filtering */}
        <CollapsibleSection
          title={t('plugins.quality_filtering')}
          isExpanded={expandedSections.quality}
          onToggle={() => toggleSection('quality')}
          colors={colors}
          styles={styles}
        >
          <Text style={styles.sectionDescription}>
            {t('plugins.quality_filtering_desc')}
          </Text>

          <View style={styles.qualityChipsContainer}>
            {qualityOptions.map((quality) => {
              const isExcluded = (settings.excludedQualities || []).includes(quality);
              return (
                <TouchableOpacity
                  key={quality}
                  style={[
                    styles.qualityChip,
                    isExcluded && styles.qualityChipSelected,
                    !settings.enableLocalScrapers && styles.disabledButton
                  ]}
                  onPress={() => handleToggleQualityExclusion(quality)}
                  disabled={!settings.enableLocalScrapers}
                >
                  <Text style={[
                    styles.qualityChipText,
                    isExcluded && styles.qualityChipTextSelected,
                    !settings.enableLocalScrapers && styles.disabledText
                  ]}>
                    {isExcluded ? '✕ ' : ''}{quality}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {(settings.excludedQualities || []).length > 0 && (
            <Text style={[styles.infoText, { marginTop: 12 }, !settings.enableLocalScrapers && styles.disabledText]}>
              {t('plugins.excluded_qualities')} {(settings.excludedQualities || []).join(', ')}
            </Text>
          )}
        </CollapsibleSection>

        {/* Language Filtering */}
        <CollapsibleSection
          title={t('plugins.language_filtering')}
          isExpanded={expandedSections.quality}
          onToggle={() => toggleSection('quality')}
          colors={colors}
          styles={styles}
        >
          <Text style={styles.sectionDescription}>
            {t('plugins.language_filtering_desc')}
          </Text>

          <Text style={[styles.infoText, { marginTop: 8, fontSize: 13, color: colors.mediumEmphasis }]}>
            <Text style={{ fontWeight: '600' }}>{t('plugins.note')}</Text> {t('plugins.language_filtering_note')}
          </Text>

          <View style={styles.qualityChipsContainer}>
            {languageOptions.map((language) => {
              const isExcluded = (settings.excludedLanguages || []).includes(language);
              return (
                <TouchableOpacity
                  key={language}
                  style={[
                    styles.qualityChip,
                    isExcluded && styles.qualityChipSelected,
                    !settings.enableLocalScrapers && styles.disabledButton
                  ]}
                  onPress={() => handleToggleLanguageExclusion(language)}
                  disabled={!settings.enableLocalScrapers}
                >
                  <Text style={[
                    styles.qualityChipText,
                    isExcluded && styles.qualityChipTextSelected,
                    !settings.enableLocalScrapers && styles.disabledText
                  ]}>
                    {isExcluded ? '✕ ' : ''}{language}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {(settings.excludedLanguages || []).length > 0 && (
            <Text style={[styles.infoText, { marginTop: 12 }, !settings.enableLocalScrapers && styles.disabledText]}>
              {t('plugins.excluded_languages')} {(settings.excludedLanguages || []).join(', ')}
            </Text>
          )}
        </CollapsibleSection>

        {/* About */}
        <View style={[styles.section, styles.lastSection]}>
          <Text style={styles.sectionTitle}>{t('plugins.about_title')}</Text>
          <Text style={styles.infoText}>
            {t('plugins.about_desc_1')}
          </Text>

          <Text style={[styles.infoText, { marginTop: 8, fontSize: 13, color: colors.mediumEmphasis }]}>
            <Text style={{ fontWeight: '600' }}>{t('plugins.note')}</Text> {t('plugins.about_desc_2')}
          </Text>
        </View>
      </ScrollView>

      {/* Help Modal */}
      <Modal
        visible={showHelpModal}
        transparent={true}
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setShowHelpModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('plugins.help_title')}</Text>
            <Text style={styles.modalText}>
              <Text>{t('plugins.help_step_1')}</Text>
            </Text>
            <Text style={styles.modalText}>
              <Text>{t('plugins.help_step_2')}</Text>
            </Text>
            <Text style={styles.modalText}>
              <Text>{t('plugins.help_step_3')}</Text>
            </Text>
            <Text style={styles.modalText}>
              <Text>{t('plugins.help_step_4')}</Text>
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowHelpModal(false)}
            >
              <Text style={styles.modalButtonText}>{t('plugins.got_it')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isLoading}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { alignItems: 'center', paddingVertical: 32 }]}>
            <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 16 }} />
            <Text style={styles.modalTitle}>Installing Repository...</Text>
            <Text style={styles.modalText}>Please wait while we fetch and install the repository.</Text>
          </View>
        </View>
      </Modal>

      {/* Add Repository Modal */}
      <Modal
        visible={showAddRepositoryModal && !isLoading}
        transparent={true}
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setShowAddRepositoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <Ionicons name="add-circle" size={20} color={colors.primary} />
                <Text style={styles.modalTitle}>Add Repository</Text>
              </View>

              <TextInput
                style={styles.compactTextInput}
                value={newRepositoryUrl}
                onChangeText={handleUrlChange}
                placeholder="Repository URL"
                placeholderTextColor={colors.mediumGray}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                multiline={false}
                numberOfLines={1}
              />


              {/* Format Hint */}
              <Text style={styles.formatHint}>
                {t('plugins.repo_format_hint')}
              </Text>

              {/* Action Buttons */}
              <View style={styles.compactActions}>
                <TouchableOpacity
                  style={[styles.compactButton, styles.cancelButton]}
                  onPress={() => {
                    setShowAddRepositoryModal(false);
                    setNewRepositoryUrl('');
                  }}
                >
                  <Text style={styles.cancelButtonText}>{t('plugins.cancel')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.compactButton, styles.addButton, (!newRepositoryUrl.trim() || isLoading) && styles.disabledButton]}
                  onPress={handleAddRepository}
                  disabled={!newRepositoryUrl.trim() || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.addButtonText}>{t('plugins.add')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        actions={alertActions}
        onClose={() => setAlertVisible(false)}
      />
    </SafeAreaView>
  );
};

export default PluginsScreen;
