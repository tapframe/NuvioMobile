import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import CustomAlert from '../components/CustomAlert';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import FastImage from '@d11/react-native-fast-image';
import { BlurView as ExpoBlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
// Lazy-safe community blur import (avoid bundling issues on web)
let AndroidBlurView: any = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AndroidBlurView = require('@react-native-community/blur').BlurView;
  } catch (_) {
    AndroidBlurView = null;
  }
}

// Optional iOS Glass effect (expo-glass-effect) with safe fallback for AIChatScreen
let GlassViewComp: any = null;
let liquidGlassAvailable = false;
if (Platform.OS === 'ios') {
  try {
    // Dynamically require so app still runs if the package isn't installed yet
    const glass = require('expo-glass-effect');
    GlassViewComp = glass.GlassView;
    liquidGlassAvailable = typeof glass.isLiquidGlassAvailable === 'function' ? glass.isLiquidGlassAvailable() : false;
  } catch {
    GlassViewComp = null;
    liquidGlassAvailable = false;
  }
}
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { aiService, ChatMessage, ContentContext, createMovieContext, createEpisodeContext, createSeriesContext } from '../services/aiService';
import { tmdbService } from '../services/tmdbService';
import Markdown from 'react-native-markdown-display';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  interpolate,
  Extrapolate,
  runOnJS
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const isTablet = width >= 768;

type AIChatRouteParams = {
  AIChat: {
    contentId: string;
    contentType: 'movie' | 'series';
    episodeId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    title: string;
  };
};

type AIChatScreenRouteProp = RouteProp<AIChatRouteParams, 'AIChat'>;

interface ChatBubbleProps {
  message: ChatMessage;
  isLast: boolean;
}

// Animated typing dot component
const TypingDot: React.FC<{ delay: number; color: string }> = ({ delay, color }) => {
  const opacity = useSharedValue(0.3);
  const scale = useSharedValue(1);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 400 }),
          withTiming(0.3, { duration: 400 })
        ),
        -1,
        false
      )
    );
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1.2, { duration: 400 }),
          withTiming(1, { duration: 400 })
        ),
        -1,
        false
      )
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.typingDot, { backgroundColor: color }, animatedStyle]} />
  );
};

const ChatBubble: React.FC<ChatBubbleProps> = React.memo(({ message, isLast }) => {
  const { currentTheme } = useTheme();
  const isUser = message.role === 'user';

  const bubbleAnimation = useSharedValue(0);

  useEffect(() => {
    bubbleAnimation.value = withSpring(1, { damping: 18, stiffness: 100 });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: bubbleAnimation.value,
    transform: [
      {
        translateY: interpolate(
          bubbleAnimation.value,
          [0, 1],
          [16, 0],
          Extrapolate.CLAMP
        )
      },
      {
        scale: interpolate(
          bubbleAnimation.value,
          [0, 1],
          [0.95, 1],
          Extrapolate.CLAMP
        )
      }
    ]
  }));

  return (
    <Animated.View style={[
      styles.messageContainer,
      isUser ? styles.userMessageContainer : styles.assistantMessageContainer,
      isLast && styles.lastMessageContainer,
      animatedStyle
    ]}>
      {!isUser && (
        <View style={styles.avatarWrapper}>
          <LinearGradient
            colors={[currentTheme.colors.primary, `${currentTheme.colors.primary}99`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarContainer}
          >
            <MaterialIcons name="auto-awesome" size={14} color="white" />
          </LinearGradient>
        </View>
      )}

      <View style={[
        styles.messageBubble,
        isUser ? [
          styles.userBubble,
          {
            backgroundColor: currentTheme.colors.primary,
            shadowColor: currentTheme.colors.primary,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.25,
            shadowRadius: 8,
            elevation: 6,
          }
        ] : [
          styles.assistantBubble,
          { backgroundColor: 'transparent' }
        ]
      ]}>
        {!isUser && (
          <View style={styles.assistantBlurBackdrop} pointerEvents="none">
            {Platform.OS === 'android' && AndroidBlurView
              ? <AndroidBlurView blurAmount={18} blurRadius={10} style={StyleSheet.absoluteFill} />
              : Platform.OS === 'ios' && GlassViewComp && liquidGlassAvailable
                ? <GlassViewComp style={StyleSheet.absoluteFill} glassEffectStyle="regular" />
                : <ExpoBlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
          </View>
        )}
        {isUser ? (
          <Text style={[styles.messageText, styles.userMessageText]}>
            {message.content}
          </Text>
        ) : (
          <Markdown
            style={{
              body: {
                color: currentTheme.colors.highEmphasis,
                fontSize: 15.5,
                lineHeight: 24,
                margin: 0,
                padding: 0,
                letterSpacing: 0.15,
              },
              paragraph: {
                marginBottom: 12,
                marginTop: 0,
                color: currentTheme.colors.highEmphasis
              },
              heading1: {
                fontSize: 22,
                fontWeight: '700',
                color: currentTheme.colors.highEmphasis,
                marginBottom: 12,
                marginTop: 4,
                letterSpacing: -0.3,
              },
              heading2: {
                fontSize: 19,
                fontWeight: '600',
                color: currentTheme.colors.highEmphasis,
                marginBottom: 10,
                marginTop: 4,
                letterSpacing: -0.2,
              },
              heading3: {
                fontSize: 17,
                fontWeight: '600',
                color: currentTheme.colors.highEmphasis,
                marginBottom: 8,
                marginTop: 2,
              },
              link: {
                color: currentTheme.colors.primary,
                textDecorationLine: 'underline'
              },
              code_inline: {
                backgroundColor: 'rgba(255,255,255,0.08)',
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                fontSize: 13.5,
                color: currentTheme.colors.primary,
              },
              code_block: {
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: 14,
                marginVertical: 10,
                color: currentTheme.colors.highEmphasis,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                fontSize: 13.5,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              },
              fence: {
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderRadius: 12,
                padding: 14,
                marginVertical: 10,
                color: currentTheme.colors.highEmphasis,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                fontSize: 13.5,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              },
              bullet_list: {
                marginBottom: 10,
                marginTop: 0
              },
              ordered_list: {
                marginBottom: 10,
                marginTop: 0
              },
              list_item: {
                marginBottom: 6,
                color: currentTheme.colors.highEmphasis
              },
              strong: {
                fontWeight: '700',
                color: currentTheme.colors.highEmphasis
              },
              em: {
                fontStyle: 'italic',
                color: currentTheme.colors.mediumEmphasis
              },
              blockquote: {
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderLeftWidth: 3,
                borderLeftColor: currentTheme.colors.primary,
                paddingLeft: 14,
                paddingVertical: 10,
                marginVertical: 10,
                borderRadius: 6,
              },
              table: {
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
                borderRadius: 10,
                marginVertical: 10,
                overflow: 'hidden',
              },
              thead: {
                backgroundColor: 'rgba(255,255,255,0.06)',
              },
              th: {
                padding: 10,
                fontWeight: '600',
                color: currentTheme.colors.highEmphasis,
                borderBottomWidth: 1,
                borderBottomColor: 'rgba(255,255,255,0.1)',
              },
              td: {
                padding: 10,
                color: currentTheme.colors.highEmphasis,
                borderBottomWidth: 1,
                borderBottomColor: 'rgba(255,255,255,0.06)',
              },
            }}
          >
            {message.content}
          </Markdown>
        )}
        <Text style={[
          styles.messageTime,
          { color: isUser ? 'rgba(255,255,255,0.65)' : currentTheme.colors.disabled }
        ]}>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })}
        </Text>
      </View>

      {isUser && (
        <View style={[styles.userAvatarContainer, {
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
        }]}>
          <MaterialIcons name="person" size={14} color={currentTheme.colors.primary} />
        </View>
      )}
    </Animated.View>
  );
}, (prev, next) => {
  return (
    prev.isLast === next.isLast &&
    prev.message.id === next.message.id &&
    prev.message.role === next.message.role &&
    prev.message.content === next.message.content &&
    prev.message.timestamp === next.message.timestamp
  );
});

interface SuggestionChipProps {
  text: string;
  onPress: () => void;
  index: number;
}

const SuggestionChip: React.FC<SuggestionChipProps> = React.memo(({ text, onPress, index }) => {
  const { currentTheme } = useTheme();
  const animValue = useSharedValue(0);

  useEffect(() => {
    animValue.value = withDelay(
      index * 80,
      withSpring(1, { damping: 18, stiffness: 120 })
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: animValue.value,
    transform: [
      { translateY: interpolate(animValue.value, [0, 1], [12, 0], Extrapolate.CLAMP) },
      { scale: interpolate(animValue.value, [0, 1], [0.95, 1], Extrapolate.CLAMP) },
    ],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <TouchableOpacity
        style={[
          styles.suggestionChip,
          {
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderWidth: 1,
            borderColor: `${currentTheme.colors.primary}40`,
          }
        ]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <MaterialIcons
          name="lightbulb-outline"
          size={16}
          color={currentTheme.colors.primary}
          style={styles.suggestionIcon}
        />
        <Text style={[styles.suggestionText, { color: currentTheme.colors.highEmphasis }]}>
          {text}
        </Text>
        <MaterialIcons
          name="arrow-forward"
          size={14}
          color={currentTheme.colors.mediumEmphasis}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}, (prev, next) => prev.text === next.text && prev.onPress === next.onPress && prev.index === next.index);

const AIChatScreen: React.FC = () => {
  const { t } = useTranslation();

  // CustomAlert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<Array<{ label: string; onPress: () => void; style?: object }>>([]);

  const defaultAlertActions = useMemo(() => ([
    { label: t('common.ok'), onPress: () => setAlertVisible(false) },
  ]), [t]);

  const openAlert = (
    title: string,
    message: string,
    actions?: Array<{ label: string; onPress?: () => void; style?: object }>
  ) => {
    setAlertTitle(title);
    setAlertMessage(message);
    if (actions && actions.length > 0) {
      setAlertActions(
        actions.map(a => ({
          label: a.label,
          style: a.style,
          onPress: () => { a.onPress?.(); setAlertVisible(false); },
        }))
      );
    } else {
      setAlertActions(defaultAlertActions);
    }
    setAlertVisible(true);
  };
  const route = useRoute<AIChatScreenRouteProp>();
  const navigation = useNavigation();
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();

  const { contentId, contentType, episodeId, seasonNumber, episodeNumber, title } = route.params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState<ContentContext | null>(null);
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // Ensure Android cleans up heavy image resources when leaving the screen to avoid flash on back
  useFocusEffect(
    React.useCallback(() => {
      return () => {
        if (Platform.OS === 'android') {
          setBackdropUrl(null);
        }
      };
    }, [])
  );

  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  // Animation values
  const headerOpacity = useSharedValue(1);
  const inputContainerY = useSharedValue(0);
  // Android full-screen modal fade
  const modalOpacity = useSharedValue(Platform.OS === 'android' ? 0 : 1);

  useEffect(() => {
    loadContext();
  }, []);

  // Track keyboard and animate input to avoid gaps on iOS
  useEffect(() => {
    const onShow = (e: any) => {
      setIsKeyboardVisible(true);
      if (Platform.OS === 'ios') {
        const kbHeight = e?.endCoordinates?.height ?? 0;
        const lift = Math.max(0, kbHeight - insets.bottom);
        inputContainerY.value = withTiming(-lift, { duration: 220 });
      }
    };
    const onHide = () => {
      setIsKeyboardVisible(false);
      if (Platform.OS === 'ios') {
        inputContainerY.value = withTiming(0, { duration: 220 });
      }
    };

    const showSub = Platform.OS === 'ios'
      ? Keyboard.addListener('keyboardWillShow', onShow)
      : Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Platform.OS === 'ios'
      ? Keyboard.addListener('keyboardWillHide', onHide)
      : Keyboard.addListener('keyboardDidHide', onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom, inputContainerY]);

  // Animate in on Android for full-screen modal feel
  useEffect(() => {
    if (Platform.OS === 'android') {
      // Use spring to avoid jank on some devices
      modalOpacity.value = withSpring(1, { damping: 20, stiffness: 140 });
    }
  }, [modalOpacity]);

  useEffect(() => {
    if (context && messages.length === 0) {
      const starters = (() => {
        if ('episodesBySeason' in (context as any)) {
          const series = context as any;
          return [
            t('ai_chat.starters.series.overall', { title: series.title }),
            t('ai_chat.starters.series.arcs'),
            t('ai_chat.starters.series.rated'),
            t('ai_chat.starters.series.pivotal'),
            t('ai_chat.starters.series.themes'),
          ];
        }

        if ('showTitle' in (context as any)) {
          const episode = context as any;
          return [
            t('ai_chat.starters.episode.overview', { showTitle: episode.showTitle }),
            t('ai_chat.starters.episode.plot_points', { episodeTitle: episode.episodeTitle }),
            t('ai_chat.starters.episode.character_development'),
            t('ai_chat.starters.episode.hidden_details'),
            t('ai_chat.starters.episode.story_arc'),
          ];
        }

        const movie = context as any;
        return [
          t('ai_chat.starters.movie.overview', { title: movie.title }),
          t('ai_chat.starters.movie.themes'),
          t('ai_chat.starters.movie.ending'),
          t('ai_chat.starters.movie.characters'),
          t('ai_chat.starters.movie.production_facts'),
        ];
      })();

      setSuggestions(starters);
    }
  }, [context, messages.length, t]);

  const loadContext = async () => {
    try {
      setIsLoadingContext(true);

      if (contentType === 'movie') {
        // Movies: contentId may be TMDB id string or IMDb id (tt...)
        let movieData = await tmdbService.getMovieDetails(contentId);
        if (!movieData) {
          // Try resolve TMDB id from IMDb id
          const tmdbId = await tmdbService.findTMDBIdByIMDB(contentId);
          if (tmdbId) {
            movieData = await tmdbService.getMovieDetails(String(tmdbId));
          }
        }

        if (!movieData) throw new Error('Unable to load movie details');

        const movieContext = createMovieContext(movieData);
        setContext(movieContext);
        try {
          const path = movieData.backdrop_path || movieData.poster_path || null;
          if (path) setBackdropUrl(`https://image.tmdb.org/t/p/w780${path}`);
        } catch { }
      } else {
        // Series: resolve TMDB numeric id first (contentId may be IMDb/stremio id)
        let tmdbNumericId: number | null = null;
        if (/^\d+$/.test(contentId)) {
          tmdbNumericId = parseInt(contentId, 10);
        } else {
          // Try to resolve from IMDb id or stremio-like id
          tmdbNumericId = await tmdbService.findTMDBIdByIMDB(contentId);
          if (!tmdbNumericId && episodeId) {
            tmdbNumericId = await tmdbService.extractTMDBIdFromStremioId(episodeId);
          }
        }

        if (!tmdbNumericId) throw new Error('Unable to resolve TMDB ID for series');

        const [showData, allEpisodes] = await Promise.all([
          tmdbService.getTVShowDetails(tmdbNumericId),
          tmdbService.getAllEpisodes(tmdbNumericId)
        ]);

        if (!showData) throw new Error('Unable to load TV show details');
        try {
          const path = showData.backdrop_path || showData.poster_path || null;
          if (path) setBackdropUrl(`https://image.tmdb.org/t/p/w780${path}`);
        } catch { }

        if (!showData) throw new Error('Unable to load TV show details');
        const seriesContext = createSeriesContext(showData, allEpisodes || {});
        setContext(seriesContext);
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading context:', error);
      openAlert(t('common.error'), t('ai_chat.errors.load_content_details'));
    } finally {
      setIsLoadingContext(false);
      {/* CustomAlert at root */ }
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        onClose={() => setAlertVisible(false)}
        actions={alertActions}
      />
    }
  };

  const sendMessage = useCallback(async (messageText: string) => {
    if (!messageText.trim() || !context || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setSuggestions([]); // Hide suggestions after first message

    try {
      // If series overview is loaded, parse user query for specific episode and fetch on-demand
      let requestContext = context;
      if ('episodesBySeason' in (context as any)) {
        // Series-wide context; optionally detect SxE patterns to focus answer, but keep series context
        const sxe = messageText.match(/s(\d+)e(\d+)/i) || messageText.match(/season\s+(\d+)[^\d]+episode\s+(\d+)/i);
        if (sxe) {
          // We will append a brief hint to the user question to scope, but still pass series context
          messageText = `${messageText} (about Season ${sxe[1]}, Episode ${sxe[2]})`;
        }
      } else if ('showTitle' in (context as any)) {
        const sxe = messageText.match(/s(\d+)e(\d+)/i);
        const words = messageText.match(/season\s+(\d+)[^\d]+episode\s+(\d+)/i);
        const seasonOnly = messageText.match(/s(\d+)(?!e)/i) || messageText.match(/season\s+(\d+)/i);

        let season = sxe ? parseInt(sxe[1], 10) : (words ? parseInt(words[1], 10) : undefined);
        let episode = sxe ? parseInt(sxe[2], 10) : (words ? parseInt(words[2], 10) : undefined);

        // If only season mentioned (like "s2" or "season 2"), default to episode 1
        if (!season && seasonOnly) {
          season = parseInt(seasonOnly[1], 10);
          episode = 1;
        }

        if (season && episode) {
          try {
            // Resolve TMDB id for the show
            let tmdbNumericId: number | null = null;
            if (/^\d+$/.test(contentId)) {
              tmdbNumericId = parseInt(contentId, 10);
            } else {
              tmdbNumericId = await tmdbService.findTMDBIdByIMDB(contentId);
              if (!tmdbNumericId && episodeId) {
                tmdbNumericId = await tmdbService.extractTMDBIdFromStremioId(episodeId);
              }
            }
            if (tmdbNumericId) {
              const [showData, episodeData] = await Promise.all([
                tmdbService.getTVShowDetails(tmdbNumericId),
                tmdbService.getEpisodeDetails(tmdbNumericId, season, episode)
              ]);
              if (showData && episodeData) {
                requestContext = createEpisodeContext(episodeData, showData, season, episode);
              }
            }
          } catch { }
        }
      }

      const response = await aiService.sendMessage(
        messageText.trim(),
        requestContext,
        messages
      );

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      if (__DEV__) console.error('Error sending message:', error);

      let errorMessage = t('ai_chat.errors.generic');
      if (error instanceof Error) {
        if (error.message.includes('not configured')) {
          errorMessage = t('ai_chat.errors.not_configured');
        } else if (/401|unauthorized|invalid api key|authentication/i.test(error.message)) {
          errorMessage = t('ai_chat.errors.invalid_api_key');
        } else if (/insufficient|credit|quota|429/i.test(error.message)) {
          errorMessage = t('ai_chat.errors.quota');
        } else if (/model|provider|endpoint|unsupported|unavailable|not found/i.test(error.message)) {
          errorMessage = t('ai_chat.errors.model_unavailable');
        } else if (error.message.includes('API request failed')) {
          errorMessage = t('ai_chat.errors.connection');
        }
      }

      const errorResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMessage,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsLoading(false);
    }
  }, [context, messages, isLoading, t]);

  const handleSendPress = useCallback(() => {
    sendMessage(inputText);
  }, [inputText, sendMessage]);

  const handleSuggestionPress = useCallback((suggestion: string) => {
    sendMessage(suggestion);
  }, [sendMessage]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  const getDisplayTitle = () => {
    if (!context) return title;

    if ('episodesBySeason' in (context as any)) {
      // Always show just the series title
      return (context as any).title;
    } else if ('showTitle' in (context as any)) {
      // For episode contexts, now also only show show title to avoid episode in title per requirement
      return (context as any).showTitle;
    }
    return ('title' in (context as any) && (context as any).title) ? (context as any).title : title;
  };

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
  }));

  const inputAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: inputContainerY.value }],
  }));

  if (isLoadingContext) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: currentTheme.colors.darkBackground }]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={currentTheme.colors.primary} />
        <Text style={[styles.loadingText, { color: currentTheme.colors.mediumEmphasis }]}>
          {t('ai_chat.loading_context')}
        </Text>
      </View>
    );
  }

  return (
    <Animated.View style={{ flex: 1, opacity: modalOpacity }}>
      <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
        {backdropUrl && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <FastImage
              source={{ uri: backdropUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode={FastImage.resizeMode.cover}
            />
            {Platform.OS === 'android' && AndroidBlurView
              ? <AndroidBlurView blurAmount={12} blurRadius={6} style={StyleSheet.absoluteFill} />
              : Platform.OS === 'ios' && GlassViewComp && liquidGlassAvailable
                ? <GlassViewComp style={StyleSheet.absoluteFill} glassEffectStyle="regular" />
                : <ExpoBlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'android' ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.45)' }]} />
          </View>
        )}
        <StatusBar barStyle="light-content" />

        {/* Header */}
        <Animated.View style={[
          styles.header,
          {
            backgroundColor: 'transparent',
            paddingTop: Platform.OS === 'ios' ? insets.top : insets.top
          },
          headerAnimatedStyle
        ]}>
          <View style={styles.headerContent}>
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS === 'android') {
                  modalOpacity.value = withSpring(0, { damping: 18, stiffness: 160 }, (finished) => {
                    if (finished) runOnJS(navigation.goBack)();
                  });
                } else {
                  navigation.goBack();
                }
              }}
              style={styles.backButton}
            >
              <MaterialIcons name="arrow-back" size={24} color={currentTheme.colors.text} />
            </TouchableOpacity>

            <View style={styles.headerInfo}>
              <Text style={[styles.headerTitle, { color: currentTheme.colors.highEmphasis }]}>
                {t('ai_chat.title')}
              </Text>
              <Text style={[styles.headerSubtitle, { color: currentTheme.colors.mediumEmphasis }]}>
                {getDisplayTitle()}
              </Text>
            </View>

            <LinearGradient
              colors={[currentTheme.colors.primary, `${currentTheme.colors.primary}CC`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.aiIndicator}
            >
              <MaterialIcons name="auto-awesome" size={22} color="white" />
            </LinearGradient>
          </View>
        </Animated.View>

        {/* Chat Messages */}
        <KeyboardAvoidingView
          style={styles.chatContainer}
          behavior={Platform.OS === 'ios' ? undefined : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.messagesContainer}
            contentContainerStyle={[
              styles.messagesContent,
              { paddingBottom: isKeyboardVisible ? 20 : (56 + (isLoading ? 20 : 0)) }
            ]}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 && suggestions.length > 0 && (
              <View style={styles.welcomeContainer}>
                <LinearGradient
                  colors={[currentTheme.colors.primary, `${currentTheme.colors.primary}99`]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.welcomeIcon}
                >
                  <MaterialIcons name="auto-awesome" size={34} color="white" />
                </LinearGradient>
                <Text style={[styles.welcomeTitle, { color: currentTheme.colors.highEmphasis }]}>
                  {t('ai_chat.welcome_title')}
                </Text>
                <Text style={[styles.welcomeSubtitle, { color: currentTheme.colors.primary }]}>
                  {getDisplayTitle()}
                </Text>
                <Text style={[styles.welcomeDescription, { color: currentTheme.colors.mediumEmphasis }]}>
                  {t('ai_chat.welcome_description')}
                </Text>

                <View style={styles.suggestionsContainer}>
                  <Text style={[styles.suggestionsTitle, { color: currentTheme.colors.mediumEmphasis }]}>
                    {t('ai_chat.try_asking')}
                  </Text>
                  <View style={styles.suggestionsGrid}>
                    {suggestions.map((suggestion, index) => (
                      <SuggestionChip
                        key={index}
                        text={suggestion}
                        onPress={() => handleSuggestionPress(suggestion)}
                        index={index}
                      />
                    ))}
                  </View>
                </View>
              </View>
            )}

            {messages.map((message, index) => (
              <ChatBubble
                key={message.id}
                message={message}
                isLast={index === messages.length - 1}
              />
            ))}

            {isLoading && (
              <View style={styles.typingIndicator}>
                <View style={[styles.typingBubble, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                  <View style={styles.typingDots}>
                    <TypingDot delay={0} color={currentTheme.colors.primary} />
                    <TypingDot delay={150} color={currentTheme.colors.primary} />
                    <TypingDot delay={300} color={currentTheme.colors.primary} />
                  </View>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Input Container */}
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
            <Animated.View style={[
              styles.inputContainer,
              {
                backgroundColor: 'transparent',
                paddingBottom: 12
              },
              inputAnimatedStyle
            ]}>
              <View style={[styles.inputWrapper, { backgroundColor: 'transparent' }]}>
                <View style={styles.inputBlurBackdrop} pointerEvents="none">
                  {Platform.OS === 'android' && AndroidBlurView
                    ? <AndroidBlurView blurAmount={10} blurRadius={4} style={StyleSheet.absoluteFill} />
                    : Platform.OS === 'ios' && GlassViewComp && liquidGlassAvailable
                      ? <GlassViewComp style={StyleSheet.absoluteFill} glassEffectStyle="regular" />
                      : <ExpoBlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />}
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'android' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.25)' }]} />
                </View>
                <TextInput
                  ref={inputRef}
                  style={[
                    styles.textInput,
                    { color: currentTheme.colors.highEmphasis }
                  ]}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder={t('ai_chat.placeholder')}
                  placeholderTextColor={currentTheme.colors.mediumEmphasis}
                  multiline
                  maxLength={500}
                  editable={!isLoading}
                  onSubmitEditing={handleSendPress}
                  blurOnSubmit={false}
                />

                <TouchableOpacity
                  onPress={handleSendPress}
                  disabled={!inputText.trim() || isLoading}
                  activeOpacity={0.7}
                  style={styles.sendButtonWrapper}
                >
                  {inputText.trim() ? (
                    <LinearGradient
                      colors={[currentTheme.colors.primary, `${currentTheme.colors.primary}DD`]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.sendButton}
                    >
                      <MaterialIcons name="arrow-upward" size={22} color="white" />
                    </LinearGradient>
                  ) : (
                    <View style={[styles.sendButton, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                      <MaterialIcons
                        name="arrow-upward"
                        size={22}
                        color={currentTheme.colors.disabled}
                      />
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </Animated.View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        onClose={() => setAlertVisible(false)}
        actions={alertActions}
      />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backButton: {
    padding: 10,
    marginLeft: -6,
    borderRadius: 12,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 3,
    opacity: 0.7,
    letterSpacing: 0.1,
  },
  aiIndicator: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatContainer: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    padding: 20,
    paddingBottom: 12,
  },
  welcomeContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 28,
  },
  welcomeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  welcomeTitle: {
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: 0.2,
    opacity: 0.85,
  },
  welcomeSubtitle: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
    letterSpacing: -0.4,
  },
  welcomeDescription: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginBottom: 36,
    opacity: 0.7,
    letterSpacing: 0.15,
    maxWidth: 320,
  },
  suggestionsContainer: {
    width: '100%',
  },
  suggestionsTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 14,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    opacity: 0.6,
  },
  suggestionsGrid: {
    gap: 10,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 0,
  },
  suggestionIcon: {
    marginRight: 10,
  },
  suggestionText: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  messageContainer: {
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  userMessageContainer: {
    justifyContent: 'flex-end',
  },
  assistantMessageContainer: {
    justifyContent: 'flex-start',
  },
  lastMessageContainer: {
    marginBottom: 12,
  },
  avatarWrapper: {
    marginRight: 10,
  },
  avatarContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  messageBubble: {
    maxWidth: width * 0.78,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 22,
    overflow: 'hidden',
  },
  userBubble: {
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    borderBottomLeftRadius: 6,
  },
  assistantBlurBackdrop: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
  },
  messageText: {
    fontSize: 15.5,
    lineHeight: 23,
    letterSpacing: 0.15,
  },
  userMessageText: {
    color: 'white',
    fontWeight: '400',
  },
  messageTime: {
    fontSize: 11,
    marginTop: 8,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 20,
  },
  typingBubble: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 22,
    borderBottomLeftRadius: 6,
    marginLeft: 40,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  inputContainer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    paddingBottom: 18,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  inputBlurBackdrop: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    maxHeight: 120,
    paddingVertical: 10,
    letterSpacing: 0.15,
  },
  sendButtonWrapper: {
    marginLeft: 2,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AIChatScreen;
