import React, { useMemo, useCallback, forwardRef, RefObject, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { DiscoverCatalog } from './searchUtils';
import { searchStyles as styles } from './searchStyles';
import { useBottomSheetBackHandler } from '../../hooks/useBottomSheetBackHandler';

interface DiscoverBottomSheetsProps {
    typeSheetRef: RefObject<BottomSheetModal>;
    catalogSheetRef: RefObject<BottomSheetModal>;
    genreSheetRef: RefObject<BottomSheetModal>;
    selectedDiscoverType: 'movie' | 'series';
    selectedCatalog: DiscoverCatalog | null;
    selectedDiscoverGenre: string | null;
    filteredCatalogs: DiscoverCatalog[];
    availableGenres: string[];
    onTypeSelect: (type: 'movie' | 'series') => void;
    onCatalogSelect: (catalog: DiscoverCatalog) => void;
    onGenreSelect: (genre: string | null) => void;
    currentTheme: any;
}

export const DiscoverBottomSheets = ({
    typeSheetRef,
    catalogSheetRef,
    genreSheetRef,
    selectedDiscoverType,
    selectedCatalog,
    selectedDiscoverGenre,
    filteredCatalogs,
    availableGenres,
    onTypeSelect,
    onCatalogSelect,
    onGenreSelect,
    currentTheme,
}: DiscoverBottomSheetsProps) => {
    const { t } = useTranslation();
    const isYearFilter = selectedCatalog?.filterLabel === 'year';
    const filterTitle = isYearFilter ? 'Select Year' : t('search.select_genre');
    const allFilterLabel = isYearFilter ? 'All Years' : t('search.all_genres');

    const typeSnapPoints = useMemo(() => ['25%'], []);
    const catalogSnapPoints = useMemo(() => ['50%'], []);
    const genreSnapPoints = useMemo(() => ['50%'], []);
    const [activeBottomSheetRef, setActiveBottomSheetRef] = useState(null);
    const {onDismiss, onChange} = useBottomSheetBackHandler();

    const renderBackdrop = useCallback(
        (props: any) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.5}
            />
        ),
        []
    );

    return (
        <>
            {/* Catalog Selection Bottom Sheet */}
            <BottomSheetModal
                ref={catalogSheetRef}
                index={0}
                snapPoints={catalogSnapPoints}
                enableDynamicSizing={false}
                enablePanDownToClose={true}
                backdropComponent={renderBackdrop}
                backgroundStyle={{
                    backgroundColor: currentTheme.colors.darkGray || '#0A0C0C',
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                }}
                handleIndicatorStyle={{
                    backgroundColor: currentTheme.colors.mediumGray,
                }}
                onDismiss={onDismiss(catalogSheetRef)}
                onChange={onChange(catalogSheetRef)}
            >
                <View style={[styles.bottomSheetHeader, { backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }]}>
                    <Text style={[styles.bottomSheetTitle, { color: currentTheme.colors.white }]}>
                        {t('search.select_catalog')}
                    </Text>
                    <TouchableOpacity onPress={() => catalogSheetRef.current?.dismiss()}>
                        <MaterialIcons name="close" size={24} color={currentTheme.colors.lightGray} />
                    </TouchableOpacity>
                </View>
                <BottomSheetScrollView
                    style={{ backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }}
                    contentContainerStyle={styles.bottomSheetContent}
                >
                    {filteredCatalogs.map((catalog, index) => (
                        <TouchableOpacity
                            key={`${catalog.addonId}-${catalog.catalogId}-${index}`}
                            style={[
                                styles.bottomSheetItem,
                                selectedCatalog?.catalogId === catalog.catalogId &&
                                selectedCatalog?.addonId === catalog.addonId &&
                                styles.bottomSheetItemSelected
                            ]}
                            onPress={() => onCatalogSelect(catalog)}
                        >
                            <View style={styles.bottomSheetItemContent}>
                                <Text style={[styles.bottomSheetItemTitle, { color: currentTheme.colors.white }]}>
                                    {catalog.catalogName}
                                </Text>
                                <Text style={[styles.bottomSheetItemSubtitle, { color: currentTheme.colors.lightGray }]}>
                                    {catalog.addonName}
                                </Text>
                            </View>
                            {selectedCatalog?.catalogId === catalog.catalogId &&
                                selectedCatalog?.addonId === catalog.addonId && (
                                    <MaterialIcons name="check" size={24} color={currentTheme.colors.primary} />
                                )}
                        </TouchableOpacity>
                    ))}
                </BottomSheetScrollView>
            </BottomSheetModal>

            {/* Genre Selection Bottom Sheet */}
            <BottomSheetModal
                ref={genreSheetRef}
                index={0}
                snapPoints={genreSnapPoints}
                enableDynamicSizing={false}
                enablePanDownToClose={true}
                backdropComponent={renderBackdrop}
                android_keyboardInputMode="adjustResize"
                animateOnMount={true}
                backgroundStyle={{
                    backgroundColor: currentTheme.colors.darkGray || '#0A0C0C',
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                }}
                handleIndicatorStyle={{
                    backgroundColor: currentTheme.colors.mediumGray,
                }}
                onDismiss={onDismiss(genreSheetRef)}
                onChange={onChange(genreSheetRef)}
            >
                <View style={[styles.bottomSheetHeader, { backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }]}>
                    <Text style={[styles.bottomSheetTitle, { color: currentTheme.colors.white }]}>
                        {filterTitle}
                    </Text>
                    <TouchableOpacity onPress={() => genreSheetRef.current?.dismiss()}>
                        <MaterialIcons name="close" size={24} color={currentTheme.colors.lightGray} />
                    </TouchableOpacity>
                </View>
                <BottomSheetScrollView
                    style={{ backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }}
                    contentContainerStyle={styles.bottomSheetContent}
                >
                    {/* All Genres option */}
                    <TouchableOpacity
                        style={[
                            styles.bottomSheetItem,
                            !selectedDiscoverGenre && styles.bottomSheetItemSelected
                        ]}
                        onPress={() => onGenreSelect(null)}
                    >
                        <View style={styles.bottomSheetItemContent}>
                            <Text style={[styles.bottomSheetItemTitle, { color: currentTheme.colors.white }]}>
                                {allFilterLabel}
                            </Text>
                            <Text style={[styles.bottomSheetItemSubtitle, { color: currentTheme.colors.lightGray }]}>
                                {t('search.show_all_content')}
                            </Text>
                        </View>
                        {!selectedDiscoverGenre && (
                            <MaterialIcons name="check" size={24} color={currentTheme.colors.primary} />
                        )}
                    </TouchableOpacity>

                    {/* Genre options */}
                    {availableGenres.map((genre, index) => (
                        <TouchableOpacity
                            key={`${genre}-${index}`}
                            style={[
                                styles.bottomSheetItem,
                                selectedDiscoverGenre === genre && styles.bottomSheetItemSelected
                            ]}
                            onPress={() => onGenreSelect(genre)}
                        >
                            <View style={styles.bottomSheetItemContent}>
                                <Text style={[styles.bottomSheetItemTitle, { color: currentTheme.colors.white }]}>
                                    {genre}
                                </Text>
                            </View>
                            {selectedDiscoverGenre === genre && (
                                <MaterialIcons name="check" size={24} color={currentTheme.colors.primary} />
                            )}
                        </TouchableOpacity>
                    ))}
                </BottomSheetScrollView>
            </BottomSheetModal>

            {/* Type Selection Bottom Sheet */}
            <BottomSheetModal
                ref={typeSheetRef}
                index={0}
                snapPoints={typeSnapPoints}
                enableDynamicSizing={false}
                enablePanDownToClose={true}
                backdropComponent={renderBackdrop}
                backgroundStyle={{
                    backgroundColor: currentTheme.colors.darkGray || '#0A0C0C',
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                }}
                handleIndicatorStyle={{
                    backgroundColor: currentTheme.colors.mediumGray,
                }}
                onDismiss={onDismiss(typeSheetRef)}
                onChange={onChange(typeSheetRef)}
            >
                <View style={[styles.bottomSheetHeader, { backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }]}>
                    <Text style={[styles.bottomSheetTitle, { color: currentTheme.colors.white }]}>
                        {t('search.select_type')}
                    </Text>
                    <TouchableOpacity onPress={() => typeSheetRef.current?.dismiss()}>
                        <MaterialIcons name="close" size={24} color={currentTheme.colors.lightGray} />
                    </TouchableOpacity>
                </View>
                <BottomSheetScrollView
                    style={{ backgroundColor: currentTheme.colors.darkGray || '#0A0C0C' }}
                    contentContainerStyle={styles.bottomSheetContent}
                >
                    {/* Movies option */}
                    <TouchableOpacity
                        style={[
                            styles.bottomSheetItem,
                            selectedDiscoverType === 'movie' && styles.bottomSheetItemSelected
                        ]}
                        onPress={() => onTypeSelect('movie')}
                    >
                        <View style={styles.bottomSheetItemContent}>
                            <Text style={[styles.bottomSheetItemTitle, { color: currentTheme.colors.white }]}>
                                {t('search.movies')}
                            </Text>
                            <Text style={[styles.bottomSheetItemSubtitle, { color: currentTheme.colors.lightGray }]}>
                                {t('search.browse_movies')}
                            </Text>
                        </View>
                        {selectedDiscoverType === 'movie' && (
                            <MaterialIcons name="check" size={24} color={currentTheme.colors.primary} />
                        )}
                    </TouchableOpacity>

                    {/* TV Shows option */}
                    <TouchableOpacity
                        style={[
                            styles.bottomSheetItem,
                            selectedDiscoverType === 'series' && styles.bottomSheetItemSelected
                        ]}
                        onPress={() => onTypeSelect('series')}
                    >
                        <View style={styles.bottomSheetItemContent}>
                            <Text style={[styles.bottomSheetItemTitle, { color: currentTheme.colors.white }]}>
                                {t('search.tv_shows')}
                            </Text>
                            <Text style={[styles.bottomSheetItemSubtitle, { color: currentTheme.colors.lightGray }]}>
                                {t('search.browse_tv')}
                            </Text>
                        </View>
                        {selectedDiscoverType === 'series' && (
                            <MaterialIcons name="check" size={24} color={currentTheme.colors.primary} />
                        )}
                    </TouchableOpacity>
                </BottomSheetScrollView>
            </BottomSheetModal>
        </>
    );
};

DiscoverBottomSheets.displayName = 'DiscoverBottomSheets';
