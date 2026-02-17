import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Platform,
  TouchableOpacity,
  StatusBar,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettings, AppSettings } from '../hooks/useSettings';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useTheme } from '../contexts/ThemeContext';
import CustomAlert from '../components/CustomAlert';
import { useTranslation } from 'react-i18next';

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;

interface SettingItemProps {
  title: string;
  description?: string;
  icon: string;
  isSelected: boolean;
  onPress: () => void;
  isLast?: boolean;
}

const SettingItem: React.FC<SettingItemProps> = ({
  title,
  description,
  icon,
  isSelected,
  onPress,
  isLast,
}) => {
  const { currentTheme } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.settingItem,
        !isLast && styles.settingItemBorder,
        { borderBottomColor: 'rgba(255,255,255,0.08)' },
      ]}
    >
      <View style={styles.settingContent}>
        <View style={[
          styles.settingIconContainer,
          { backgroundColor: 'rgba(255,255,255,0.1)' }
        ]}>
          <MaterialIcons
            name={icon}
            size={20}
            color={currentTheme.colors.primary}
          />
        </View>
        <View style={styles.settingText}>
          <Text
            style={[
              styles.settingTitle,
              { color: currentTheme.colors.text },
            ]}
          >
            {title}
          </Text>
          {description && (
            <Text
              style={[
                styles.settingDescription,
                { color: currentTheme.colors.textMuted },
              ]}
            >
              {description}
            </Text>
          )}
        </View>
        {isSelected && (
          <MaterialIcons
            name="check"
            size={24}
            color={currentTheme.colors.primary}
            style={styles.checkIcon}
          />
        )}
      </View>
    </TouchableOpacity>
  );
};

const PlayerSettingsScreen: React.FC = () => {
  const { settings, updateSetting } = useSettings();
  const { currentTheme } = useTheme();
  const navigation = useNavigation();
  const { t } = useTranslation();

  // CustomAlert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const openAlert = (title: string, message: string) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertVisible(true);
  };

  const playerOptions = [
    {
      id: 'internal',
      title: t('player.internal_title'),
      description: t('player.internal_desc'),
      icon: 'play-circle-outline',
    },
    ...(Platform.OS === 'ios' ? [
      {
        id: 'vlc',
        title: t('player.vlc_title'),
        description: t('player.vlc_desc'),
        icon: 'video-library',
      },
      {
        id: 'infuse',
        title: t('player.infuse_title'),
        description: t('player.infuse_desc'),
        icon: 'smart-display',
      },
      {
        id: 'outplayer',
        title: t('player.outplayer_title'),
        description: t('player.outplayer_desc'),
        icon: 'slideshow',
      },
      {
        id: 'vidhub',
        title: t('player.vidhub_title'),
        description: t('player.vidhub_desc'),
        icon: 'ondemand-video',
      },
      {
        id: 'infuse_livecontainer',
        title: t('player.infuse_live_title'),
        description: t('player.infuse_live_desc'),
        icon: 'smart-display',
      },
    ] : [
      {
        id: 'external',
        title: t('player.external_title'),
        description: t('player.external_desc'),
        icon: 'open-in-new',
      },
    ]),
  ];

  const handleBack = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: currentTheme.colors.darkBackground },
      ]}
    >
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

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
          <Text style={[styles.backText, { color: currentTheme.colors.text }]}>
            {t('common.settings') || 'Settings'}
          </Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Empty for now, but ready for future actions */}
        </View>
      </View>

      <Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>
        {t('player.title')}
      </Text>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: currentTheme.colors.textMuted },
            ]}
          >
            {t('player.section_selection')}
          </Text>
          <View
            style={[
              styles.card,
              {
                backgroundColor: currentTheme.colors.elevation2,
              },
            ]}
          >
            {playerOptions.map((option, index) => (
              <SettingItem
                key={option.id}
                title={option.title}
                description={option.description}
                icon={option.icon}
                isSelected={
                  Platform.OS === 'ios'
                    ? settings.preferredPlayer === option.id
                    : settings.useExternalPlayer === (option.id === 'external')
                }
                onPress={() => {
                  if (Platform.OS === 'ios') {
                    updateSetting('preferredPlayer', option.id as AppSettings['preferredPlayer']);
                  } else {
                    updateSetting('useExternalPlayer', option.id === 'external');
                  }
                }}
                isLast={index === playerOptions.length - 1}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: currentTheme.colors.textMuted },
            ]}
          >
            {t('player.section_playback')}
          </Text>
          <View
            style={[
              styles.card,
              {
                backgroundColor: currentTheme.colors.elevation2,
              },
            ]}
          >
            {/* Video Player Engine for Android */}
            {Platform.OS === 'android' && !settings.useExternalPlayer && (
              <>
                <View style={[styles.settingItem, styles.settingItemBorder, { borderTopColor: 'rgba(255,255,255,0.08)', borderTopWidth: 1 }]}>
                  <View style={styles.settingContent}>
                    <View style={[
                      styles.settingIconContainer,
                      { backgroundColor: 'rgba(255,255,255,0.1)' }
                    ]}>
                      <MaterialIcons
                        name="play-circle-filled"
                        size={20}
                        color={currentTheme.colors.primary}
                      />
                    </View>
                    <View style={styles.settingText}>
                      <Text
                        style={[
                          styles.settingTitle,
                          { color: currentTheme.colors.text },
                        ]}
                      >
                        {t('player.engine_title')}
                      </Text>
                      <Text
                        style={[
                          styles.settingDescription,
                          { color: currentTheme.colors.textMuted },
                        ]}
                      >
                        {t('player.engine_desc')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.optionButtonsRow}>
                    {([
                      { id: 'auto', label: t('player.option_auto'), desc: t('player.option_auto_desc_engine') },
                      { id: 'mpv', label: t('player.option_mpv'), desc: t('player.option_mpv_desc') },
                    ] as const).map((option) => (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => updateSetting('videoPlayerEngine', option.id)}
                        style={[
                          styles.optionButton,
                          styles.optionButtonWide,
                          settings.videoPlayerEngine === option.id && { backgroundColor: currentTheme.colors.primary },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionButtonText,
                            { color: settings.videoPlayerEngine === option.id ? '#fff' : currentTheme.colors.text },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Decoder Mode for Android Internal Player */}
                <View style={[styles.settingItem, styles.settingItemBorder, { borderTopColor: 'rgba(255,255,255,0.08)', borderTopWidth: 1 }]}>
                  <View style={styles.settingContent}>
                    <View style={[
                      styles.settingIconContainer,
                      { backgroundColor: 'rgba(255,255,255,0.1)' }
                    ]}>
                      <MaterialIcons
                        name="memory"
                        size={20}
                        color={currentTheme.colors.primary}
                      />
                    </View>
                    <View style={styles.settingText}>
                      <Text
                        style={[
                          styles.settingTitle,
                          { color: currentTheme.colors.text },
                        ]}
                      >
                        {t('player.decoder_title')}
                      </Text>
                      <Text
                        style={[
                          styles.settingDescription,
                          { color: currentTheme.colors.textMuted },
                        ]}
                      >
                        {t('player.decoder_desc')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.optionButtonsRow}>
                    {([
                      { id: 'auto', label: t('player.option_auto'), desc: t('player.option_auto_desc_decoder') },
                      { id: 'sw', label: t('player.option_sw'), desc: t('player.option_sw_desc') },
                      { id: 'hw', label: t('player.option_hw'), desc: t('player.option_hw_desc') },
                      { id: 'hw+', label: t('player.option_hw_plus'), desc: t('player.option_hw_plus_desc') },
                    ] as const).map((option) => (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => {
                          updateSetting('decoderMode', option.id);
                          openAlert(
                            t('player.restart_required'),
                            t('player.restart_msg_decoder')
                          );
                        }}
                        style={[
                          styles.optionButton,
                          settings.decoderMode === option.id && { backgroundColor: currentTheme.colors.primary },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionButtonText,
                            { color: settings.decoderMode === option.id ? '#fff' : currentTheme.colors.text },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* GPU Mode for Android Internal Player */}
                <View style={[styles.settingItem, styles.settingItemBorder, { borderTopColor: 'rgba(255,255,255,0.08)', borderTopWidth: 1 }]}>
                  <View style={styles.settingContent}>
                    <View style={[
                      styles.settingIconContainer,
                      { backgroundColor: 'rgba(255,255,255,0.1)' }
                    ]}>
                      <MaterialIcons
                        name="videocam"
                        size={20}
                        color={currentTheme.colors.primary}
                      />
                    </View>
                    <View style={styles.settingText}>
                      <Text
                        style={[
                          styles.settingTitle,
                          { color: currentTheme.colors.text },
                        ]}
                      >
                        {t('player.gpu_title')}
                      </Text>
                      <Text
                        style={[
                          styles.settingDescription,
                          { color: currentTheme.colors.textMuted },
                        ]}
                      >
                        {t('player.gpu_desc')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.optionButtonsRow}>
                    {([
                      { id: 'gpu', label: t('player.option_gpu_desc') },
                      { id: 'gpu-next', label: t('player.option_gpu_next_desc') },
                    ] as const).map((option) => (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => {
                          updateSetting('gpuMode', option.id);
                          openAlert(
                            t('player.restart_required'),
                            t('player.restart_msg_gpu')
                          );
                        }}
                        style={[
                          styles.optionButton,
                          styles.optionButtonWide,
                          settings.gpuMode === option.id && { backgroundColor: currentTheme.colors.primary },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionButtonText,
                            { color: settings.gpuMode === option.id ? '#fff' : currentTheme.colors.text },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}

            {/* External Player for Downloads */}
            {((Platform.OS === 'android' && settings.useExternalPlayer) ||
              (Platform.OS === 'ios' && settings.preferredPlayer !== 'internal')) && (
                <View style={[styles.settingItem, styles.settingItemBorder, { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' }]}>
                  <View style={styles.settingContent}>
                    <View style={[
                      styles.settingIconContainer,
                      { backgroundColor: 'rgba(255,255,255,0.1)' }
                    ]}>
                      <MaterialIcons
                        name="open-in-new"
                        size={20}
                        color={currentTheme.colors.primary}
                      />
                    </View>
                    <View style={styles.settingText}>
                      <Text
                        style={[
                          styles.settingTitle,
                          { color: currentTheme.colors.text },
                        ]}
                      >
                        {t('player.external_downloads_title')}
                      </Text>
                      <Text
                        style={[
                          styles.settingDescription,
                          { color: currentTheme.colors.textMuted },
                        ]}
                      >
                        {t('player.external_downloads_desc')}
                      </Text>
                    </View>
                    <Switch
                      value={settings.useExternalPlayerForDownloads}
                      onValueChange={(value) => updateSetting('useExternalPlayerForDownloads', value)}
                      thumbColor={settings.useExternalPlayerForDownloads ? currentTheme.colors.primary : undefined}
                    />
                  </View>
                </View>
              )}
          </View>
        </View>
      </ScrollView>

      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        onClose={() => setAlertVisible(false)}
      />
    </SafeAreaView >
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
    paddingBottom: 24,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 4,
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: 'rgba(0,0,0,0.1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  settingItem: {
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  settingItemBorder: {
    borderBottomWidth: 1,
  },
  settingContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 14,
    marginTop: 2,
  },
  checkIcon: {
    marginLeft: 16,
  },
  optionButtonsRow: {
    flexDirection: 'row',
    marginTop: 12,
    paddingHorizontal: 52,
    gap: 8,
  },
  optionButtonsRowScroll: {
    paddingHorizontal: 52,
    gap: 8,
    marginTop: 12,
    paddingBottom: 4,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionButtonLanguage: {
    minWidth: 90,
    flex: 0,
  },
  optionButtonWide: {
    flex: 1.5,
  },
  optionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default PlayerSettingsScreen; 
