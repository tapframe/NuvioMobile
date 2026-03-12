import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  StatusBar,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeIn,
  FadeInUp,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../contexts/ThemeContext';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../navigation/AppNavigator';
import { mmkvStorage } from '../services/mmkvStorage';
import { ShapeAnimation } from '../components/onboarding/ShapeAnimation';

const { width, height } = Dimensions.get('window');

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 90,
  mass: 0.8,
};

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  description: string;
}

const getOnboardingData = (t: any): OnboardingSlide[] => [
  {
    id: '1',
    title: t('onboarding.slides.welcome_title'),
    subtitle: t('onboarding.slides.welcome_subtitle'),
    description: t('onboarding.slides.welcome_desc'),
  },
  {
    id: '2',
    title: t('onboarding.slides.addons_title'),
    subtitle: t('onboarding.slides.addons_subtitle'),
    description: t('onboarding.slides.addons_desc'),
  },
  {
    id: '3',
    title: t('onboarding.slides.discovery_title'),
    subtitle: t('onboarding.slides.discovery_subtitle'),
    description: t('onboarding.slides.discovery_desc'),
  },
  {
    id: '4',
    title: t('onboarding.slides.library_title'),
    subtitle: t('onboarding.slides.library_subtitle'),
    description: t('onboarding.slides.library_desc'),
  },
];

// Animated Slide Component with parallax
const AnimatedSlide = ({
  item,
  index,
  scrollX
}: {
  item: OnboardingSlide;
  index: number;
  scrollX: SharedValue<number>;
}) => {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];

  const titleStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      scrollX.value,
      inputRange,
      [width * 0.3, 0, -width * 0.3],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0, 1, 0],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      scrollX.value,
      inputRange,
      [0.8, 1, 0.8],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateX }, { scale }],
      opacity,
    };
  });

  const subtitleStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      scrollX.value,
      inputRange,
      [width * 0.5, 0, -width * 0.5],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0, 1, 0],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateX }],
      opacity,
    };
  });

  const descriptionStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      scrollX.value,
      inputRange,
      [width * 0.7, 0, -width * 0.7],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0, 1, 0],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateX }],
      opacity,
    };
  });

  return (
    <View style={styles.slide}>
      <View style={styles.textContainer}>
        <Animated.Text style={[styles.title, titleStyle]}>
          {item.title}
        </Animated.Text>

        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          {item.subtitle}
        </Animated.Text>

        <Animated.Text style={[styles.description, descriptionStyle]}>
          {item.description}
        </Animated.Text>
      </View>
    </View>
  );
};

const OnboardingScreen = () => {
  const { currentTheme } = useTheme();
  const { t } = useTranslation();
  const onboardingData = getOnboardingData(t);
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<Animated.FlatList<OnboardingSlide>>(null);
  const scrollX = useSharedValue(0);

  const updateIndex = (index: number) => {
    setCurrentIndex(index);
  };

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
    onMomentumEnd: (event) => {
      const slideIndex = Math.round(event.contentOffset.x / width);
      runOnJS(updateIndex)(slideIndex);
    },
  });

  const progressStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      scrollX.value,
      [0, (onboardingData.length - 1) * width],
      [0, 100],
      Extrapolation.CLAMP
    );
    return {
      width: `${progress}%`,
    };
  });

  const handleNext = () => {
    if (currentIndex < onboardingData.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToOffset({
        offset: nextIndex * width,
        animated: true
      });
    } else {
      handleGetStarted();
    }
  };

  const handleSkip = () => {
    (async () => {
      try {
        await mmkvStorage.setItem('hasCompletedOnboarding', 'true');
        await mmkvStorage.setItem('showLoginHintToastOnce', 'true');
      } catch { }
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    })();
  };

  const handleGetStarted = async () => {
    try {
      await mmkvStorage.setItem('hasCompletedOnboarding', 'true');
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (error) {
      if (__DEV__) console.error('Error saving onboarding status:', error);
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    }
  };

  const renderSlide = ({ item, index }: { item: OnboardingSlide; index: number }) => (
    <AnimatedSlide item={item} index={index} scrollX={scrollX} />
  );

  // Animated pagination dots
  const PaginationDot = ({ index }: { index: number }) => {
    const dotStyle = useAnimatedStyle(() => {
      const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
      const dotWidth = interpolate(
        scrollX.value,
        inputRange,
        [8, 32, 8],
        Extrapolation.CLAMP
      );
      const opacity = interpolate(
        scrollX.value,
        inputRange,
        [0.3, 1, 0.3],
        Extrapolation.CLAMP
      );
      return {
        width: dotWidth,
        opacity,
      };
    });

    return <Animated.View style={[styles.paginationDot, dotStyle]} />;
  };

  // Animated button
  const buttonScale = useSharedValue(1);

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  // Animated opacity for button and swipe indicator based on scroll
  const lastSlideStart = (onboardingData.length - 1) * width;

  const buttonOpacityStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollX.value,
      [lastSlideStart - width * 0.3, lastSlideStart],
      [0, 1],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const swipeOpacityStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollX.value,
      [lastSlideStart - width * 0.3, lastSlideStart],
      [1, 0],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.95, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" translucent />

      <View style={styles.fullScreenContainer}>
        {/* Shape Animation Background - iOS only */}
        {Platform.OS === 'ios' && <ShapeAnimation scrollX={scrollX} />}

        {/* Header */}
        <Animated.View
          entering={FadeIn.delay(300).duration(600)}
          style={styles.header}
        >
          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>{t('onboarding.skip', 'Skip')}</Text>
          </TouchableOpacity>

          {/* Smooth Progress Bar */}
          <View style={styles.progressContainer}>
            <Animated.View style={[styles.progressBar, progressStyle]} />
          </View>
        </Animated.View>

        {/* Slides */}
        <Animated.FlatList
          ref={flatListRef}
          data={onboardingData}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          onScroll={onScroll}
          scrollEventThrottle={16}
          decelerationRate="fast"
          snapToInterval={width}
          snapToAlignment="start"
          bounces={false}
          style={{ flex: 1 }}
        />

        {/* Footer */}
        <Animated.View
          entering={FadeInUp.delay(500).duration(600)}
          style={styles.footer}
        >
          {/* Smooth Pagination */}
          <View style={styles.pagination}>
            {onboardingData.map((_, index) => (
              <PaginationDot key={index} index={index} />
            ))}
          </View>

          {/* Button and Swipe indicator with crossfade based on scroll */}
          <View style={styles.footerButtonContainer}>
            {/* Swipe Indicator - fades out on last slide */}
            <Animated.View style={[styles.swipeIndicator, styles.absoluteFill, swipeOpacityStyle]}>
              <Text style={styles.swipeText}>{t('onboarding.swipe_to_continue', 'Swipe to continue')}</Text>
              <Text style={styles.swipeArrow}>→</Text>
            </Animated.View>

            {/* Get Started Button - fades in on last slide */}
            <Animated.View style={[styles.absoluteFill, buttonOpacityStyle]}>
              <TouchableOpacity
                onPress={handleGetStarted}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                activeOpacity={1}
              >
                <Animated.View style={[styles.button, buttonStyle]}>
                  <Text style={styles.buttonText}>{t('onboarding.get_started', 'Get Started')}</Text>
                </Animated.View>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  fullScreenContainer: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  skipButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  skipText: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.4)',
  },
  progressContainer: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    marginLeft: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 1.5,
    backgroundColor: '#FFFFFF',
  },
  slide: {
    width,
    flex: 1,
    justifyContent: Platform.OS === 'ios' ? 'flex-start' : 'center', // Top on iOS, center on Android
    paddingHorizontal: 32,
    paddingTop: Platform.OS === 'ios' ? '20%' : 0, // Padding only on iOS
  },
  textContainer: {
    alignItems: 'flex-start', // Text always left-aligned
  },
  title: {
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -2,
    lineHeight: 56,
    marginBottom: 16,
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 17,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 20,
    letterSpacing: 0.3,
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
    color: 'rgba(255, 255, 255, 0.4)',
    maxWidth: 300,
    textAlign: 'left', // Always left-aligned text
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: Platform.OS === 'ios' ? 50 : 32,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    gap: 6,
  },
  paginationDot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  button: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0A0A0A',
    letterSpacing: 0.3,
  },
  swipeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    gap: 8,
  },
  swipeText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.4)',
    letterSpacing: 0.3,
  },
  swipeArrow: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  footerButtonContainer: {
    height: 56,
    position: 'relative',
  },
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

export default OnboardingScreen;