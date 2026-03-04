import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InnertubeFormat {
  itag: number;
  url?: string;
  signatureCipher?: string;
  mimeType: string;
  bitrate: number;
  width?: number;
  height?: number;
  contentLength?: string;
  quality: string;
  qualityLabel?: string;
  audioQuality?: string;
  audioSampleRate?: string;
  audioChannels?: number;
  approxDurationMs?: string;
  lastModified?: string;
  projectionType?: string;
  initRange?: { start: string; end: string };
  indexRange?: { start: string; end: string };
}

interface InnertubeStreamingData {
  formats: InnertubeFormat[];
  adaptiveFormats: InnertubeFormat[];
  expiresInSeconds?: string;
}

interface InnertubePlayerResponse {
  streamingData?: InnertubeStreamingData;
  videoDetails?: {
    videoId: string;
    title: string;
    lengthSeconds: string;
    isLive?: boolean;
    isLiveDvr?: boolean;
  };
  playabilityStatus?: {
    status: string;
    reason?: string;
  };
}

export interface ExtractedStream {
  url: string;
  quality: string;        // e.g. "720p", "480p"
  mimeType: string;       // e.g. "video/mp4"
  itag: number;
  hasAudio: boolean;
  hasVideo: boolean;
  bitrate: number;
}

export interface YouTubeExtractionResult {
  streams: ExtractedStream[];
  bestStream: ExtractedStream | null;
  videoId: string;
  title?: string;
  durationSeconds?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Innertube client configs — we use Android (no cipher, direct URLs)
// and web as fallback (may need cipher decode)
// Note: ?key= param was deprecated by YouTube in mid-2023 and is no longer sent.
const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player';

// Android client gives direct URLs without cipher obfuscation
const ANDROID_CLIENT_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: '19.44.41',
    androidSdkVersion: 30,
    userAgent:
      'com.google.android.youtube/19.44.41 (Linux; U; Android 11) gzip',
    hl: 'en',
    gl: 'US',
  },
};

// iOS client as secondary fallback
const IOS_CLIENT_CONTEXT = {
  client: {
    clientName: 'IOS',
    clientVersion: '19.45.4',
    deviceModel: 'iPhone16,2',
    userAgent:
      'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
    hl: 'en',
    gl: 'US',
  },
};

// TV Embedded client — works for age-restricted / embed-allowed content
const TVHTML5_EMBEDDED_CONTEXT = {
  client: {
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '2.0',
    hl: 'en',
    gl: 'US',
  },
};

// Web Embedded client — good fallback for content that rejects app clients
const WEB_EMBEDDED_CONTEXT = {
  client: {
    clientName: 'WEB_EMBEDDED_PLAYER',
    clientVersion: '2.20240726.00.00',
    hl: 'en',
    gl: 'US',
  },
  thirdParty: {
    embedUrl: 'https://www.youtube.com',
  },
};

// ---------------------------------------------------------------------------
// Itag reference tables
// ---------------------------------------------------------------------------

// Muxed (video+audio in one file).
// iOS AVPlayer can ONLY use these. Max quality YouTube provides is 720p (itag 22),
// but it is often absent on modern videos, leaving 360p (itag 18) as the fallback.
const PREFERRED_MUXED_ITAGS = [
  22,   // 720p MP4 (video+audio)
  18,   // 360p MP4 (video+audio)
  59,   // 480p MP4 (video+audio) — rare
  78,   // 480p MP4 (video+audio) — rare
];

// Adaptive video-only itags, best quality first (MP4 preferred over WebM).
// Used for DASH on Android only.
const ADAPTIVE_VIDEO_ITAGS_RANKED = [
  137,  // 1080p MP4 video-only
  248,  // 1080p WebM video-only
  136,  // 720p MP4 video-only
  247,  // 720p WebM video-only
  135,  // 480p MP4 video-only
  244,  // 480p WebM video-only
  134,  // 360p MP4 video-only
  243,  // 360p WebM video-only
];

// Adaptive audio-only itags, best quality first (AAC preferred over Opus).
// Used for DASH on Android only.
const ADAPTIVE_AUDIO_ITAGS_RANKED = [
  141,  // 256kbps AAC
  140,  // 128kbps AAC  ← most common
  251,  // 160kbps Opus
  250,  // 70kbps Opus
  249,  // 50kbps Opus
];

const REQUEST_TIMEOUT_MS = 12000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractVideoId(input: string): string | null {
  if (!input) return null;

  // Already a bare video ID (11 chars, alphanumeric + _ -)
  if (/^[A-Za-z0-9_-]{11}$/.test(input.trim())) {
    return input.trim();
  }

  try {
    const url = new URL(input);

    // youtu.be/VIDEO_ID
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }

    // youtube.com/watch?v=VIDEO_ID
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

    // youtube.com/embed/VIDEO_ID or /shorts/VIDEO_ID
    const pathMatch = url.pathname.match(/\/(embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (pathMatch) return pathMatch[2];
  } catch {
    // Not a valid URL — try regex fallback
    const match = input.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (match) return match[1];
  }

  return null;
}

function parseMimeType(mimeType: string): { container: string; codecs: string } {
  // e.g. 'video/mp4; codecs="avc1.64001F, mp4a.40.2"'
  const [base, codecsPart] = mimeType.split(';');
  const container = base.trim();
  const codecs = codecsPart ? codecsPart.replace(/codecs=["']?/i, '').replace(/["']$/, '').trim() : '';
  return { container, codecs };
}

function isMuxedFormat(format: InnertubeFormat): boolean {
  // A muxed format has both video and audio codecs in its mimeType
  const { codecs } = parseMimeType(format.mimeType);
  // MP4 muxed: "avc1.xxx, mp4a.xxx"
  // WebM muxed: "vp8, vorbis" etc.
  return codecs.includes(',') || (!!format.audioQuality && !!format.qualityLabel);
}

function isVideoMp4(format: InnertubeFormat): boolean {
  return format.mimeType.startsWith('video/mp4');
}

function formatQualityLabel(format: InnertubeFormat): string {
  return format.qualityLabel || format.quality || 'unknown';
}

function scoreFormat(format: InnertubeFormat): number {
  const preferredIndex = PREFERRED_MUXED_ITAGS.indexOf(format.itag);
  const itagBonus = preferredIndex !== -1 ? (PREFERRED_MUXED_ITAGS.length - preferredIndex) * 10000 : 0;
  const height = format.height ?? 0;
  const heightScore = Math.min(height, 720) * 10;
  const bitrateScore = Math.min(format.bitrate ?? 0, 3_000_000) / 1000;
  return itagBonus + heightScore + bitrateScore;
}

// ---------------------------------------------------------------------------
// Adaptive stream helpers (Android/DASH only)
// ---------------------------------------------------------------------------

function pickBestAdaptiveVideo(adaptiveFormats: InnertubeFormat[]): InnertubeFormat | null {
  // Video-only: has qualityLabel, no audioQuality, has direct URL
  const videoOnly = adaptiveFormats.filter(
    (f) => f.url && f.qualityLabel && !f.audioQuality && f.mimeType.startsWith('video/')
  );
  if (videoOnly.length === 0) return null;
  for (const itag of ADAPTIVE_VIDEO_ITAGS_RANKED) {
    const match = videoOnly.find((f) => f.itag === itag);
    if (match) return match;
  }
  return videoOnly.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? null;
}

function pickBestAdaptiveAudio(adaptiveFormats: InnertubeFormat[]): InnertubeFormat | null {
  // Audio-only: has audioQuality, no qualityLabel, has direct URL
  const audioOnly = adaptiveFormats.filter(
    (f) => f.url && f.audioQuality && !f.qualityLabel && f.mimeType.startsWith('audio/')
  );
  if (audioOnly.length === 0) return null;
  for (const itag of ADAPTIVE_AUDIO_ITAGS_RANKED) {
    const match = audioOnly.find((f) => f.itag === itag);
    if (match) return match;
  }
  return audioOnly.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? null;
}

/**
 * Write a DASH MPD manifest to a temp file and return its file:// URI.
 *
 * We use a file URI rather than a data: URI because:
 * - ExoPlayer's DefaultDataSource handles file:// URIs natively via FileDataSource.
 * - The .mpd file extension lets ExoPlayer auto-detect the type even without an
 *   explicit 'type' hint — meaning TrailerModal's bare <Video> also works correctly.
 * - Avoids the need for a Buffer/btoa polyfill (not guaranteed in Hermes).
 *
 * Uses expo-file-system which is already in the project's dependencies.
 * Returns null if writing fails.
 */
async function writeDashManifestToFile(
  videoFormat: InnertubeFormat,
  audioFormat: InnertubeFormat,
  videoId: string,
  durationSeconds?: number
): Promise<string | null> {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) return null;

    const duration = durationSeconds ?? 300;
    const mediaDurationISO = `PT${duration}S`;

    const videoCodec = parseMimeType(videoFormat.mimeType).codecs.replace(/"/g, '').trim();
    const audioCodec = parseMimeType(audioFormat.mimeType).codecs.replace(/"/g, '').trim();
    const videoMime = videoFormat.mimeType.split(';')[0].trim();
    const audioMime = audioFormat.mimeType.split(';')[0].trim();

    const width = videoFormat.width ?? 1920;
    const height = videoFormat.height ?? 1080;
    const videoBandwidth = videoFormat.bitrate ?? 2_000_000;
    const audioBandwidth = audioFormat.bitrate ?? 128_000;
    const audioSampleRate = audioFormat.audioSampleRate ?? '44100';

    const escapeXml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const videoUrl = escapeXml(videoFormat.url!);
    const audioUrl = escapeXml(audioFormat.url!);

    // Use proper initRange/indexRange if available (YouTube adaptive streams have these)
    // Without correct ranges ExoPlayer's DashMediaSource cannot parse the segment index.
    // Fall back to range "0-0" only as last resort — ExoPlayer will attempt a range request.
    const vInit = videoFormat.initRange
      ? `${videoFormat.initRange.start}-${videoFormat.initRange.end}`
      : '0-0';
    const vIndex = videoFormat.indexRange
      ? `${videoFormat.indexRange.start}-${videoFormat.indexRange.end}`
      : '0-0';
    const aInit = audioFormat.initRange
      ? `${audioFormat.initRange.start}-${audioFormat.initRange.end}`
      : '0-0';
    const aIndex = audioFormat.indexRange
      ? `${audioFormat.indexRange.start}-${audioFormat.indexRange.end}`
      : '0-0';

    const mpd = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="${mediaDurationISO}" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
  <Period duration="${mediaDurationISO}">
    <AdaptationSet id="1" mimeType="${videoMime}" codecs="${videoCodec}" width="${width}" height="${height}" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <Representation id="v1" bandwidth="${videoBandwidth}" width="${width}" height="${height}">
        <BaseURL>${videoUrl}</BaseURL>
        <SegmentBase indexRange="${vIndex}">
          <Initialization range="${vInit}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    <AdaptationSet id="2" mimeType="${audioMime}" codecs="${audioCodec}" lang="en" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <Representation id="a1" bandwidth="${audioBandwidth}" audioSamplingRate="${audioSampleRate}">
        <BaseURL>${audioUrl}</BaseURL>
        <SegmentBase indexRange="${aIndex}">
          <Initialization range="${aInit}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    const filePath = `${cacheDir}trailer_${videoId}.mpd`;
    await FileSystem.writeAsStringAsync(filePath, mpd, { encoding: FileSystem.EncodingType.UTF8 });
    logger.info('YouTubeExtractor', `DASH manifest written: ${filePath}`);
    return filePath;
  } catch (err) {
    logger.warn('YouTubeExtractor', 'writeDashManifestToFile failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core extractor
// ---------------------------------------------------------------------------

async function fetchPlayerResponse(
  videoId: string,
  context: object,
  userAgent: string,
  clientNameId: string = '3'
): Promise<InnertubePlayerResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = {
      videoId,
      context,
      contentCheckOk: true,
      racyCheckOk: true,
    };

    const response = await fetch(
      `${INNERTUBE_URL}?prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'X-YouTube-Client-Name': clientNameId,
          'Origin': 'https://www.youtube.com',
          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    clearTimeout(timer);

    if (!response.ok) {
      logger.warn('YouTubeExtractor', `Innertube HTTP ${response.status} for videoId=${videoId}`);
      return null;
    }

    const data: InnertubePlayerResponse = await response.json();
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('YouTubeExtractor', `Request timed out for videoId=${videoId}`);
    } else {
      logger.warn('YouTubeExtractor', `Fetch error for videoId=${videoId}:`, err);
    }
    return null;
  }
}

function parseMuxedFormats(playerResponse: InnertubePlayerResponse): InnertubeFormat[] {
  const sd = playerResponse.streamingData;
  if (!sd) return [];
  const formats: InnertubeFormat[] = [];
  for (const f of sd.formats ?? []) {
    if (f.url) formats.push(f);
  }
  // Edge case: some adaptive formats are muxed
  for (const f of sd.adaptiveFormats ?? []) {
    if (f.url && isMuxedFormat(f)) formats.push(f);
  }
  return formats;
}

function parseAdaptiveFormats(playerResponse: InnertubePlayerResponse): InnertubeFormat[] {
  const sd = playerResponse.streamingData;
  if (!sd) return [];
  return (sd.adaptiveFormats ?? []).filter((f) => !!f.url);
}

function pickBestMuxedStream(
  muxedFormats: InnertubeFormat[],
  adaptiveFormats: InnertubeFormat[] = []
): ExtractedStream | null {
  // Prefer proper muxed streams (have both video and audio)
  if (muxedFormats.length > 0) {
    const mp4Formats = muxedFormats.filter(isVideoMp4);
    const pool = mp4Formats.length > 0 ? mp4Formats : muxedFormats;
    const sorted = [...pool].sort((a, b) => scoreFormat(b) - scoreFormat(a));
    const best = sorted[0];
    return {
      url: best.url!,
      quality: formatQualityLabel(best),
      mimeType: best.mimeType,
      itag: best.itag,
      hasAudio: !!best.audioQuality || isMuxedFormat(best),
      hasVideo: !!best.qualityLabel || best.mimeType.startsWith('video/'),
      bitrate: best.bitrate ?? 0,
    };
  }

  // Last resort: if there are no muxed formats at all, use the best video-only
  // adaptive stream (will have no audio, but at least something plays vs nothing)
  if (adaptiveFormats.length > 0) {
    const videoAdaptive = adaptiveFormats.filter(
      (f) => f.url && f.qualityLabel && f.mimeType.startsWith('video/')
    );
    if (videoAdaptive.length > 0) {
      const sorted = [...videoAdaptive].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      const best = sorted[0];
      logger.warn('YouTubeExtractor', `No muxed streams — using video-only adaptive itag=${best.itag} (no audio)`);
      return {
        url: best.url!,
        quality: formatQualityLabel(best),
        mimeType: best.mimeType,
        itag: best.itag,
        hasAudio: false,
        hasVideo: true,
        bitrate: best.bitrate ?? 0,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class YouTubeExtractor {
  /**
   * Extract a playable stream URL from a YouTube video ID or URL.
   *
   * On Android: attempts to build a DASH manifest from high-quality adaptive
   * streams (up to 1080p) written to a temp .mpd file. Falls back to best
   * muxed stream (max 720p) if adaptive streams are unavailable or file write fails.
   *
   * On iOS: always returns the best muxed stream. AVPlayer has no DASH support.
   */
  static async extract(
    videoIdOrUrl: string,
    platform?: 'android' | 'ios'
  ): Promise<YouTubeExtractionResult | null> {
    const videoId = extractVideoId(videoIdOrUrl);
    if (!videoId) {
      logger.warn('YouTubeExtractor', `Could not parse video ID from: ${videoIdOrUrl}`);
      return null;
    }

    logger.info('YouTubeExtractor', `Extracting for videoId=${videoId} platform=${platform ?? 'unknown'}`);

    const clients: Array<{ context: object; userAgent: string; name: string; clientNameId: string }> = [
      {
        name: 'ANDROID',
        clientNameId: '3',
        context: ANDROID_CLIENT_CONTEXT,
        userAgent: 'com.google.android.youtube/19.44.41 (Linux; U; Android 11) gzip',
      },
      {
        name: 'IOS',
        clientNameId: '5',
        context: IOS_CLIENT_CONTEXT,
        userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
      },
      {
        name: 'TVHTML5_EMBEDDED',
        clientNameId: '85',
        context: TVHTML5_EMBEDDED_CONTEXT,
        userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0)',
      },
      {
        name: 'WEB_EMBEDDED',
        clientNameId: '56',
        context: WEB_EMBEDDED_CONTEXT,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      },
    ];

    let muxedFormats: InnertubeFormat[] = [];
    let adaptiveFormats: InnertubeFormat[] = [];
    let playerResponse: InnertubePlayerResponse | null = null;

    for (const client of clients) {
      logger.info('YouTubeExtractor', `Trying ${client.name} client...`);
      const resp = await fetchPlayerResponse(videoId, client.context, client.userAgent, client.clientNameId);
      if (!resp) continue;

      const status = resp.playabilityStatus?.status;
      if (status === 'UNPLAYABLE' || status === 'LOGIN_REQUIRED') {
        logger.warn('YouTubeExtractor', `${client.name}: playabilityStatus=${status}`);
        continue;
      }

      const muxed = parseMuxedFormats(resp);
      const adaptive = parseAdaptiveFormats(resp);

      if (muxed.length > 0 || adaptive.length > 0) {
        logger.info('YouTubeExtractor', `${client.name}: ${muxed.length} muxed, ${adaptive.length} adaptive`);
        muxedFormats = muxed;
        adaptiveFormats = adaptive;
        playerResponse = resp;
        break;
      }

      logger.warn('YouTubeExtractor', `${client.name} returned no usable formats`);
    }

    if (muxedFormats.length === 0 && adaptiveFormats.length === 0) {
      logger.warn('YouTubeExtractor', `All clients failed for videoId=${videoId}`);
      return null;
    }

    const details = playerResponse?.videoDetails;
    const durationSeconds = details?.lengthSeconds ? parseInt(details.lengthSeconds, 10) : undefined;

    let bestStream: ExtractedStream | null = null;

    // Android: try DASH via temp .mpd file (works in TrailerPlayer AND TrailerModal)
    if (platform === 'android' && adaptiveFormats.length > 0) {
      const bestVideo = pickBestAdaptiveVideo(adaptiveFormats);
      const bestAudio = pickBestAdaptiveAudio(adaptiveFormats);

      if (bestVideo && bestAudio) {
        const mpdFilePath = await writeDashManifestToFile(bestVideo, bestAudio, videoId, durationSeconds);
        if (mpdFilePath) {
          logger.info(
            'YouTubeExtractor',
            `DASH: video=${bestVideo.itag} (${formatQualityLabel(bestVideo)}), audio=${bestAudio.itag}`
          );
          bestStream = {
            url: mpdFilePath,        // file:// path, .mpd extension → ExoPlayer auto-detects DASH
            quality: formatQualityLabel(bestVideo),
            mimeType: 'application/dash+xml',
            itag: bestVideo.itag,
            hasAudio: true,
            hasVideo: true,
            bitrate: (bestVideo.bitrate ?? 0) + (bestAudio.bitrate ?? 0),
          };
        } else {
          logger.warn('YouTubeExtractor', 'DASH file write failed — falling back to muxed');
        }
      } else {
        logger.info(
          'YouTubeExtractor',
          `No adaptive pair: video=${bestVideo?.itag ?? 'none'}, audio=${bestAudio?.itag ?? 'none'} — falling back to muxed`
        );
      }
    }

    // iOS or DASH fallback: use best muxed stream (or video-only adaptive as last resort)
    if (!bestStream) {
      bestStream = pickBestMuxedStream(muxedFormats, adaptiveFormats);
      if (bestStream) {
        logger.info('YouTubeExtractor', `Muxed: itag=${bestStream.itag} quality=${bestStream.quality}`);
      }
    }

    const streams: ExtractedStream[] = muxedFormats.map((f) => ({
      url: f.url!,
      quality: formatQualityLabel(f),
      mimeType: f.mimeType,
      itag: f.itag,
      hasAudio: !!f.audioQuality || isMuxedFormat(f),
      hasVideo: !!f.qualityLabel || f.mimeType.startsWith('video/'),
      bitrate: f.bitrate ?? 0,
    }));

    return {
      streams,
      bestStream,
      videoId,
      title: details?.title,
      durationSeconds,
    };
  }

  /**
   * Returns just the best playable URL or null.
   * Pass platform so the extractor can choose DASH vs muxed.
   */
  static async getBestStreamUrl(
    videoIdOrUrl: string,
    platform?: 'android' | 'ios'
  ): Promise<string | null> {
    const result = await this.extract(videoIdOrUrl, platform);
    return result?.bestStream?.url ?? null;
  }

  static parseVideoId(input: string): string | null {
    return extractVideoId(input);
  }
}

export default YouTubeExtractor;
