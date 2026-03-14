import React, { useMemo } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AddonSearchResults, StreamingContent } from '../../services/catalogService';
import { SearchResultItem } from './SearchResultItem';
import { isTablet, isLargeTablet, isTV } from './searchUtils';
import { searchStyles as styles } from './searchStyles';

interface AddonSectionProps {
    addonGroup: AddonSearchResults;
    addonIndex: number;
    onItemPress: (item: StreamingContent) => void;
    onItemLongPress: (item: StreamingContent) => void;
    currentTheme: any;
}

const TYPE_LABELS: Record<string, string> = {
    'movie': 'search.movies',
    'series': 'search.tv_shows',
    'anime.movie': 'search.anime_movies',
    'anime.series': 'search.anime_series',
};

const subtitleStyle = (currentTheme: any) => ({
    color: currentTheme.colors.lightGray,
    fontSize: isTV ? 18 : isLargeTablet ? 17 : isTablet ? 16 : 14,
    marginBottom: isTV ? 14 : isLargeTablet ? 13 : isTablet ? 12 : 8,
    paddingHorizontal: isTV ? 24 : isLargeTablet ? 20 : isTablet ? 16 : 16,
});

const containerStyle = {
    marginBottom: isTV ? 40 : isLargeTablet ? 36 : isTablet ? 32 : 24,
};

export const AddonSection = React.memo(({
    addonGroup,
    addonIndex,
    onItemPress,
    onItemLongPress,
    currentTheme,
}: AddonSectionProps) => {
    const { t } = useTranslation();

    // Group results by their exact type, preserving order of first appearance
    const groupedByType = useMemo(() => {
        const order: string[] = [];
        const groups: Record<string, StreamingContent[]> = {};

        for (const item of addonGroup.results) {
            if (!groups[item.type]) {
                order.push(item.type);
                groups[item.type] = [];
            }
            groups[item.type].push(item);
        }

        return order.map(type => ({ type, items: groups[type] }));
    }, [addonGroup.results]);

    const getLabelForType = (type: string): string => {
        if (TYPE_LABELS[type]) return t(TYPE_LABELS[type]);
        // Fallback: capitalise and replace dots/underscores for unknown types
        return type.replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    return (
        <View>
            {/* Addon Header */}
            <View style={styles.addonHeaderContainer}>
                <Text style={[styles.addonHeaderText, { color: currentTheme.colors.white }]}>
                    {addonGroup.addonName}
                </Text>
                <View style={[styles.addonHeaderBadge, { backgroundColor: currentTheme.colors.elevation2 }]}>
                    <Text style={[styles.addonHeaderBadgeText, { color: currentTheme.colors.lightGray }]}>
                        {addonGroup.results.length}
                    </Text>
                </View>
            </View>

            {groupedByType.map(({ type, items }) => (
                <View key={type} style={[styles.carouselContainer, containerStyle]}>
                    <Text style={[styles.carouselSubtitle, subtitleStyle(currentTheme)]}>
                        {getLabelForType(type)} ({items.length})
                    </Text>
                    <FlatList
                        data={items}
                        renderItem={({ item, index }) => (
                            <SearchResultItem
                                item={item}
                                index={index}
                                onPress={onItemPress}
                                onLongPress={onItemLongPress}
                            />
                        )}
                        keyExtractor={item => `${addonGroup.addonId}-${type}-${item.id}`}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.horizontalListContent}
                    />
                </View>
            ))}
        </View>
    );
}, (prev, next) => {
    return prev.addonGroup === next.addonGroup && prev.addonIndex === next.addonIndex;
});

AddonSection.displayName = 'AddonSection';
