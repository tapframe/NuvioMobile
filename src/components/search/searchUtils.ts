import { Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

// Catalog info type for discover
export interface DiscoverCatalog {
    addonId: string;
    addonName: string;
    catalogId: string;
    catalogName: string;
    type: string;
    genres: string[];
    filterKey?: string | null;
    filterLabel?: 'genre' | 'year' | 'filter';
}

// Enhanced responsive breakpoints
export const BREAKPOINTS = {
    phone: 0,
    tablet: 768,
    largeTablet: 1024,
    tv: 1440,
} as const;

export const getDeviceType = (deviceWidth: number) => {
    if (deviceWidth >= BREAKPOINTS.tv) return 'tv';
    if (deviceWidth >= BREAKPOINTS.largeTablet) return 'largeTablet';
    if (deviceWidth >= BREAKPOINTS.tablet) return 'tablet';
    return 'phone';
};

// Current device calculations
export const deviceType = getDeviceType(width);
export const isTablet = deviceType === 'tablet';
export const isLargeTablet = deviceType === 'largeTablet';
export const isTV = deviceType === 'tv';

// Constants
export const TAB_BAR_HEIGHT = 85;
export const RECENT_SEARCHES_KEY = 'recent_searches';
export const MAX_RECENT_SEARCHES = 10;
export const PLACEHOLDER_POSTER = 'https://placehold.co/300x450/222222/CCCCCC?text=No+Poster';

// Responsive poster sizes
export const HORIZONTAL_ITEM_WIDTH = isTV ? width * 0.14 : isLargeTablet ? width * 0.16 : isTablet ? width * 0.18 : width * 0.3;
export const HORIZONTAL_POSTER_HEIGHT = HORIZONTAL_ITEM_WIDTH * 1.5;
export const POSTER_WIDTH = isTV ? 90 : isLargeTablet ? 80 : isTablet ? 70 : 90;
export const POSTER_HEIGHT = POSTER_WIDTH * 1.5;
