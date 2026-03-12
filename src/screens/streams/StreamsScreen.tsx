import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { PaperProvider } from 'react-native-paper';

import TabletStreamsLayout from '../../components/TabletStreamsLayout';
import CustomAlert from '../../components/CustomAlert';
import { MobileStreamsLayout } from './components';
import { useStreamsScreen } from './useStreamsScreen';
import { createStyles } from './styles';
import { StreamSection } from './types';

export const StreamsScreen = () => {
  const insets = useSafeAreaInsets();
  const {
    // Route params
    id,
    type,
    
    // Theme
    currentTheme,
    colors,
    settings,
    
    // Navigation
    navigation,
    handleBack,
    
    // Tablet
    isTablet,
    
    // Alert
    alertVisible,
    alertTitle,
    alertMessage,
    alertSubtitle,
    alertActions,
    openAlert,
    closeAlert,
    
    // Metadata
    metadata,
    imdbId,
    bannerImage,
    currentEpisode,
    
    // Streams
    streams,
    groupedStreams,
    episodeStreams,
    sections,
    filterItems,
    selectedProvider,
    handleProviderChange,
    handleStreamPress,
    
    // Loading states
    loadingStreams,
    loadingEpisodeStreams,
    loadingProviders,
    streamsEmpty,
    showInitialLoading,
    showStillFetching,
    showNoSourcesError,
    hasStremioStreamProviders,
    
    // Autoplay
    isAutoplayWaiting,
    autoplayTriggered,
    
    // Scrapers
    activeFetchingScrapers,
    scraperLogos,
    
    // Movie
    movieLogoError,
    setMovieLogoError,
    
    // Episode
    episodeImage,
    effectiveEpisodeVote,
    effectiveEpisodeRuntime,
    hasIMDbRating,
    selectedEpisode,
    
    // Backdrop
    mobileBackdropSource,
    gradientColors,
  } = useStreamsScreen();

  const { t } = useTranslation();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <PaperProvider>
      <View style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

        {/* Back Button (Android only) */}
        {Platform.OS !== 'ios' && (
          <View style={[styles.backButtonContainer, isTablet && styles.backButtonContainerTablet]}>
            <TouchableOpacity
              style={[styles.backButton, Platform.OS === 'android' ? { paddingTop: 45 } : null]}
              onPress={handleBack}
              activeOpacity={0.7}
            >
              <MaterialIcons name="arrow-back" size={24} color={colors.white} />
              <Text style={styles.backButtonText}>
                {metadata?.videos && metadata.videos.length > 1 && selectedEpisode
                  ? t('streams.back_to_episodes')
                  : t('streams.back_to_info')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tablet Layout */}
        {isTablet ? (
          <TabletStreamsLayout
            episodeImage={episodeImage}
            bannerImage={bannerImage}
            metadata={metadata}
            type={type}
            currentEpisode={currentEpisode}
            movieLogoError={movieLogoError}
            setMovieLogoError={setMovieLogoError}
            streamsEmpty={streamsEmpty}
            selectedProvider={selectedProvider}
            filterItems={filterItems}
            handleProviderChange={handleProviderChange}
            activeFetchingScrapers={activeFetchingScrapers}
            isAutoplayWaiting={isAutoplayWaiting}
            autoplayTriggered={autoplayTriggered}
            showNoSourcesError={showNoSourcesError}
            showInitialLoading={showInitialLoading}
            showStillFetching={showStillFetching}
            sections={sections}
            renderSectionHeader={({ section }: { section: { title: string; addonId: string; isEmptyDueToQualityFilter?: boolean } }) => (
              <View style={styles.sectionHeaderContainer}>
                <View style={styles.sectionHeaderContent}>
                  <Text style={styles.streamGroupTitle}>{section.title}</Text>
                </View>
              </View>
            )}
            handleStreamPress={handleStreamPress}
            openAlert={openAlert}
            settings={settings}
            currentTheme={currentTheme}
            colors={colors}
            navigation={navigation}
            insets={insets}
            streams={streams}
            scraperLogos={scraperLogos}
            id={id}
            imdbId={imdbId || undefined}
            loadingStreams={loadingStreams}
            loadingEpisodeStreams={loadingEpisodeStreams}
            hasStremioStreamProviders={hasStremioStreamProviders}
          />
        ) : (
          /* Mobile Layout */
          <MobileStreamsLayout
            navigation={navigation}
            currentTheme={currentTheme}
            colors={colors}
            settings={settings}
            type={type}
            metadata={metadata}
            currentEpisode={currentEpisode}
            selectedEpisode={selectedEpisode || undefined}
            movieLogoError={movieLogoError}
            setMovieLogoError={setMovieLogoError}
            episodeImage={episodeImage}
            effectiveEpisodeVote={effectiveEpisodeVote}
            effectiveEpisodeRuntime={effectiveEpisodeRuntime}
            hasIMDbRating={hasIMDbRating}
            gradientColors={gradientColors}
            mobileBackdropSource={mobileBackdropSource}
            sections={sections}
            streams={streams}
            filterItems={filterItems}
            selectedProvider={selectedProvider}
            handleProviderChange={handleProviderChange}
            handleStreamPress={handleStreamPress}
            loadingProviders={loadingProviders}
            loadingStreams={loadingStreams}
            loadingEpisodeStreams={loadingEpisodeStreams}
            hasStremioStreamProviders={hasStremioStreamProviders}
            streamsEmpty={streamsEmpty}
            showInitialLoading={showInitialLoading}
            showStillFetching={showStillFetching}
            showNoSourcesError={showNoSourcesError}
            isAutoplayWaiting={isAutoplayWaiting}
            autoplayTriggered={autoplayTriggered}
            activeFetchingScrapers={activeFetchingScrapers}
            scraperLogos={scraperLogos}
            openAlert={openAlert}
            id={id}
            imdbId={imdbId || undefined}
          />
        )}

        {/* Custom Alert Dialog */}
        <CustomAlert
          visible={alertVisible}
          title={alertTitle}
          message={alertMessage}
          subtitle={alertSubtitle}
          actions={alertActions}
          onClose={closeAlert}
        />
      </View>
    </PaperProvider>
  );
};

export default memo(StreamsScreen);
