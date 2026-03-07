import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, StatusBar, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { mmkvStorage } from '../../services/mmkvStorage';
import { campaignService } from '../../services/campaignService';
import { RootStackParamList } from '../../navigation/AppNavigator';
import ScreenHeader from '../../components/common/ScreenHeader';
import CustomAlert from '../../components/CustomAlert';
import { SettingsCard, SettingItem, ChevronRight } from './SettingsComponents';
import { useTranslation } from 'react-i18next';

const DeveloperSettingsScreen: React.FC = () => {
    const navigation = useNavigation<NavigationProp<RootStackParamList>>();
    const { currentTheme } = useTheme();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();

    const [developerModeEnabled, setDeveloperModeEnabled] = useState(__DEV__);
    const [alertVisible, setAlertVisible] = useState(false);
    const [alertTitle, setAlertTitle] = useState('');
    const [alertMessage, setAlertMessage] = useState('');
    const [alertActions, setAlertActions] = useState<Array<{ label: string; onPress: () => void }>>([]);

    // Load developer mode state on mount
    useEffect(() => {
        const loadDevModeState = async () => {
            try {
                const devModeEnabled = await mmkvStorage.getItem('developer_mode_enabled');
                setDeveloperModeEnabled(__DEV__ || devModeEnabled === 'true');
            } catch (error) {
                console.error('Failed to load developer mode state:', error);
            }
        };
        loadDevModeState();
    }, []);

    const openAlert = (
        title: string,
        message: string,
        actions?: Array<{ label: string; onPress: () => void }>
    ) => {
        setAlertTitle(title);
        setAlertMessage(message);
        setAlertActions(actions && actions.length > 0 ? actions : [{ label: 'OK', onPress: () => { } }]);
        setAlertVisible(true);
    };

    const handleResetOnboarding = async () => {
        try {
            await mmkvStorage.removeItem('hasCompletedOnboarding');
            openAlert('Success', 'Onboarding has been reset. Restart the app to see the onboarding flow.');
        } catch (error) {
            openAlert('Error', 'Failed to reset onboarding.');
        }
    };

    const handleResetCampaigns = async () => {
        await campaignService.resetCampaigns();
        openAlert('Success', 'Campaign history reset. Restart app to see posters again.');
    };

    const handleClearAllData = () => {
        openAlert(
            'Clear All Data',
            'This will reset all settings and clear all cached data. Are you sure?',
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
    };

    const handleOpenPipTestStream = () => {
        const playerRoute = Platform.OS === 'ios' ? 'PlayerIOS' : 'PlayerAndroid';
        navigation.navigate(playerRoute as any, {
            uri: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
            title: 'PiP Test Stream',
            quality: '720',
            streamProvider: 'Dev Test',
            streamName: 'Mux HLS',
            id: 'dev-pip-test',
            type: 'movie',
            headers: {
                'User-Agent': 'Nuvio-PiP-Test',
            },
        });
    };

    // Only show if developer mode is enabled (via __DEV__ or manually unlocked)
    if (!developerModeEnabled) {
        return null;
    }

    return (
        <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
            <StatusBar barStyle="light-content" />
            <ScreenHeader title={t('settings.developer')} showBackButton onBackPress={() => navigation.goBack()} />

            <ScrollView
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
            >
                <SettingsCard title={t('settings.sections.testing')}>
                    <SettingItem
                        title={'Plugin Tester'}
                        description={'Run a plugin and inspect logs/streams'}
                        icon="terminal"
                        onPress={() => navigation.navigate('PluginTester')}
                        renderControl={() => <ChevronRight />}
                    />
                    <SettingItem
                        title={t('settings.items.test_onboarding')}
                        icon="play-circle"
                        onPress={() => navigation.navigate('Onboarding')}
                        renderControl={() => <ChevronRight />}
                    />
                    <SettingItem
                        title={t('settings.items.reset_onboarding')}
                        icon="refresh-ccw"
                        onPress={handleResetOnboarding}
                        renderControl={() => <ChevronRight />}
                    />
                    <SettingItem
                        title={t('settings.items.reset_campaigns')}
                        description={t('settings.items.reset_campaigns_desc')}
                        icon="refresh-cw"
                        onPress={handleResetCampaigns}
                        renderControl={() => <ChevronRight />}
                    />
                    <SettingItem
                        title={'PiP Test Stream (Temporary)'}
                        description={'Open a public HLS stream for player/PiP smoke tests'}
                        icon="tv"
                        onPress={handleOpenPipTestStream}
                        renderControl={() => <ChevronRight />}
                        isLast
                    />
                </SettingsCard>

                <SettingsCard title={t('settings.sections.danger_zone')}>
                    <SettingItem
                        title={t('settings.items.clear_all_data')}
                        description={t('settings.items.clear_all_data_desc')}
                        icon="trash-2"
                        onPress={handleClearAllData}
                        isLast
                    />
                </SettingsCard>
            </ScrollView>

            <CustomAlert
                visible={alertVisible}
                title={alertTitle}
                message={alertMessage}
                actions={alertActions}
                onClose={() => setAlertVisible(false)}
            />
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
});

export default DeveloperSettingsScreen;
