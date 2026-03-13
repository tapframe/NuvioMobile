const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': DEFAULT_USER_AGENT,
};

const CLIENTS = [
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
  },
];

function parseVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (url.hostname.endsWith('youtu.be')) {
      const id = url.pathname.slice(1).split('/')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  } catch {}
  return null;
}

function getMimeBase(mimeType = '') {
  return mimeType.split(';')[0].trim();
}

function getExt(mimeType = '') {
  const base = getMimeBase(mimeType);
  if (base === 'video/mp4' || base === 'audio/mp4') return 'mp4';
  if (base.includes('webm')) return 'webm';
  if (base.includes('m4a')) return 'm4a';
  return 'other';
}

function parseQualityLabel(label = '') {
  const match = label.match(/(\d{2,4})p/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function videoScore(height, fps, bitrate) {
  return height * 1_000_000_000 + fps * 1_000_000 + bitrate;
}

function audioScore(bitrate, sampleRate) {
  return bitrate * 1_000_000 + sampleRate;
}

function sortCandidates(items) {
  return [...items].sort((a, b) => b.score - a.score);
}

function isIosSafeVideo(candidate) {
  const mimeBase = getMimeBase(candidate.mimeType);
  return mimeBase === 'video/mp4';
}

function isIosSafeAudio(candidate) {
  const mimeBase = getMimeBase(candidate.mimeType);
  return mimeBase === 'audio/mp4' || candidate.ext === 'm4a';
}

async function fetchWatchConfig(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: DEFAULT_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`watch page failed: ${response.status}`);
  }
  const html = await response.text();
  return {
    apiKey: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? null,
    visitorData: html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1] ?? null,
  };
}

async function fetchPlayerResponse(videoId, apiKey, visitorData, client) {
  const endpoint = apiKey
    ? `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`
    : `https://www.youtube.com/youtubei/v1/player?prettyPrint=false`;

  const headers = {
    ...DEFAULT_HEADERS,
    'content-type': 'application/json',
    origin: 'https://www.youtube.com',
    'x-youtube-client-name': client.id,
    'x-youtube-client-version': client.version,
    'user-agent': client.userAgent,
    ...(visitorData ? { 'x-goog-visitor-id': visitorData } : {}),
  };

  const payload = {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    context: { client: client.context },
    playbackContext: {
      contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' },
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`player API ${client.key} failed: ${response.status}`);
  }

  return response.json();
}

async function main() {
  const input = process.argv[2];
  const videoId = parseVideoId(input);
  if (!videoId) {
    console.error('Usage: node scripts/inspect-youtube-formats.mjs <youtube-id-or-url>');
    process.exit(1);
  }

  const { apiKey, visitorData } = await fetchWatchConfig(videoId);
  if (!apiKey) {
    throw new Error('Could not extract INNERTUBE_API_KEY');
  }

  const adaptiveVideo = [];
  const adaptiveAudio = [];

  for (const client of CLIENTS) {
    const data = await fetchPlayerResponse(videoId, apiKey, visitorData, client);
    const formats = data?.streamingData?.adaptiveFormats ?? [];

    for (const f of formats) {
      if (!f.url) continue;
      const mimeBase = getMimeBase(f.mimeType);
      if (mimeBase.startsWith('video/')) {
        const height = f.height ?? parseQualityLabel(f.qualityLabel);
        const fps = f.fps ?? 0;
        const bitrate = f.bitrate ?? f.averageBitrate ?? 0;
        adaptiveVideo.push({
          client: client.key,
          mimeType: f.mimeType ?? '',
          ext: getExt(f.mimeType),
          height,
          fps,
          bitrate,
          score: videoScore(height, fps, bitrate),
          url: f.url,
        });
      } else if (mimeBase.startsWith('audio/')) {
        const bitrate = f.bitrate ?? f.averageBitrate ?? 0;
        const sampleRate = Number.parseFloat(f.audioSampleRate ?? '0') || 0;
        adaptiveAudio.push({
          client: client.key,
          mimeType: f.mimeType ?? '',
          ext: getExt(f.mimeType),
          bitrate,
          audioSampleRate: f.audioSampleRate ?? '',
          score: audioScore(bitrate, sampleRate),
          url: f.url,
        });
      }
    }
  }

  const sortedVideo = sortCandidates(adaptiveVideo);
  const sortedAudio = sortCandidates(adaptiveAudio);
  const iosSafeVideo = sortedVideo.filter(isIosSafeVideo);
  const iosSafeAudio = sortedAudio.filter(isIosSafeAudio);

  console.log(`Video ID: ${videoId}`);
  console.log('');
  console.log('Top adaptive video candidates:');
  for (const item of sortedVideo.slice(0, 8)) {
    console.log(
      `- client=${item.client} height=${item.height} fps=${item.fps} bitrate=${item.bitrate} ext=${item.ext} mime=${item.mimeType}`
    );
  }

  console.log('');
  console.log('Top adaptive audio candidates:');
  for (const item of sortedAudio.slice(0, 12)) {
    console.log(
      `- client=${item.client} bitrate=${item.bitrate} sampleRate=${item.audioSampleRate} ext=${item.ext} mime=${item.mimeType}`
    );
  }

  console.log('');
  console.log('Top iOS-safe video candidates:');
  for (const item of iosSafeVideo.slice(0, 8)) {
    console.log(
      `- client=${item.client} height=${item.height} fps=${item.fps} bitrate=${item.bitrate} ext=${item.ext} mime=${item.mimeType}`
    );
  }

  console.log('');
  console.log('Top iOS-safe audio candidates:');
  for (const item of iosSafeAudio.slice(0, 8)) {
    console.log(
      `- client=${item.client} bitrate=${item.bitrate} sampleRate=${item.audioSampleRate} ext=${item.ext} mime=${item.mimeType}`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
