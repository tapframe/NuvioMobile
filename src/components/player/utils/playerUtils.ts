import i18n from '../../../i18n';
import { logger } from '../../../utils/logger';
import { useEffect } from 'react';
import { SubtitleCue } from './playerTypes';
import { parseSRT as parseSRTEnhanced, parseSubtitle } from './subtitleParser';

// Debug flag - set back to false to disable verbose logging
// WARNING: Setting this to true currently causes infinite render loops
// Use selective logging instead if debugging is needed
export const DEBUG_MODE = true;

// Safer debug function that won't cause render loops
// Call this with any debugging info you need instead of using inline DEBUG_MODE checks
export const safeDebugLog = (message: string, data?: any) => {
  // This function only runs once per call site, avoiding render loops
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (DEBUG_MODE) {
      if (data) {
        logger.log(`[VideoPlayer] ${message}`, data);
      } else {
        logger.log(`[VideoPlayer] ${message}`);
      }
    }
  }, []); // Empty dependency array means this only runs once per mount
};

// Add language code to name mapping
export const languageMap: { [key: string]: string } = {
  'en': 'English',
  'eng': 'English',
  'es': 'Spanish',
  'spa': 'Spanish',
  'fr': 'French',
  'fre': 'French',
  'de': 'German',
  'ger': 'German',
  'it': 'Italian',
  'ita': 'Italian',
  'ja': 'Japanese',
  'jpn': 'Japanese',
  'ko': 'Korean',
  'kor': 'Korean',
  'zh': 'Chinese',
  'chi': 'Chinese',
  'ru': 'Russian',
  'rus': 'Russian',
  'pt': 'Portuguese',
  'por': 'Portuguese',
  'hi': 'Hindi',
  'hin': 'Hindi',
  'ar': 'Arabic',
  'ara': 'Arabic',
  'nl': 'Dutch',
  'dut': 'Dutch',
  'sv': 'Swedish',
  'swe': 'Swedish',
  'no': 'Norwegian',
  'nor': 'Norwegian',
  'fi': 'Finnish',
  'fin': 'Finnish',
  'da': 'Danish',
  'dan': 'Danish',
  'pl': 'Polish',
  'pol': 'Polish',
  'tr': 'Turkish',
  'tur': 'Turkish',
  'cs': 'Czech',
  'cze': 'Czech',
  'hu': 'Hungarian',
  'hun': 'Hungarian',
  'el': 'Greek',
  'gre': 'Greek',
  'th': 'Thai',
  'tha': 'Thai',
  'vi': 'Vietnamese',
  'vie': 'Vietnamese',
};

// Function to format language code to readable name
export const formatLanguage = (code?: string): string => {
  if (!code) return 'Unknown';
  const normalized = code.toLowerCase();
  const languageName = languageMap[normalized] || code.toUpperCase();

  // If the result is still the uppercased code, it means we couldn't find it in our map.
  if (languageName === code.toUpperCase()) {
    return `Unknown (${code})`;
  }

  return languageName;
};

// Helper function to extract a display name from the track's name property
export const getTrackDisplayName = (track: { name?: string, id: number, language?: string }): string => {
  if (!track) return i18n.t('components.unknown_track');

  // If no name, use track number
  if (!track.name) return `Track ${track.id}`;

  // If the name is already well-formatted (contains • separators), use it as-is
  if (track.name.includes('•')) {
    return track.name;
  }

  // If the track name contains detailed information, use it as-is
  if (track.name && (track.name.includes('DDP') || track.name.includes('DTS') || track.name.includes('AAC') ||
    track.name.includes('EAC3') || track.name.includes('AC3') || track.name.includes('TrueHD') ||
    track.name.includes('Dolby') || track.name.includes('FLAC') || track.name.includes('Opus') ||
    track.name.includes('Kbps') || track.name.includes('kbps') || track.name.includes('Atmos') ||
    track.name.includes('5.1') || track.name.includes('7.1') || track.name.includes('6.1') || track.name.includes('2.0') ||
    track.name.includes('SDH') || track.name.includes('Forced') || track.name.includes('~'))) {
    return track.name;
  }

  // If name is a rich multi-word label (more than one word and not a generic track name), use it as-is
  const genericTrackMatch = track.name.match(/^(Audio|Track|Subtitle)\s+(\d+)$/i);
  if (!genericTrackMatch && track.name.trim().includes(' ')) {
    return track.name;
  }

  // Try to extract language from name like "Some Info - [English]"
  const languageMatch = track.name.match(/\[(.*?)\]/);
  if (languageMatch && languageMatch[1]) {
    return languageMatch[1];
  }

  // Handle generic VLC track names like "Audio 1", "Track 1" — use language if available
  if (genericTrackMatch) {
    if (track.language && track.language !== 'Unknown') {
      return formatLanguage(track.language);
    }
    return track.name;
  }

  // Check for common language patterns in the name
  const languagePatterns = [
    /\b(english|spanish|french|german|italian|japanese|korean|chinese|russian|portuguese|hindi|arabic|dutch|swedish|norwegian|finnish|danish|polish|turkish|czech|hungarian|greek|thai|vietnamese)\b/i,
    /\b(en|es|fr|de|it|ja|ko|zh|ru|pt|hi|ar|nl|sv|no|fi|da|pl|tr|cs|hu|el|th|vi)\b/i
  ];

  for (const pattern of languagePatterns) {
    const match = track.name.match(pattern);
    if (match) {
      const detectedLang = match[1];
      const formatted = formatLanguage(detectedLang);
      if (formatted !== 'Unknown' && !formatted.includes('Unknown')) {
        return formatted;
      }
    }
  }

  // If name contains only numbers or is very short, it's probably not meaningful
  if (/^\d+$/.test(track.name.trim()) || track.name.trim().length <= 2) {
    return `Audio ${track.id}`;
  }

  // Use the name as-is if it seems meaningful
  return track.name;
};

// Format time function for the player
export const formatTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  } else {
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
};

// Enhanced SRT parser function - delegates to new parser with formatting support
export const parseSRT = (srtContent: string): SubtitleCue[] => {
  // Use the new enhanced parser from subtitleParser.ts
  return parseSRTEnhanced(srtContent);
};

/**
 * Detect if text contains primarily RTL (right-to-left) characters
 * Checks for Arabic, Hebrew, Persian, Urdu, and other RTL scripts
 * Returns true if the majority of non-whitespace characters are RTL
 */
export const detectRTL = (text: string): boolean => {
  if (!text || text.length === 0) return false;

  // RTL character ranges
  // Arabic: U+0600–U+06FF
  // Arabic Supplement: U+0750–U+077F
  // Arabic Extended-A: U+08A0–U+08FF
  // Arabic Presentation Forms-A: U+FB50–U+FDFF
  // Arabic Presentation Forms-B: U+FE70–U+FEFF
  // Hebrew: U+0590–U+05FF
  // Persian/Urdu use Arabic script (no separate range)
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

  // Remove whitespace and count characters
  const nonWhitespace = text.replace(/\s/g, '');
  if (nonWhitespace.length === 0) return false;

  const rtlCount = (nonWhitespace.match(rtlRegex) || []).length;

  // Consider RTL if at least 30% of non-whitespace characters are RTL
  // This handles mixed-language subtitles (e.g., Arabic with English numbers)
  return rtlCount / nonWhitespace.length >= 0.3;
};

// Check if a URL is an HLS stream
export const isHlsStream = (url: string | undefined): boolean => {
  if (!url) return false;
  return url.includes('.m3u8') || url.includes('.m3u');
};

// Process URL for VLC to handle specific protocol requirements
export const processUrlForVLC = (url: string | undefined): string => {
  if (!url) return '';
  // Some HLS streams need to be passed with specific protocols for VLC
  if (url.startsWith('https://') && isHlsStream(url)) {
    // Standard HTTPS is usually fine, but some implementations might prefer http
    return url;
  }
  return url;
};

// Default headers for Android requests
export const defaultAndroidHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile; rv:89.0) Gecko/89.0 Firefox/89.0',
  'Accept': '*/*'
};

// Get specific headers for HLS streams
export const getHlsHeaders = () => {
  return {
    ...defaultAndroidHeaders,
    'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, application/json, text/plain',
  };
}; 
