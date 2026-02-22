import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    SafeAreaView,
    ScrollView,
    StatusBar,
    Platform,
    Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { makeRedirectUri, useAuthRequest, ResponseType, CodeChallengeMethod } from 'expo-auth-session';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { SimklService } from '../services/simklService';
import { useSettings } from '../hooks/useSettings';
import { logger } from '../utils/logger';
import { useTheme } from '../contexts/ThemeContext';
import { useSimklIntegration } from '../hooks/useSimklIntegration';
import { useTraktIntegration } from '../hooks/useTraktIntegration';
import CustomAlert from '../components/CustomAlert';
import { useTranslation } from 'react-i18next';

const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;

// Simkl configuration
const SIMKL_CLIENT_ID = process.env.EXPO_PUBLIC_SIMKL_CLIENT_ID as string;

const discovery = {
    authorizationEndpoint: 'https://simkl.com/oauth/authorize',
    tokenEndpoint: 'https://api.simkl.com/oauth/token',
};

// For use with deep linking
const redirectUri = makeRedirectUri({
    scheme: 'nuvio',
    path: 'auth/simkl',
});

const simklService = SimklService.getInstance();

const SimklSettingsScreen: React.FC = () => {
    const { settings } = useSettings();
    const isDarkMode = settings.enableDarkMode;
    const navigation = useNavigation();
    const [alertVisible, setAlertVisible] = useState(false);
    const [alertTitle, setAlertTitle] = useState('');
    const [alertMessage, setAlertMessage] = useState('');

    const { currentTheme } = useTheme();
    const { t } = useTranslation();

    const {
        isAuthenticated,
        isLoading,
        checkAuthStatus,
        refreshAuthStatus,
        userSettings,
        userStats
    } = useSimklIntegration();
    const { isAuthenticated: isTraktAuthenticated } = useTraktIntegration();

    const [isExchangingCode, setIsExchangingCode] = useState(false);

    const openAlert = (title: string, message: string) => {
        setAlertTitle(title);
        setAlertMessage(message);
        setAlertVisible(true);
    };

    // Setup expo-auth-session hook
    const [request, response, promptAsync] = useAuthRequest(
        {
            clientId: SIMKL_CLIENT_ID,
            scopes: [], // Simkl doesn't strictly use scopes for basic access
            redirectUri: redirectUri,
            responseType: ResponseType.Code,
            usePKCE: true,
            codeChallengeMethod: CodeChallengeMethod.S256,
        },
        discovery
    );

    useEffect(() => {
        checkAuthStatus();
    }, [checkAuthStatus]);

    // Handle the response from the auth request
    useEffect(() => {
        if (response) {
            if (response.type === 'success' && request?.codeVerifier) {
                const { code } = response.params;
                setIsExchangingCode(true);
                logger.log('[SimklSettingsScreen] Auth code received, exchanging...');

                simklService.exchangeCodeForToken(code, request.codeVerifier)
                    .then(success => {
                        if (success) {
                            refreshAuthStatus();
                            openAlert(t('common.success'), t('simkl.auth_success_msg'));
                        } else {
                            openAlert(t('common.error'), t('simkl.auth_error_msg'));
                        }
                    })
                    .catch(err => {
                        logger.error('[SimklSettingsScreen] Token exchange error:', err);
                        openAlert(t('common.error'), t('simkl.auth_error_generic'));
                    })
                    .finally(() => setIsExchangingCode(false));
            } else if (response.type === 'success') {
                logger.error('[SimklSettingsScreen] Missing PKCE code verifier on successful auth response');
                openAlert(t('common.error'), t('simkl.auth_error_msg'));
            } else if (response.type === 'error') {
                openAlert(t('simkl.auth_error_title'), t('simkl.auth_error_generic') + ' ' + (response.error?.message || t('common.unknown')));
            }
        }
    }, [response, refreshAuthStatus, request?.codeVerifier, t]);

    const handleSignIn = () => {
        if (!SIMKL_CLIENT_ID) {
            openAlert(t('simkl.config_error_title'), t('simkl.config_error_msg'));
            return;
        }

        if (isTraktAuthenticated) {
            openAlert(t('simkl.conflict_title'), t('simkl.conflict_msg'));
            return;
        }

        promptAsync();
    };

    const handleSignOut = async () => {
        await simklService.logout();
        refreshAuthStatus();
        openAlert(t('common.success'), t('simkl.sign_out_confirm'));
    };

    return (
        <SafeAreaView style={[
            styles.container,
            { backgroundColor: isDarkMode ? currentTheme.colors.darkBackground : '#F2F2F7' }
        ]}>
            <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={styles.backButton}
                >
                    <MaterialIcons
                        name="arrow-back"
                        size={24}
                        color={isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark}
                    />
                    <Text style={[styles.backText, { color: isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark }]}>
                        Settings
                    </Text>
                </TouchableOpacity>
            </View>

            <Text style={[styles.headerTitle, { color: isDarkMode ? currentTheme.colors.highEmphasis : currentTheme.colors.textDark }]}>
                {t('simkl.settings_title')} (Alpha)
            </Text>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
                <View style={[
                    styles.card,
                    { backgroundColor: isDarkMode ? currentTheme.colors.elevation2 : currentTheme.colors.white }
                ]}>
                    {isLoading ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color={currentTheme.colors.primary} />
                        </View>
                    ) : isAuthenticated ? (
                        <View style={styles.profileContainer}>
                            <View style={styles.profileHeader}>
                                {userSettings?.user?.avatar ? (
                                    <Image
                                        source={{ uri: userSettings.user.avatar }}
                                        style={styles.avatar}
                                    />
                                ) : (
                                    <View style={[styles.avatarPlaceholder, { backgroundColor: currentTheme.colors.elevation3 }]}> 
                                        <MaterialIcons name="person" size={20} color={currentTheme.colors.mediumEmphasis} />
                                    </View>
                                )}
                                <View style={styles.profileText}>
                                    {userSettings?.user && (
                                        <Text style={[styles.statusTitle, { color: currentTheme.colors.highEmphasis }]}>
                                            {userSettings.user.name}
                                        </Text>
                                    )}
                                    {userSettings?.account?.type && (
                                        <Text style={[styles.accountType, { color: currentTheme.colors.mediumEmphasis, textTransform: 'capitalize' }]}>
                                            {userSettings.account.type} Account
                                        </Text>
                                    )}
                                </View>
                            </View>
                            <Text style={[styles.statusDesc, { color: currentTheme.colors.mediumEmphasis }]}>
                                {t('simkl.syncing_desc')}
                            </Text>

                            {userStats && (
                                <View style={[styles.statsGrid, { borderTopColor: currentTheme.colors.border, borderBottomColor: currentTheme.colors.border }]}> 
                                    <View style={styles.statItem}>
                                        <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}>
                                            {userStats.movies?.completed?.count || 0}
                                        </Text>
                                        <Text style={[styles.statLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                                            Movies
                                        </Text>
                                    </View>
                                    <View style={styles.statItem}>
                                        <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}>
                                            {(userStats.tv?.watching?.count || 0) + (userStats.tv?.completed?.count || 0)}
                                        </Text>
                                        <Text style={[styles.statLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                                            TV Shows
                                        </Text>
                                    </View>
                                    <View style={styles.statItem}>
                                        <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}>
                                            {(userStats.anime?.watching?.count || 0) + (userStats.anime?.completed?.count || 0)}
                                        </Text>
                                        <Text style={[styles.statLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                                            Anime
                                        </Text>
                                    </View>
                                    <View style={styles.statItem}>
                                        <Text style={[styles.statValue, { color: currentTheme.colors.primary }]}>
                                            {Math.round(((userStats.total_mins || 0) + (userStats.movies?.total_mins || 0) + (userStats.tv?.total_mins || 0) + (userStats.anime?.total_mins || 0)) / 60)}h
                                        </Text>
                                        <Text style={[styles.statLabel, { color: currentTheme.colors.mediumEmphasis }]}>
                                            Watched
                                        </Text>
                                    </View>
                                </View>
                            )}

                            <TouchableOpacity
                                style={[styles.button, { backgroundColor: currentTheme.colors.error, marginTop: 20 }]}
                                onPress={handleSignOut}
                            >
                                <Text style={styles.buttonText}>{t('simkl.sign_out')}</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.signInContainer}>
                            <Text style={[styles.signInTitle, { color: currentTheme.colors.highEmphasis }]}>
                                {t('simkl.connect_title')}
                            </Text>
                            <Text style={[styles.signInDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                                {t('simkl.connect_desc')}
                            </Text>
                            <TouchableOpacity
                                style={[
                                    styles.button,
                                    { backgroundColor: currentTheme.colors.primary }
                                ]}
                                onPress={handleSignIn}
                                disabled={!request || isExchangingCode}
                            >
                                {isExchangingCode ? (
                                    <ActivityIndicator color="white" />
                                ) : (
                                    <Text style={styles.buttonText}>{t('simkl.sign_in')}</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                <View style={styles.logoSection}>
                    <Image
                        source={require('../../assets/simkl-logo.png')}
                        style={styles.logo}
                        resizeMode="contain"
                    />
                </View>

                <Text style={[styles.disclaimer, { color: isDarkMode ? currentTheme.colors.mediumEmphasis : currentTheme.colors.textMutedDark }]}>
                    {t('simkl.disclaimer')}
                </Text>
            </ScrollView>

            <CustomAlert
                visible={alertVisible}
                title={alertTitle}
                message={alertMessage}
                onClose={() => setAlertVisible(false)}
                actions={[{ label: 'OK', onPress: () => setAlertVisible(false) }]}
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
        paddingHorizontal: 16,
        paddingBottom: 32,
    },
    card: {
        borderRadius: 12,
        overflow: 'hidden',
        padding: 20,
        marginBottom: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
    loadingContainer: {
        padding: 40,
        alignItems: 'center',
    },
    signInContainer: {
        alignItems: 'center',
        paddingVertical: 20,
    },
    signInTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 8,
    },
    signInDescription: {
        textAlign: 'center',
        marginBottom: 20,
        fontSize: 15,
    },
    profileContainer: {
        alignItems: 'stretch',
        paddingVertical: 8,
    },
    profileHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        marginRight: 12,
        backgroundColor: '#00000010',
    },
    avatarPlaceholder: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    profileText: {
        flex: 1,
    },
    statusTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 2,
    },
    accountType: {
        fontSize: 13,
        fontWeight: '500',
        marginBottom: 8,
    },
    statusDesc: {
        fontSize: 14,
        marginBottom: 8,
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 16,
        marginVertical: 12,
        borderTopWidth: 1,
        borderBottomWidth: 1,
    },
    statItem: {
        alignItems: 'center',
    },
    statValue: {
        fontSize: 17,
        fontWeight: '700',
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '500',
    },
    button: {
        width: '100%',
        height: 48,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: 'white',
    },
    disclaimer: {
        fontSize: 12,
        textAlign: 'center',
        marginTop: 8,
        marginBottom: 8,
    },
    logoSection: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
        marginTop: 16,
        marginBottom: 0,
    },
    logo: {
        width: 150,
        height: 30,
    },
    logoContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 28,
        marginBottom: 24,
        borderRadius: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
});

export default SimklSettingsScreen;
