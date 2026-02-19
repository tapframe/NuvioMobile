# iOS Torrent Engine Path (Native, Not Desktop Service Port)

## Goal
Enable native torrent playback on iOS/iPadOS/tvOS with the same JS contract already used on Android:
- `prepareStream({ magnetUri, streamTitle, fileIndex, trackers, networkMbps })`
- `stopStream(streamId)`
- `stopAllStreams()`

The player receives a local playback URL such as `http://127.0.0.1:<port>/torrent/<streamId>`.

## Why Not Port Desktop Stremio Service
- `stremio-shell` is a desktop shell that starts a separate streaming server process in production.
- `stremio-service` packaging targets desktop distributions (macOS dmg, Windows exe, Linux deb/rpm/flatpak).
- iOS needs an embedded native engine lifecycle (memory/background constraints), not a desktop-style sidecar service process.

## Research Snapshot (2026-02-19)
### Torrent Core Candidates
- `arvidn/libtorrent`: mature BitTorrent core, highly active, strongest long-term choice.
- `frostwire/frostwire-jlibtorrent`: excellent for Android/JVM, but not a native Swift/iOS API surface.

### iOS Client/Engine References
- `XITRIX/iTorrent`: active iOS torrent app; uses `libtorrent-rasterbar` and local HTTP playback bridging.
- `XITRIX/LibTorrent-Swift`: active Swift wrapper project used by iTorrent.
- `danylokos/SwiftyTorrent`: useful reference implementation, but older push cadence and Carthage-era stack.
- `siuying/peerflix-ios`: archived and stale for modern production use.

### Local HTTP Bridge Candidates
- `swisspol/GCDWebServer`: historically common, but archived.
- `swhitty/FlyingFox`: active, modern Swift Concurrency HTTP server with range request support.

### Requested Check: VLC BitTorrent
- `johang/vlc-bittorrent` is a VLC plugin (C/C++ plugin target), useful as concept/reference, but not a direct iOS-native app integration path for Nuvio’s React Native architecture.

## Decision
Use:
1. `libtorrent-rasterbar` as the iOS/tvOS torrent core.
2. A thin Swift bridge layer (`TorrentStreamingModule`) exposing Nuvio’s existing JS API.
3. A local HTTP range bridge based on `FlyingFox` (preferred) or a custom equivalent if tighter control is needed.

Avoid:
- Desktop `stremio-service` process porting.
- Archived HTTP server dependencies as primary infrastructure.
- iOS torrent clients as direct code imports; use them as implementation references only.

## Target iOS Architecture
1. `TorrentSessionActor`
- Owns `libtorrent` session lifecycle, torrent handles, and shutdown.

2. `TorrentStreamCoordinator`
- File selection, piece windowing, and seek-aware reprioritization.
- Network-aware prefetch profile (slow/medium/fast/ultra), matching Android strategy.

3. `LocalPlaybackServer`
- Serves `/torrent/{streamId}` with full `Range` support (`206`, `Content-Range`, `Accept-Ranges`).
- Keeps buffered reads aggressive during play/pause up to cache policy limits.

4. `TorrentStreamingModule` (RN bridge)
- `prepareStream`, `stopStream`, `stopAllStreams`.
- Returns `{ streamId, playbackUrl, infoHash, fileName, fileSize, mimeType }`.

## Buffering/Robustness Rules
- Keep forward prefetch active during pause (subject to thermal/memory policy).
- Maintain high-priority piece window around playback pointer and seek target.
- Keep a wider low-priority prefetch window for smoother long-form playback.
- Resume quickly after app foreground/background transitions.
- Treat near-tail transient I/O failures as graceful completion when safe.

## Disk/Cache Policy
- Configurable base cache directory (default app container cache).
- Per-infohash subfolders.
- LRU cleanup and max cache budget.
- Optional “keep completed file” mode off by default.

## Integration Status In This Branch
- JS service already supports native torrent module discovery on Android/iOS.
- Stream selection now uses capability checks instead of Android-only assumptions.
- `KSPlayerCore` carries `torrentStreamId` and performs stop on close/unmount/switch.
- Android torrent prefetch is now network-tuned (very-slow to ultra-fast profiles).

## Remaining iOS Work
1. Implement and register `TorrentStreamingModule` on iOS.
2. Integrate `libtorrent-rasterbar` (XCFramework/static linkage path).
3. Implement local HTTP range bridge and seek-aware scheduler.
4. Add settings UI for cache path + cache budget.
5. Validate on real devices: pause buffering, seek storms, tokenized links, EOS behavior.

## Primary References
- https://github.com/Stremio/stremio-shell
- https://github.com/Stremio/stremio-service
- https://github.com/arvidn/libtorrent
- https://github.com/XITRIX/iTorrent
- https://github.com/XITRIX/LibTorrent-Swift
- https://github.com/danylokos/SwiftyTorrent
- https://github.com/siuying/peerflix-ios
- https://github.com/swhitty/FlyingFox
- https://github.com/swisspol/GCDWebServer
- https://github.com/johang/vlc-bittorrent
