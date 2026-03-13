import { logger } from '../utils/logger';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InnertubeFormat {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  averageBitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  quality?: string;
  qualityLabel?: string;
  audioQuality?: string;
  audioSampleRate?: string;
  initRange?: { start: string; end: string };
  indexRange?: { start: string; end: string };
}

interface PlayerResponse {
  streamingData?: {
    formats?: InnertubeFormat[];
    adaptiveFormats?: InnertubeFormat[];
    hlsManifestUrl?: string;
  };
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
}

interface StreamCandidate {
  client: string;
  priority: number;
  url: string;
  score: number;
  height: number;
  fps: number;
  ext: 'mp4' | 'webm' | 'm4a' | 'other';
  bitrate: number;
  audioSampleRate?: string;
  mimeType: string;
}

interface HlsVariant {
  url: string;
  width: number;
  height: number;
  bandwidth: number;
}

export interface YouTubeExtractionResult {
  /** Primary playable URL — HLS manifest, progressive muxed, or video-only adaptive */
  videoUrl: string;
  /** Separate audio URL when adaptive video-only is used. null for HLS/progressive. */
  audioUrl: string | null;
  quality: string;
  videoId: string;
}

// ---------------------------------------------------------------------------
// Constants — matching the Kotlin extractor exactly
// ---------------------------------------------------------------------------

// Used for all GET requests (watch page, HLS manifest fetch)
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': DEFAULT_USER_AGENT,
};

const REQUEST_TIMEOUT_MS = 6000;        // player API + HLS manifest requests
const WATCH_PAGE_TIMEOUT_MS = 3000;    // watch page scrape — best-effort only
const MAX_RETRIES = 2;                  // retry extraction up to 2 times on total failure

interface ClientDef {
  key: string;
  id: string;
  version: string;
  userAgent: string;
  context: Record<string, any>;
  priority: number;
}

// Matching the Kotlin extractor client list exactly (versions updated to current)
const CLIENTS: ClientDef[] = [
  {
    key: 'android_vr',
    id: '28',
    version: '1.62.27',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.62.27 ' +
      '(Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1) gzip',
    context: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.62.27',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      osName: 'Android',
      osVersion: '12',
      platform: 'MOBILE',
      androidSdkVersion: 32,
      hl: 'en',
      gl: 'US',
    },
    priority: 0,
  },
  {
    key: 'android',
    id: '3',
    version: '20.10.38',
    userAgent:
      'com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip',
    context: {
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      osName: 'Android',
      osVersion: '14',
      platform: 'MOBILE',
      androidSdkVersion: 34,
      hl: 'en',
      gl: 'US',
    },
    priority: 1,
  },
  {
    key: 'ios',
    id: '5',
    version: '20.10.1',
    userAgent:
      'com.google.ios.youtube/20.10.1 (iPhone16,2; U; CPU iOS 17_4 like Mac OS X)',
    context: {
      clientName: 'IOS',
      clientVersion: '20.10.1',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '17.4.0.21E219',
      platform: 'MOBILE',
      hl: 'en',
      gl: 'US',
    },
    priority: 2,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseVideoId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (host.endsWith('youtu.be')) {
      const id = url.pathname.slice(1).split('/')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/\/(embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[2];
  } catch {
    const m = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function getMimeBase(mimeType?: string): string {
  return (mimeType ?? '').split(';')[0].trim();
}

function getCodecs(mimeType?: string): string[] {
  const match = (mimeType ?? '').match(/codecs="([^"]+)"/i);
  if (!match) return [];
  return match[1].split(',').map(codec => codec.trim().toLowerCase()).filter(Boolean);
}

function getExt(mimeType?: string): 'mp4' | 'webm' | 'm4a' | 'other' {
  const base = getMimeBase(mimeType);
  if (base === 'video/mp4' || base === 'audio/mp4') return 'mp4';
  if (base.includes('webm')) return 'webm';
  if (base.includes('m4a')) return 'm4a';
  return 'other';
}

function containerScore(ext: string): number {
  return ext === 'mp4' || ext === 'm4a' ? 0 : ext === 'webm' ? 1 : 2;
}

function videoScore(height: number, fps: number, bitrate: number): number {
  return height * 1_000_000_000 + fps * 1_000_000 + bitrate;
}

function audioScore(bitrate: number, sampleRate: number): number {
  return bitrate * 1_000_000 + sampleRate;
}

function parseQualityLabel(label?: string): number {
  const m = (label ?? '').match(/(\d{2,4})p/);
  return m ? parseInt(m[1], 10) : 0;
}

function summarizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.substring(0, 40)}`;
  } catch {
    return url.substring(0, 80);
  }
}

// ---------------------------------------------------------------------------
// URL validation — HEAD request to check if URL is actually accessible
// ---------------------------------------------------------------------------

async function validateUrl(url: string, userAgent: string): Promise<boolean> {
  // Only validate googlevideo.com CDN URLs — other URLs (HLS manifests) are fine
  if (!url.includes('googlevideo.com')) return true;

  // Check expiry param before making a network request
  try {
    const u = new URL(url);
    const expire = u.searchParams.get('expire');
    if (expire) {
      const expiresAt = parseInt(expire, 10) * 1000;
      if (Date.now() > expiresAt - 30000) {
        logger.warn('YouTubeExtractor', `URL expired or expiring in <30s: expire=${expire}`);
        return false;
      }
    }
  } catch { /* ignore URL parse errors */ }

  // Quick HEAD request to confirm URL is accessible
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 403 || res.status === 401) {
      logger.warn('YouTubeExtractor', `URL validation failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    clearTimeout(timer);
    // Network error or timeout — assume valid and let the player try
    logger.warn('YouTubeExtractor', `URL validation request failed (assuming valid):`, err);
    return true;
  }
}

function sortCandidates(items: StreamCandidate[]): StreamCandidate[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ca = containerScore(a.ext), cb = containerScore(b.ext);
    if (ca !== cb) return ca - cb;
    return a.priority - b.priority;
  });
}

async function findBestValidatedCandidate(
  items: StreamCandidate[],
  userAgent: string,
  label: string,
): Promise<StreamCandidate | null> {
  for (const candidate of sortCandidates(items)) {
    const valid = await validateUrl(candidate.url, userAgent);
    if (valid) return candidate;
    logger.warn('YouTubeExtractor', `${label} URL invalid, trying next candidate`);
  }
  return null;
}

function getHlsQualityScore(variant: HlsVariant): number {
  return variant.height * 1_000_000_000 + variant.bandwidth;
}

function isIosCompatibleSeparateVideo(candidate: StreamCandidate): boolean {
  if (getMimeBase(candidate.mimeType) !== 'video/mp4') return false;
  const codecs = getCodecs(candidate.mimeType);
  if (codecs.length === 0) return true;
  return codecs.some(codec =>
    codec.startsWith('avc1') ||
    codec.startsWith('hvc1') ||
    codec.startsWith('hev1'),
  );
}

function isIosCompatibleSeparateAudio(candidate: StreamCandidate): boolean {
  if (getMimeBase(candidate.mimeType) !== 'audio/mp4') return false;
  const codecs = getCodecs(candidate.mimeType);
  if (codecs.length === 0) return true;
  return codecs.some(codec => codec.startsWith('mp4a'));
}

// ---------------------------------------------------------------------------
// Watch page — extract API key + visitor data dynamically
// ---------------------------------------------------------------------------

interface WatchConfig {
  apiKey: string | null;
  visitorData: string | null;
}

async function fetchWatchConfig(videoId: string): Promise<WatchConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WATCH_PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.youtube.com/watch?v=${videoId}&hl=en`,
      { headers: DEFAULT_HEADERS, signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn('YouTubeExtractor', `Watch page ${res.status}`);
      return { apiKey: null, visitorData: null };
    }
    const html = await res.text();
    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? null;
    const visitorData = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1] ?? null;
    logger.info('YouTubeExtractor', `Watch page: apiKey=${apiKey ? 'found' : 'missing'} visitorData=${visitorData ? 'found' : 'missing'}`);
    return { apiKey, visitorData };
  } catch (err) {
    clearTimeout(timer);
    logger.warn('YouTubeExtractor', 'Watch page error:', err);
    return { apiKey: null, visitorData: null };
  }
}

// ---------------------------------------------------------------------------
// Player API
// ---------------------------------------------------------------------------

async function fetchPlayerResponse(
  videoId: string,
  client: ClientDef,
  apiKey: string | null,
  visitorData: string | null,
): Promise<PlayerResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const endpoint = apiKey
    ? `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`
    : `https://www.youtube.com/youtubei/v1/player?prettyPrint=false`;

  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    'content-type': 'application/json',
    'origin': 'https://www.youtube.com',
    'referer': `https://www.youtube.com/watch?v=${videoId}`,
    'x-youtube-client-name': client.id,
    'x-youtube-client-version': client.version,
    'user-agent': client.userAgent,
  };
  if (visitorData) headers['x-goog-visitor-id'] = visitorData;

  const body = JSON.stringify({
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: { client: client.context },
    playbackContext: {
      contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' },
    },
  });

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn('YouTubeExtractor', `[${client.key}] HTTP ${res.status}`);
      return null;
    }
    return await res.json() as PlayerResponse;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('YouTubeExtractor', `[${client.key}] Timed out`);
    } else {
      logger.warn('YouTubeExtractor', `[${client.key}] Error:`, err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// HLS manifest parsing
// ---------------------------------------------------------------------------

async function parseBestHlsVariant(manifestUrl: string): Promise<HlsVariant | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(manifestUrl, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    let best: HlsVariant | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
      const nextLine = lines[i + 1];
      if (!nextLine || nextLine.startsWith('#')) continue;

      // Parse attribute list
      const attrs: Record<string, string> = {};
      let key = '', val = '', inKey = true, inQuote = false;
      for (const ch of line.substring(line.indexOf(':') + 1)) {
        if (inKey) { if (ch === '=') inKey = false; else key += ch; continue; }
        if (ch === '"') { inQuote = !inQuote; continue; }
        if (ch === ',' && !inQuote) {
          if (key.trim()) attrs[key.trim()] = val.trim();
          key = ''; val = ''; inKey = true; continue;
        }
        val += ch;
      }
      if (key.trim()) attrs[key.trim()] = val.trim();

      const res2 = (attrs['RESOLUTION'] ?? '').split('x');
      const width = parseInt(res2[0] ?? '0', 10) || 0;
      const height = parseInt(res2[1] ?? '0', 10) || 0;
      const bandwidth = parseInt(attrs['BANDWIDTH'] ?? '0', 10) || 0;

      let variantUrl = nextLine;
      if (!variantUrl.startsWith('http')) {
        try { variantUrl = new URL(variantUrl, manifestUrl).toString(); } catch { /* keep */ }
      }

      const candidate: HlsVariant = { url: variantUrl, width, height, bandwidth };
      if (
        !best ||
        candidate.height > best.height ||
        (candidate.height === best.height && candidate.bandwidth > best.bandwidth)
      ) {
        best = candidate;
      }
    }
    return best;
  } catch (err) {
    clearTimeout(timer);
    logger.warn('YouTubeExtractor', 'HLS manifest parse error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Format collection — tries ALL clients, collects from all (matching Kotlin)
// ---------------------------------------------------------------------------

interface CollectedFormats {
  progressive: StreamCandidate[];
  adaptiveVideo: StreamCandidate[];
  adaptiveAudio: StreamCandidate[];
  hlsManifests: Array<{ clientKey: string; priority: number; url: string }>;
}

async function collectAllFormats(
  videoId: string,
  apiKey: string | null,
  visitorData: string | null,
): Promise<CollectedFormats> {
  const progressive: StreamCandidate[] = [];
  const adaptiveVideo: StreamCandidate[] = [];
  const adaptiveAudio: StreamCandidate[] = [];
  const hlsManifests: Array<{ clientKey: string; priority: number; url: string }> = [];

  // Fire all client requests in parallel — same approach as Kotlin coroutines
  const results = await Promise.allSettled(
    CLIENTS.map(client => fetchPlayerResponse(videoId, client, apiKey, visitorData)
      .then(resp => ({ client, resp }))
    )
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn('YouTubeExtractor', `Client request rejected:`, result.reason);
      continue;
    }

    const { client, resp } = result.value;
    if (!resp) continue;

    const status = resp.playabilityStatus?.status;
    if (status && status !== 'OK' && status !== 'CONTENT_CHECK_REQUIRED') {
      logger.warn('YouTubeExtractor', `[${client.key}] status=${status} reason=${resp.playabilityStatus?.reason ?? ''}`);
      continue;
    }

    const sd = resp.streamingData;
    if (!sd) continue;

    if (sd.hlsManifestUrl) {
      hlsManifests.push({ clientKey: client.key, priority: client.priority, url: sd.hlsManifestUrl });
    }

    let nProg = 0, nVid = 0, nAud = 0;

    // Progressive (muxed) formats — matching Kotlin: skip non-video mimeTypes
    for (const f of (sd.formats ?? [])) {
      if (!f.url) continue;
      const mimeBase = getMimeBase(f.mimeType);
      if (f.mimeType && !mimeBase.startsWith('video/')) continue;
      const height = f.height ?? parseQualityLabel(f.qualityLabel);
      const fps = f.fps ?? 0;
      const bitrate = f.bitrate ?? f.averageBitrate ?? 0;
      progressive.push({
        client: client.key,
        priority: client.priority,
        url: f.url,
        score: videoScore(height, fps, bitrate),
        height,
        fps,
        ext: getExt(f.mimeType),
        bitrate,
        mimeType: f.mimeType ?? '',
      });
      nProg++;
    }

    // Adaptive formats
    for (const f of (sd.adaptiveFormats ?? [])) {
      if (!f.url) continue;
      const mimeBase = getMimeBase(f.mimeType);

      if (mimeBase.startsWith('video/')) {
        const height = f.height ?? parseQualityLabel(f.qualityLabel);
        const fps = f.fps ?? 0;
        const bitrate = f.bitrate ?? f.averageBitrate ?? 0;
        adaptiveVideo.push({
          client: client.key,
          priority: client.priority,
          url: f.url,
          score: videoScore(height, fps, bitrate),
          height,
          fps,
          ext: getExt(f.mimeType),
          bitrate,
          mimeType: f.mimeType ?? '',
        });
        nVid++;
      } else if (mimeBase.startsWith('audio/')) {
        const bitrate = f.bitrate ?? f.averageBitrate ?? 0;
        const sampleRate = parseFloat(f.audioSampleRate ?? '0') || 0;
        adaptiveAudio.push({
          client: client.key,
          priority: client.priority,
          url: f.url,
          score: audioScore(bitrate, sampleRate),
          height: 0,
          fps: 0,
          ext: getExt(f.mimeType),
          bitrate,
          audioSampleRate: f.audioSampleRate,
          mimeType: f.mimeType ?? '',
        });
        nAud++;
      }
    }

    logger.info('YouTubeExtractor', `[${client.key}] progressive=${nProg} video=${nVid} audio=${nAud} hls=${sd.hlsManifestUrl ? 1 : 0}`);
  }

  return { progressive, adaptiveVideo, adaptiveAudio, hlsManifests };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class YouTubeExtractor {
  /**
   * Extract a playable source from a YouTube video ID or URL.
   *
   * Matches the Kotlin InAppYouTubeExtractor approach:
   * 1. Fetch watch page for dynamic API key + visitor data
   * 2. Try ALL clients, collect formats from all that succeed
   * 3. Prefer separate adaptive video+audio when available
   * 4. Fall back to HLS/progressive muxed sources
   */
  static async extract(
    videoIdOrUrl: string,
    platform?: 'android' | 'ios',
  ): Promise<YouTubeExtractionResult | null> {
    const videoId = parseVideoId(videoIdOrUrl);
    if (!videoId) {
      logger.warn('YouTubeExtractor', `Could not parse video ID: ${videoIdOrUrl}`);
      return null;
    }

    const effectivePlatform = platform ?? (Platform.OS === 'android' ? 'android' : 'ios');

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      if (attempt > 1) {
        const delay = attempt * 300;
        logger.info('YouTubeExtractor', `Retry attempt ${attempt}/${MAX_RETRIES + 1} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      const result = await this.extractOnce(videoId, effectivePlatform);
      if (result) return result;
      logger.warn('YouTubeExtractor', `Attempt ${attempt} failed for videoId=${videoId}`);
    }

    logger.warn('YouTubeExtractor', `All ${MAX_RETRIES + 1} attempts failed for videoId=${videoId}`);
    return null;
  }

  private static async extractOnce(
    videoId: string,
    effectivePlatform: 'android' | 'ios',
  ): Promise<YouTubeExtractionResult | null> {
    logger.info('YouTubeExtractor', `Extracting videoId=${videoId} platform=${effectivePlatform}`);

    const { apiKey, visitorData } = await fetchWatchConfig(videoId);

    // Step 2: collect formats from all clients
    const { progressive, adaptiveVideo, adaptiveAudio, hlsManifests } =
      await collectAllFormats(videoId, apiKey, visitorData);

    logger.info('YouTubeExtractor',
      `Totals: progressive=${progressive.length} adaptiveVideo=${adaptiveVideo.length} ` +
      `adaptiveAudio=${adaptiveAudio.length} hls=${hlsManifests.length}`
    );

    if (progressive.length === 0 && adaptiveVideo.length === 0 && hlsManifests.length === 0) {
      logger.warn('YouTubeExtractor', `No usable formats for videoId=${videoId}`);
      return null;
    }

    // Step 3: pick best HLS variant across all manifests
    let bestHls: (HlsVariant & { manifestUrl: string }) | null = null;
    for (const { url } of hlsManifests.sort((a, b) => a.priority - b.priority)) {
      const variant = await parseBestHlsVariant(url);
      if (
        variant &&
        (!bestHls ||
          variant.height > bestHls.height ||
          (variant.height === bestHls.height && variant.bandwidth > bestHls.bandwidth))
      ) {
        bestHls = { ...variant, manifestUrl: url };
      }
    }

    const progressiveCandidates = sortCandidates(progressive);
    const adaptiveVideoCandidates = sortCandidates(adaptiveVideo);
    const adaptiveAudioCandidates = sortCandidates(adaptiveAudio);
    const compatibleAdaptiveVideoCandidates =
      effectivePlatform === 'ios'
        ? adaptiveVideoCandidates.filter(isIosCompatibleSeparateVideo)
        : adaptiveVideoCandidates;
    const compatibleAdaptiveAudioCandidates =
      effectivePlatform === 'ios'
        ? adaptiveAudioCandidates.filter(isIosCompatibleSeparateAudio)
        : adaptiveAudioCandidates;

    if (bestHls) logger.info('YouTubeExtractor', `Best HLS: ${bestHls.height}p ${bestHls.bandwidth}bps`);
    if (progressiveCandidates[0]) logger.info('YouTubeExtractor', `Best progressive: ${progressiveCandidates[0].height}p client=${progressiveCandidates[0].client}`);
    if (adaptiveVideoCandidates[0]) logger.info('YouTubeExtractor', `Best adaptive video: ${adaptiveVideoCandidates[0].height}p client=${adaptiveVideoCandidates[0].client}`);
    if (adaptiveAudioCandidates[0]) logger.info('YouTubeExtractor', `Best adaptive audio: ${adaptiveAudioCandidates[0].bitrate}bps client=${adaptiveAudioCandidates[0].client}`);
    if (effectivePlatform === 'ios') {
      if (compatibleAdaptiveVideoCandidates[0]) {
        logger.info(
          'YouTubeExtractor',
          `Best iOS-compatible adaptive video: ${compatibleAdaptiveVideoCandidates[0].height}p client=${compatibleAdaptiveVideoCandidates[0].client} mime=${compatibleAdaptiveVideoCandidates[0].mimeType}`
        );
      }
      if (compatibleAdaptiveAudioCandidates[0]) {
        logger.info(
          'YouTubeExtractor',
          `Best iOS-compatible adaptive audio: ${compatibleAdaptiveAudioCandidates[0].bitrate}bps client=${compatibleAdaptiveAudioCandidates[0].client} mime=${compatibleAdaptiveAudioCandidates[0].mimeType}`
        );
      }
    }

    // VR client user agent used for CDN URL validation
    const vrUserAgent = CLIENTS.find(c => c.key === 'android_vr')!.userAgent;

    // Step 4: validate the best candidates per source type, then pick the
    // highest-quality playable result.
    const validatedAdaptiveVideo = await findBestValidatedCandidate(
      compatibleAdaptiveVideoCandidates,
      vrUserAgent,
      'Adaptive video',
    );
    const validatedAdaptiveAudio = await findBestValidatedCandidate(
      compatibleAdaptiveAudioCandidates,
      vrUserAgent,
      'Adaptive audio',
    );
    const validatedProgressive = await findBestValidatedCandidate(
      progressiveCandidates,
      vrUserAgent,
      'Progressive',
    );

    const adaptivePlayback =
      validatedAdaptiveVideo && validatedAdaptiveAudio
        ? {
            type: 'adaptive' as const,
            videoUrl: validatedAdaptiveVideo.url,
            audioUrl: validatedAdaptiveAudio.url,
            quality: `${validatedAdaptiveVideo.height}p`,
            score: validatedAdaptiveVideo.score,
            height: validatedAdaptiveVideo.height,
            audioBitrate: validatedAdaptiveAudio.bitrate,
            videoClient: validatedAdaptiveVideo.client,
            videoMimeType: validatedAdaptiveVideo.mimeType,
            videoExt: validatedAdaptiveVideo.ext,
            audioClient: validatedAdaptiveAudio.client,
            audioMimeType: validatedAdaptiveAudio.mimeType,
            audioExt: validatedAdaptiveAudio.ext,
          }
        : null;

    const progressivePlayback = validatedProgressive
      ? {
          type: 'progressive' as const,
          videoUrl: validatedProgressive.url,
          audioUrl: null,
          quality: `${validatedProgressive.height}p`,
          score: validatedProgressive.score,
          height: validatedProgressive.height,
        }
      : null;

    const hlsPlayback = bestHls
      ? {
          type: 'hls' as const,
          videoUrl: bestHls.manifestUrl,
          audioUrl: null,
          quality: `${bestHls.height}p`,
          score: getHlsQualityScore(bestHls),
          height: bestHls.height,
          bandwidth: bestHls.bandwidth,
        }
      : null;

    const bestPlayable = [adaptivePlayback, progressivePlayback, hlsPlayback]
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((a, b) => b.score - a.score)[0] ?? null;

    if (bestPlayable) {
      if (bestPlayable.type === 'adaptive') {
        logger.info(
          'YouTubeExtractor',
          `Using separate adaptive streams: video=${bestPlayable.height}p ` +
          `videoClient=${bestPlayable.videoClient} videoMime=${bestPlayable.videoMimeType} videoExt=${bestPlayable.videoExt} ` +
          `audio=${bestPlayable.audioBitrate}bps audioClient=${bestPlayable.audioClient} ` +
          `audioMime=${bestPlayable.audioMimeType} audioExt=${bestPlayable.audioExt}`
        );
      } else if (bestPlayable.type === 'progressive') {
        logger.info(
          'YouTubeExtractor',
          `Using progressive: ${summarizeUrl(bestPlayable.videoUrl)} ${bestPlayable.height}p`
        );
      } else {
        logger.info(
          'YouTubeExtractor',
          `Using HLS manifest: ${summarizeUrl(bestPlayable.videoUrl)} ${bestPlayable.height}p`
        );
      }
      return {
        videoUrl: bestPlayable.videoUrl,
        audioUrl: bestPlayable.audioUrl,
        quality: bestPlayable.quality,
        videoId,
      };
    }

    if (validatedAdaptiveVideo) {
      logger.warn('YouTubeExtractor', `Using video-only adaptive fallback (no audio): ${validatedAdaptiveVideo.height}p`);
      return {
        videoUrl: validatedAdaptiveVideo.url,
        audioUrl: null,
        quality: `${validatedAdaptiveVideo.height}p`,
        videoId,
      };
    }

    logger.warn('YouTubeExtractor', `No playable source for videoId=${videoId}`);
    return null;
  }

  static async getBestStreamUrl(
    videoIdOrUrl: string,
    platform?: 'android' | 'ios',
  ): Promise<string | null> {
    const result = await this.extract(videoIdOrUrl, platform);
    return result?.videoUrl ?? null;
  }

  static parseVideoId(input: string): string | null {
    return parseVideoId(input);
  }
}

export default YouTubeExtractor;
