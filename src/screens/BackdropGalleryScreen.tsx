import i18n from '../i18n';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FastImage from '@d11/react-native-fast-image';
import { MaterialIcons } from '@expo/vector-icons';
import { TMDBService } from '../services/tmdbService';
import { useTheme } from '../contexts/ThemeContext';
import { useSettings } from '../hooks/useSettings';

const { width } = Dimensions.get('window');
const BACKDROP_WIDTH = width * 0.9;
const BACKDROP_HEIGHT = (BACKDROP_WIDTH * 9) / 16; // 16:9 aspect ratio


interface BackdropItem {
  file_path: string;
  width: number;
  height: number;
  aspect_ratio: number;
}

interface RouteParams {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
}

const BackdropGalleryScreen: React.FC = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { tmdbId, type, title } = route.params as RouteParams;
  const { currentTheme } = useTheme();
  const { settings } = useSettings();

  const [backdrops, setBackdrops] = useState<BackdropItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBackdrops = async () => {
      try {
        setLoading(true);
        const tmdbService = TMDBService.getInstance();
        
        // Get language preference
        const language = settings.useTmdbLocalizedMetadata ? (settings.tmdbLanguagePreference || 'en') : 'en';

        let images;
        if (type === 'movie') {
          images = await tmdbService.getMovieImagesFull(tmdbId, language);
        } else {
          images = await tmdbService.getTvShowImagesFull(tmdbId, language);
        }

        if (__DEV__) {
          console.log('[BackdropGallery] TMDB response:', {
            tmdbId,
            type,
            hasImages: !!images,
            backdropsCount: images?.backdrops?.length || 0,
            images
          });
        }

        if (images && images.backdrops && images.backdrops.length > 0) {
          setBackdrops(images.backdrops);
        } else {
          setError(i18n.t('components.no_backdrops_found'));
        }
      } catch (err) {
        setError(i18n.t('components.failed_to_load_backdrops'));
        console.error('Backdrop fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    if (tmdbId) {
      fetchBackdrops();
    }
  }, [tmdbId, type, settings.useTmdbLocalizedMetadata, settings.tmdbLanguagePreference]);



  const renderBackdrop = ({ item, index }: { item: BackdropItem; index: number }) => {
    const imageUrl = `https://image.tmdb.org/t/p/w1280${item.file_path}`;

    return (
      <View style={styles.backdropContainer}>
        <FastImage
          source={{ uri: imageUrl }}
          style={styles.backdropImage}
          resizeMode={FastImage.resizeMode.cover}
        />
        <View style={styles.backdropInfo}>
          <Text style={[styles.backdropResolution, { color: currentTheme.colors.highEmphasis }]}>
            {item.width} × {item.height}
          </Text>
          <Text style={[styles.backdropAspect, { color: currentTheme.colors.highEmphasis }]}>
            {item.aspect_ratio.toFixed(2)}:1
          </Text>
        </View>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <MaterialIcons name="arrow-back" size={24} color={currentTheme.colors.highEmphasis} />
      </TouchableOpacity>
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: currentTheme.colors.highEmphasis }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.subtitle, { color: currentTheme.colors.textMuted }]}>
          {backdrops.length} Backdrop{backdrops.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        {renderHeader()}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={currentTheme.colors.primary} />
          <Text style={[styles.loadingText, { color: currentTheme.colors.textMuted }]}>{i18n.t('components.loading_backdrops')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || backdrops.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
        {renderHeader()}
        <View style={styles.errorContainer}>
          <MaterialIcons name="image-not-supported" size={64} color={currentTheme.colors.textMuted} />
          <Text style={[styles.errorText, { color: currentTheme.colors.textMuted }]}>
            {error || i18n.t('components.no_backdrops_available')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      {renderHeader()}

      <FlatList
        data={backdrops}
        keyExtractor={(item, index) => `${item.file_path}-${index}`}
        renderItem={renderBackdrop}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    padding: 8,
    marginRight: 12,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
  },
  listContainer: {
    padding: 16,
  },
  backdropContainer: {
    marginBottom: 20,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  backdropImage: {
    width: BACKDROP_WIDTH,
    height: BACKDROP_HEIGHT,
    alignSelf: 'center',
  },
  backdropInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  backdropResolution: {
    fontSize: 12,
    opacity: 0.8,
  },
  backdropAspect: {
    fontSize: 12,
    opacity: 0.8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
});

export default BackdropGalleryScreen;
