import { NativeModules, Platform } from 'react-native';
import { Stream } from '../types/metadata';
import { logger } from '../utils/logger';

type NativePrepareInput = {
  magnetUri: string;
  streamTitle?: string;
  fileIndex?: number;
  trackers?: string[];
  networkMbps?: number;
};

type NativePrepareResult = {
  streamId: string;
  playbackUrl: string;
  infoHash?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
};

type NativeTorrentStreamingModule = {
  prepareStream: (input: NativePrepareInput) => Promise<NativePrepareResult>;
  stopStream: (streamId: string) => Promise<boolean>;
  stopAllStreams: () => Promise<boolean>;
};

const getNativeModule = (): NativeTorrentStreamingModule | undefined => {
  const modules = NativeModules as any;
  return (
    (modules.TorrentStreamingModule as NativeTorrentStreamingModule | undefined) ||
    (modules.NuvioTorrentStreamingModule as NativeTorrentStreamingModule | undefined)
  );
};

export type PreparedTorrentPlayback = {
  streamId: string;
  playbackUrl: string;
  infoHash?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
};

type PreparePlaybackOptions = {
  networkMbps?: number;
};

class TorrentStreamingService {
  isNativeSupported(): boolean {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
    return !!getNativeModule();
  }

  isTorrentStream(stream: Partial<Stream> | null | undefined): boolean {
    if (!stream) return false;
    if (typeof stream.url === 'string' && stream.url.startsWith('magnet:')) return true;
    return typeof stream.infoHash === 'string' && stream.infoHash.length > 0;
  }

  isLocalTorrentPlaybackUrl(url?: string | null): boolean {
    if (!url) return false;
    return /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/torrent\//.test(url);
  }

  async preparePlayback(
    stream: Stream,
    streamTitle?: string,
    options?: PreparePlaybackOptions
  ): Promise<PreparedTorrentPlayback> {
    const nativeModule = getNativeModule();
    if (!this.isNativeSupported() || !nativeModule) {
      throw new Error('Native torrent streaming is not available on this device.');
    }

    const magnetUri = this.buildMagnetUri(stream, streamTitle);
    if (!magnetUri) {
      throw new Error('Missing torrent identifier. Expected magnet URL or infoHash.');
    }

    const trackers = this.extractTrackerUrls(stream);
    const fileIndex = typeof stream.fileIdx === 'number' && Number.isFinite(stream.fileIdx)
      ? stream.fileIdx
      : undefined;

    const payload: NativePrepareInput = {
      magnetUri,
      streamTitle: streamTitle || stream.title || stream.name,
      fileIndex,
      trackers,
      networkMbps:
        typeof options?.networkMbps === 'number' && Number.isFinite(options.networkMbps)
          ? Math.max(0.1, options.networkMbps)
          : undefined,
    };

    const result = await nativeModule.prepareStream(payload);
    if (!result?.playbackUrl || !result?.streamId) {
      throw new Error('Native module did not return a playback URL.');
    }

    logger.log('[TorrentStreamingService] Prepared torrent playback', {
      streamId: result.streamId,
      playbackUrl: result.playbackUrl,
      infoHash: result.infoHash,
      fileName: result.fileName,
      fileSize: result.fileSize,
    });

    return {
      streamId: result.streamId,
      playbackUrl: result.playbackUrl,
      infoHash: result.infoHash,
      fileName: result.fileName,
      fileSize: result.fileSize,
      mimeType: result.mimeType,
    };
  }

  async stopStream(streamId?: string): Promise<void> {
    const nativeModule = getNativeModule();
    if (!this.isNativeSupported() || !nativeModule || !streamId) return;
    try {
      await nativeModule.stopStream(streamId);
    } catch (error) {
      logger.warn('[TorrentStreamingService] Failed to stop torrent stream', error);
    }
  }

  async stopAll(): Promise<void> {
    const nativeModule = getNativeModule();
    if (!this.isNativeSupported() || !nativeModule) return;
    try {
      await nativeModule.stopAllStreams();
    } catch (error) {
      logger.warn('[TorrentStreamingService] Failed to stop all torrent streams', error);
    }
  }

  private buildMagnetUri(stream: Stream, streamTitle?: string): string | null {
    if (typeof stream.url === 'string' && stream.url.startsWith('magnet:')) {
      return stream.url;
    }

    if (typeof stream.infoHash === 'string' && stream.infoHash.trim().length > 0) {
      const trackers = this.extractTrackerUrls(stream);
      const encodedName = encodeURIComponent(streamTitle || stream.title || stream.name || 'Torrent Stream');
      const trackersQuery = trackers.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
      return `magnet:?xt=urn:btih:${stream.infoHash.trim()}&dn=${encodedName}${trackersQuery}`;
    }

    return null;
  }

  private extractTrackerUrls(stream: Stream): string[] {
    const out = new Set<string>();

    if (Array.isArray(stream.sources)) {
      stream.sources.forEach(source => {
        if (typeof source === 'string' && source.startsWith('tracker:')) {
          const tracker = source.slice('tracker:'.length).trim();
          if (tracker) out.add(tracker);
        }
      });
    }

    if (typeof stream.url === 'string' && stream.url.startsWith('magnet:')) {
      const query = stream.url.split('?')[1] || '';
      query.split('&').forEach(param => {
        const [key, value] = param.split('=');
        if ((key || '').toLowerCase() === 'tr' && value) {
          try {
            const decoded = decodeURIComponent(value);
            if (decoded) out.add(decoded);
          } catch {
            // ignore invalid tracker encoding
          }
        }
      });
    }

    return [...out];
  }
}

export const torrentStreamingService = new TorrentStreamingService();
export default torrentStreamingService;
