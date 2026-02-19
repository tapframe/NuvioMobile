import React from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    FlatList,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import { StreamingContent } from '../../services/catalogService';
import { DiscoverCatalog, isTablet, isLargeTablet, isTV } from './searchUtils';
import { DiscoverResultItem } from './DiscoverResultItem';
import { searchStyles as styles } from './searchStyles';
import { BottomSheetModal } from '@gorhom/bottom-sheet';

interface DiscoverSectionProps {
    discoverLoading: boolean;
    discoverInitialized: boolean;
    discoverResults: StreamingContent[];
    pendingDiscoverResults: StreamingContent[];
    loadingMore: boolean;
    selectedCatalog: DiscoverCatalog | null;
    selectedDiscoverType: 'movie' | 'series';
    selectedDiscoverGenre: string | null;
    availableGenres: string[];
    typeSheetRef: React.RefObject<BottomSheetModal>;
    catalogSheetRef: React.RefObject<BottomSheetModal>;
    genreSheetRef: React.RefObject<BottomSheetModal>;
    handleShowMore: () => void;
    navigation: any;
    setSelectedItem: (item: StreamingContent) => void;
    setMenuVisible: (visible: boolean) => void;
    currentTheme: any;
}

export const DiscoverSection = ({
    discoverLoading,
    discoverInitialized,
    discoverResults,
    pendingDiscoverResults,
    loadingMore,
    selectedCatalog,
    selectedDiscoverType,
    selectedDiscoverGenre,
    availableGenres,
    typeSheetRef,
    catalogSheetRef,
    genreSheetRef,
    handleShowMore,
    navigation,
    setSelectedItem,
    setMenuVisible,
    currentTheme,
}: DiscoverSectionProps) => {
    const { t } = useTranslation();
    const isYearFilter = selectedCatalog?.filterLabel === 'year';
    const allFilterLabel = isYearFilter ? 'All Years' : t('search.all_genres');

    return (
        <View style={styles.discoverContainer}>
            {/* Section Header */}
            <View style={styles.discoverHeader}>
                <Text style={[styles.discoverTitle, { color: currentTheme.colors.white }]}>
                    {t('search.discover')}
                </Text>
            </View>

            {/* Filter Chips Row */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.discoverChipsScroll}
                contentContainerStyle={styles.discoverChipsContent}
            >
                {/* Type Selector Chip (Movie/TV Show) */}
                <TouchableOpacity
                    style={[styles.discoverSelectorChip, { backgroundColor: currentTheme.colors.elevation2 }]}
                    onPress={() => typeSheetRef.current?.present()}
                >
                    <Text style={[styles.discoverSelectorText, { color: currentTheme.colors.white }]} numberOfLines={1}>
                        {selectedDiscoverType === 'movie' ? t('search.movies') : t('search.tv_shows')}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={20} color={currentTheme.colors.lightGray} />
                </TouchableOpacity>

                {/* Catalog Selector Chip */}
                <TouchableOpacity
                    style={[styles.discoverSelectorChip, { backgroundColor: currentTheme.colors.elevation2 }]}
                    onPress={() => catalogSheetRef.current?.present()}
                >
                    <Text style={[styles.discoverSelectorText, { color: currentTheme.colors.white }]} numberOfLines={1}>
                        {selectedCatalog ? selectedCatalog.catalogName : t('search.select_catalog')}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={20} color={currentTheme.colors.lightGray} />
                </TouchableOpacity>

                {/* Filter Selector Chip - only show if catalog has options */}
                {availableGenres.length > 0 && (
                    <TouchableOpacity
                        style={[styles.discoverSelectorChip, { backgroundColor: currentTheme.colors.elevation2 }]}
                        onPress={() => genreSheetRef.current?.present()}
                    >
                        <Text style={[styles.discoverSelectorText, { color: currentTheme.colors.white }]} numberOfLines={1}>
                            {selectedDiscoverGenre || allFilterLabel}
                        </Text>
                        <MaterialIcons name="keyboard-arrow-down" size={20} color={currentTheme.colors.lightGray} />
                    </TouchableOpacity>
                )}
            </ScrollView>

            {/* Selected filters summary */}
            {selectedCatalog && (
                <View style={styles.discoverFilterSummary}>
                    <Text style={[styles.discoverFilterSummaryText, { color: currentTheme.colors.lightGray }]}>
                        {selectedCatalog.addonName} • {selectedCatalog.type === 'movie' ? t('search.movies') : t('search.tv_shows')}
                        {selectedDiscoverGenre ? ` • ${selectedDiscoverGenre}` : ''}
                    </Text>
                </View>
            )}

            {/* Discover Results */}
            {discoverLoading ? (
                <View style={styles.discoverLoadingContainer}>
                    <ActivityIndicator size="large" color={currentTheme.colors.primary} />
                    <Text style={[styles.discoverLoadingText, { color: currentTheme.colors.lightGray }]}>
                        {t('search.discovering')}
                    </Text>
                </View>
            ) : discoverResults.length > 0 ? (
                <FlatList
                    data={discoverResults}
                    keyExtractor={(item, index) => `discover-${item.id}-${index}`}
                    numColumns={isTV ? 6 : isLargeTablet ? 5 : isTablet ? 4 : 3}
                    key={isTV ? 'tv-6' : isLargeTablet ? 'ltab-5' : isTablet ? 'tab-4' : 'phone-3'}
                    columnWrapperStyle={styles.discoverGridRow}
                    contentContainerStyle={styles.discoverGridContent}
                    renderItem={({ item, index }) => (
                        <DiscoverResultItem
                            key={`discover-${item.id}-${index}`}
                            item={item}
                            index={index}
                            navigation={navigation}
                            setSelectedItem={setSelectedItem}
                            setMenuVisible={setMenuVisible}
                            currentTheme={currentTheme}
                            isGrid={true}
                        />
                    )}
                    initialNumToRender={9}
                    maxToRenderPerBatch={6}
                    windowSize={5}
                    removeClippedSubviews={true}
                    scrollEnabled={false}
                    ListFooterComponent={
                        pendingDiscoverResults.length > 0 ? (
                            <TouchableOpacity
                                style={styles.showMoreButton}
                                onPress={handleShowMore}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.showMoreButtonText, { color: currentTheme.colors.white }]}>
                                    {t('search.show_more', { count: pendingDiscoverResults.length })}
                                </Text>
                                <MaterialIcons name="expand-more" size={20} color={currentTheme.colors.white} />
                            </TouchableOpacity>
                        ) : loadingMore ? (
                            <View style={styles.loadingMoreContainer}>
                                <ActivityIndicator size="small" color={currentTheme.colors.primary} />
                            </View>
                        ) : null
                    }
                />
            ) : discoverInitialized && !discoverLoading && selectedCatalog ? (
                <View style={styles.discoverEmptyContainer}>
                    <MaterialIcons name="movie-filter" size={48} color={currentTheme.colors.lightGray} />
                    <Text style={[styles.discoverEmptyText, { color: currentTheme.colors.lightGray }]}>
                        {t('search.no_content_found')}
                    </Text>
                    <Text style={[styles.discoverEmptySubtext, { color: currentTheme.colors.mediumGray }]}>
                        {t('search.try_different')}
                    </Text>
                </View>
            ) : !selectedCatalog && discoverInitialized ? (
                <View style={styles.discoverEmptyContainer}>
                    <MaterialIcons name="touch-app" size={48} color={currentTheme.colors.lightGray} />
                    <Text style={[styles.discoverEmptyText, { color: currentTheme.colors.lightGray }]}>
                        {t('search.select_catalog_desc')}
                    </Text>
                    <Text style={[styles.discoverEmptySubtext, { color: currentTheme.colors.mediumGray }]}>
                        {t('search.tap_catalog_desc')}
                    </Text>
                </View>
            ) : null}
        </View>
    );
};

DiscoverSection.displayName = 'DiscoverSection';
