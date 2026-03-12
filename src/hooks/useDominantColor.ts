import i18n from '../i18n';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getColors } from 'react-native-image-colors';
import type { ImageColorsResult } from 'react-native-image-colors';

interface DominantColorResult {
  dominantColor: string | null;
  loading: boolean;
  error: string | null;
}

// Simple in-memory cache for extracted colors
const colorCache = new Map<string, string>();

// Helper function to calculate color vibrancy
const calculateVibrancy = (hex: string): number => {
  const r = parseInt(hex.substr(1, 2), 16);
  const g = parseInt(hex.substr(3, 2), 16);
  const b = parseInt(hex.substr(5, 2), 16);
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  
  return saturation * (max / 255);
};

// Helper function to calculate color brightness
const calculateBrightness = (hex: string): number => {
  const r = parseInt(hex.substr(1, 2), 16);
  const g = parseInt(hex.substr(3, 2), 16);
  const b = parseInt(hex.substr(5, 2), 16);
  
  return (r * 299 + g * 587 + b * 114) / 1000;
};

// Helper function to darken a color
const darkenColor = (hex: string, factor: number = 0.1): string => {
  const r = parseInt(hex.substr(1, 2), 16);
  const g = parseInt(hex.substr(3, 2), 16);
  const b = parseInt(hex.substr(5, 2), 16);
  
  const newR = Math.floor(r * factor);
  const newG = Math.floor(g * factor);
  const newB = Math.floor(b * factor);
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
};

// Enhanced color selection logic
const selectBestColor = (result: ImageColorsResult): string => {
  let candidates: string[] = [];
  
  if (result.platform === 'android') {
    // Collect all available colors
    candidates = [
      result.dominant,
      result.vibrant,
      result.darkVibrant,
      result.muted,
      result.darkMuted,
      result.lightVibrant,
      result.lightMuted,
      result.average
    ].filter(Boolean);
  } else if (result.platform === 'ios') {
    candidates = [
      result.primary,
      result.secondary,
      result.background,
      result.detail
    ].filter(Boolean);
  } else if (result.platform === 'web') {
    candidates = [
      result.dominant,
      result.vibrant,
      result.darkVibrant,
      result.muted,
      result.darkMuted,
      result.lightVibrant,
      result.lightMuted
    ].filter(Boolean);
  }
  
  if (candidates.length === 0) {
    return '#1a1a1a';
  }
  
  // Score each color based on vibrancy and appropriateness for backgrounds
  const scoredColors = candidates.map(color => {
    const brightness = calculateBrightness(color);
    const vibrancy = calculateVibrancy(color);
    
    // Prefer colors that are:
    // 1. Not too bright (good for backgrounds)
    // 2. Have decent vibrancy (not too gray)
    // 3. Not too dark (still visible)
    let score = 0;
    
    // Brightness scoring (prefer medium-dark colors)
    if (brightness >= 30 && brightness <= 120) {
      score += 3;
    } else if (brightness >= 15 && brightness <= 150) {
      score += 2;
    } else if (brightness >= 5) {
      score += 1;
    }
    
    // Vibrancy scoring (prefer some color over pure gray)
    if (vibrancy >= 0.3) {
      score += 3;
    } else if (vibrancy >= 0.15) {
      score += 2;
    } else if (vibrancy >= 0.05) {
      score += 1;
    }
    
    return { color, score, brightness, vibrancy };
  });
  
  // Sort by score (highest first)
  scoredColors.sort((a, b) => b.score - a.score);
  
  // Get the best color
  let bestColor = scoredColors[0].color;
  const bestBrightness = scoredColors[0].brightness;
  
  // Apply more aggressive darkening to make colors darker overall
  if (bestBrightness > 60) {
    bestColor = darkenColor(bestColor, 0.18);
  } else if (bestBrightness > 40) {
    bestColor = darkenColor(bestColor, 0.3);
  } else if (bestBrightness > 20) {
    bestColor = darkenColor(bestColor, 0.5);
  } else {
    bestColor = darkenColor(bestColor, 0.7);
  }
  
  return bestColor;
};

// Preload function to start extraction early
export const preloadDominantColor = async (imageUri: string | null) => {
  if (!imageUri || colorCache.has(imageUri)) return;
  
  if (__DEV__) console.log('[useDominantColor] Preloading color for URI:', imageUri);
  
  try {
    // Use highest quality for best color accuracy
    const result = await getColors(imageUri, {
      fallback: '#1a1a1a',
      cache: true,
      key: imageUri,
      quality: 'highest', // Best quality for accurate colors
      pixelSpacing: 1, // Sample every pixel for best accuracy (Android only)
    });

    const extractedColor = selectBestColor(result);
    colorCache.set(imageUri, extractedColor);
  } catch (err) {
    if (__DEV__) console.warn('[preloadDominantColor] Failed to preload color:', err);
    colorCache.set(imageUri, '#1a1a1a');
  }
};

export const useDominantColor = (imageUri: string | null): DominantColorResult => {
  // Start with cached color if available, otherwise use fallback immediately
  const [dominantColor, setDominantColor] = useState<string | null>(() => {
    if (imageUri && colorCache.has(imageUri)) {
      return colorCache.get(imageUri) || '#1a1a1a';
    }
    // Never return null - always provide immediate fallback
    return '#1a1a1a';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSetColorRef = useRef<string | null>(dominantColor);

  const safelySetColor = useCallback((color: string) => {
    if (lastSetColorRef.current !== color) {
      lastSetColorRef.current = color;
      setDominantColor(color);
    }
  }, []);

  const extractColor = useCallback(async (uri: string) => {
    if (!uri) {
      safelySetColor('#1a1a1a');
      setLoading(false);
      return;
    }

    // Check cache first
    if (colorCache.has(uri)) {
      const cachedColor = colorCache.get(uri)!;
      safelySetColor(cachedColor);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Use highest quality for best color accuracy
      const fastResult: ImageColorsResult = await getColors(uri, {
        fallback: '#1a1a1a',
        cache: true,
        key: uri,
        quality: 'highest', // Best quality for accurate colors
        pixelSpacing: 1, // Sample every pixel for best accuracy (Android only)
      });

      const fastColor = selectBestColor(fastResult);
      colorCache.set(uri, fastColor); // Cache fast color to avoid flicker
      safelySetColor(fastColor);
      setLoading(false);

      // Since we're already using highest quality, no need for refinement
    } catch (err) {
      if (__DEV__) console.warn('[useDominantColor] Failed to extract color:', err);
      setError(err instanceof Error ? err.message : i18n.t('errors.failed_to_extract_color'));
      const fallbackColor = '#1a1a1a';
      colorCache.set(uri, fallbackColor); // Cache fallback to avoid repeated failures
      safelySetColor(fallbackColor);
    } finally {
      // loading already set to false
    }
  }, []);

  useEffect(() => {
    if (imageUri) {
      // If we have a cached color, use it immediately, but still extract in background for accuracy
      if (colorCache.has(imageUri)) {
        safelySetColor(colorCache.get(imageUri)!);
        setLoading(false);
      } else {
        // No cache, extract color
        extractColor(imageUri);
      }
    } else {
      safelySetColor('#1a1a1a');
      setLoading(false);
      setError(null);
    }
  }, [imageUri, extractColor, safelySetColor]);

  return {
    dominantColor,
    loading,
    error,
  };
};

export default useDominantColor;