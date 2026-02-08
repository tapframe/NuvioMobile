import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, StatusBar, Platform, Text, TouchableOpacity, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useSettings } from '../../hooks/useSettings';
import { RootStackParamList } from '../../navigation/AppNavigator';
import ScreenHeader from '../../components/common/ScreenHeader';
import { SettingsCard, SettingItem, CustomSwitch, ChevronRight } from './SettingsComponents';
import { useRealtimeConfig } from '../../hooks/useRealtimeConfig';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { SvgXml } from 'react-native-svg';
import { toastService } from '../../services/toastService';
import { introService } from '../../services/introService';
import { shaderService } from '../../services/shaderService';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const INTRODB_LOGO_URI = 'https://introdb.app/images/logo-vector.svg';

// Available languages for audio/subtitle selection
const AVAILABLE_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ru', name: 'Russian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'hi', name: 'Hindi' },
    { code: 'ar', name: 'Arabic' },
    { code: 'nl', name: 'Dutch' },
    { code: 'sv', name: 'Swedish' },
    { code: 'no', name: 'Norwegian' },
    { code: 'fi', name: 'Finnish' },
    { code: 'da', name: 'Danish' },
    { code: 'pl', name: 'Polish' },
    { code: 'tr', name: 'Turkish' },
    { code: 'cs', name: 'Czech' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'el', name: 'Greek' },
    { code: 'th', name: 'Thai' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'id', name: 'Indonesian' },
    { code: 'ms', name: 'Malay' },
    { code: 'ta', name: 'Tamil' },
    { code: 'te', name: 'Telugu' },
    { code: 'bn', name: 'Bengali' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'he', name: 'Hebrew' },
    { code: 'fa', name: 'Persian' },
];

const SUBTITLE_SOURCE_OPTIONS = [
    { value: 'internal', label: 'Internal First', description: 'Prefer embedded subtitles, then external' },
    { value: 'external', label: 'External First', description: 'Prefer addon subtitles, then embedded' },
    { value: 'any', label: 'Any Available', description: 'Use first available subtitle track' },
];

// Props for the reusable content component
interface PlaybackSettingsContentProps {
    isTablet?: boolean;
}

/**
 * Reusable PlaybackSettingsContent component
 */
export const PlaybackSettingsContent: React.FC<PlaybackSettingsContentProps> = ({ isTablet = false }) => {
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();
    const { currentTheme } = useTheme();
    const { settings, updateSetting } = useSettings();
    const { t } = useTranslation();
    const config = useRealtimeConfig();

    const [introDbLogoXml, setIntroDbLogoXml] = useState<string | null>(null);
    const [apiKeyInput, setApiKeyInput] = useState(settings?.introDbApiKey || '');
    const [isVerifyingKey, setIsVerifyingKey] = useState(false);

    // Video Enhancement Assets state
    const [isEnhancementDownloaded, setIsEnhancementDownloaded] = useState(false);
    const [isDownloadingEnhancement, setIsDownloadingEnhancement] = useState(false);
    const [enhancementProgress, setEnhancementProgress] = useState(0);

    const isMounted = useRef(true);

    const checkEnhancementStatus = useCallback(async () => {
        const available = await shaderService.checkAvailability();
        setIsEnhancementDownloaded(available);
    }, []);

    useFocusEffect(
        useCallback(() => {
            checkEnhancementStatus();
        }, [checkEnhancementStatus])
    );

    const handleDownloadEnhancements = async () => {
        setIsDownloadingEnhancement(true);
        const success = await shaderService.downloadShaders((p) => setEnhancementProgress(p));
        if (isMounted.current) {
            setIsDownloadingEnhancement(false);
            if (success) {
                shaderService.setInitialized(true); // Force update service state
                setIsEnhancementDownloaded(true);
                toastService.success(t('settings.enhancement_download_success', { defaultValue: 'Enhancement assets installed!' }));
            } else {
                toastService.error(t('settings.enhancement_download_failed', { defaultValue: 'Failed to install assets' }));
            }
        }
    };

    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    useEffect(() => {
        setApiKeyInput(settings?.introDbApiKey || '');
    }, [settings?.introDbApiKey]);

    const handleApiKeySubmit = async () => {
        if (!apiKeyInput.trim()) {
            updateSetting('introDbApiKey', '');
            toastService.success(t('settings.items.api_key_cleared', { defaultValue: 'API Key Cleared' }));
            return;
        }

        setIsVerifyingKey(true);
        const isValid = await introService.verifyApiKey(apiKeyInput);
        
        if (!isMounted.current) return;
        setIsVerifyingKey(false);

        if (isValid) {
            updateSetting('introDbApiKey', apiKeyInput);
            toastService.success(t('settings.items.api_key_saved', { defaultValue: 'API Key Saved' }));
        } else {
            toastService.error(t('settings.items.api_key_invalid', { defaultValue: 'Invalid API Key' }));
        }
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetch(INTRODB_LOGO_URI);
                let xml = await res.text();
                xml = xml.replace(/class="cls-4"/g, 'fill="url(#linear-gradient)"');
                xml = xml.replace(/class="cls-3"/g, 'fill="#141414" opacity=".38"');
                xml = xml.replace(/class="cls-1"/g, 'fill="url(#linear-gradient-2)" opacity=".53"');
                xml = xml.replace(/class="cls-2"/g, 'fill="url(#linear-gradient-3)" opacity=".53"');
                xml = xml.replace(/<style>[\s\S]*?<\/style>/, '');
                if (!cancelled) setIntroDbLogoXml(xml);
            } catch {
                if (!cancelled) setIntroDbLogoXml(null);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const introDbLogoIcon = introDbLogoXml ? (
        <SvgXml xml={introDbLogoXml} width={28} height={18} />
    ) : (
        <MaterialIcons name="skip-next" size={18} color={currentTheme.colors.primary} />
    );

    // Bottom sheet refs
    const audioLanguageSheetRef = useRef<BottomSheetModal>(null);
    const subtitleLanguageSheetRef = useRef<BottomSheetModal>(null);
    const subtitleSourceSheetRef = useRef<BottomSheetModal>(null);

    // Snap points
    const languageSnapPoints = useMemo(() => ['70%'], []);
    const sourceSnapPoints = useMemo(() => ['45%'], []);

    // Handlers
    const openAudioLanguageSheet = useCallback(() => {
        subtitleLanguageSheetRef.current?.dismiss();
        subtitleSourceSheetRef.current?.dismiss();
        setTimeout(() => audioLanguageSheetRef.current?.present(), 100);
    }, []);

    const openSubtitleLanguageSheet = useCallback(() => {
        audioLanguageSheetRef.current?.dismiss();
        subtitleSourceSheetRef.current?.dismiss();
        setTimeout(() => subtitleLanguageSheetRef.current?.present(), 100);
    }, []);

    const openSubtitleSourceSheet = useCallback(() => {
        audioLanguageSheetRef.current?.dismiss();
        subtitleLanguageSheetRef.current?.dismiss();
        setTimeout(() => subtitleSourceSheetRef.current?.present(), 100);
    }, []);

    const isItemVisible = (itemId: string) => {
        if (!config?.items) return true;
        const item = config.items[itemId];
        if (item && item.visible === false) return false;
        return true;
    };

    const hasVisibleItems = (itemIds: string[]) => {
        return itemIds.some(id => isItemVisible(id));
    };

    const getLanguageName = (code: string) => {
        const lang = AVAILABLE_LANGUAGES.find(l => l.code === code);
        return lang ? lang.name : code.toUpperCase();
    };

    const getSourceLabel = (value: string) => {
        if (value === 'internal') return t('settings.options.internal_first');
        if (value === 'external') return t('settings.options.external_first');
        if (value === 'any') return t('settings.options.any_available');
        return t('settings.options.internal_first');
    };

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

    const handleSelectAudioLanguage = (code: string) => {
        updateSetting('preferredAudioLanguage', code);
        audioLanguageSheetRef.current?.dismiss();
    };

    const handleSelectSubtitleLanguage = (code: string) => {
        updateSetting('preferredSubtitleLanguage', code);
        subtitleLanguageSheetRef.current?.dismiss();
    };

    const handleSelectSubtitleSource = (value: 'internal' | 'external' | 'any') => {
        updateSetting('subtitleSourcePreference', value);
        subtitleSourceSheetRef.current?.dismiss();
    };

    return (
        <>
            {hasVisibleItems(['video_player']) && (
                <SettingsCard title={t('settings.sections.video_player')} isTablet={isTablet}>
                    {isItemVisible('video_player') && (
                        <SettingItem
                            title={t('settings.items.video_player')}
                            description={Platform.OS === 'ios'
                                ? (settings?.preferredPlayer === 'internal' ? t('settings.items.built_in') : settings?.preferredPlayer?.toUpperCase() || t('settings.items.built_in'))
                                : (settings?.useExternalPlayer ? t('settings.items.external') : t('settings.items.built_in'))
                            }
                            icon="play-circle"
                            renderControl={() => <ChevronRight />}
                            onPress={() => navigation.navigate('PlayerSettings')}
                            isLast
                            isTablet={isTablet}
                        />
                    )}
                </SettingsCard>
            )}

            <SettingsCard title={t('player.section_playback', { defaultValue: 'Playback' })} isTablet={isTablet}>
                <SettingItem
                    title={t('player.skip_intro_settings_title', { defaultValue: 'Skip Intro' })}
                    description={t('player.powered_by_introdb', { defaultValue: 'Powered by IntroDB' })}
                    customIcon={introDbLogoIcon}
                    renderControl={() => (
                        <CustomSwitch
                            value={settings?.skipIntroEnabled ?? true}
                            onValueChange={(value) => updateSetting('skipIntroEnabled', value)}
                        />
                    )}
                    isLast
                    isTablet={isTablet}
                />
            </SettingsCard>

            {/* IntroDB Contribution Section */}
            <SettingsCard title={t('settings.sections.introdb_contribution', { defaultValue: 'IntroDB Contribution' })} isTablet={isTablet}>
                <SettingItem
                    title={t('settings.items.enable_intro_submission', { defaultValue: 'Enable Intro Submission' })}
                    description={t('settings.items.enable_intro_submission_desc', { defaultValue: 'Contribute timestamps to the community' })}
                    icon="flag"
                    renderControl={() => (
                        <CustomSwitch
                            value={settings?.introSubmitEnabled ?? false}
                            onValueChange={(value) => updateSetting('introSubmitEnabled', value)}
                        />
                    )}
                    isLast={!settings?.introSubmitEnabled}
                    isTablet={isTablet}
                />
                
                {settings?.introSubmitEnabled && (
                    <View style={styles.inputContainer}>
                        <Text style={styles.inputLabel}>
                            {t('settings.items.introdb_api_key', { defaultValue: 'INTRODB API KEY' })}
                        </Text>
                        <View style={styles.apiKeyRow}>
                            <TextInput
                                style={[styles.input, { flex: 1, marginRight: 10, color: currentTheme.colors.highEmphasis }]}
                                value={apiKeyInput}
                                onChangeText={setApiKeyInput}
                                placeholder="Enter your API key"
                                placeholderTextColor={currentTheme.colors.mediumEmphasis}
                                autoCapitalize="none"
                                autoCorrect={false}
                                secureTextEntry
                            />
                            <TouchableOpacity
                                style={styles.confirmButton}
                                onPress={handleApiKeySubmit}
                                disabled={isVerifyingKey}
                            >
                                {isVerifyingKey ? (
                                    <ActivityIndicator size="small" color="black" />
                                ) : (
                                    <MaterialIcons name="check" size={24} color="black" />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </SettingsCard>

            {/* Shaders Section */}
            <SettingsCard title="Shaders" isTablet={isTablet}>
                
                {/* Enable Shaders Toggle */}
                <SettingItem
                    title={t('settings.items.enable_shaders', { defaultValue: 'Enable Shaders' })}
                    description={t('settings.items.enable_shaders_desc', { defaultValue: 'Apply real-time shaders (Anime4K/FSR) to the player.' })}
                    icon="eye"
                    renderControl={() => (
                        <CustomSwitch
                            value={settings?.enableShaders ?? false}
                            onValueChange={(value) => updateSetting('enableShaders', value)}
                        />
                    )}
                    isTablet={isTablet}
                />

                {settings?.enableShaders && (
                    <>
                        {/* Profile Selection */}
                        <SettingItem
                            title={t('settings.items.shader_profile', { defaultValue: 'Shader Profile' })}
                            description={t('settings.items.shader_profile_desc', { defaultValue: 'Choose based on your device performance.' })}
                            icon="activity"
                            renderControl={() => (
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ color: currentTheme.colors.primary, marginRight: 8, fontWeight: '700' }}>
                                        {settings?.shaderProfile || 'MID-END'}
                                    </Text>
                                    <ChevronRight />
                                </View>
                            )}
                            onPress={() => {
                                const newProfile = settings?.shaderProfile === 'HIGH-END' ? 'MID-END' : 'HIGH-END';
                                updateSetting('shaderProfile', newProfile);
                                toastService.success(`Profile switched to ${newProfile}`);
                            }}
                            isTablet={isTablet}
                        />

                        {/* Warning Box */}
                        <View style={{
                            backgroundColor: 'rgba(220, 38, 38, 0.1)',
                            borderWidth: 1,
                            borderColor: 'rgba(220, 38, 38, 0.3)',
                            borderRadius: 12,
                            padding: 16,
                            marginHorizontal: 16,
                            marginTop: 12,
                            marginBottom: 12,
                            flexDirection: 'row'
                        }}>
                            <Ionicons name="alert-circle" size={24} color="#EF5350" style={{ marginRight: 12 }} />
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: '#EF5350', fontWeight: '700', fontSize: 15, marginBottom: 4 }}>Warning</Text>
                                <Text style={{ color: 'rgba(239, 83, 80, 0.8)', fontSize: 13, lineHeight: 18 }}>
                                    Using high-end shaders on older devices may cause lag, overheating, or black screens. Use 'MID-END' for better compatibility.
                                </Text>
                            </View>
                        </View>

                        {/* Install Assets / Status */}
                        <View style={{
                            backgroundColor: isEnhancementDownloaded ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                            borderWidth: 1,
                            borderColor: isEnhancementDownloaded ? 'rgba(76, 175, 80, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                            borderRadius: 12,
                            padding: 16,
                            marginHorizontal: 16,
                            marginBottom: 16,
                        }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                <Ionicons 
                                    name={isEnhancementDownloaded ? "checkmark-circle" : "cloud-download"} 
                                    size={20} 
                                    color={isEnhancementDownloaded ? "#4CAF50" : currentTheme.colors.primary} 
                                    style={{ marginRight: 10 }}
                                />
                                <Text style={{ color: 'white', fontWeight: '600', fontSize: 15 }}>
                                    {isEnhancementDownloaded ? 'Shader Assets Ready' : 'Install Shader Pack'}
                                </Text>
                            </View>
                            
                            {!isEnhancementDownloaded && (
                                <TouchableOpacity
                                    style={{
                                        backgroundColor: currentTheme.colors.primary,
                                        borderRadius: 8,
                                        paddingVertical: 12,
                                        alignItems: 'center',
                                        marginTop: 8
                                    }}
                                    onPress={handleDownloadEnhancements}
                                    disabled={isDownloadingEnhancement}
                                >
                                    {isDownloadingEnhancement ? (
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <ActivityIndicator size="small" color="black" style={{ marginRight: 8 }} />
                                            <Text style={{ color: 'black', fontWeight: '700' }}>
                                                Extracting {Math.round(enhancementProgress * 100)}%
                                            </Text>
                                        </View>
                                    ) : (
                                        <Text style={{ color: 'black', fontWeight: '700' }}>Initialize Assets</Text>
                                    )}
                                </TouchableOpacity>
                            )}
                            
                            {isEnhancementDownloaded && (
                                <View style={{ marginTop: 8 }}>
                                    <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 12, marginBottom: 12 }}>
                                        All required shader files are ready. You can switch profiles in the video player menu.
                                    </Text>
                                    <TouchableOpacity
                                        style={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                            borderRadius: 8,
                                            paddingVertical: 10,
                                            alignItems: 'center',
                                            borderWidth: 1,
                                            borderColor: 'rgba(255, 255, 255, 0.1)'
                                        }}
                                        onPress={async () => {
                                            await shaderService.clearShaders();
                                            setIsEnhancementDownloaded(false);
                                            toastService.success('Shader assets cleared');
                                        }}
                                    >
                                        <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontWeight: '600', fontSize: 13 }}>Reset Assets</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    </>
                )}
            </SettingsCard>

            {/* Audio & Subtitle Preferences */}
            <SettingsCard title={t('settings.sections.audio_subtitles')} isTablet={isTablet}>
                <SettingItem
                    title={t('settings.items.preferred_audio')}
                    description={getLanguageName(settings?.preferredAudioLanguage || 'en')}
                    icon="volume-2"
                    renderControl={() => <ChevronRight />}
                    onPress={openAudioLanguageSheet}
                    isTablet={isTablet}
                />
                <SettingItem
                    title={t('settings.items.preferred_subtitle')}
                    description={getLanguageName(settings?.preferredSubtitleLanguage || 'en')}
                    icon="type"
                    renderControl={() => <ChevronRight />}
                    onPress={openSubtitleLanguageSheet}
                    isTablet={isTablet}
                />
                <SettingItem
                    title={t('settings.items.subtitle_source')}
                    description={getSourceLabel(settings?.subtitleSourcePreference || 'internal')}
                    icon="layers"
                    renderControl={() => <ChevronRight />}
                    onPress={openSubtitleSourceSheet}
                    isTablet={isTablet}
                />
                <SettingItem
                    title={t('settings.items.auto_select_subs')}
                    description={t('settings.items.auto_select_subs_desc')}
                    icon="zap"
                    renderControl={() => (
                        <CustomSwitch
                            value={settings?.enableSubtitleAutoSelect ?? true}
                            onValueChange={(value) => updateSetting('enableSubtitleAutoSelect', value)}
                        />
                    )}
                    isLast
                    isTablet={isTablet}
                />
            </SettingsCard>

            {hasVisibleItems(['show_trailers', 'enable_downloads']) && (
                <SettingsCard title={t('settings.sections.media')} isTablet={isTablet}>
                    {isItemVisible('show_trailers') && (
                        <SettingItem
                            title={t('settings.items.show_trailers')}
                            description={t('settings.items.show_trailers_desc')}
                            icon="film"
                            renderControl={() => (
                                <CustomSwitch
                                    value={settings?.showTrailers ?? true}
                                    onValueChange={(value) => updateSetting('showTrailers', value)}
                                />
                            )}
                            isTablet={isTablet}
                        />
                    )}
                    {isItemVisible('enable_downloads') && (
                        <SettingItem
                            title={t('settings.items.enable_downloads')}
                            description={t('settings.items.enable_downloads_desc')}
                            icon="download"
                            renderControl={() => (
                                <CustomSwitch
                                    value={settings?.enableDownloads ?? false}
                                    onValueChange={(value) => updateSetting('enableDownloads', value)}
                                />
                            )}
                            isLast
                            isTablet={isTablet}
                        />
                    )}
                </SettingsCard>
            )}

            {hasVisibleItems(['notifications']) && (
                <SettingsCard title={t('settings.sections.notifications')} isTablet={isTablet}>
                    {isItemVisible('notifications') && (
                        <SettingItem
                            title={t('settings.items.notifications')}
                            description={t('settings.items.notifications_desc')}
                            icon="bell"
                            renderControl={() => <ChevronRight />}
                            onPress={() => navigation.navigate('NotificationSettings')}
                            isLast
                            isTablet={isTablet}
                        />
                    )}
                </SettingsCard>
            )}

            <BottomSheetModal
                ref={audioLanguageSheetRef}
                index={0}
                snapPoints={languageSnapPoints}
                enableDynamicSizing={false}
                enablePanDownToClose={true}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: '#1a1a1a' }}
                handleIndicatorStyle={{ backgroundColor: 'rgba(255,255,255,0.3)' }}
            >
                <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>{t('settings.items.preferred_audio')}</Text>
                </View>
                <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
                    {AVAILABLE_LANGUAGES.map((lang) => {
                        const isSelected = lang.code === (settings?.preferredAudioLanguage || 'en');
                        return (
                            <TouchableOpacity
                                key={lang.code}
                                style={[
                                    styles.languageItem,
                                    isSelected && { backgroundColor: currentTheme.colors.primary + '20' }
                                ]}
                                onPress={() => handleSelectAudioLanguage(lang.code)}
                            >
                                <Text style={[styles.languageName, { color: isSelected ? currentTheme.colors.primary : '#fff' }]}>
                                    {lang.name}
                                </Text>
                                <Text style={styles.languageCode}>
                                    {lang.code.toUpperCase()}
                                </Text>
                                {isSelected && (
                                    <MaterialIcons name="check" size={20} color={currentTheme.colors.primary} />
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </BottomSheetScrollView>
            </BottomSheetModal>

            <BottomSheetModal
                ref={subtitleLanguageSheetRef}
                index={0}
                snapPoints={languageSnapPoints}
                enableDynamicSizing={false}
                enablePanDownToClose={true}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: '#1a1a1a' }}
                handleIndicatorStyle={{ backgroundColor: 'rgba(255,255,255,0.3)' }}
            >
                <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>{t('settings.items.preferred_subtitle')}</Text>
                </View>
                <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
                    {AVAILABLE_LANGUAGES.map((lang) => {
                        const isSelected = lang.code === (settings?.preferredSubtitleLanguage || 'en');
                        return (
                            <TouchableOpacity
                                key={lang.code}
                                style={[
                                    styles.languageItem,
                                    isSelected && { backgroundColor: currentTheme.colors.primary + '20' }
                                ]}
                                onPress={() => handleSelectSubtitleLanguage(lang.code)}
                            >
                                <Text style={[styles.languageName, { color: isSelected ? currentTheme.colors.primary : '#fff' }]}>
                                    {lang.name}
                                </Text>
                                <Text style={styles.languageCode}>
                                    {lang.code.toUpperCase()}
                                </Text>
                                {isSelected && (
                                    <MaterialIcons name="check" size={20} color={currentTheme.colors.primary} />
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </BottomSheetScrollView>
            </BottomSheetModal>

            <BottomSheetModal
                ref={subtitleSourceSheetRef}
                index={0}
                snapPoints={sourceSnapPoints}
                enableDynamicSizing={false}
                enablePanDownToClose={true}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: '#1a1a1a' }}
                handleIndicatorStyle={{ backgroundColor: 'rgba(255,255,255,0.3)' }}
            >
                <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>{t('settings.items.subtitle_source')}</Text>
                </View>
                <BottomSheetScrollView contentContainerStyle={styles.sheetContent}>
                    {SUBTITLE_SOURCE_OPTIONS.map((option) => {
                        const isSelected = option.value === (settings?.subtitleSourcePreference || 'internal');
                        return (
                            <TouchableOpacity
                                key={option.value}
                                style={[
                                    styles.sourceItem,
                                    isSelected && { backgroundColor: currentTheme.colors.primary + '20', borderColor: currentTheme.colors.primary }
                                ]}
                                onPress={() => handleSelectSubtitleSource(option.value as 'internal' | 'external' | 'any')}
                            >
                                <View style={styles.sourceItemContent}>
                                    <Text style={[styles.sourceLabel, { color: isSelected ? currentTheme.colors.primary : '#fff' }]}>
                                        {getSourceLabel(option.value)}
                                    </Text>
                                    <Text style={styles.sourceDescription}>
                                        {option.value === 'internal' && t('settings.options.internal_first_desc')}
                                        {option.value === 'external' && t('settings.options.external_first_desc')}
                                        {option.value === 'any' && t('settings.options.any_available_desc')}
                                    </Text>
                                </View>
                                {isSelected && (
                                    <MaterialIcons name="check" size={20} color={currentTheme.colors.primary} />
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </BottomSheetScrollView>
            </BottomSheetModal>
        </>
    );
};

/**
 * PlaybackSettingsScreen - Wrapper for mobile navigation
 */
const PlaybackSettingsScreen: React.FC = () => {
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();
    const { currentTheme } = useTheme();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const screenIsTablet = width >= 768;

    return (
        <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
            <StatusBar barStyle="light-content" />
            <ScreenHeader title={t('settings.playback')} showBackButton onBackPress={() => navigation.goBack()} />

            <ScrollView
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
            >
                <PlaybackSettingsContent isTablet={screenIsTablet} />
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingTop: 16,
    },
    sheetHeader: {
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
        marginBottom: 8,
    },
    sheetTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    sheetContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 24,
    },
    languageItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginVertical: 2,
    },
    languageName: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
    },
    languageCode: {
        fontSize: 12,
        marginRight: 12,
        color: 'rgba(255,255,255,0.5)',
    },
    sourceItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginVertical: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
        backgroundColor: 'rgba(255,255,255,0.05)',
    },
    sourceItemContent: {
        flex: 1,
    },
    sourceLabel: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    sourceDescription: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.5)',
    },
    inputContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        paddingTop: 8,
    },
    inputLabel: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.5)',
        marginBottom: 8,
        marginLeft: 4,
    },
    input: {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        color: 'white',
        fontSize: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    apiKeyRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    confirmButton: {
        backgroundColor: 'white',
        borderRadius: 12,
        width: 48,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
});

export default PlaybackSettingsScreen;