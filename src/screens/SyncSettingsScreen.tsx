import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { NavigationProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../contexts/ThemeContext';
import CustomAlert from '../components/CustomAlert';
import { supabaseSyncService, SupabaseUser, RemoteSyncStats } from '../services/supabaseSyncService';
import { useAccount } from '../contexts/AccountContext';
import { useTraktContext } from '../contexts/TraktContext';
import { useSimklContext } from '../contexts/SimklContext';
import { useTranslation } from 'react-i18next';

const SyncSettingsScreen: React.FC = () => {
  const { currentTheme } = useTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAccount();
  const { isAuthenticated: traktAuthenticated } = useTraktContext();
  const { isAuthenticated: simklAuthenticated } = useSimklContext();

  const [loading, setLoading] = useState(false);
  const [syncCodeLoading, setSyncCodeLoading] = useState(false);
  const [sessionUser, setSessionUser] = useState<SupabaseUser | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [remoteStats, setRemoteStats] = useState<RemoteSyncStats | null>(null);

  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<Array<{ label: string; onPress: () => void; style?: object }>>([]);

  const openAlert = useCallback(
    (title: string, message: string, actions?: Array<{ label: string; onPress: () => void; style?: object }>) => {
      setAlertTitle(title);
      setAlertMessage(message);
      setAlertActions(actions && actions.length > 0 ? actions : [{ label: 'OK', onPress: () => {} }]);
      setAlertVisible(true);
    },
    []
  );

  const loadSyncState = useCallback(async () => {
    setLoading(true);
    try {
      await supabaseSyncService.initialize();
      setSessionUser(supabaseSyncService.getCurrentSessionUser());
      const owner = await supabaseSyncService.getEffectiveOwnerId();
      setOwnerId(owner);
      const stats = await supabaseSyncService.getRemoteStats();
      setRemoteStats(stats);
    } catch (error: any) {
      openAlert('Sync Error', error?.message || 'Failed to load sync state');
    } finally {
      setLoading(false);
    }
  }, [openAlert]);

  useFocusEffect(
    useCallback(() => {
      loadSyncState();
    }, [loadSyncState])
  );

  const authLabel = useMemo(() => {
    if (!supabaseSyncService.isConfigured()) return 'Supabase not configured';
    if (!sessionUser) return 'Not authenticated';
    return `Email session${sessionUser.email ? ` (${sessionUser.email})` : ''}`;
  }, [sessionUser]);

  const statItems = useMemo(() => {
    if (!remoteStats) return [];
    return [
      { label: 'Plugins', value: remoteStats.plugins },
      { label: 'Addons', value: remoteStats.addons },
      { label: 'Watch Progress', value: remoteStats.watchProgress },
      { label: 'Library Items', value: remoteStats.libraryItems },
      { label: 'Watched Items', value: remoteStats.watchedItems },
    ];
  }, [remoteStats]);
  const isSignedIn = Boolean(user);
  const externalSyncServices = useMemo(
    () => [
      traktAuthenticated ? 'Trakt' : null,
      simklAuthenticated ? 'Simkl' : null,
    ].filter(Boolean) as string[],
    [traktAuthenticated, simklAuthenticated]
  );
  const externalSyncActive = externalSyncServices.length > 0;

  const handleManualSync = async () => {
    setSyncCodeLoading(true);
    try {
      await supabaseSyncService.pullAllToLocal();
      openAlert('Cloud Data Pulled', 'Latest cloud data was pulled to this device.');
      await loadSyncState();
    } catch (error: any) {
      openAlert('Pull Failed', error?.message || 'Failed to pull cloud data');
    } finally {
      setSyncCodeLoading(false);
    }
  };

  const handleUploadLocalData = async () => {
    setSyncCodeLoading(true);
    try {
      await supabaseSyncService.pushAllLocalData();
      openAlert('Upload Complete', 'This device data has been uploaded to cloud.');
      await loadSyncState();
    } catch (error: any) {
      openAlert('Upload Failed', error?.message || 'Failed to upload local data');
    } finally {
      setSyncCodeLoading(false);
    }
  };

  const handleSignOut = async () => {
    setSyncCodeLoading(true);
    try {
      await signOut();
      await loadSyncState();
    } catch (error: any) {
      openAlert('Sign Out Failed', error?.message || 'Failed to sign out');
    } finally {
      setSyncCodeLoading(false);
    }
  };

  return (
      <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={currentTheme.colors.highEmphasis} />
          <Text style={[styles.backText, { color: currentTheme.colors.highEmphasis }]}>{t('settings.title')}</Text>
        </TouchableOpacity>
        <View style={styles.headerActions} />
      </View>
      <Text style={[styles.screenTitle, { color: currentTheme.colors.highEmphasis }]}>Nuvio Sync</Text>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={currentTheme.colors.primary} size="large" />
        </View>
      ) : (
      <>

      <ScrollView contentContainerStyle={[styles.content, isTablet ? styles.contentTablet : null, { paddingBottom: insets.bottom + 24 }]}>
        <View style={[styles.heroCard, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTitleWrap}>
              <Text style={[styles.heroTitle, { color: currentTheme.colors.highEmphasis }]}>Cloud Sync</Text>
              <Text style={[styles.heroSubtitle, { color: currentTheme.colors.mediumEmphasis }]}>
                Keep your addons, progress and library aligned across devices.
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.noteCard, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="info-outline" size={18} color={currentTheme.colors.highEmphasis} />
            <Text style={[styles.cardTitle, { color: currentTheme.colors.highEmphasis }]}>External Sync Priority</Text>
          </View>
          <Text style={[styles.cardText, { color: currentTheme.colors.mediumEmphasis }]}>
            {externalSyncActive
              ? `${externalSyncServices.join(' + ')} is active. Watch progress and library updates are managed by these services instead of Nuvio cloud database.`
              : 'If Trakt or Simkl sync is enabled, watch progress and library updates will use those services instead of Nuvio cloud database.'}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="person-outline" size={18} color={currentTheme.colors.highEmphasis} />
            <Text style={[styles.cardTitle, { color: currentTheme.colors.highEmphasis }]}>Account</Text>
          </View>
          <Text style={[styles.cardText, { color: currentTheme.colors.mediumEmphasis }]}>
            {user?.email ? `Signed in as ${user.email}` : 'Not signed in'}
          </Text>
          <View style={styles.buttonRow}>
            {!isSignedIn ? (
              <TouchableOpacity
                style={[styles.button, { backgroundColor: currentTheme.colors.primary }]}
                onPress={() => navigation.navigate('Account')}
              >
                <Text style={styles.buttonText}>Sign In / Sign Up</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: currentTheme.colors.primary }]}
                  onPress={() => navigation.navigate('AccountManage')}
                >
                  <Text style={styles.buttonText}>Manage Account</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={syncCodeLoading}
                  style={[styles.button, { backgroundColor: currentTheme.colors.elevation2 }]}
                  onPress={handleSignOut}
                >
                  <Text style={styles.buttonText}>Sign Out</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {!isSignedIn ? (
          <View style={[styles.card, styles.preAuthCard, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
            <View style={styles.sectionHeader}>
              <MaterialIcons name="sync-lock" size={18} color={currentTheme.colors.highEmphasis} />
              <Text style={[styles.cardTitle, { color: currentTheme.colors.highEmphasis }]}>Before You Sync</Text>
            </View>
            <Text style={[styles.cardText, { color: currentTheme.colors.mediumEmphasis }]}>
              Sign in to start cloud sync and keep your data consistent across devices.
            </Text>
            <View style={styles.preAuthList}>
              <Text style={[styles.preAuthItem, { color: currentTheme.colors.mediumEmphasis }]}>• Addons and plugin settings</Text>
              <Text style={[styles.preAuthItem, { color: currentTheme.colors.mediumEmphasis }]}>• Watch progress and library</Text>
            </View>
            {!supabaseSyncService.isConfigured() && (
              <Text style={[styles.warning, { color: '#ffb454' }]}>
                Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable sync.
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="link" size={18} color={currentTheme.colors.highEmphasis} />
                <Text style={[styles.cardTitle, { color: currentTheme.colors.highEmphasis }]}>Connection</Text>
              </View>
              <Text style={[styles.cardText, { color: currentTheme.colors.mediumEmphasis }]}>{authLabel}</Text>
              <Text style={[styles.cardText, { color: currentTheme.colors.mediumEmphasis }]}>
                Effective owner: {ownerId || 'Unavailable'}
              </Text>
              {!supabaseSyncService.isConfigured() && (
                <Text style={[styles.warning, { color: '#ffb454' }]}>
                  Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable sync.
                </Text>
              )}
            </View>

            <View style={[styles.card, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="storage" size={18} color={currentTheme.colors.highEmphasis} />
                <Text style={[styles.cardTitle, { color: currentTheme.colors.highEmphasis }]}>Database Stats</Text>
              </View>
              {!remoteStats ? (
                <Text style={[styles.cardText, { color: currentTheme.colors.mediumEmphasis }]}>
                  Sign in to load remote data counts.
                </Text>
              ) : (
                <View style={styles.statsGrid}>
                  {statItems.map((item) => (
                    <View key={item.label} style={[styles.statTile, { backgroundColor: currentTheme.colors.darkBackground, borderColor: currentTheme.colors.elevation2 }]}>
                      <Text style={[styles.statValue, { color: currentTheme.colors.highEmphasis }]}>{item.value}</Text>
                      <Text style={[styles.statLabel, { color: currentTheme.colors.mediumEmphasis }]}>{item.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.card, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
              <View style={styles.sectionHeader}>
                <MaterialIcons name="sync" size={18} color={currentTheme.colors.highEmphasis} />
                <Text style={[styles.cardTitle, { color: currentTheme.colors.highEmphasis }]}>Actions</Text>
              </View>
              <Text style={[styles.cardText, { color: currentTheme.colors.mediumEmphasis }]}>
                Pull to refresh this device from cloud, or upload this device as the latest source.
              </Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  disabled={syncCodeLoading || !supabaseSyncService.isConfigured()}
                  style={[
                    styles.button,
                    styles.primaryButton,
                    { backgroundColor: currentTheme.colors.primary },
                    (syncCodeLoading || !supabaseSyncService.isConfigured()) && styles.buttonDisabled,
                  ]}
                  onPress={handleManualSync}
                >
                  {syncCodeLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Pull From Cloud</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={syncCodeLoading || !supabaseSyncService.isConfigured()}
                  style={[
                    styles.button,
                    styles.secondaryButton,
                    { backgroundColor: currentTheme.colors.elevation2, borderColor: currentTheme.colors.elevation2 },
                    (syncCodeLoading || !supabaseSyncService.isConfigured()) && styles.buttonDisabled,
                  ]}
                  onPress={handleUploadLocalData}
                >
                  <Text style={styles.buttonText}>Upload This Device</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </ScrollView>
      </>
      )}

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  backText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  headerActions: {
    minWidth: 32,
  },
  screenTitle: {
    fontSize: 32,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  contentTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 980,
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroTitleWrap: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  noteCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  preAuthCard: {
    gap: 12,
  },
  preAuthList: {
    gap: 6,
    marginTop: 2,
  },
  preAuthItem: {
    fontSize: 13,
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardText: {
    fontSize: 13,
    lineHeight: 18,
  },
  warning: {
    fontSize: 12,
    marginTop: 4,
  },
  statsGrid: {
    marginTop: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statTile: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    borderRadius: 10,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  primaryButton: {
    borderWidth: 0,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});

export default SyncSettingsScreen;
