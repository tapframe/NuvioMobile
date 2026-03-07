import React, { useCallback, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  Dimensions,
  Alert,
  ScrollView,
  Animated,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import TraktIcon from '../../../assets/rating-icons/trakt.svg';
import { useTheme } from '../../contexts/ThemeContext';
import { TraktContentComment } from '../../services/traktService';
import { logger } from '../../utils/logger';
import { useTraktComments } from '../../hooks/useTraktComments';
import { useSettings } from '../../hooks/useSettings';
import BottomSheet, { BottomSheetView, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import i18n from '../../i18n';

// Enhanced responsive breakpoints for Comments Section
const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  largeTablet: 1024,
  tv: 1440,
};

interface CommentsSectionProps {
  imdbId: string;
  type: 'movie' | 'show';
  season?: number;
  episode?: number;
  onCommentPress?: (comment: TraktContentComment) => void;
}

interface CommentItemProps {
  comment: TraktContentComment;
  theme: any;
}

// Minimal markdown renderer with inline spoiler handling
const MarkdownText: React.FC<{
  text: string;
  theme: any;
  numberOfLines?: number;
  revealedInlineSpoilers: boolean;
  onSpoilerPress?: () => void;
  textStyle?: any;
}> = ({ text, theme, numberOfLines, revealedInlineSpoilers, onSpoilerPress, textStyle }) => {
  // Regexes for simple markdown
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g; // [text](url)
  const boldRegex = /\*\*([^*]+)\*\*/g; // **bold**
  const italicRegex = /\*([^*]+)\*/g; // *italic*
  const codeRegex = /`([^`]+)`/g; // `code`
  const spoilerRegex = /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi;

  // Tokenize spoilers first to keep nesting simple
  const spoilerTokens: Array<{ type: 'spoiler' | 'text'; content: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = spoilerRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      spoilerTokens.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    spoilerTokens.push({ type: 'spoiler', content: match[1] });
    lastIndex = spoilerRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    spoilerTokens.push({ type: 'text', content: text.slice(lastIndex) });
  }

  const renderInline = (segment: string, keyPrefix: string) => {
    // Process code
    const codeSplit = segment.split(codeRegex);
    const codeNodes: React.ReactNode[] = [];
    for (let i = 0; i < codeSplit.length; i++) {
      if (i % 2 === 1) {
        codeNodes.push(
          <Text key={`${keyPrefix}-code-${i}`} style={[{ fontFamily: 'Courier', backgroundColor: theme.colors.card, paddingHorizontal: 3, borderRadius: 3 }, textStyle]}>
            {codeSplit[i]}
          </Text>
        );
      } else {
        // process bold and italic and links inside normal text
        let chunk = codeSplit[i] ?? '';
        const parts: React.ReactNode[] = [];

        // Links
        let cursor = 0;
        let linkMatch: RegExpExecArray | null;
        while ((linkMatch = linkRegex.exec(chunk)) !== null) {
          const before = chunk.slice(cursor, linkMatch.index);
          if (before) parts.push(<Text key={`${keyPrefix}-lnk-before-${cursor}`} style={textStyle}>{before}</Text>);
          const label = linkMatch[1];
          const url = linkMatch[2];
          parts.push(
            <Text
              key={`${keyPrefix}-link-${cursor}`}
              style={[{ color: theme.colors.primary }, textStyle]}
              onPress={() => Linking.openURL(url)}
              suppressHighlighting
            >
              {label}
            </Text>
          );
          cursor = linkMatch.index + linkMatch[0].length;
        }
        if (cursor < chunk.length) {
          parts.push(<Text key={`${keyPrefix}-lnk-tail`} style={textStyle}>{chunk.slice(cursor)}</Text>);
        }

        // Wrap bold & italic via nested Text by replacing markers
        const applyFormat = (nodes: React.ReactNode[]): React.ReactNode[] => {
          return nodes.flatMap((node, idx) => {
            if (typeof node !== 'string' && !(node as any).props?.children) return node;
            const str = typeof node === 'string' ? node : (node as any).props.children as string;
            if (typeof str !== 'string') return node;

            // bold
            const boldSplit = str.split(boldRegex);
            const boldNodes: React.ReactNode[] = [];
            for (let b = 0; b < boldSplit.length; b++) {
              if (b % 2 === 1) {
                boldNodes.push(<Text key={`${keyPrefix}-b-${idx}-${b}`} style={[{ fontWeight: '700' }, textStyle]}>{boldSplit[b]}</Text>);
              } else {
                // italic inside non-bold chunk
                const italSplit = boldSplit[b].split(italicRegex);
                for (let it = 0; it < italSplit.length; it++) {
                  if (it % 2 === 1) {
                    boldNodes.push(<Text key={`${keyPrefix}-i-${idx}-${b}-${it}`} style={[{ fontStyle: 'italic' }, textStyle]}>{italSplit[it]}</Text>);
                  } else {
                    if (italSplit[it]) boldNodes.push(<Text key={`${keyPrefix}-t-${idx}-${b}-${it}`} style={textStyle}>{italSplit[it]}</Text>);
                  }
                }
              }
            }
            return boldNodes;
          });
        };

        codeNodes.push(
          <Text key={`${keyPrefix}-txt-${i}`} style={[{ color: theme.colors.highEmphasis }, textStyle]}>
            {applyFormat(parts)}
          </Text>
        );
      }
    }
    return codeNodes;
  };

  return (
    <Text numberOfLines={numberOfLines} ellipsizeMode="tail" style={[{ color: theme.colors.highEmphasis }, textStyle]}>
      {spoilerTokens.map((tok, idx) => {
        if (tok.type === 'text') {
          return <Text key={`seg-${idx}`} style={textStyle}>{renderInline(tok.content, `seg-${idx}`)}</Text>;
        }
        if (revealedInlineSpoilers) {
          return <Text key={`spl-${idx}`} style={textStyle}>{renderInline(tok.content, `spl-${idx}`)}</Text>;
        }
        return (
          <Text key={`splmask-${idx}`} style={textStyle}>
            <Text style={textStyle}> </Text>
            <Text
              onPress={onSpoilerPress}
              style={[{ color: theme.colors.error, fontWeight: '700' }, textStyle]}
            >
              [spoiler]
            </Text>
            <Text style={textStyle}> </Text>
          </Text>
        );
      })}
    </Text>
  );
};

// Compact comment card for horizontal scrolling
const CompactCommentCard: React.FC<{
  comment: TraktContentComment;
  theme: any;
  onPress: () => void;
  isSpoilerRevealed: boolean;
  onSpoilerPress: () => void;
}> = ({ comment, theme, onPress, isSpoilerRevealed, onSpoilerPress }) => {
  const { t } = useTranslation();
  const [isPressed, setIsPressed] = useState(false);
  const fadeInOpacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeInOpacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [fadeInOpacity]);

  // Enhanced responsive sizing for tablets and TV screens
  const deviceWidth = Dimensions.get('window').width;
  const deviceHeight = Dimensions.get('window').height;

  // Determine device type based on width
  const getDeviceType = useCallback(() => {
    if (deviceWidth >= BREAKPOINTS.tv) return 'tv';
    if (deviceWidth >= BREAKPOINTS.largeTablet) return 'largeTablet';
    if (deviceWidth >= BREAKPOINTS.tablet) return 'tablet';
    return 'phone';
  }, [deviceWidth]);

  const deviceType = getDeviceType();
  const isTablet = deviceType === 'tablet';
  const isLargeTablet = deviceType === 'largeTablet';
  const isTV = deviceType === 'tv';
  const isLargeScreen = isTablet || isLargeTablet || isTV;

  // Enhanced comment card sizing
  const commentCardWidth = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 360;
      case 'largeTablet':
        return 320;
      case 'tablet':
        return 300;
      default:
        return 280; // phone
    }
  }, [deviceType]);

  const commentCardHeight = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 200;
      case 'largeTablet':
        return 185;
      case 'tablet':
        return 175;
      default:
        return 170; // phone
    }
  }, [deviceType]);

  const commentCardSpacing = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 16;
      case 'largeTablet':
        return 14;
      case 'tablet':
        return 12;
      default:
        return 12; // phone
    }
  }, [deviceType]);

  // Safety check - ensure comment data exists
  if (!comment || !comment.comment) {
    return null;
  }

  // Handle missing user data gracefully
  const user = comment.user || {};
  const username = user.name || user.username || t('common.anonymous_user');

  // Handle spoiler content
  const hasSpoiler = comment.spoiler;
  const shouldBlurContent = hasSpoiler && !isSpoilerRevealed;

  // We render markdown with inline spoilers; limit lines to keep card compact

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    try {
      const now = new Date();
      const commentDate = new Date(dateString);
      const diffMs = now.getTime() - commentDate.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 1) return t('common.time.now');
      if (diffMins < 60) return t('common.time.minutes_ago', { count: diffMins });
      if (diffHours < 24) return t('common.time.hours_ago', { count: diffHours });
      if (diffDays < 7) return t('common.time.days_ago', { count: diffDays });

      // For older dates, show month/day
      return commentDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '';
    }
  };

  // Render stars for rating (convert 1-10 rating to 1-5 stars)
  const renderCompactStars = (rating: number) => {
    const stars = [];
    const fullStars = Math.floor(rating / 2); // Convert 10-point scale to 5 stars
    const hasHalfStar = rating % 2 >= 1;

    // Add full stars
    for (let i = 0; i < fullStars; i++) {
      stars.push(
        <MaterialIcons key={`full-${i}`} name="star" size={10} color="#FFD700" />
      );
    }

    // Add half star if needed
    if (hasHalfStar) {
      stars.push(
        <MaterialIcons key="half" name="star-half" size={10} color="#FFD700" />
      );
    }

    // Add empty stars to make 5 total
    const filledStars = fullStars + (hasHalfStar ? 1 : 0);
    const emptyStars = 5 - filledStars;
    for (let i = 0; i < emptyStars; i++) {
      stars.push(
        <MaterialIcons key={`empty-${i}`} name="star-border" size={10} color="#FFD700" />
      );
    }

    return stars;
  };

  return (
    <Animated.View
      style={[
        styles.compactCard,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
          opacity: fadeInOpacity,
          transform: isPressed ? [{ scale: 0.98 }] : [{ scale: 1 }],
          width: commentCardWidth,
          height: commentCardHeight,
          marginRight: commentCardSpacing,
          padding: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
          borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12
        },
      ]}
    >
      <TouchableOpacity
        style={{ flex: 1 }}
        onPressIn={() => setIsPressed(true)}
        onPressOut={() => setIsPressed(false)}
        onPress={() => {
          onPress();
        }}
        activeOpacity={1}
      >
        {/* Trakt Icon - Top Right Corner */}
        <View style={styles.traktIconContainer}>
          <TraktIcon width={isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16} height={isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16} />
        </View>

        {/* Header Section - Fixed at top */}
        <View style={[
          styles.compactHeader,
          {
            marginBottom: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 8 : 8
          }
        ]}>
          <View style={styles.usernameContainer}>
            <Text style={[
              styles.compactUsername,
              {
                color: theme.colors.highEmphasis,
                fontSize: isTV ? 18 : isLargeTablet ? 17 : isTablet ? 16 : 16
              }
            ]}>
              {username}
            </Text>
            {user.vip && (
              <View style={[
                styles.miniVipBadge,
                {
                  paddingHorizontal: isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 4,
                  paddingVertical: isTV ? 2 : isLargeTablet ? 2 : isTablet ? 1 : 1,
                  borderRadius: isTV ? 8 : isLargeTablet ? 7 : isTablet ? 6 : 6
                }
              ]}>
                <Text style={[
                  styles.miniVipText,
                  {
                    fontSize: isTV ? 11 : isLargeTablet ? 10 : isTablet ? 9 : 9
                  }
                ]}>VIP</Text>
              </View>
            )}
          </View>
        </View>

        {/* Rating - Show stars */}
        {comment.user_stats?.rating && (
          <View style={[
            styles.compactRating,
            {
              marginBottom: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 8 : 8
            }
          ]}>
            {renderCompactStars(comment.user_stats.rating)}
            <Text style={[
              styles.compactRatingText,
              {
                color: theme.colors.mediumEmphasis,
                fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14
              }
            ]}>
              {comment.user_stats.rating}/10
            </Text>
          </View>
        )}

        {/* Comment Preview - Flexible area that fills space */}
        <View style={[
          styles.commentContainer,
          shouldBlurContent ? styles.blurredContent : undefined,
          {
            marginBottom: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 8 : 8
          }
        ]}>
          {shouldBlurContent ? (
            <Text style={[
              styles.compactComment,
              {
                color: theme.colors.highEmphasis,
                fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14,
                lineHeight: isTV ? 22 : isLargeTablet ? 20 : isTablet ? 18 : 18
              }
            ]}>⚠️ This comment contains spoilers. Tap to reveal.</Text>
          ) : (
            <MarkdownText
              text={comment.comment}
              theme={theme}
              numberOfLines={isLargeScreen ? 4 : 3}
              revealedInlineSpoilers={isSpoilerRevealed}
              onSpoilerPress={onSpoilerPress}
              textStyle={[
                styles.compactComment,
                {
                  fontSize: isTV ? 16 : isLargeTablet ? 15 : isTablet ? 14 : 14,
                  lineHeight: isTV ? 22 : isLargeTablet ? 20 : isTablet ? 18 : 18
                }
              ]}
            />
          )}
        </View>

        {/* Meta Info - Fixed at bottom */}
        <View style={[
          styles.compactMeta,
          {
            paddingTop: isTV ? 8 : isLargeTablet ? 6 : isTablet ? 6 : 6
          }
        ]}>
          <View style={styles.compactBadges}>
            {comment.spoiler && (
              <Text style={[
                styles.spoilerMiniText,
                {
                  color: theme.colors.error,
                  fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 11 : 11
                }
              ]}>{i18n.t('components.spoiler')}</Text>
            )}
          </View>
          <View style={styles.compactStats}>
            <Text style={[
              styles.compactTime,
              {
                color: theme.colors.mediumEmphasis,
                fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 11 : 11
              }
            ]}>
              {formatRelativeTime(comment.created_at)}
            </Text>
            {comment.likes > 0 && (
              <Text style={[
                styles.compactStat,
                {
                  color: theme.colors.mediumEmphasis,
                  fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 12 : 12
                }
              ]}>
                👍 {comment.likes}
              </Text>
            )}
            {comment.replies > 0 && (
              <Text style={[
                styles.compactStat,
                {
                  color: theme.colors.mediumEmphasis,
                  fontSize: isTV ? 13 : isLargeTablet ? 12 : isTablet ? 12 : 12
                }
              ]}>
                💬 {comment.replies}
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Expanded comment bottom sheet
const ExpandedCommentBottomSheet: React.FC<{
  comment: TraktContentComment | null;
  visible: boolean;
  onClose: () => void;
  theme: any;
  isSpoilerRevealed: boolean;
  onSpoilerPress: () => void;
}> = ({ comment, visible, onClose, theme, isSpoilerRevealed, onSpoilerPress }) => {
  const bottomSheetRef = useRef<BottomSheet>(null);

  // Handle visibility changes - always call this hook
  React.useEffect(() => {
    if (visible && comment) {
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible, comment]);

  if (!comment) return null;

  const user = comment.user || {};
  const username = user.name || user.username || 'Anonymous User';
  const hasSpoiler = comment.spoiler;
  const shouldBlurModalContent = hasSpoiler && !isSpoilerRevealed;

  const formatDateParts = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const datePart = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const timePart = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return { datePart, timePart };
    } catch {
      return { datePart: 'Unknown date', timePart: '' };
    }
  };

  const renderStars = (rating: number | null) => {
    if (rating === null) return null;

    const stars = [];
    const fullStars = Math.floor(rating / 2);
    const hasHalfStar = rating % 2 >= 1;

    for (let i = 0; i < fullStars; i++) {
      stars.push(
        <MaterialIcons key={`full-${i}`} name="star" size={16} color="#FFD700" />
      );
    }

    if (hasHalfStar) {
      stars.push(
        <MaterialIcons key="half" name="star-half" size={16} color="#FFD700" />
      );
    }

    const emptyStars = 5 - Math.ceil(rating / 2);
    for (let i = 0; i < emptyStars; i++) {
      stars.push(
        <MaterialIcons key={`empty-${i}`} name="star-border" size={16} color="#FFD700" />
      );
    }

    return stars;
  };

  return (
    <BottomSheet
      ref={bottomSheetRef}
      onChange={(index) => {
        if (index === -1) {
          onClose();
        }
      }}
      index={-1}
      snapPoints={[200, '50%', '70%']}
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      android_keyboardInputMode="adjustResize"
      enablePanDownToClose={true}
      animateOnMount={true}
      backgroundStyle={{
        backgroundColor: theme.colors.darkGray || '#0A0C0C',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
      }}
      handleIndicatorStyle={{
        backgroundColor: theme.colors.mediumEmphasis || '#CCCCCC',
      }}
    >
      <BottomSheetScrollView
        style={[styles.bottomSheetContent, { backgroundColor: theme.colors.darkGray || '#0A0C0C' }]}
        contentContainerStyle={styles.modalCommentContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {/* Close Button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <MaterialIcons name="close" size={24} color={theme.colors.highEmphasis} />
        </TouchableOpacity>

        {/* User Info */}
        <View style={styles.modalHeader}>
          <View style={styles.userInfo}>
            <Text
              style={[styles.modalUsername, { color: theme.colors.highEmphasis }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {username}
            </Text>
            {user.vip && (
              <View style={styles.vipBadge}>
                <Text style={styles.vipText}>VIP</Text>
              </View>
            )}
          </View>
          {(() => {
            const { datePart, timePart } = formatDateParts(comment.created_at);
            return (
              <View style={styles.dateTimeContainer}>
                <Text style={[styles.modalDate, { color: theme.colors.mediumEmphasis }]}>
                  {datePart}
                </Text>
                {!!timePart && (
                  <Text style={[styles.modalTime, { color: theme.colors.mediumEmphasis }]}>
                    {timePart}
                  </Text>
                )}
              </View>
            );
          })()}
        </View>

        {/* Rating */}
        {comment.user_stats?.rating && (
          <View style={styles.modalRating}>
            {renderStars(comment.user_stats.rating)}
            <Text style={[styles.modalRatingText, { color: theme.colors.mediumEmphasis }]}>
              {comment.user_stats.rating}/10
            </Text>
          </View>
        )}

        {/* Full Comment (Markdown with inline spoilers) */}
        {shouldBlurModalContent ? (
          <View style={styles.spoilerContainer}>
            <View style={[styles.spoilerIcon, { backgroundColor: theme.colors.card }]}>
              <MaterialIcons name="visibility-off" size={20} color={theme.colors.mediumEmphasis} />
            </View>
            <Text style={[styles.spoilerTitle, { color: theme.colors.highEmphasis }]}>{i18n.t('components.contains_spoilers')}</Text>
            <TouchableOpacity
              style={[styles.revealButton, { borderColor: theme.colors.primary }]}
              onPress={onSpoilerPress}
              activeOpacity={0.9}
            >
              <MaterialIcons name="visibility" size={18} color={theme.colors.primary} />
              <Text style={[styles.revealButtonText, { color: theme.colors.primary }]}>{i18n.t('components.reveal')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginBottom: 16 }}>
            <MarkdownText
              text={comment.comment}
              theme={theme}
              revealedInlineSpoilers={true}
              textStyle={styles.modalComment}
            />
          </View>
        )}

        {/* Comment Meta */}
        <View style={styles.modalMeta}>
          {comment.spoiler && (
            <Text style={[styles.spoilerText, { color: theme.colors.error }]}>{i18n.t('components.spoiler')}</Text>
          )}
          <View style={styles.modalStats}>
            {comment.likes > 0 && (
              <View style={styles.likesContainer}>
                <MaterialIcons name="thumb-up" size={16} color={theme.colors.mediumEmphasis} />
                <Text style={[styles.likesText, { color: theme.colors.mediumEmphasis }]}>
                  {comment.likes}
                </Text>
              </View>
            )}
            {comment.replies > 0 && (
              <View style={styles.repliesContainer}>
                <MaterialIcons name="chat-bubble-outline" size={16} color={theme.colors.mediumEmphasis} />
                <Text style={[styles.repliesText, { color: theme.colors.mediumEmphasis }]}>
                  {comment.replies}
                </Text>
              </View>
            )}
          </View>
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
};

export const CommentsSection: React.FC<CommentsSectionProps> = ({
  imdbId,
  type,
  season,
  episode,
  onCommentPress,
}) => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const { settings } = useSettings();
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);

  // Enhanced responsive sizing for tablets and TV screens
  const deviceWidth = Dimensions.get('window').width;
  const deviceHeight = Dimensions.get('window').height;

  // Determine device type based on width
  const getDeviceType = useCallback(() => {
    if (deviceWidth >= BREAKPOINTS.tv) return 'tv';
    if (deviceWidth >= BREAKPOINTS.largeTablet) return 'largeTablet';
    if (deviceWidth >= BREAKPOINTS.tablet) return 'tablet';
    return 'phone';
  }, [deviceWidth]);

  const deviceType = getDeviceType();
  const isTablet = deviceType === 'tablet';
  const isLargeTablet = deviceType === 'largeTablet';
  const isTV = deviceType === 'tv';
  const isLargeScreen = isTablet || isLargeTablet || isTV;

  // Enhanced spacing and padding
  const horizontalPadding = useMemo(() => {
    switch (deviceType) {
      case 'tv':
        return 32;
      case 'largeTablet':
        return 28;
      case 'tablet':
        return 24;
      default:
        return 16; // phone
    }
  }, [deviceType]);

  const {
    comments,
    loading,
    error,
    hasMore,
    isAuthenticated,
    loadMore,
    refresh,
  } = useTraktComments({
    imdbId,
    type: type === 'show' ? (season !== undefined && episode !== undefined ? 'episode' :
      season !== undefined ? 'season' : 'show') : 'movie',
    season,
    episode,
    enabled: true,
  });

  // Track when first load completes to avoid premature empty state
  React.useEffect(() => {
    if (!loading) {
      setHasLoadedOnce(true);
    }
  }, [loading]);

  // Debug logging
  // Debug logging removed per user request

  const renderComment = useCallback(({ item }: { item: TraktContentComment }) => {
    // Safety check for null/undefined items
    if (!item || !item.id) {
      return null;
    }



    return (
      <CompactCommentCard
        comment={item}
        theme={currentTheme}
        onPress={() => {
          onCommentPress?.(item);
        }}
        isSpoilerRevealed={true}
        onSpoilerPress={() => {
          // Do nothing for now - spoilers are handled by parent
        }}
      />
    );
  }, [currentTheme, onCommentPress]);

  const renderEmpty = useCallback(() => {
    if (loading) return null;

    return (
      <View style={styles.emptyContainer}>
        <MaterialIcons name="chat-bubble-outline" size={48} color={currentTheme.colors.mediumEmphasis} />
        <Text style={[styles.emptyText, { color: currentTheme.colors.mediumEmphasis }]}>
          {error ? t('comments.unavailable') : t('comments.no_comments')}
        </Text>
        <Text style={[styles.emptySubtext, { color: currentTheme.colors.disabled }]}>
          {error
            ? t('comments.not_in_database')
            : t('comments.check_trakt')
          }
        </Text>
      </View>
    );
  }, [loading, error, currentTheme]);

  const renderSkeletons = useCallback(() => {
    const placeholders = [0, 1, 2];
    // Responsive skeleton sizes to match CompactCommentCard
    const skWidth = isTV ? 360 : isLargeTablet ? 320 : isTablet ? 300 : 280;
    const skHeight = isTV ? 200 : isLargeTablet ? 185 : isTablet ? 175 : 170;
    const skPad = isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12;
    const gap = isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12;
    const headLineWidth = isTV ? 160 : isLargeTablet ? 140 : isTablet ? 130 : 120;
    const ratingWidth = isTV ? 100 : isLargeTablet ? 90 : isTablet ? 85 : 80;
    const statWidth = isTV ? 44 : isLargeTablet ? 40 : isTablet ? 38 : 36;
    const badgeW = isTV ? 60 : isLargeTablet ? 56 : isTablet ? 52 : 50;
    const badgeH = isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 12;

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.horizontalList, { paddingRight: gap }]}>
        {placeholders.map((i) => (
          <View
            key={`skeleton-${i}`}
            style={[
              styles.compactCard,
              {
                backgroundColor: currentTheme.colors.card,
                borderColor: currentTheme.colors.border,
                width: skWidth,
                height: skHeight,
                marginRight: gap,
                padding: skPad,
                borderRadius: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12,
              },
            ]}
          >
            <View style={styles.skeletonTraktContainer}>
              <View style={[styles.skeletonDot, { width: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16, height: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16, borderRadius: isTV ? 10 : isLargeTablet ? 9 : 8 }]} />
            </View>

            <View style={[styles.compactHeader, { marginBottom: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 8 : 8 }]}>
              <View style={[styles.skeletonLine, { width: headLineWidth, height: isTV ? 14 : 12 }]} />
              <View style={[styles.miniVipBadge, styles.skeletonBadge, { width: isTV ? 36 : isLargeTablet ? 32 : isTablet ? 28 : 24, height: isTV ? 16 : isLargeTablet ? 14 : isTablet ? 12 : 12, borderRadius: isTV ? 10 : isLargeTablet ? 9 : 8 }]} />
            </View>

            <View style={[styles.compactRating, { marginBottom: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 8 : 8 }]}>
              <View style={[styles.skeletonLine, { width: ratingWidth, height: isTV ? 12 : 10 }]} />
            </View>

            <View style={[styles.commentContainer, { marginBottom: isTV ? 10 : isLargeTablet ? 8 : isTablet ? 8 : 8 }]}>
              <View style={[styles.skeletonLine, { width: '95%', height: isTV ? 14 : 12 }]} />
              <View style={[styles.skeletonLine, { width: '90%', height: isTV ? 14 : 12, marginTop: 6 }]} />
              <View style={[styles.skeletonLine, { width: '70%', height: isTV ? 14 : 12, marginTop: 6 }]} />
            </View>

            <View style={[styles.compactMeta, { paddingTop: isTV ? 8 : isLargeTablet ? 6 : isTablet ? 6 : 6 }]}>
              <View style={[styles.skeletonBadge, { width: badgeW, height: badgeH, borderRadius: Math.min(6, badgeH / 2) }]} />
              <View style={{ flexDirection: 'row', gap }}>
                <View style={[styles.skeletonLine, { width: statWidth, height: isTV ? 12 : 10 }]} />
                <View style={[styles.skeletonLine, { width: statWidth, height: isTV ? 12 : 10 }]} />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    );
  }, [currentTheme, isTV, isLargeTablet, isTablet]);

  // Don't show section if not authenticated, if comments are disabled in settings, or if still checking authentication
  // Only show when authentication is definitively true and settings allow it
  if (isAuthenticated !== true || !settings.showTraktComments) {
    // Show loading state only if we're checking authentication but settings allow comments
    if (isAuthenticated === null && settings.showTraktComments) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={currentTheme.colors.primary} />
        </View>
      );
    }
    return null;
  }

  return (
    <View style={[
      styles.container,
      { paddingHorizontal: horizontalPadding }
    ]}>
      <View style={[
        styles.header,
        {
          marginBottom: isTV ? 20 : isLargeTablet ? 18 : isTablet ? 16 : 16
        }
      ]}>
        <Text style={[
          styles.title,
          {
            color: currentTheme.colors.highEmphasis,
            fontSize: isTV ? 28 : isLargeTablet ? 26 : isTablet ? 24 : 20
          }
        ]}>
          {t('comments.title')}
        </Text>
      </View>

      {error && (
        <View style={[styles.errorContainer, { backgroundColor: currentTheme.colors.card }]}>
          <MaterialIcons name="error-outline" size={20} color={currentTheme.colors.error} />
          <Text style={[styles.errorText, { color: currentTheme.colors.error }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { borderColor: currentTheme.colors.error }]}
            onPress={refresh}
          >
            <Text style={[styles.retryButtonText, { color: currentTheme.colors.error }]}>
              {t('common.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && Array.isArray(comments) && comments.length === 0 && renderSkeletons()}

      {(!loading && Array.isArray(comments) && comments.length === 0 && hasLoadedOnce && !error) && (
        renderEmpty()
      )}

      {Array.isArray(comments) && comments.length > 0 && (
        <Animated.FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={comments}
          keyExtractor={(item, index) => item?.id?.toString() || `comment-${index}`}
          renderItem={renderComment}
          contentContainerStyle={styles.horizontalList}
          removeClippedSubviews={false}
          getItemLayout={(data, index) => {
            const itemWidth = isTV ? 376 : isLargeTablet ? 334 : isTablet ? 312 : 292; // width + marginRight
            return {
              length: itemWidth,
              offset: itemWidth * index,
              index,
            };
          }}
          onEndReached={() => {
            if (hasMore && !loading) {
              loadMore();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            hasMore ? (
              <View style={styles.loadMoreContainer}>
                <TouchableOpacity
                  style={[styles.loadMoreButton, { backgroundColor: currentTheme.colors.card }]}
                  onPress={loadMore}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={currentTheme.colors.primary} />
                  ) : (
                    <>
                      <Text style={[styles.loadMoreText, { color: currentTheme.colors.primary }]}>
                        {t('common.load_more')}
                      </Text>
                      <MaterialIcons name="chevron-right" size={20} color={currentTheme.colors.primary} />
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null
          }
          extraData={loading}
          style={{ opacity: 1 }}
        />
      )}

    </View>
  );
};

// BottomSheet component that should be rendered at a higher level
export const CommentBottomSheet: React.FC<{
  comment: TraktContentComment | null;
  visible: boolean;
  onClose: () => void;
  theme: any;
  isSpoilerRevealed: boolean;
  onSpoilerPress: () => void;
}> = ({ comment, visible, onClose, theme, isSpoilerRevealed, onSpoilerPress }) => {
  const bottomSheetRef = useRef<BottomSheet>(null);

  // Early return before any Reanimated components are rendered
  // This prevents the BottomSheet from initializing when not needed
  if (!visible || !comment) {
    return null;
  }

  console.log('CommentBottomSheet: Rendered with visible:', visible, 'comment:', comment?.id);

  // Calculate the index based on visibility - start at medium height (50%)
  const sheetIndex = 1; // Always 1 when visible and comment are truthy

  console.log('CommentBottomSheet: Calculated sheetIndex:', sheetIndex);

  const user = comment.user || {};
  const username = user.name || user.username || 'Anonymous User';
  const hasSpoiler = comment.spoiler;
  const shouldBlurModalContent = hasSpoiler && !isSpoilerRevealed;

  const formatDateParts = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const datePart = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const timePart = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return { datePart, timePart };
    } catch {
      return { datePart: 'Unknown date', timePart: '' };
    }
  };

  const renderStars = (rating: number | null) => {
    if (rating === null) return null;

    const stars = [];
    const fullStars = Math.floor(rating / 2);
    const hasHalfStar = rating % 2 >= 1;

    for (let i = 0; i < fullStars; i++) {
      stars.push(
        <MaterialIcons key={`full-${i}`} name="star" size={16} color="#FFD700" />
      );
    }

    if (hasHalfStar) {
      stars.push(
        <MaterialIcons key="half" name="star-half" size={16} color="#FFD700" />
      );
    }

    const emptyStars = 5 - Math.ceil(rating / 2);
    for (let i = 0; i < emptyStars; i++) {
      stars.push(
        <MaterialIcons key={`empty-${i}`} name="star-border" size={16} color="#FFD700" />
      );
    }

    return stars;
  };

  return (
    <BottomSheet
      ref={bottomSheetRef}
      onChange={(index) => {
        console.log('CommentBottomSheet: onChange called with index:', index);
        if (index === -1) {
          onClose();
        }
      }}
      index={sheetIndex}
      snapPoints={[200, '50%', '70%']}
      enableDynamicSizing={false}
      keyboardBehavior="interactive"
      android_keyboardInputMode="adjustResize"
      enablePanDownToClose={true}
      animateOnMount={true}
      backgroundStyle={{
        backgroundColor: theme.colors.darkGray || '#0A0C0C',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
      }}
      handleIndicatorStyle={{
        backgroundColor: theme.colors.mediumEmphasis || '#CCCCCC',
      }}
    >
      <BottomSheetScrollView
        style={[styles.bottomSheetContent, { backgroundColor: theme.colors.darkGray || '#0A0C0C' }]}
        contentContainerStyle={styles.modalCommentContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {/* User Info */}
        <View style={styles.modalHeader}>
          <View style={styles.userInfo}>
            <Text
              style={[styles.modalUsername, { color: theme.colors.highEmphasis }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {username}
            </Text>
            {user.vip && (
              <View style={styles.vipBadge}>
                <Text style={styles.vipText}>VIP</Text>
              </View>
            )}
          </View>
          {(() => {
            const { datePart, timePart } = formatDateParts(comment.created_at);
            return (
              <View style={styles.dateTimeContainer}>
                <Text style={[styles.modalDate, { color: theme.colors.mediumEmphasis }]}>
                  {datePart}
                </Text>
                {!!timePart && (
                  <Text style={[styles.modalTime, { color: theme.colors.mediumEmphasis }]}>
                    {timePart}
                  </Text>
                )}
              </View>
            );
          })()}
        </View>

        {/* Rating */}
        {comment.user_stats?.rating && (
          <View style={styles.modalRating}>
            {renderStars(comment.user_stats.rating)}
            <Text style={[styles.modalRatingText, { color: theme.colors.mediumEmphasis }]}>
              {comment.user_stats.rating}/10
            </Text>
          </View>
        )}

        {/* Full Comment (Markdown with inline spoilers) */}
        {shouldBlurModalContent ? (
          <View style={styles.spoilerContainer}>
            <View style={[styles.spoilerIcon, { backgroundColor: theme.colors.card }]}>
              <MaterialIcons name="visibility-off" size={20} color={theme.colors.mediumEmphasis} />
            </View>
            <Text style={[styles.spoilerTitle, { color: theme.colors.highEmphasis }]}>{i18n.t('components.contains_spoilers')}</Text>
            <TouchableOpacity
              style={[styles.revealButton, { borderColor: theme.colors.primary }]}
              onPress={onSpoilerPress}
              activeOpacity={0.9}
            >
              <MaterialIcons name="visibility" size={18} color={theme.colors.primary} />
              <Text style={[styles.revealButtonText, { color: theme.colors.primary }]}>{i18n.t('components.reveal')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginBottom: 16 }}>
            <MarkdownText
              text={comment.comment}
              theme={theme}
              revealedInlineSpoilers={true}
              textStyle={styles.modalComment}
            />
          </View>
        )}

        {/* Comment Meta */}
        <View style={styles.modalMeta}>
          {comment.spoiler && (
            <Text style={[styles.spoilerText, { color: theme.colors.error }]}>{i18n.t('components.spoiler')}</Text>
          )}
          <View style={styles.modalStats}>
            {comment.likes > 0 && (
              <View style={styles.likesContainer}>
                <MaterialIcons name="thumb-up" size={16} color={theme.colors.mediumEmphasis} />
                <Text style={[styles.likesText, { color: theme.colors.mediumEmphasis }]}>
                  {comment.likes}
                </Text>
              </View>
            )}
            {comment.replies > 0 && (
              <View style={styles.repliesContainer}>
                <MaterialIcons name="chat-bubble-outline" size={16} color={theme.colors.mediumEmphasis} />
                <Text style={[styles.repliesText, { color: theme.colors.mediumEmphasis }]}>
                  {comment.replies}
                </Text>
              </View>
            )}
          </View>
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    flex: 1,
  },
  horizontalList: {
    paddingRight: 16,
  },
  compactCard: {
    paddingBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    flexDirection: 'column',
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  usernameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  compactUsername: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  miniVipBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 6,
  },
  traktIconContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 1,
  },
  skeletonTraktContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
  },
  miniVipText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#000',
  },
  compactRating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 2,
  },
  compactRatingText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  commentContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  compactComment: {
    fontSize: 14,
    lineHeight: 18,
  },
  blurredContent: {
    opacity: 0.3,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    padding: 8,
    borderRadius: 4,
  },
  compactMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingTop: 6,
  },
  compactBadges: {
    flexDirection: 'row',
    gap: 4,
  },
  spoilerMiniText: {
    fontSize: 11,
    fontWeight: '700',
  },
  compactStats: {
    flexDirection: 'row',
    gap: 8,
  },
  compactStat: {
    fontSize: 12,
  },
  compactTime: {
    fontSize: 11,
    fontWeight: '500',
  },
  loadMoreContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  commentItem: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  vipBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  vipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000',
  },
  date: {
    fontSize: 12,
  },
  contentTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ratingText: {
    fontSize: 12,
    marginLeft: 4,
  },
  commentText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spoilerText: {
    fontSize: 12,
    fontWeight: '600',
    marginRight: 8,
  },
  metaRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  likesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  likesText: {
    fontSize: 12,
    marginLeft: 4,
  },
  repliesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  repliesText: {
    fontSize: 12,
    marginLeft: 4,
  },
  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 12,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  skeletonDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)'
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  retryButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 12,
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  bottomSheetContent: {
    flex: 1,
    padding: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingTop: 20,
  },
  modalUsername: {
    fontSize: 18,
    fontWeight: '600',
    flexShrink: 1,
    marginRight: 8,
  },
  modalDate: {
    fontSize: 12,
    marginTop: 4,
  },
  modalTime: {
    fontSize: 12,
    marginTop: 2,
  },
  dateTimeContainer: {
    alignItems: 'flex-end',
  },
  modalRating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalRatingText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalComment: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  modalCommentScroll: {
    // Let the scroll view expand to use available space inside the sheet
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    marginBottom: 16,
  },
  modalCommentContent: {
    paddingBottom: 16,
  },
  spoilerContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  spoilerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  spoilerTitle: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  revealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  revealButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalStats: {
    flexDirection: 'row',
    gap: 12,
  },
});
