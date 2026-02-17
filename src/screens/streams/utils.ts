import { Stream } from '../../types/metadata';

/**
 * Language variations for filtering
 */
const LANGUAGE_VARIATIONS: Record<string, string[]> = {
  latin: ['latino', 'latina', 'lat'],
  spanish: ['español', 'espanol', 'spa'],
  german: ['deutsch', 'ger'],
  french: ['français', 'francais', 'fre'],
  portuguese: ['português', 'portugues', 'por'],
  italian: ['ita'],
  english: ['eng'],
  japanese: ['jap'],
  korean: ['kor'],
  chinese: ['chi', 'cn'],
  arabic: ['ara'],
  russian: ['rus'],
  turkish: ['tur'],
  hindi: ['hin'],
};

/**
 * Get all variations of a language name
 */
const getLanguageVariations = (language: string): string[] => {
  const langLower = language.toLowerCase();
  const variations = [langLower];
  
  if (LANGUAGE_VARIATIONS[langLower]) {
    variations.push(...LANGUAGE_VARIATIONS[langLower]);
  }
  
  return variations;
};

/**
 * Filter streams by excluded quality settings
 */
export const filterStreamsByQuality = (
  streams: Stream[],
  excludedQualities: string[]
): Stream[] => {
  if (!excludedQualities || excludedQualities.length === 0) {
    return streams;
  }

  return streams.filter(stream => {
    const streamTitle = stream.title || stream.name || '';

    const hasExcludedQuality = excludedQualities.some(excludedQuality => {
      if (excludedQuality === 'Auto') {
        return /\b(auto|adaptive)\b/i.test(streamTitle);
      } else {
        const pattern = new RegExp(excludedQuality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        return pattern.test(streamTitle);
      }
    });

    return !hasExcludedQuality;
  });
};

/**
 * Filter streams by excluded language settings
 */
export const filterStreamsByLanguage = (
  streams: Stream[],
  excludedLanguages: string[]
): Stream[] => {
  if (!excludedLanguages || excludedLanguages.length === 0) {
    return streams;
  }

  return streams.filter(stream => {
    const streamName = stream.name || '';
    const streamTitle = stream.title || '';
    const streamDescription = stream.description || '';
    const searchText = `${streamName} ${streamTitle} ${streamDescription}`.toLowerCase();

    const hasExcludedLanguage = excludedLanguages.some(excludedLanguage => {
      const variations = getLanguageVariations(excludedLanguage);
      return variations.some(variant => searchText.includes(variant));
    });

    return !hasExcludedLanguage;
  });
};

/**
 * Extract numeric quality from stream title
 * Maps common quality labels (4K, 8K) to their vertical resolution (2160p, 4320p)
 * and extracts numeric values from patterns like "1080p".
 */
export const getQualityNumeric = (title: string | undefined): number => {
  if (!title) return 0;

  // Check for 4K first (treat as 2160p)
  if (/\b(4k|uhd)\b/i.test(title)) {
    return 2160;
  }
  
  // Check for 8K (treat as 4320p)
  if (/\b8k\b/i.test(title)) {
    return 4320;
  }

  // General pattern for numbers followed by 'p' (e.g., 1080p, 3660p)
  const matchWithP = title.match(/(\d+)p/i);
  if (matchWithP) return parseInt(matchWithP[1], 10);

  // Standalone common resolutions if 'p' suffix is missing (e.g., "UHD 2160")
  const commonResolutions = [/\b(140|240|360|480|720|1080|1440|2160|3660|4320|8000)\b/];
  for (const pattern of commonResolutions) {
    const match = title.match(pattern);
    if (match) {
      const quality = parseInt(match[1], 10);
      if (quality >= 140 && quality <= 8000) return quality;
    }
  }
  
  return 0;
};

/**
 * Sort streams by quality (highest first)
 */
export const sortStreamsByQuality = (streams: Stream[]): Stream[] => {
  return [...streams].sort((a, b) => {
    const titleA = (a.name || a.title || '').toLowerCase();
    const titleB = (b.name || b.title || '').toLowerCase();

    // Check for "Auto" quality - always prioritize it
    const isAutoA = /\b(auto|adaptive)\b/i.test(titleA);
    const isAutoB = /\b(auto|adaptive)\b/i.test(titleB);

    if (isAutoA && !isAutoB) return -1;
    if (!isAutoA && isAutoB) return 1;

    const qualityA = getQualityNumeric(a.name || a.title);
    const qualityB = getQualityNumeric(b.name || b.title);

    if (qualityA !== qualityB) {
      return qualityB - qualityA;
    }

    // If quality is the same, sort by provider name, then stream name
    const providerA = a.addonId || a.addonName || '';
    const providerB = b.addonId || b.addonName || '';

    if (providerA !== providerB) {
      return providerA.localeCompare(providerB);
    }

    const nameA = (a.name || a.title || '').toLowerCase();
    const nameB = (b.name || b.title || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
};

/**
 * Infer video type from URL
 */
export const inferVideoTypeFromUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  const lower = url.toLowerCase();
  // HLS
  if (/(\.|ext=)(m3u8)(\b|$)/i.test(lower) || /\.m3u8(\b|$)/i.test(lower)) return 'm3u8';
  if (/(^|[?&])type=(m3u8|hls)(\b|$)/i.test(lower)) return 'm3u8';
  if (/\b(m3u8|m3u)\b/i.test(lower) || /\bhls\b/i.test(lower)) return 'm3u8';
  // Some providers serve HLS playlists behind extensionless endpoints.
  // Example: https://<host>/playlist/<id>?token=...&expires=...
  if (/\/playlist\//i.test(lower) && (/(^|[?&])token=/.test(lower) || /(^|[?&])expires=/.test(lower))) return 'm3u8';

  // DASH
  if (/(\.|ext=)(mpd)(\b|$)/i.test(lower) || /\.mpd(\b|$)/i.test(lower)) return 'mpd';

  // Progressive
  if (/(\.|ext=)(mp4)(\b|$)/i.test(lower) || /\.mp4(\b|$)/i.test(lower)) return 'mp4';
  return undefined;
};

/**
 * Filter headers for Vidrock compatibility
 */
export const filterHeadersForVidrock = (
  headers: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (!headers) return undefined;

  const essentialHeaders: Record<string, string> = {};
  if (headers['User-Agent']) essentialHeaders['User-Agent'] = headers['User-Agent'];
  if (headers['Referer']) essentialHeaders['Referer'] = headers['Referer'];
  if (headers['Origin']) essentialHeaders['Origin'] = headers['Origin'];

  return Object.keys(essentialHeaders).length > 0 ? essentialHeaders : undefined;
};
