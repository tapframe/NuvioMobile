import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  Dimensions,
  SectionList,
  Platform
} from 'react-native';
import { InteractionManager } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NavigationProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import FastImage from '@d11/react-native-fast-image';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useLibrary } from '../hooks/useLibrary';
import { useTraktContext } from '../contexts/TraktContext';
import { format, parseISO, isThisWeek, isAfter, startOfToday, addWeeks, isBefore, isSameDay } from 'date-fns';
import Animated, { FadeIn } from 'react-native-reanimated';
import { CalendarSection as CalendarSectionComponent } from '../components/calendar/CalendarSection';
import { tmdbService } from '../services/tmdbService';
import { logger } from '../utils/logger';
import { memoryManager } from '../utils/memoryManager';
import { useCalendarData } from '../hooks/useCalendarData';

const { width } = Dimensions.get('window');
const ANDROID_STATUSBAR_HEIGHT = StatusBar.currentHeight || 0;

interface CalendarEpisode {
  id: string;
  seriesId: string;
  title: string;
  seriesName: string;
  poster: string;
  releaseDate: string;
  season: number;
  episode: number;
  overview: string;
  vote_average: number;
  still_path: string | null;
  season_poster_path: string | null;
}

interface CalendarSection {
  title: string;
  data: CalendarEpisode[];
}

const CalendarScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { libraryItems, loading: libraryLoading } = useLibrary();
  const { currentTheme } = useTheme();
  const { calendarData, loading, refresh } = useCalendarData();
  const {
    isAuthenticated: traktAuthenticated,
    isLoading: traktLoading,
    watchedShows,
    watchlistShows,
    continueWatching,
    loadAllCollections
  } = useTraktContext();

  logger.log(`[Calendar] Initial load - Library has ${libraryItems?.length || 0} items, loading: ${libraryLoading}`);
  const [refreshing, setRefreshing] = useState(false);
  const [uiReady, setUiReady] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [filteredEpisodes, setFilteredEpisodes] = useState<CalendarEpisode[]>([]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Check memory pressure before refresh
    memoryManager.checkMemoryPressure();
    refresh(true);
    setRefreshing(false);
  }, [refresh]);

  // Defer heavy UI work until after interactions to reduce jank/crashes
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setUiReady(true);
    });
    return () => task.cancel();
  }, []);

  const handleSeriesPress = useCallback((seriesId: string, episode?: CalendarEpisode) => {
    navigation.navigate('Metadata', {
      id: seriesId,
      type: 'series',
      episodeId: episode ? `${episode.seriesId}:${episode.season}:${episode.episode}` : undefined
    });
  }, [navigation]);

  const handleEpisodePress = useCallback((episode: CalendarEpisode) => {
    // For series without episode dates, just go to the series page
    if (!episode.releaseDate) {
      handleSeriesPress(episode.seriesId, episode);
      return;
    }

    // For episodes with dates, go to the stream screen
    const episodeId = `${episode.seriesId}:${episode.season}:${episode.episode}`;
    navigation.navigate('Streams', {
      id: episode.seriesId,
      type: 'series',
      episodeId
    });
  }, [navigation, handleSeriesPress]);

  const renderEpisodeItem = ({ item }: { item: CalendarEpisode }) => {
    const hasReleaseDate = !!item.releaseDate;
    const releaseDate = hasReleaseDate ? parseISO(item.releaseDate) : null;
    const formattedDate = releaseDate ? format(releaseDate, 'MMM d, yyyy') : '';
    const isFuture = releaseDate ? isAfter(releaseDate, new Date()) : false;

    // Use episode still image if available, fallback to series poster
    const imageUrl = item.still_path ?
      tmdbService.getImageUrl(item.still_path) :
      (item.season_poster_path ?
        tmdbService.getImageUrl(item.season_poster_path) :
        item.poster);

    return (
      <Animated.View entering={FadeIn.duration(300).delay(100)}>
        <TouchableOpacity
          style={[styles.episodeItem, { borderBottomColor: currentTheme.colors.border + '20' }]}
          onPress={() => handleEpisodePress(item)}
          activeOpacity={0.7}
        >
          <TouchableOpacity
            onPress={() => handleSeriesPress(item.seriesId, item)}
            activeOpacity={0.7}
          >
            <FastImage
              source={{ uri: imageUrl || '' }}
              style={styles.poster}
              resizeMode={FastImage.resizeMode.cover}
            />
          </TouchableOpacity>

          <View style={styles.episodeDetails}>
            <Text style={[styles.seriesName, { color: currentTheme.colors.text }]} numberOfLines={1}>
              {item.seriesName}
            </Text>

            {hasReleaseDate ? (
              <>
                <Text style={[styles.episodeTitle, { color: currentTheme.colors.lightGray }]} numberOfLines={2}>
                  S{item.season}:E{item.episode} - {item.title}
                </Text>

                {item.overview ? (
                  <Text style={[styles.overview, { color: currentTheme.colors.lightGray }]} numberOfLines={2}>
                    {item.overview}
                  </Text>
                ) : null}

                <View style={styles.metadataContainer}>
                  <View style={styles.dateContainer}>
                    <MaterialIcons
                      name={isFuture ? "event" : "event-available"}
                      size={16}
                      color={currentTheme.colors.lightGray}
                    />
                    <Text style={[styles.date, { color: currentTheme.colors.lightGray }]}>{formattedDate}</Text>
                  </View>

                  {item.vote_average > 0 && (
                    <View style={styles.ratingContainer}>
                      <MaterialIcons
                        name="star"
                        size={16}
                        color={currentTheme.colors.primary}
                      />
                      <Text style={[styles.rating, { color: currentTheme.colors.primary }]}>
                        {item.vote_average.toFixed(1)}
                      </Text>
                    </View>
                  )}
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.noEpisodesText, { color: currentTheme.colors.text }]}>
                  {t('calendar.no_scheduled_episodes')}
                </Text>
                <View style={styles.dateContainer}>
                  <MaterialIcons
                    name="event-busy"
                    size={16}
                    color={currentTheme.colors.lightGray}
                  />
                  <Text style={[styles.date, { color: currentTheme.colors.lightGray }]}>{t('calendar.check_back_later')}</Text>
                </View>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderSectionHeader = ({ section }: { section: CalendarSection }) => {
    // Map section titles to translation keys
    const titleKeyMap: Record<string, string> = {
      [t('components.this_week')]: 'home.this_week',
      'Upcoming': 'home.upcoming',
      [t('components.recently_released')]: 'home.recently_released',
      [t('components.series_no_scheduled')]: 'home.no_scheduled_episodes'
    };

    const displayTitle = titleKeyMap[section.title] ? t(titleKeyMap[section.title]) : section.title;

    return (
      <View style={[styles.sectionHeader, {
        backgroundColor: currentTheme.colors.darkBackground,
        borderBottomColor: currentTheme.colors.border
      }]}>
        <Text style={[styles.sectionTitle, { color: currentTheme.colors.text }]}>
          {displayTitle}
        </Text>
      </View>
    );
  };

  // Process all episodes once data is loaded - using memory-efficient approach
  const allEpisodes = React.useMemo(() => {
    if (!uiReady) return [] as CalendarEpisode[];
    const episodes = calendarData.reduce((acc: CalendarEpisode[], section: CalendarSection) => {

      const trimmed = memoryManager.limitArraySize(section.data.filter(ep => ep.season !== 0), 500);
      return acc.length > 1500 ? acc : [...acc, ...trimmed];
    }, [] as CalendarEpisode[]);
    // Global cap to keep memory bounded
    return memoryManager.limitArraySize(episodes, 1500);
  }, [calendarData, uiReady]);

  // Log when rendering with relevant state info
  logger.log(`[Calendar] Rendering: loading=${loading}, calendarData sections=${calendarData.length}, allEpisodes=${allEpisodes.length}`);

  // Log section details
  if (calendarData.length > 0) {
    calendarData.forEach((section, index) => {
      logger.log(`[Calendar] Section ${index}: "${section.title}" with ${section.data.length} episodes`);
      if (section.data && section.data.length > 0) {
        logger.log(`[Calendar] First episode in "${section.title}": ${section.data[0].seriesName} - ${section.data[0].title} (${section.data[0].releaseDate})`);
      } else {
        logger.log(`[Calendar] Section "${section.title}" has empty or undefined data array`);
      }
    });
  } else {
    logger.log(`[Calendar] No calendarData sections available`);
  }

  // Handle date selection from calendar
  const handleDateSelect = useCallback((date: Date) => {
    logger.log(`[Calendar] Date selected: ${format(date, 'yyyy-MM-dd')}`);
    setSelectedDate(date);

    // Filter episodes for the selected date
    const filtered = allEpisodes.filter(episode => {
      if (!episode.releaseDate) return false;
      const episodeDate = parseISO(episode.releaseDate);
      return isSameDay(episodeDate, date);
    });

    logger.log(`[Calendar] Filtered episodes for selected date: ${filtered.length}`);
    setFilteredEpisodes(filtered);
  }, [allEpisodes]);

  // Reset date filter
  const clearDateFilter = useCallback(() => {
    logger.log(`[Calendar] Clearing date filter`);
    setSelectedDate(null);
    setFilteredEpisodes([]);
  }, []);

  if ((loading || !uiReady) && !refreshing) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={currentTheme.colors.primary} />
          <Text style={[styles.loadingText, { color: currentTheme.colors.text }]}>{t('calendar.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar barStyle="light-content" />

      <View style={[styles.header, { borderBottomColor: currentTheme.colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <MaterialIcons name="arrow-back" size={24} color={currentTheme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>{t('calendar.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {selectedDate && filteredEpisodes.length > 0 && (
        <View style={[styles.filterInfoContainer, { borderBottomColor: currentTheme.colors.border }]}>
          <Text style={[styles.filterInfoText, { color: currentTheme.colors.text }]}>
            {t('calendar.showing_episodes_for', { date: format(selectedDate, 'MMMM d, yyyy') })}
          </Text>
          <TouchableOpacity onPress={clearDateFilter} style={styles.clearFilterButton}>
            <MaterialIcons name="close" size={18} color={currentTheme.colors.text} />
          </TouchableOpacity>
        </View>
      )}

      <CalendarSectionComponent
        episodes={allEpisodes}
        onSelectDate={handleDateSelect}
      />

      {selectedDate && filteredEpisodes.length > 0 ? (
        <FlatList
          data={filteredEpisodes}
          keyExtractor={(item) => item.id}
          renderItem={renderEpisodeItem}
          contentContainerStyle={styles.listContent}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={currentTheme.colors.primary}
              colors={[currentTheme.colors.primary]}
            />
          }
        />
      ) : selectedDate && filteredEpisodes.length === 0 ? (
        <View style={styles.emptyFilterContainer}>
          <MaterialIcons name="event-busy" size={48} color={currentTheme.colors.lightGray} />
          <Text style={[styles.emptyFilterText, { color: currentTheme.colors.text }]}>
            {t('calendar.no_episodes_for', { date: format(selectedDate, 'MMMM d, yyyy') })}
          </Text>
          <TouchableOpacity
            style={[styles.clearFilterButtonLarge, { backgroundColor: currentTheme.colors.primary }]}
            onPress={clearDateFilter}
          >
            <Text style={[styles.clearFilterButtonText, { color: currentTheme.colors.white }]}>
              {t('calendar.show_all_episodes')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : calendarData.length > 0 ? (
        <SectionList
          sections={calendarData}
          keyExtractor={(item) => item.id}
          renderItem={renderEpisodeItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.listContent}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={currentTheme.colors.primary}
              colors={[currentTheme.colors.primary]}
            />
          }
        />
      ) : (
        <View style={styles.emptyContainer}>
          <MaterialIcons name="calendar-today" size={64} color={currentTheme.colors.lightGray} />
          <Text style={[styles.emptyText, { color: currentTheme.colors.text }]}>
            {t('calendar.no_upcoming_found')}
          </Text>
          <Text style={[styles.emptySubtext, { color: currentTheme.colors.lightGray }]}>
            {t('calendar.add_series_desc')}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  episodeItem: {
    flexDirection: 'row',
    padding: 12,
    borderBottomWidth: 1,
  },
  poster: {
    width: 120,
    height: 68,
    borderRadius: 8,
  },
  episodeDetails: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  seriesName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  episodeTitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  overview: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  metadataContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  date: {
    fontSize: 14,
    marginLeft: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    fontSize: 14,
    marginLeft: 4,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  filterInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
  },
  filterInfoText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  clearFilterButton: {
    padding: 8,
  },
  emptyFilterContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyFilterText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    textAlign: 'center',
  },
  clearFilterButtonLarge: {
    marginTop: 20,
    padding: 16,
    borderRadius: 8,
  },
  clearFilterButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingTop: Platform.OS === 'android' ? ANDROID_STATUSBAR_HEIGHT + 12 : 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 12,
  },
  emptyLibraryContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  discoverButton: {
    padding: 16,
    borderRadius: 8,
  },
  discoverButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  noEpisodesText: {
    fontSize: 14,
    marginBottom: 4,
  },
});

export default CalendarScreen; 