import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, TouchableOpacity, Platform, Linking, Dimensions, Alert, TextInput, Modal, KeyboardAvoidingView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FastImage from '@d11/react-native-fast-image';
import LottieView from 'lottie-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Sentry from '@sentry/react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { fetchTotalDownloads } from '../../services/githubReleaseService';
import { getDisplayedAppVersion } from '../../utils/version';
import ScreenHeader from '../../components/common/ScreenHeader';
import { SettingsCard, SettingItem, ChevronRight } from './SettingsComponents';
import { useTranslation } from 'react-i18next';
import { mmkvStorage } from '../../services/mmkvStorage';
import CustomAlert from '../../components/CustomAlert';

const { width } = Dimensions.get('window');

interface AboutSettingsContentProps {
    isTablet?: boolean;
    displayDownloads?: number | null;
    onDevModeChange?: (enabled: boolean) => void;
}

/**
 * Reusable AboutSettingsContent component
 * Can be used inline (tablets) or wrapped in a screen (mobile)
 */
export const AboutSettingsContent: React.FC<AboutSettingsContentProps> = ({
    isTablet = false,
    displayDownloads: externalDisplayDownloads,
    onDevModeChange
}) => {
    const { t } = useTranslation();
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();
    const { currentTheme } = useTheme();

    const [internalDisplayDownloads, setInternalDisplayDownloads] = useState<number | null>(null);
    const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
    const [tapCount, setTapCount] = useState(0);
    const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Developer code entry modal state
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [codeInput, setCodeInput] = useState('');

    // CustomAlert state
    const [alertState, setAlertState] = useState<{
        visible: boolean;
        title: string;
        message: string;
        actions: Array<{ label: string; onPress: () => void; style?: object }>;
    }>({
        visible: false,
        title: '',
        message: '',
        actions: [{ label: 'OK', onPress: () => { } }]
    });

    const showAlert = (title: string, message: string, actions?: Array<{ label: string; onPress: () => void; style?: object }>) => {
        setAlertState({
            visible: true,
            title,
            message,
            actions: actions || [{ label: 'OK', onPress: () => { } }]
        });
    };

    // Use external downloads if provided (for tablet inline use), otherwise load internally
    const displayDownloads = externalDisplayDownloads ?? internalDisplayDownloads;

    // Load developer mode state on mount
    useEffect(() => {
        const loadDevModeState = async () => {
            try {
                const devModeEnabled = await mmkvStorage.getItem('developer_mode_enabled');
                setDeveloperModeEnabled(devModeEnabled === 'true');
            } catch (error) {
                console.error('Failed to load developer mode state:', error);
            }
        };
        loadDevModeState();
    }, []);

    useEffect(() => {
        // Only load downloads internally if not provided externally
        if (externalDisplayDownloads === undefined) {
            const loadDownloads = async () => {
                const downloads = await fetchTotalDownloads();
                if (downloads !== null) {
                    setInternalDisplayDownloads(downloads);
                }
            };
            loadDownloads();
        }
    }, [externalDisplayDownloads]);

    const handleVersionTap = () => {
        // If already in developer mode, do nothing on tap
        if (developerModeEnabled) return;

        // Clear previous timeout
        if (tapTimeoutRef.current) {
            clearTimeout(tapTimeoutRef.current);
        }

        const newTapCount = tapCount + 1;
        setTapCount(newTapCount);

        // Reset tap count after 2 seconds of no tapping
        tapTimeoutRef.current = setTimeout(() => {
            setTapCount(0);
        }, 2000);

        // Trigger developer mode unlock after 5 taps
        if (newTapCount >= 5) {
            setTapCount(0);
            promptForDeveloperCode();
        }
    };

    const promptForDeveloperCode = () => {
        setCodeInput('');
        setShowCodeModal(true);
    };

    const verifyDeveloperCode = async () => {
        setShowCodeModal(false);
        const expectedCode = process.env.EXPO_PUBLIC_DEV_MODE_CODE || '815787';
        if (codeInput === expectedCode) {
            try {
                await mmkvStorage.setItem('developer_mode_enabled', 'true');
                setDeveloperModeEnabled(true);
                onDevModeChange?.(true);
                showAlert(
                    t('settings.developer_mode.enabled_title', 'Developer Mode Enabled'),
                    t('settings.developer_mode.enabled_message', 'Developer tools are now available in Settings.')
                );
            } catch (error) {
                console.error('Failed to save developer mode state:', error);
            }
        } else {
            showAlert(
                t('settings.developer_mode.invalid_code_title', 'Invalid Code'),
                t('settings.developer_mode.invalid_code_message', 'The code you entered is incorrect.')
            );
        }
        setCodeInput('');
    };

    const handleDisableDeveloperMode = () => {
        showAlert(
            t('settings.developer_mode.disable_title', 'Disable Developer Mode'),
            t('settings.developer_mode.disable_message', 'Are you sure you want to disable developer mode?'),
            [
                {
                    label: t('common.cancel', 'Cancel'),
                    onPress: () => { },
                },
                {
                    label: t('common.disable', 'Disable'),
                    onPress: async () => {
                        try {
                            await mmkvStorage.setItem('developer_mode_enabled', 'false');
                            setDeveloperModeEnabled(false);
                            onDevModeChange?.(false);
                            showAlert(
                                t('settings.developer_mode.disabled_title', 'Developer Mode Disabled'),
                                t('settings.developer_mode.disabled_message', 'Developer tools are now hidden.')
                            );
                        } catch (error) {
                            console.error('Failed to save developer mode state:', error);
                        }
                    },
                },
            ]
        );
    };

    return (
        <>
            <SettingsCard title={t('settings.sections.information')} isTablet={isTablet}>
                {isTablet && (
                    <SettingItem
                        title={t('contributors.title', 'Contributors')}
                        icon="users"
                        onPress={() => navigation.navigate('Contributors')}
                        renderControl={() => <ChevronRight />}
                        isTablet={isTablet}
                    />
                )}
                <SettingItem
                    title={t('settings.items.legal')}
                    icon="file-text"
                    onPress={() => navigation.navigate('Legal')}
                    renderControl={() => <ChevronRight />}
                    isTablet={isTablet}
                />
                <SettingItem
                    title={t('settings.items.privacy_policy')}
                    icon="lock"
                    onPress={() => Linking.openURL('https://tapframe.github.io/NuvioStreaming/#privacy-policy')}
                    renderControl={() => <ChevronRight />}
                    isTablet={isTablet}
                />
                <SettingItem
                    title={t('settings.items.report_issue')}
                    icon="alert-triangle"
                    onPress={() => Sentry.showFeedbackWidget()}
                    renderControl={() => <ChevronRight />}
                    isTablet={isTablet}
                />
                <SettingItem
                    title={t('settings.items.version')}
                    description={getDisplayedAppVersion()}
                    icon="info"
                    onPress={handleVersionTap}
                    isTablet={isTablet}
                />

                {developerModeEnabled && (
                    <SettingItem
                        title={t('settings.developer_mode.title', 'Developer Mode')}
                        description={t('settings.developer_mode.enabled_desc', 'Tap to disable developer mode')}
                        icon="code"
                        onPress={handleDisableDeveloperMode}
                        renderControl={() => <ChevronRight />}
                        isLast
                        isTablet={isTablet}
                    />
                )}
            </SettingsCard>

            {/* Developer Code Entry Modal */}
            <Modal
                visible={showCodeModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowCodeModal(false)}
                statusBarTranslucent
            >
                <KeyboardAvoidingView
                    style={modalStyles.overlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <TouchableOpacity
                        style={modalStyles.backdrop}
                        activeOpacity={1}
                        onPress={() => setShowCodeModal(false)}
                    />
                    <View style={modalStyles.container}>
                        <Text style={modalStyles.title}>
                            {t('settings.developer_mode.enter_code_title', 'Enable Developer Mode')}
                        </Text>
                        <Text style={modalStyles.message}>
                            {t('settings.developer_mode.enter_code_message', 'Enter the developer code to enable developer mode:')}
                        </Text>
                        <TextInput
                            style={modalStyles.input}
                            value={codeInput}
                            onChangeText={setCodeInput}
                            placeholder="Enter code"
                            placeholderTextColor="#888"
                            secureTextEntry
                            keyboardType="number-pad"
                            autoFocus
                            maxLength={10}
                        />
                        <View style={modalStyles.buttonRow}>
                            <TouchableOpacity
                                style={modalStyles.cancelButton}
                                onPress={() => {
                                    setShowCodeModal(false);
                                    setCodeInput('');
                                }}
                            >
                                <Text style={modalStyles.cancelButtonText}>
                                    {t('common.cancel', 'Cancel')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[modalStyles.confirmButton, { backgroundColor: currentTheme.colors.primary }]}
                                onPress={verifyDeveloperCode}
                            >
                                <Text style={modalStyles.confirmButtonText}>
                                    {t('common.confirm', 'Confirm')}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Custom Alert */}
            <CustomAlert
                visible={alertState.visible}
                title={alertState.title}
                message={alertState.message}
                actions={alertState.actions}
                onClose={() => setAlertState(prev => ({ ...prev, visible: false }))}
            />
        </>
    );
};

/**
 * Reusable AboutFooter component - Downloads counter, social links, branding
 */
export const AboutFooter: React.FC<{ displayDownloads: number | null }> = ({ displayDownloads }) => {
    const { currentTheme } = useTheme();
    const { t } = useTranslation();

    return (
        <>
            {displayDownloads !== null && (
                <View style={styles.downloadsContainer}>
                    <Text style={[styles.downloadsNumber, { color: currentTheme.colors.primary }]}>
                        {displayDownloads.toLocaleString()}
                    </Text>
                    <Text style={[styles.downloadsLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                        {t('settings.downloads_counter')}
                    </Text>
                </View>
            )}

            <View style={styles.communityContainer}>
                <TouchableOpacity
                    style={styles.supportButton}
                    onPress={() => WebBrowser.openBrowserAsync('https://ko-fi.com/tapframe', {
                        presentationStyle: Platform.OS === 'ios' ? WebBrowser.WebBrowserPresentationStyle.FORM_SHEET : WebBrowser.WebBrowserPresentationStyle.FORM_SHEET
                    })}
                    activeOpacity={0.7}
                >
                    <FastImage
                        source={require('../../../assets/support_me_on_kofi_red.png')}
                        style={styles.kofiImage}
                        resizeMode={FastImage.resizeMode.contain}
                    />
                </TouchableOpacity>

                <View style={styles.socialRow}>
                    <TouchableOpacity
                        style={[styles.socialButton, { backgroundColor: currentTheme.colors.elevation1 }]}
                        onPress={() => Linking.openURL('https://discord.gg/KVgDTjhA4H')}
                        activeOpacity={0.7}
                    >
                        <View style={styles.socialButtonContent}>
                            <FastImage
                                source={{ uri: 'https://pngimg.com/uploads/discord/discord_PNG3.png' }}
                                style={styles.socialLogo}
                                resizeMode={FastImage.resizeMode.contain}
                            />
                            <Text style={[styles.socialButtonText, { color: currentTheme.colors.highEmphasis }]}>
                                Discord
                            </Text>
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.socialButton, { backgroundColor: '#FF4500' + '15' }]}
                        onPress={() => Linking.openURL('https://www.reddit.com/r/Nuvio/')}
                        activeOpacity={0.7}
                    >
                        <View style={styles.socialButtonContent}>
                            <FastImage
                                source={{ uri: 'https://www.iconpacks.net/icons/2/free-reddit-logo-icon-2436-thumb.png' }}
                                style={styles.socialLogo}
                                resizeMode={FastImage.resizeMode.contain}
                            />
                            <Text style={[styles.socialButtonText, { color: '#FF4500' }]}>
                                Reddit
                            </Text>
                        </View>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Monkey Animation */}
            <View style={styles.monkeyContainer}>
                <LottieView
                    source={require('../../assets/lottie/monito.json')}
                    autoPlay
                    loop
                    style={styles.monkeyAnimation}
                    resizeMode="contain"
                />
            </View>

            <View style={styles.brandLogoContainer}>
                <FastImage
                    source={require('../../../assets/text_only_og.png')}
                    style={styles.brandLogo}
                    resizeMode={FastImage.resizeMode.contain}
                />
            </View>

            <View style={styles.footer}>
                <Text style={[styles.footerText, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('settings.made_with_love')}
                </Text>
            </View>
        </>
    );
};

/**
 * AboutSettingsScreen - Wrapper for mobile navigation
 */
const AboutSettingsScreen: React.FC = () => {
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();
    const { currentTheme } = useTheme();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const screenIsTablet = width >= 768;

    return (
        <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
            <StatusBar barStyle="light-content" />
            <ScreenHeader title={t('settings.about')} showBackButton onBackPress={() => navigation.goBack()} />

            <ScrollView
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
            >
                <AboutSettingsContent isTablet={screenIsTablet} />
                <View style={{ height: 24 }} />
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
    downloadsContainer: {
        alignItems: 'center',
        marginTop: 24,
        marginBottom: 16,
    },
    downloadsNumber: {
        fontSize: 48,
        fontWeight: '700',
        letterSpacing: -1,
    },
    downloadsLabel: {
        fontSize: 16,
        marginTop: 4,
    },
    communityContainer: {
        alignItems: 'center',
        marginTop: 16,
        paddingHorizontal: 16,
    },
    supportButton: {
        marginBottom: 16,
    },
    kofiImage: {
        width: 200,
        height: 50,
    },
    socialRow: {
        flexDirection: 'row',
        gap: 12,
        flexWrap: 'wrap',
        justifyContent: 'center',
    },
    socialButton: {
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 12,
    },
    socialButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    socialLogo: {
        width: 24,
        height: 24,
    },
    socialButtonText: {
        fontSize: 15,
        fontWeight: '600',
    },
    monkeyContainer: {
        alignItems: 'center',
        marginTop: 32,
    },
    monkeyAnimation: {
        width: 150,
        height: 150,
    },
    brandLogoContainer: {
        alignItems: 'center',
        marginTop: 16,
    },
    brandLogo: {
        width: 120,
        height: 40,
    },
    footer: {
        alignItems: 'center',
        marginTop: 24,
    },
    footerText: {
        fontSize: 14,
    },
});

// Styles for the developer code entry modal
const modalStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    container: {
        width: '85%',
        maxWidth: 400,
        backgroundColor: '#1E1E1E',
        borderRadius: 16,
        padding: 24,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    title: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '700',
        marginBottom: 8,
        textAlign: 'center',
    },
    message: {
        color: '#AAAAAA',
        fontSize: 15,
        marginBottom: 20,
        textAlign: 'center',
        lineHeight: 22,
    },
    input: {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 18,
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 20,
        letterSpacing: 4,
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 12,
    },
    cancelButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        alignItems: 'center',
    },
    cancelButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    confirmButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    confirmButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default AboutSettingsScreen;
