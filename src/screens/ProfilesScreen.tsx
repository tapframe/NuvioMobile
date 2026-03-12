import i18n from '../i18n';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
  SafeAreaView,
  TextInput,
  Modal
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useTraktContext } from '../contexts/TraktContext';
import { mmkvStorage } from '../services/mmkvStorage';
import CustomAlert from '../components/CustomAlert';

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;
const PROFILE_STORAGE_KEY = 'user_profiles';

interface Profile {
  id: string;
  name: string;
  avatar?: string;
  isActive: boolean;
  createdAt: number;
}

const ProfilesScreen: React.FC = () => {
  const navigation = useNavigation();
  const { currentTheme } = useTheme();
  const { isAuthenticated, userProfile, refreshAuthStatus } = useTraktContext();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [isLoading, setIsLoading] = useState(true);

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
    setAlertActions(actions && actions.length > 0 ? actions : [{ label: i18n.t('common.ok'), onPress: () => { } }]);
    setAlertVisible(true);
  };

  // Load profiles from AsyncStorage
  const loadProfiles = useCallback(async () => {
    try {
      setIsLoading(true);
      const storedProfiles = await mmkvStorage.getItem(PROFILE_STORAGE_KEY);
      if (storedProfiles) {
        setProfiles(JSON.parse(storedProfiles));
      } else {
        // If no profiles exist, create a default one with the Trakt username
        const defaultProfile: Profile = {
          id: new Date().getTime().toString(),
          name: userProfile?.username || 'Default',
          isActive: true,
          createdAt: new Date().getTime()
        };
        setProfiles([defaultProfile]);
        await mmkvStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify([defaultProfile]));
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading profiles:', error);
      openAlert('Error', 'Failed to load profiles');
    } finally {
      setIsLoading(false);
    }
  }, [userProfile]);

  // Add a focus listener to refresh authentication status
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Refresh the auth status when the screen comes into focus
      refreshAuthStatus().then(() => {
        if (isAuthenticated) {
          loadProfiles();
        }
      });
    });

    return unsubscribe;
  }, [navigation, refreshAuthStatus, isAuthenticated, loadProfiles]);

  // Save profiles to AsyncStorage
  const saveProfiles = useCallback(async (updatedProfiles: Profile[]) => {
    try {
      await mmkvStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(updatedProfiles));
    } catch (error) {
      if (__DEV__) console.error('Error saving profiles:', error);
      openAlert('Error', 'Failed to save profiles');
    }
  }, []);

  useEffect(() => {
    // Only authenticated users can access profiles
    if (!isAuthenticated) {
      navigation.goBack();
      return;
    }

    loadProfiles();
  }, [isAuthenticated, loadProfiles, navigation]);

  const handleAddProfile = useCallback(() => {
    if (!newProfileName.trim()) {
      openAlert('Error', 'Please enter a profile name');
      return;
    }

    const newProfile: Profile = {
      id: new Date().getTime().toString(),
      name: newProfileName.trim(),
      isActive: false,
      createdAt: new Date().getTime()
    };

    const updatedProfiles = [...profiles, newProfile];
    setProfiles(updatedProfiles);
    saveProfiles(updatedProfiles);
    setNewProfileName('');
    setShowAddModal(false);
  }, [newProfileName, profiles, saveProfiles]);

  const handleSelectProfile = useCallback((id: string) => {
    const updatedProfiles = profiles.map(profile => ({
      ...profile,
      isActive: profile.id === id
    }));

    setProfiles(updatedProfiles);
    saveProfiles(updatedProfiles);
  }, [profiles, saveProfiles]);

  const handleDeleteProfile = useCallback((id: string) => {
    // Prevent deleting the active profile
    const isActiveProfile = profiles.find(p => p.id === id)?.isActive;
    if (isActiveProfile) {
      openAlert('Error', 'Cannot delete the active profile. Switch to another profile first.');
      return;
    }

    // Prevent deleting the last profile
    if (profiles.length <= 1) {
      openAlert('Error', 'Cannot delete the only profile');
      return;
    }

    openAlert(
      i18n.t('components.delete_profile'),
      i18n.t('components.delete_profile_confirm'),
      [
        { label: i18n.t('components.cancel'), onPress: () => { } },
        {
          label: i18n.t('components.delete'),
          onPress: () => {
            const updatedProfiles = profiles.filter(profile => profile.id !== id);
            setProfiles(updatedProfiles);
            saveProfiles(updatedProfiles);
          }
        }
      ]
    );
  }, [profiles, saveProfiles]);

  const handleBack = () => {
    navigation.goBack();
  };

  const renderItem = ({ item }: { item: Profile }) => (
    <View style={styles.profileItem}>
      <TouchableOpacity
        style={[
          styles.profileContent,
          item.isActive && {
            backgroundColor: `${currentTheme.colors.primary}30`,
            borderColor: currentTheme.colors.primary
          }
        ]}
        onPress={() => handleSelectProfile(item.id)}
      >
        <View style={styles.avatarContainer}>
          <MaterialIcons
            name="account-circle"
            size={40}
            color={item.isActive ? currentTheme.colors.primary : currentTheme.colors.text}
          />
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: currentTheme.colors.text }]}>
            {item.name}
          </Text>
          {item.isActive && (
            <Text style={[styles.activeLabel, { color: currentTheme.colors.primary }]}>
              Active
            </Text>
          )}
        </View>
        {!item.isActive && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteProfile(item.id)}
          >
            <MaterialIcons name="delete" size={24} color={currentTheme.colors.error} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="arrow-back"
            size={24}
            color={currentTheme.colors.text}
          />
        </TouchableOpacity>
        <Text
          style={[
            styles.headerTitle,
            { color: currentTheme.colors.text },
          ]}
        >
          Profiles
        </Text>
      </View>

      <View style={styles.content}>
        <FlatList
          data={profiles}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={[styles.sectionTitle, { color: currentTheme.colors.textMuted }]}>
              MANAGE PROFILES
            </Text>
          }
          ListFooterComponent={
            <TouchableOpacity
              style={[
                styles.addButton,
                { backgroundColor: currentTheme.colors.elevation2 }
              ]}
              onPress={() => setShowAddModal(true)}
            >
              <MaterialIcons name="add" size={24} color={currentTheme.colors.primary} />
              <Text style={[styles.addButtonText, { color: currentTheme.colors.text }]}>
                Add New Profile
              </Text>
            </TouchableOpacity>
          }
        />
      </View>

      {/* Modal for adding a new profile */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: currentTheme.colors.elevation2 }]}>
            <Text style={[styles.modalTitle, { color: currentTheme.colors.text }]}>
              Create New Profile
            </Text>

            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: `${currentTheme.colors.textMuted}20`,
                  color: currentTheme.colors.text,
                  borderColor: currentTheme.colors.border
                }
              ]}
              placeholder={String(i18n.t('placeholders.profile_name'))}
              placeholderTextColor={currentTheme.colors.textMuted}
              value={newProfileName}
              onChangeText={setNewProfileName}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setNewProfileName('');
                  setShowAddModal(false);
                }}
              >
                <Text style={{ color: currentTheme.colors.textMuted }}>{i18n.t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.createButton,
                  { backgroundColor: currentTheme.colors.primary }
                ]}
                onPress={handleAddProfile}
              >
                <Text style={{ color: '#fff' }}>{i18n.t('profiles.create')}</Text>
              </TouchableOpacity>
            </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUSBAR_HEIGHT + 16 : 16,
    paddingBottom: 8,
  },
  backButton: {
    padding: 8,
    marginRight: 16,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  listContent: {
    paddingBottom: 24,
  },
  profileItem: {
    marginBottom: 12,
  },
  profileContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  avatarContainer: {
    marginRight: 16,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '500',
  },
  activeLabel: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
  deleteButton: {
    padding: 8,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginTop: 12,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 50,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 24,
    borderWidth: 1,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    marginRight: 8,
  },
  createButton: {
    marginLeft: 8,
  },
});

export default ProfilesScreen; 