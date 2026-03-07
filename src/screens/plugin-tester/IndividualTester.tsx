import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Modal,
    FlatList
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { pluginService } from '../../services/pluginService';
import axios from 'axios';
import { getPluginTesterStyles, useIsLargeScreen } from './styles';
import { Header, MainTabBar } from './components';
import type { RootStackNavigationProp } from '../../navigation/AppNavigator';
import i18n from '../../i18n';

interface IndividualTesterProps {
    onSwitchTab: (tab: 'individual' | 'repo') => void;
}

export const IndividualTester = ({ onSwitchTab }: IndividualTesterProps) => {
    const navigation = useNavigation<RootStackNavigationProp>();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { currentTheme } = useTheme();
    const isLargeScreen = useIsLargeScreen();
    const styles = getPluginTesterStyles(currentTheme, isLargeScreen);

    // State
    const [code, setCode] = useState('');
    const [url, setUrl] = useState('');
    const [tmdbId, setTmdbId] = useState('550'); // Fight Club default
    const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');
    const [season, setSeason] = useState('1');
    const [episode, setEpisode] = useState('1');
    const [logs, setLogs] = useState<string[]>([]);
    const [streams, setStreams] = useState<any[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [activeTab, setActiveTab] = useState<'code' | 'logs' | 'results'>('code');
    const [rightPanelTab, setRightPanelTab] = useState<'logs' | 'results'>('logs');
    const [isEditorFocused, setIsEditorFocused] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [matches, setMatches] = useState<Array<{ start: number; end: number }>>([]);
    const focusedEditorScrollRef = useRef<ScrollView | null>(null);

    const CODE_LINE_HEIGHT = 18;
    const CODE_PADDING_V = 12;
    const MIN_EDITOR_HEIGHT = 240;

    const logsScrollRef = useRef<ScrollView | null>(null);
    const codeInputRefFocused = useRef<TextInput | null>(null);

    // Calculate matches when code or search query changes
    React.useEffect(() => {
        if (!searchQuery.trim()) {
            setMatches([]);
            setCurrentMatchIndex(0);
            return;
        }

        const query = searchQuery.toLowerCase();
        const codeToSearch = code.toLowerCase();
        const foundMatches: Array<{ start: number; end: number }> = [];
        let index = 0;

        while ((index = codeToSearch.indexOf(query, index)) !== -1) {
            foundMatches.push({ start: index, end: index + query.length });
            index += 1;
        }

        setMatches(foundMatches);
        setCurrentMatchIndex(0);
    }, [searchQuery, code]);

    const jumpToMatch = (matchIndex: number) => {
        if (!isEditorFocused) return;
        if (!searchQuery.trim()) return;
        if (matches.length === 0) return;

        const safeIndex = Math.min(Math.max(matchIndex, 0), matches.length - 1);
        const match = matches[safeIndex];

        requestAnimationFrame(() => {
            // Scroll the ScrollView so the highlighted match becomes visible.
            const before = code.slice(0, match.start);
            const lineIndex = before.split('\n').length - 1;
            const y = Math.max(0, (lineIndex - 2) * CODE_LINE_HEIGHT);
            focusedEditorScrollRef.current?.scrollTo({ y, animated: true });
        });
    };

    const getEditorHeight = () => {
        const lineCount = Math.max(1, code.split('\n').length);
        const contentHeight = lineCount * CODE_LINE_HEIGHT + CODE_PADDING_V * 2;
        return Math.max(MIN_EDITOR_HEIGHT, contentHeight);
    };

    const renderHighlightedCode = () => {
        if (!searchQuery.trim() || matches.length === 0) {
            return <Text style={styles.highlightText}>{code || ' '}</Text>;
        }

        const safeIndex = Math.min(Math.max(currentMatchIndex, 0), matches.length - 1);
        const match = matches[safeIndex];
        const start = Math.max(0, Math.min(match.start, code.length));
        const end = Math.max(start, Math.min(match.end, code.length));

        return (
            <Text style={styles.highlightText}>
                {code.slice(0, start)}
                <Text style={styles.highlightActive}>{code.slice(start, end) || ' '}</Text>
                {code.slice(end) || ' '}
            </Text>
        );
    };

    const fetchFromUrl = async () => {
        if (!url) {
            Alert.alert(t('plugin_tester.common.error'), t('plugin_tester.individual.enter_url_error'));
            return;
        }

        try {
            const response = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
            const content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
            setCode(content);
            Alert.alert(t('plugin_tester.common.success'), t('plugin_tester.individual.code_loaded'));
        } catch (error: any) {
            Alert.alert(t('plugin_tester.common.error'), t('plugin_tester.individual.fetch_error', { message: error.message }));
        }
    };

    const runTest = async () => {
        if (!code.trim()) {
            Alert.alert(t('plugin_tester.common.error'), t('plugin_tester.individual.no_code_error'));
            return;
        }

        setIsRunning(true);
        setLogs([]);
        setStreams([]);
        if (isLargeScreen) {
            setRightPanelTab('logs');
        } else {
            setActiveTab('logs');
        }

        try {
            const params = {
                tmdbId,
                mediaType,
                season: mediaType === 'tv' ? parseInt(season) || 1 : undefined,
                episode: mediaType === 'tv' ? parseInt(episode) || 1 : undefined,
            };

            const result = await pluginService.testPlugin(code, params, {
                onLog: (line) => {
                    setLogs(prev => [...prev, line]);
                },
            });

            // Logs were already appended in real-time via onLog
            setStreams(result.streams);

            if (result.streams.length > 0) {
                if (isLargeScreen) {
                    setRightPanelTab('results');
                } else {
                    setActiveTab('results');
                }
            }
        } catch (error: any) {
            setLogs(prev => [...prev, `[FATAL] ${error.message}`]);
        } finally {
            setIsRunning(false);
        }
    };

    const renderCodeTab = () => {
        // On large screens, show code + logs/results side by side
        if (isLargeScreen) {
            return (
                <View style={styles.largeScreenWrapper}>
                    <View style={styles.twoColumnContainer}>
                        <View style={styles.leftColumn}>
                            <View style={{ flex: 1 }}>
                                <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 10 }} keyboardShouldPersistTaps="handled">
                                    <View style={styles.card}>
                                    <View style={styles.cardTitleRow}>
                                        <Text style={styles.cardTitle}>{t('plugin_tester.individual.load_from_url')}</Text>
                                        <Ionicons name="link-outline" size={18} color={currentTheme.colors.mediumEmphasis} />
                                    </View>
                                    <Text style={styles.helperText}>
                                        {t('plugin_tester.individual.load_from_url_desc')}
                                    </Text>
                                    <View style={[styles.row, { marginTop: 10 }]}>
                                        <TextInput
                                            style={[styles.input, { flex: 1 }]}
                                            value={url}
                                            onChangeText={setUrl}
                                            placeholder="http://192.168.1.5:8000/provider.js"
                                            placeholderTextColor={currentTheme.colors.mediumEmphasis}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                        />
                                        <TouchableOpacity
                                            style={[styles.button, styles.secondaryButton, { paddingHorizontal: 12, minHeight: 48 }]}
                                            onPress={fetchFromUrl}
                                        >
                                            <Ionicons name="download-outline" size={20} color={currentTheme.colors.white} />
                                        </TouchableOpacity>
                                    </View>
                                    </View>

                                    <View style={[styles.card, { flex: 1, minHeight: 400 }]}>
                                    <View style={styles.cardTitleRow}>
                                        <Text style={styles.cardTitle}>{t('plugin_tester.individual.plugin_code')}</Text>
                                        <View style={styles.cardActionsRow}>
                                            <TouchableOpacity
                                                style={styles.cardActionButton}
                                                onPress={() => setIsEditorFocused(true)}
                                                accessibilityLabel={t('plugin_tester.individual.focus_editor')}
                                            >
                                                <Ionicons name="expand-outline" size={18} color={currentTheme.colors.highEmphasis} />
                                            </TouchableOpacity>
                                            <Ionicons name="code-slash-outline" size={18} color={currentTheme.colors.mediumEmphasis} />
                                        </View>
                                    </View>
                                    <TextInput
                                        style={[styles.codeInput, { minHeight: 350 }]}
                                        value={code}
                                        onChangeText={setCode}
                                        multiline
                                        placeholder={t('plugin_tester.individual.code_placeholder')}
                                        placeholderTextColor={currentTheme.colors.mediumEmphasis}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                    </View>
                                </ScrollView>

                                {/* Sticky footer on large screens (match mobile behavior) */}
                                <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 14) }]}>
                                    <View style={styles.footerCard}>
                                        <View style={styles.footerTitleRow}>
                                            <Text style={styles.footerTitle}>{t('plugin_tester.individual.test_parameters')}</Text>
                                            <Ionicons name="options-outline" size={16} color={currentTheme.colors.mediumEmphasis} />
                                        </View>

                                        <View style={styles.segment}>
                                            <TouchableOpacity
                                                style={[styles.segmentItem, mediaType === 'movie' && styles.segmentItemActive]}
                                                onPress={() => setMediaType('movie')}
                                            >
                                                <Ionicons name="film-outline" size={18} color={mediaType === 'movie' ? currentTheme.colors.primary : currentTheme.colors.highEmphasis} />
                                                <Text style={[styles.segmentText, mediaType === 'movie' && styles.segmentTextActive]}>{t('plugin_tester.common.movie')}</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.segmentItem, mediaType === 'tv' && styles.segmentItemActive]}
                                                onPress={() => setMediaType('tv')}
                                            >
                                                <Ionicons name="tv-outline" size={18} color={mediaType === 'tv' ? currentTheme.colors.primary : currentTheme.colors.highEmphasis} />
                                                <Text style={[styles.segmentText, mediaType === 'tv' && styles.segmentTextActive]}>{t('plugin_tester.common.tv')}</Text>
                                            </TouchableOpacity>
                                        </View>

                                        <View style={[styles.row, { marginTop: 10, alignItems: 'flex-start' }]}>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.fieldLabel}>{t('plugin_tester.common.tmdb_id')}</Text>
                                                <TextInput
                                                    style={styles.input}
                                                    value={tmdbId}
                                                    onChangeText={setTmdbId}
                                                    keyboardType="numeric"
                                                />
                                            </View>

                                            {mediaType === 'tv' && (
                                                <>
                                                    <View style={{ width: 110 }}>
                                                        <Text style={styles.fieldLabel}>{t('plugin_tester.common.season')}</Text>
                                                        <TextInput
                                                            style={styles.input}
                                                            value={season}
                                                            onChangeText={setSeason}
                                                            keyboardType="numeric"
                                                        />
                                                    </View>
                                                    <View style={{ width: 110 }}>
                                                        <Text style={styles.fieldLabel}>{t('plugin_tester.common.episode')}</Text>
                                                        <TextInput
                                                            style={styles.input}
                                                            value={episode}
                                                            onChangeText={setEpisode}
                                                            keyboardType="numeric"
                                                        />
                                                    </View>
                                                </>
                                            )}
                                        </View>
                                    </View>

                                    <TouchableOpacity
                                        style={[styles.button, { opacity: isRunning ? 0.85 : 1 }]}
                                        onPress={runTest}
                                        disabled={isRunning}
                                    >
                                        {isRunning ? (
                                            <ActivityIndicator color={currentTheme.colors.white} />
                                        ) : (
                                            <Ionicons name="play" size={20} color={currentTheme.colors.white} />
                                        )}
                                        <Text style={styles.buttonText}>{isRunning ? t('plugin_tester.common.running') : t('plugin_tester.common.run_test')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>

                        <View style={styles.rightColumn}>
                            {/* Right side: Logs and Results */}
                            <View style={[styles.content, { flex: 1 }]}>
                                <View style={{ flexDirection: 'row', marginBottom: 12, gap: 8 }}>
                                    <TouchableOpacity
                                        style={[
                                            styles.smallTab,
                                            rightPanelTab === 'logs' && styles.smallTabActive,
                                        ]}
                                        onPress={() => setRightPanelTab('logs')}
                                    >
                                        <Text style={[styles.smallTabText, rightPanelTab === 'logs' && styles.smallTabTextActive]}>{t('plugin_tester.tabs.logs')}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.smallTab, rightPanelTab === 'results' && styles.smallTabActive]}
                                        onPress={() => setRightPanelTab('results')}
                                    >
                                        <Text style={[styles.smallTabText, rightPanelTab === 'results' && styles.smallTabTextActive]}>{t('plugin_tester.tabs.results')} ({streams.length})</Text>
                                    </TouchableOpacity>
                                </View>

                                {rightPanelTab === 'logs' ? (
                                    <ScrollView
                                        ref={(r) => (logsScrollRef.current = r)}
                                        style={[styles.logContainer, { flex: 1, minHeight: 400 }]}
                                        contentContainerStyle={{ paddingBottom: 20 }}
                                        onContentSizeChange={() => {
                                            logsScrollRef.current?.scrollToEnd({ animated: true });
                                        }}
                                    >
                                        {logs.length === 0 ? (
                                            <View style={styles.emptyState}>
                                                <Ionicons name="terminal-outline" size={48} color={currentTheme.colors.mediumGray} />
                                                <Text style={styles.emptyText}>{t('plugin_tester.individual.no_logs')}</Text>
                                            </View>
                                        ) : (
                                            logs.map((log, i) => {
                                                let style = styles.logItem;
                                                if (log.includes('[ERROR]') || log.includes('[FATAL')) style = { ...style, ...styles.logError };
                                                else if (log.includes('[WARN]')) style = { ...style, ...styles.logWarn };
                                                else if (log.includes('[INFO]')) style = { ...style, ...styles.logInfo };
                                                else if (log.includes('[DEBUG]')) style = { ...style, ...styles.logDebug };

                                                return (
                                                    <Text key={i} style={style}>
                                                        {log}
                                                    </Text>
                                                );
                                            })
                                        )}
                                    </ScrollView>
                                ) : (
                                    renderResultsTab()
                                )}
                            </View>
                        </View>
                    </View>
                </View>
            );
        }

        // Original mobile layout
        return (
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
            >
                <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 10 }} keyboardShouldPersistTaps="handled">
                    <View style={styles.card}>
                        <View style={styles.cardTitleRow}>
                            <Text style={styles.cardTitle}>{t('plugin_tester.individual.load_from_url')}</Text>
                            <Ionicons name="link-outline" size={18} color={currentTheme.colors.mediumEmphasis} />
                        </View>
                        <Text style={styles.helperText}>
                            {t('plugin_tester.individual.load_from_url_desc')}
                        </Text>
                        <View style={[styles.row, { marginTop: 10 }]}>
                            <TextInput
                                style={[styles.input, { flex: 1 }]}
                                value={url}
                                onChangeText={setUrl}
                                placeholder="http://192.168.1.5:8000/provider.js"
                                placeholderTextColor={currentTheme.colors.mediumEmphasis}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            <TouchableOpacity
                                style={[styles.button, styles.secondaryButton, { paddingHorizontal: 12, minHeight: 48 }]}
                                onPress={fetchFromUrl}
                            >
                                <Ionicons name="download-outline" size={20} color={currentTheme.colors.white} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.card}>
                        <View style={styles.cardTitleRow}>
                            <Text style={styles.cardTitle}>{t('plugin_tester.individual.plugin_code')}</Text>
                            <View style={styles.cardActionsRow}>
                                <TouchableOpacity
                                    style={styles.cardActionButton}
                                    onPress={() => setIsEditorFocused(true)}
                                    accessibilityLabel={t('plugin_tester.individual.focus_editor')}
                                >
                                    <Ionicons name="expand-outline" size={18} color={currentTheme.colors.highEmphasis} />
                                </TouchableOpacity>
                                <Ionicons name="code-slash-outline" size={18} color={currentTheme.colors.mediumEmphasis} />
                            </View>
                        </View>
                        <TextInput
                            style={styles.codeInput}
                            value={code}
                            onChangeText={setCode}
                            multiline
                            placeholder={t('plugin_tester.individual.code_placeholder')}
                            placeholderTextColor={currentTheme.colors.mediumEmphasis}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                </ScrollView>

                <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 14) }]}>
                    <View style={styles.footerCard}>
                        <View style={styles.footerTitleRow}>
                            <Text style={styles.footerTitle}>{t('plugin_tester.individual.test_parameters')}</Text>
                            <Ionicons name="options-outline" size={16} color={currentTheme.colors.mediumEmphasis} />
                        </View>

                        <View style={styles.segment}>
                            <TouchableOpacity
                                style={[styles.segmentItem, mediaType === 'movie' && styles.segmentItemActive]}
                                onPress={() => setMediaType('movie')}
                            >
                                <Ionicons name="film-outline" size={18} color={mediaType === 'movie' ? currentTheme.colors.primary : currentTheme.colors.highEmphasis} />
                                <Text style={[styles.segmentText, mediaType === 'movie' && styles.segmentTextActive]}>{i18n.t('components.movie')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.segmentItem, mediaType === 'tv' && styles.segmentItemActive]}
                                onPress={() => setMediaType('tv')}
                            >
                                <Ionicons name="tv-outline" size={18} color={mediaType === 'tv' ? currentTheme.colors.primary : currentTheme.colors.highEmphasis} />
                                <Text style={[styles.segmentText, mediaType === 'tv' && styles.segmentTextActive]}>{t('plugin_tester.common.tv')}</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={[styles.row, { marginTop: 10, alignItems: 'flex-start' }]}>
                            <View style={{ width: 110 }}>
                                <Text style={styles.fieldLabel}>{t('plugin_tester.common.tmdb_id')}</Text>
                                <TextInput
                                    style={styles.input}
                                    value={tmdbId}
                                    onChangeText={setTmdbId}
                                    keyboardType="numeric"
                                />
                            </View>

                            {mediaType === 'tv' && (
                                <>
                                    <View style={{ width: 110 }}>
                                        <Text style={styles.fieldLabel}>{t('plugin_tester.common.season')}</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={season}
                                            onChangeText={setSeason}
                                            keyboardType="numeric"
                                        />
                                    </View>
                                    <View style={{ width: 110 }}>
                                        <Text style={styles.fieldLabel}>{t('plugin_tester.common.episode')}</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={episode}
                                            onChangeText={setEpisode}
                                            keyboardType="numeric"
                                        />
                                    </View>
                                </>
                            )}
                        </View>
                    </View>
                    <TouchableOpacity
                        style={[styles.button, { opacity: isRunning ? 0.85 : 1 }]}
                        onPress={runTest}
                        disabled={isRunning}
                    >
                        {isRunning ? (
                            <ActivityIndicator color={currentTheme.colors.white} />
                        ) : (
                            <Ionicons name="play" size={20} color={currentTheme.colors.white} />
                        )}
                        <Text style={styles.buttonText}>{isRunning ? t('plugin_tester.common.running') : t('plugin_tester.common.run_test')}</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        );
    };

    const renderLogsTab = () => (
        <ScrollView
            ref={(r) => (logsScrollRef.current = r)}
            style={styles.content}
            onContentSizeChange={() => {
                if (activeTab === 'logs') {
                    logsScrollRef.current?.scrollToEnd({ animated: true });
                }
            }}
        >
            {logs.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="terminal-outline" size={48} color={currentTheme.colors.mediumGray} />
                    <Text style={styles.emptyText}>{t('plugin_tester.individual.no_logs')}</Text>
                </View>
            ) : (
                <View style={styles.logContainer}>
                    {logs.map((log, i) => {
                        let style = styles.logItem;
                        if (log.includes('[ERROR]') || log.includes('[FATAL')) style = { ...style, ...styles.logError };
                        else if (log.includes('[WARN]')) style = { ...style, ...styles.logWarn };
                        else if (log.includes('[INFO]')) style = { ...style, ...styles.logInfo };
                        else if (log.includes('[DEBUG]')) style = { ...style, ...styles.logDebug };

                        return (
                            <Text key={i} style={style}>
                                {log}
                            </Text>
                        );
                    })}
                </View>
            )}
        </ScrollView>
    );

    const playStream = (stream: any) => {
        if (!stream.url) {
            Alert.alert(t('plugin_tester.common.error'), t('plugin_tester.individual.no_url_stream_error'));
            return;
        }

        const playerRoute = Platform.OS === 'ios' ? 'PlayerIOS' : 'PlayerAndroid';
        const streamName = stream.name || stream.title || 'Test Stream';
        const quality = (stream.title?.match(/(\d+)p/) || stream.name?.match(/(\d+)p/) || [])[1] || undefined;

        // Build headers from stream object if present
        const headers = stream.headers || stream.behaviorHints?.proxyHeaders?.request || {};

        navigation.navigate(playerRoute as any, {
            uri: stream.url,
            title: `Plugin Tester - ${streamName}`,
            streamName,
            quality,
            headers,
            // Pass any additional stream properties
            videoType: stream.videoType || undefined,
        } as any);
    };

    const renderResultsTab = () => {
        if (streams.length === 0) {
            return (
                <ScrollView style={styles.content}>
                    <View style={styles.emptyState}>
                        <Ionicons name="list-outline" size={48} color={currentTheme.colors.mediumGray} />
                        <Text style={styles.emptyText}>{t('plugin_tester.individual.no_streams')}</Text>
                    </View>
                </ScrollView>
            );
        }

        return (
            <FlatList
                style={styles.content}
                contentContainerStyle={{ paddingBottom: 40 }}
                data={streams}
                keyExtractor={(item, index) => item.url + index}
                ListHeaderComponent={
                    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
                        <Text style={styles.sectionHeader}>{streams.length === 1 ? t('plugin_tester.individual.streams_found', { count: streams.length }) : t('plugin_tester.individual.streams_found_plural', { count: streams.length })}</Text>
                        <Text style={styles.sectionSubHeader}>{t('plugin_tester.individual.tap_play_hint')}</Text>
                    </View>
                }
                renderItem={({ item: stream }) => (
                    <TouchableOpacity
                        style={[styles.resultItem, { marginHorizontal: 16, marginBottom: 8 }]}
                        onPress={() => playStream(stream)}
                        activeOpacity={0.7}
                    >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <View style={styles.streamInfo}>
                                <Text style={styles.streamName}>{stream.name || stream.title || t('plugin_tester.individual.unnamed_stream')}</Text>
                                <Text style={styles.streamMeta}>{t('plugin_tester.individual.quality', { quality: stream.quality || 'Unknown' })}</Text>
                                {stream.description ? <Text style={styles.streamMeta}>{t('plugin_tester.individual.size', { size: stream.description })}</Text> : null}
                                <Text style={styles.streamMeta} numberOfLines={1}>{t('plugin_tester.individual.url_label', { url: stream.url })}</Text>
                                {stream.headers && Object.keys(stream.headers).length > 0 && (
                                    <Text style={styles.streamMeta}>{t('plugin_tester.individual.headers_info', { count: Object.keys(stream.headers).length })}</Text>
                                )}
                            </View>
                            <TouchableOpacity
                                style={styles.playButton}
                                onPress={() => playStream(stream)}
                            >
                                <Ionicons name="play" size={16} color={currentTheme.colors.white} />
                                <Text style={styles.playButtonText}>{t('plugin_tester.common.play')}</Text>
                            </TouchableOpacity>
                        </View>

                        <Text
                            style={[
                                styles.logItem,
                                {
                                    marginTop: 10,
                                    marginBottom: 0,
                                    color: currentTheme.colors.highEmphasis,
                                },
                            ]}
                            selectable
                        >
                            {(() => {
                                try {
                                    return JSON.stringify(stream, null, 2);
                                } catch {
                                    return String(stream);
                                }
                            })()}
                        </Text>
                    </TouchableOpacity>
                )}
            />
        );
    };

    const renderFocusedEditor = () => (
        <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
        >
            <View style={styles.findToolbar}>
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={18} color={currentTheme.colors.mediumEmphasis} style={styles.searchIcon} />
                    <TextInput
                        style={[styles.searchInput, { color: currentTheme.colors.highEmphasis }]}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        onSubmitEditing={() => jumpToMatch(currentMatchIndex)}
                        placeholder={t('plugin_tester.individual.find_placeholder')}
                        placeholderTextColor={currentTheme.colors.mediumEmphasis}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>
                <Text style={styles.findCounter}>
                    {matches.length === 0 ? '–' : `${currentMatchIndex + 1}/${matches.length}`}
                </Text>
                <TouchableOpacity
                    style={[styles.findButton, matches.length > 0 && styles.findButtonActive]}
                    onPress={() => {
                        if (matches.length === 0) return;
                        const nextIndex = currentMatchIndex === 0 ? matches.length - 1 : currentMatchIndex - 1;
                        setCurrentMatchIndex(nextIndex);
                        jumpToMatch(nextIndex);
                    }}
                    disabled={matches.length === 0}
                >
                    <Ionicons
                        name="chevron-up"
                        size={18}
                        color={matches.length > 0 ? currentTheme.colors.primary : currentTheme.colors.mediumEmphasis}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.findButton, matches.length > 0 && styles.findButtonActive]}
                    onPress={() => {
                        if (matches.length === 0) return;
                        const nextIndex = currentMatchIndex === matches.length - 1 ? 0 : currentMatchIndex + 1;
                        setCurrentMatchIndex(nextIndex);
                        jumpToMatch(nextIndex);
                    }}
                    disabled={matches.length === 0}
                >
                    <Ionicons
                        name="chevron-down"
                        size={18}
                        color={matches.length > 0 ? currentTheme.colors.primary : currentTheme.colors.mediumEmphasis}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.findButton}
                    onPress={() => {
                        setSearchQuery('');
                        setMatches([]);
                        setCurrentMatchIndex(0);
                    }}
                >
                    <Ionicons name="close" size={18} color={currentTheme.colors.mediumEmphasis} />
                </TouchableOpacity>
            </View>

            <ScrollView
                ref={(r) => (focusedEditorScrollRef.current = r)}
                style={styles.content}
                contentContainerStyle={{ paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
            >
                <View style={[styles.focusedEditorShell, { height: getEditorHeight() }]}>
                    <View style={styles.highlightLayer} pointerEvents="none">
                        {renderHighlightedCode()}
                    </View>

                    <TextInput
                        ref={codeInputRefFocused}
                        style={[styles.codeInputTransparent, styles.codeInputFocused]}
                        value={code}
                        onChangeText={setCode}
                        multiline
                        scrollEnabled={false}
                        autoFocus
                        selectionColor={currentTheme.colors.primary}
                        placeholder={t('plugin_tester.individual.code_placeholder_focused')}
                        placeholderTextColor={currentTheme.colors.mediumEmphasis}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {isEditorFocused ? (
                <Modal
                    visible={isEditorFocused}
                    animationType="slide"
                    presentationStyle="pageSheet"
                    onRequestClose={() => setIsEditorFocused(false)}
                >
                    <View style={[styles.modalContainer, { backgroundColor: currentTheme.colors.elevation1 }]}>
                        <Header
                            title={t('plugin_tester.individual.edit_code_title')}
                            onBack={() => setIsEditorFocused(false)}
                            rightElement={
                                <TouchableOpacity onPress={() => setIsEditorFocused(false)}>
                                    <Text style={{ color: currentTheme.colors.primary, fontWeight: '600' }}>{t('plugin_tester.common.done')}</Text>
                                </TouchableOpacity>
                            }
                        />
                        {renderFocusedEditor()}
                    </View>
                </Modal>
            ) : (
                <>
                    <Header
                        title={t('plugin_tester.title')}
                        subtitle={t('plugin_tester.subtitle')}
                        onBack={() => navigation.goBack()}
                    />
                    <MainTabBar activeTab="individual" onTabChange={onSwitchTab} />

                    {!isLargeScreen && (
                        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, gap: 8 }}>
                            <TouchableOpacity
                                style={[
                                    styles.tab,
                                    activeTab === 'code' && styles.activeTab,
                                    { paddingVertical: 8, borderWidth: 1, borderColor: currentTheme.colors.elevation3, borderRadius: 8, flex: 1 }
                                ]}
                                onPress={() => setActiveTab('code')}
                            >
                                <Text style={[styles.tabText, activeTab === 'code' && styles.activeTabText]}>{t('plugin_tester.tabs.code')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.tab,
                                    activeTab === 'logs' && styles.activeTab,
                                    { paddingVertical: 8, borderWidth: 1, borderColor: currentTheme.colors.elevation3, borderRadius: 8, flex: 1 }
                                ]}
                                onPress={() => setActiveTab('logs')}
                            >
                                <Text style={[styles.tabText, activeTab === 'logs' && styles.activeTabText]}>{t('plugin_tester.tabs.logs')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.tab,
                                    activeTab === 'results' && styles.activeTab,
                                    { paddingVertical: 8, borderWidth: 1, borderColor: currentTheme.colors.elevation3, borderRadius: 8, flex: 1 }
                                ]}
                                onPress={() => setActiveTab('results')}
                            >
                                <Text style={[styles.tabText, activeTab === 'results' && styles.activeTabText]}>{t('plugin_tester.tabs.results')}</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {activeTab === 'code' && renderCodeTab()}
                    {activeTab === 'logs' && renderLogsTab()}
                    {activeTab === 'results' && renderResultsTab()}
                </>
            )}
        </View >
    );
};
