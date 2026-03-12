import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Updates from 'expo-updates';
import { backupService, BackupOptions } from '../services/backupService';
import { useTheme } from '../contexts/ThemeContext';
import { logger } from '../utils/logger';
import CustomAlert from './CustomAlert';
import i18n from '../i18n';

interface BackupRestoreSettingsProps {
  isTablet?: boolean;
}

const BackupRestoreSettings: React.FC<BackupRestoreSettingsProps> = ({ isTablet = false }) => {
  const { currentTheme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  
  // Alert state
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
    setAlertActions(actions && actions.length > 0 ? actions : [{ label: 'OK', onPress: () => {} }]);
    setAlertVisible(true);
  };

  const restartApp = async () => {
    try {
      await Updates.reloadAsync();
    } catch (error) {
      logger.error('[BackupRestoreSettings] Failed to restart app:', error);
      // Fallback: show error message
      openAlert(
        i18n.t('components.restart_failed_title'),
        i18n.t('components.restart_failed_desc'),
        [{ label: 'OK', onPress: () => {} }]
      );
    }
  };


  // Create backup
  const handleCreateBackup = useCallback(async () => {
    try {
      // First, get backup preview to show what will be backed up
      setIsLoading(true);
      const preview = await backupService.getBackupPreview();
      setIsLoading(false);

      // Calculate total without downloads
      const totalWithoutDownloads = preview.library + preview.watchProgress + preview.addons + preview.scrapers;

      openAlert(
        'Create Backup',
        `Backup Contents:\n\n` +
        `Library: ${preview.library} items\n` +
        `Watch Progress: ${preview.watchProgress} entries\n` +
        `Addons: ${preview.addons} installed\n` +
        `Plugins: ${preview.scrapers} configurations\n\n` +
        `Total: ${totalWithoutDownloads} items\n\n` +
        `This backup includes all your app settings, themes, and integration data.`,
        [
          { label: 'Cancel', onPress: () => {} },
          {
            label: 'Create Backup',
            onPress: async () => {
              try {
                setIsLoading(true);

                const backupOptions: BackupOptions = {
                  includeLibrary: true,
                  includeWatchProgress: true,
                  includeDownloads: true,
                  includeAddons: true,
                  includeSettings: true,
                  includeTraktData: true,
                  includeLocalScrapers: true,
                };

                const fileUri = await backupService.createBackup(backupOptions);

                // Share the backup file
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(fileUri, {
                    mimeType: 'application/json',
                    dialogTitle: i18n.t('components.share_nuvio_backup'),
                  });
                }

                openAlert(
                  i18n.t('components.backup_created_title'),
                  i18n.t('components.backup_created_desc'),
                  [{ label: 'OK', onPress: () => {} }]
                );
              } catch (error) {
                logger.error('[BackupRestoreSettings] Failed to create backup:', error);
                openAlert(
                  i18n.t('components.backup_failed_title'),
                  `Failed to create backup: ${error instanceof Error ? error.message : String(error)}`,
                  [{ label: 'OK', onPress: () => {} }]
                );
              } finally {
                setIsLoading(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      logger.error('[BackupRestoreSettings] Failed to get backup preview:', error);
      openAlert(
        'Error',
        i18n.t('components.backup_failed_desc'),
        [{ label: 'OK', onPress: () => {} }]
      );
      setIsLoading(false);
    }
  }, [openAlert]);

  // Restore backup
  const handleRestoreBackup = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const fileUri = result.assets[0].uri;
      
      // Validate backup file
      const backupInfo = await backupService.getBackupInfo(fileUri);
      
      openAlert(
        i18n.t('components.confirm_restore'),
        `This will restore your data from a backup created on ${new Date(backupInfo.timestamp || 0).toLocaleDateString()}.\n\nThis action will overwrite your current data. Are you sure you want to continue?`,
        [
          { label: 'Cancel', onPress: () => {} },
          { 
            label: 'Restore', 
            onPress: async () => {
              try {
                setIsLoading(true);
                
                const restoreOptions: BackupOptions = {
                  includeLibrary: true,
                  includeWatchProgress: true,
                  includeDownloads: true,
                  includeAddons: true,
                  includeSettings: true,
                  includeTraktData: true,
                  includeLocalScrapers: true,
                };
                
                await backupService.restoreBackup(fileUri, restoreOptions);
                
                openAlert(
                  i18n.t('components.restore_complete_title'),
                  i18n.t('components.restore_complete_desc'),
                  [
                    { label: 'Cancel', onPress: () => {} },
                    { 
                      label: 'Restart App', 
                      onPress: restartApp,
                      style: { fontWeight: 'bold' }
                    }
                  ]
                );
              } catch (error) {
                logger.error('[BackupRestoreSettings] Failed to restore backup:', error);
                openAlert(
                  i18n.t('components.restore_failed_title'),
                  `Failed to restore backup: ${error instanceof Error ? error.message : String(error)}`,
                  [{ label: 'OK', onPress: () => {} }]
                );
              } finally {
                setIsLoading(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      logger.error('[BackupRestoreSettings] Failed to pick backup file:', error);
      openAlert(
        i18n.t('components.file_selection_failed'),
        `Failed to select backup file: ${error instanceof Error ? error.message : String(error)}`,
        [{ label: 'OK', onPress: () => {} }]
      );
    }
  }, [openAlert]);



  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString() + ' ' + new Date(timestamp).toLocaleTimeString();
  };

  return (
    <View style={styles.container}>
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        actions={alertActions}
        onClose={() => setAlertVisible(false)}
      />
      
      {/* Backup Actions */}
      <View style={[styles.section, { backgroundColor: currentTheme.colors.elevation1 }]}>
        <Text style={[styles.sectionTitle, { color: currentTheme.colors.highEmphasis }]}>
          Backup & Restore
        </Text>
        
        <TouchableOpacity
          style={[
            styles.actionButton,
            { 
              backgroundColor: currentTheme.colors.primary,
              opacity: isLoading ? 0.6 : 1
            }
          ]}
          onPress={handleCreateBackup}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <>
              <MaterialIcons name="backup" size={20} color="white" />
              <Text style={styles.actionButtonText}>{i18n.t('components.create_backup')}</Text>
            </>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.actionButton,
            { 
              backgroundColor: currentTheme.colors.secondary,
              opacity: isLoading ? 0.6 : 1
            }
          ]}
          onPress={handleRestoreBackup}
          disabled={isLoading}
        >
          <MaterialIcons name="restore" size={20} color="white" />
          <Text style={styles.actionButtonText}>{i18n.t('components.restore_backup')}</Text>
        </TouchableOpacity>
      </View>

      
      {/* Info Section */}
      <View style={[styles.section, { backgroundColor: currentTheme.colors.elevation1 }]}>
        <Text style={[styles.sectionTitle, { color: currentTheme.colors.highEmphasis }]}>
          About Backups
        </Text>
        <Text style={[styles.infoText, { color: currentTheme.colors.mediumEmphasis }]}>
          • Backups include all your data: library, watch progress, settings, addons, downloads, and plugins{'\n'}
          • Backup files are stored locally on your device{'\n'}
          • Share your backup to transfer data between devices{'\n'}
          • Restoring will overwrite your current data
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
  },
});

export default BackupRestoreSettings;

