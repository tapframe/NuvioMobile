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

const DEFAULT_NETWORK_MBPS = 20;
const MIN_NETWORK_MBPS = 0.1;

export type NetworkClass = 'very-slow' | 'slow' | 'medium' | 'fast' | 'very-fast' | 'ultra';

type NetworkClassWeights = {
  targetHeadroomRatio: number;
  ratioWeight: number;
  directBonus: number;
  adaptiveBonus: number;
  debridBonus: number;
  torrentBaseBonus: number;
  seedCritical: number;
  seedLow: number;
  seedOkay: number;
  seedCriticalPenalty: number;
  seedLowPenalty: number;
  seedOkayPenalty: number;
  seedUnknownPenalty: number;
  seedBoostWeight: number;
  seedBoostCap: number;
  peerCongestionRatio: number;
  peerCongestionPenalty: number;
  signedUrlPenalty: number;
  notWebReadyPenalty: number;
};

const NETWORK_CLASS_WEIGHTS: Record<NetworkClass, NetworkClassWeights> = {
  'very-slow': {
    targetHeadroomRatio: 2.5,
    ratioWeight: 25,
    directBonus: 10,
    adaptiveBonus: 10,
    debridBonus: 19,
    torrentBaseBonus: 4,
    seedCritical: 8,
    seedLow: 20,
    seedOkay: 40,
    seedCriticalPenalty: 30,
    seedLowPenalty: 19,
    seedOkayPenalty: 9,
    seedUnknownPenalty: 14,
    seedBoostWeight: 4.4,
    seedBoostCap: 18,
    peerCongestionRatio: 2.4,
    peerCongestionPenalty: 10,
    signedUrlPenalty: 5,
    notWebReadyPenalty: 12,
  },
  slow: {
    targetHeadroomRatio: 2.1,
    ratioWeight: 23,
    directBonus: 9,
    adaptiveBonus: 8,
    debridBonus: 18,
    torrentBaseBonus: 5,
    seedCritical: 6,
    seedLow: 14,
    seedOkay: 28,
    seedCriticalPenalty: 26,
    seedLowPenalty: 15,
    seedOkayPenalty: 7,
    seedUnknownPenalty: 11,
    seedBoostWeight: 4.6,
    seedBoostCap: 20,
    peerCongestionRatio: 2.8,
    peerCongestionPenalty: 9,
    signedUrlPenalty: 4,
    notWebReadyPenalty: 10,
  },
  medium: {
    targetHeadroomRatio: 1.7,
    ratioWeight: 20,
    directBonus: 8,
    adaptiveBonus: 7,
    debridBonus: 16,
    torrentBaseBonus: 6,
    seedCritical: 4,
    seedLow: 10,
    seedOkay: 20,
    seedCriticalPenalty: 21,
    seedLowPenalty: 12,
    seedOkayPenalty: 5,
    seedUnknownPenalty: 8,
    seedBoostWeight: 4.8,
    seedBoostCap: 22,
    peerCongestionRatio: 3.2,
    peerCongestionPenalty: 7,
    signedUrlPenalty: 3,
    notWebReadyPenalty: 8,
  },
  fast: {
    targetHeadroomRatio: 1.4,
    ratioWeight: 17,
    directBonus: 7,
    adaptiveBonus: 5,
    debridBonus: 14,
    torrentBaseBonus: 6,
    seedCritical: 3,
    seedLow: 7,
    seedOkay: 14,
    seedCriticalPenalty: 15,
    seedLowPenalty: 8,
    seedOkayPenalty: 3,
    seedUnknownPenalty: 5,
    seedBoostWeight: 5.1,
    seedBoostCap: 24,
    peerCongestionRatio: 3.7,
    peerCongestionPenalty: 5,
    signedUrlPenalty: 2,
    notWebReadyPenalty: 7,
  },
  'very-fast': {
    targetHeadroomRatio: 1.2,
    ratioWeight: 15,
    directBonus: 6,
    adaptiveBonus: 4,
    debridBonus: 12,
    torrentBaseBonus: 6,
    seedCritical: 2,
    seedLow: 5,
    seedOkay: 10,
    seedCriticalPenalty: 11,
    seedLowPenalty: 6,
    seedOkayPenalty: 2,
    seedUnknownPenalty: 4,
    seedBoostWeight: 5.3,
    seedBoostCap: 26,
    peerCongestionRatio: 4.2,
    peerCongestionPenalty: 4,
    signedUrlPenalty: 1,
    notWebReadyPenalty: 6,
  },
  ultra: {
    targetHeadroomRatio: 1.1,
    ratioWeight: 13,
    directBonus: 5,
    adaptiveBonus: 3,
    debridBonus: 11,
    torrentBaseBonus: 6,
    seedCritical: 2,
    seedLow: 4,
    seedOkay: 8,
    seedCriticalPenalty: 9,
    seedLowPenalty: 5,
    seedOkayPenalty: 1,
    seedUnknownPenalty: 3,
    seedBoostWeight: 5.5,
    seedBoostCap: 28,
    peerCongestionRatio: 4.8,
    peerCongestionPenalty: 3,
    signedUrlPenalty: 1,
    notWebReadyPenalty: 5,
  },
};

export interface NetworkProfile {
  estimatedDownlinkMbps: number;
  source:
    | 'wifi-rx-link-speed'
    | 'wifi-link-speed'
    | 'cellular-generation'
    | 'ethernet'
    | 'unknown';
  connectionType?: string;
  cellularGeneration?: string;
  isMetered?: boolean;
}

export interface PlaybackViability {
  score: number;
  label: 'Excellent' | 'Good' | 'Fair' | 'Risky';
  reason: string;
  requiredMbps: number;
  availableMbps: number;
  throughputRatio: number;
  networkClass: NetworkClass;
  seeders?: number;
  peers?: number;
}

type MinimalNetInfoState = {
  type?: string;
  details?: Record<string, any> | null;
  isConnectionExpensive?: boolean | null;
  isInternetReachable?: boolean | null;
};

const clamp = (value: number, minValue: number, maxValue: number): number => {
  return Math.max(minValue, Math.min(maxValue, value));
};

export const getNetworkClassForMbps = (networkMbps: number): NetworkClass => {
  const mbps = clamp(networkMbps || DEFAULT_NETWORK_MBPS, MIN_NETWORK_MBPS, 1000);
  if (mbps <= 1.5) return 'very-slow';
  if (mbps <= 5) return 'slow';
  if (mbps <= 20) return 'medium';
  if (mbps <= 80) return 'fast';
  if (mbps <= 250) return 'very-fast';
  return 'ultra';
};

const isTorrentLikeStream = (stream: Stream): boolean => {
  const url = stream.url || '';
  const hints = stream.behaviorHints as any;
  return (
    url.startsWith('magnet:') ||
    typeof stream.infoHash === 'string' ||
    typeof hints?.infoHash === 'string' ||
    hints?.type === 'torrent'
  );
};

const isHttpStream = (stream: Stream): boolean => {
  const url = stream.url || '';
  return /^https?:\/\//i.test(url);
};

const getSearchText = (stream: Stream): string => {
  return `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`.toLowerCase();
};

const parseNumberFromPatterns = (text: string, patterns: RegExp[]): number | undefined => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
};

const extractTorrentStats = (stream: Stream): { seeders?: number; peers?: number } => {
  const hints = (stream.behaviorHints || {}) as any;
  const torrentHints = hints?.torrent || {};

  const hintedSeeders =
    (typeof hints.seeders === 'number' ? hints.seeders : undefined) ??
    (typeof torrentHints.seeders === 'number' ? torrentHints.seeders : undefined);
  const hintedPeers =
    (typeof hints.peers === 'number' ? hints.peers : undefined) ??
    (typeof torrentHints.peers === 'number' ? torrentHints.peers : undefined);

  if (hintedSeeders !== undefined || hintedPeers !== undefined) {
    return {
      seeders: hintedSeeders,
      peers: hintedPeers,
    };
  }

  const text = `${stream.name || ''}\n${stream.title || ''}\n${stream.description || ''}`;

  const seeders = parseNumberFromPatterns(text, [
    /(?:seeders?|seeds?)\s*[:=]\s*(\d{1,6})/i,
    /(?:👤|🧲)\s*(\d{1,6})/u,
    /\bS\s*[:=]\s*(\d{1,6})\b/i,
  ]);

  const peers = parseNumberFromPatterns(text, [
    /(?:peers?|leechers?)\s*[:=]\s*(\d{1,6})/i,
    /(?:👥)\s*(\d{1,6})/u,
    /\bP\s*[:=]\s*(\d{1,6})\b/i,
  ]);

  return { seeders, peers };
};

const estimateRequiredBitrateMbps = (stream: Stream): number => {
  const text = getSearchText(stream);

  const explicitRateMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:mbps|mb\/s|mib\/s)/i);
  if (explicitRateMatch) {
    const explicit = Number(explicitRateMatch[1]);
    if (Number.isFinite(explicit) && explicit > 0) {
      return clamp(explicit, 0.5, 120);
    }
  }

  const quality = getQualityNumeric(stream.quality || stream.name || stream.title);

  let estimated = 6;
  if (quality >= 4320) estimated = 80;
  else if (quality >= 2160) estimated = 28;
  else if (quality >= 1440) estimated = 16;
  else if (quality >= 1080) estimated = 9;
  else if (quality >= 720) estimated = 4.5;
  else if (quality >= 480) estimated = 2.5;
  else if (quality > 0) estimated = 1.5;

  // More efficient codecs typically need less bandwidth at similar quality.
  if (/\b(hevc|x265|h265|av1)\b/i.test(text)) {
    estimated *= 0.75;
  }

  if (/\b(remux|blu[\s-]?ray)\b/i.test(text)) {
    estimated *= 1.35;
  }

  if (/\b(cam|ts|telesync|screener)\b/i.test(text)) {
    estimated *= 0.75;
  }

  return clamp(estimated, 0.8, 120);
};

export const estimateNetworkProfile = (state?: MinimalNetInfoState | null): NetworkProfile => {
  const connectionType = state?.type || 'unknown';
  const details = state?.details || {};
  const isMetered = !!state?.isConnectionExpensive;

  let estimatedDownlinkMbps = DEFAULT_NETWORK_MBPS;
  let source: NetworkProfile['source'] = 'unknown';

  if (connectionType === 'wifi') {
    const rx = Number(details.rxLinkSpeed);
    const link = Number(details.linkSpeed);
    if (Number.isFinite(rx) && rx > 0) {
      estimatedDownlinkMbps = rx;
      source = 'wifi-rx-link-speed';
    } else if (Number.isFinite(link) && link > 0) {
      estimatedDownlinkMbps = link;
      source = 'wifi-link-speed';
    }
  } else if (connectionType === 'cellular') {
    const generation = (details.cellularGeneration || '').toString().toLowerCase();
    source = 'cellular-generation';
    if (generation === '5g') estimatedDownlinkMbps = 130;
    else if (generation === '4g') estimatedDownlinkMbps = 28;
    else if (generation === '3g') estimatedDownlinkMbps = 4;
    else if (generation === '2g') estimatedDownlinkMbps = 0.6;
    else estimatedDownlinkMbps = 12;
  } else if (connectionType === 'ethernet') {
    estimatedDownlinkMbps = 350;
    source = 'ethernet';
  }

  if (state?.isInternetReachable === false) {
    estimatedDownlinkMbps = MIN_NETWORK_MBPS;
  }

  if (isMetered && estimatedDownlinkMbps > 40) {
    estimatedDownlinkMbps = 40;
  }

  return {
    estimatedDownlinkMbps: clamp(estimatedDownlinkMbps, MIN_NETWORK_MBPS, 1000),
    source,
    connectionType,
    cellularGeneration: details.cellularGeneration,
    isMetered,
  };
};

export const computeStreamPlaybackViability = (
  stream: Stream,
  networkMbps = DEFAULT_NETWORK_MBPS
): PlaybackViability => {
  const availableMbps = clamp(networkMbps || DEFAULT_NETWORK_MBPS, MIN_NETWORK_MBPS, 1000);
  const networkClass = getNetworkClassForMbps(availableMbps);
  const weights = NETWORK_CLASS_WEIGHTS[networkClass];
  const requiredMbps = estimateRequiredBitrateMbps(stream);
  const throughputRatio = availableMbps / Math.max(requiredMbps, MIN_NETWORK_MBPS);
  const isTorrent = isTorrentLikeStream(stream);
  const isDirect = isHttpStream(stream);
  const text = getSearchText(stream);
  const lowerUrl = (stream.url || '').toLowerCase();
  const { seeders, peers } = extractTorrentStats(stream);
  const isDebrid = !!stream.behaviorHints?.cached;
  const isAdaptive = /\b(m3u8|hls|adaptive|auto)\b/i.test(text);
  const isSignedUrl = /\b(token|expires?|signature|sig)=/i.test(lowerUrl);

  let score = 48;
  score += clamp((throughputRatio - weights.targetHeadroomRatio) * weights.ratioWeight, -42, 35);

  if (isDirect) score += weights.directBonus;
  if (isAdaptive) score += weights.adaptiveBonus;
  if (isDebrid) score += weights.debridBonus;
  if (isSignedUrl && throughputRatio < weights.targetHeadroomRatio) {
    score -= weights.signedUrlPenalty;
  }

  if (isTorrent) {
    score += weights.torrentBaseBonus;
    if (typeof seeders === 'number') {
      score += clamp(Math.log2(seeders + 1) * weights.seedBoostWeight, 0, weights.seedBoostCap);
      if (seeders < weights.seedCritical) {
        score -= weights.seedCriticalPenalty;
      } else if (seeders < weights.seedLow) {
        score -= weights.seedLowPenalty;
      } else if (seeders < weights.seedOkay) {
        score -= weights.seedOkayPenalty;
      }
    } else {
      score -= weights.seedUnknownPenalty;
    }

    if (
      typeof peers === 'number' &&
      typeof seeders === 'number' &&
      peers > seeders * weights.peerCongestionRatio
    ) {
      score -= weights.peerCongestionPenalty;
    }
  }

  if (stream.behaviorHints?.notWebReady && !isTorrent) {
    score -= weights.notWebReadyPenalty;
  }

  if (availableMbps < 1) score -= 20;

  score = clamp(score, 1, 99);

  let label: PlaybackViability['label'];
  if (score >= 85) label = 'Excellent';
  else if (score >= 70) label = 'Good';
  else if (score >= 50) label = 'Fair';
  else label = 'Risky';

  let reason = 'Balanced for current connection';
  if (isDebrid) {
    reason = 'Cached/debrid source';
  } else if (isTorrent && typeof seeders === 'number' && seeders < weights.seedLow) {
    reason = 'Low seed availability for current network';
  } else if (throughputRatio < weights.targetHeadroomRatio * 0.8) {
    reason = 'Bitrate may exceed stable throughput';
  } else if (isAdaptive && availableMbps <= 25) {
    reason = 'Adaptive stream favored for current network';
  } else if (throughputRatio > weights.targetHeadroomRatio * 1.7) {
    reason = 'Bandwidth headroom available';
  }

  return {
    score,
    label,
    reason,
    requiredMbps: Number(requiredMbps.toFixed(1)),
    availableMbps: Number(availableMbps.toFixed(1)),
    throughputRatio: Number(throughputRatio.toFixed(2)),
    networkClass,
    seeders,
    peers,
  };
};

export const annotateStreamWithPlaybackViability = (
  stream: Stream,
  networkMbps = DEFAULT_NETWORK_MBPS
): Stream => {
  const viability = computeStreamPlaybackViability(stream, networkMbps);
  const currentHints = (stream.behaviorHints || {}) as any;
  stream.behaviorHints = {
    ...currentHints,
    playbackViability: viability,
    seeders: currentHints?.seeders ?? viability.seeders ?? undefined,
    peers: currentHints?.peers ?? viability.peers ?? undefined,
  };
  return stream;
};

export const getPlaybackViabilityFromStream = (stream: Stream): PlaybackViability | undefined => {
  return (stream.behaviorHints as any)?.playbackViability as PlaybackViability | undefined;
};

export const rankStreamsByPlaybackViability = (
  streams: Stream[],
  networkMbps = DEFAULT_NETWORK_MBPS
): Stream[] => {
  const networkClass = getNetworkClassForMbps(networkMbps);
  const prefersLowerBitrate =
    networkClass === 'very-slow' || networkClass === 'slow' || networkClass === 'medium';

  return streams
    .map((stream, index) => {
      const annotated = annotateStreamWithPlaybackViability(stream, networkMbps);
      const viability = getPlaybackViabilityFromStream(annotated);
      return {
        stream: annotated,
        index,
        viabilityScore: viability?.score ?? 0,
        requiredMbps: viability?.requiredMbps ?? estimateRequiredBitrateMbps(stream),
        seeders: viability?.seeders,
        quality: getQualityNumeric(stream.quality || stream.name || stream.title),
        isCached: !!annotated.behaviorHints?.cached,
        isTorrent: isTorrentLikeStream(annotated),
      };
    })
    .sort((a, b) => {
      if (a.viabilityScore !== b.viabilityScore) return b.viabilityScore - a.viabilityScore;
      if (a.isCached !== b.isCached) return a.isCached ? -1 : 1;
      if (a.isTorrent || b.isTorrent) {
        const aSeeders = a.seeders ?? -1;
        const bSeeders = b.seeders ?? -1;
        if (aSeeders !== bSeeders) return bSeeders - aSeeders;
      }
      if (prefersLowerBitrate && a.requiredMbps !== b.requiredMbps) {
        return a.requiredMbps - b.requiredMbps;
      }
      if (!prefersLowerBitrate && a.quality !== b.quality) {
        return b.quality - a.quality;
      }
      if (!prefersLowerBitrate && a.requiredMbps !== b.requiredMbps) {
        return b.requiredMbps - a.requiredMbps;
      }
      if (prefersLowerBitrate && a.quality !== b.quality) {
        return b.quality - a.quality;
      }
      return a.index - b.index;
    })
    .map(item => item.stream);
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
 */
export const getQualityNumeric = (title: string | undefined): number => {
  if (!title) return 0;

  // Check for 4K first (treat as 2160p)
  if (/\b4k\b/i.test(title)) {
    return 2160;
  }

  const matchWithP = title.match(/(\d+)p/i);
  if (matchWithP) return parseInt(matchWithP[1], 10);

  const qualityPatterns = [/\b(240|360|480|720|1080|1440|2160|4320|8000)\b/i];

  for (const pattern of qualityPatterns) {
    const match = title.match(pattern);
    if (match) {
      const quality = parseInt(match[1], 10);
      if (quality >= 240 && quality <= 8000) return quality;
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
