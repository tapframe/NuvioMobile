# Torrent Engine Research (2026-02-19)

## Scope
- Android torrent streaming engine choice and viability.
- iOS/tvOS torrent engine choice and integration strategy.
- Check requested references (`Stremio`, `vlc-bittorrent`) and pick lowest-risk modern path.

## Android Findings
### Selected
- `frostwire/frostwire-jlibtorrent`
  - GitHub: 498 stars, recently updated.
  - Works directly from Android/Kotlin, stable JVM binding around libtorrent.
  - Current branch now uses `2.0.12.7` artifacts from FrostWire Maven.

### Why
- Native Android integration is straightforward compared to desktop-plugin or Node-sidecar designs.
- Mature dependency chain and direct access to session/piece priority APIs.

## iOS Findings
### Core Engine
- `arvidn/libtorrent` remains the strongest base core.

### Real-World iOS References
- `XITRIX/iTorrent`
  - 2,953 stars, actively maintained.
  - Uses `libtorrent-rasterbar` and local HTTP serving for playback.
- `XITRIX/LibTorrent-Swift`
  - Active Swift wrapper used by iTorrent.
- `danylokos/SwiftyTorrent`
  - Useful reference, but older push cadence and older toolchain approach.
- `siuying/peerflix-ios`
  - Archived and stale; not suitable for modern production path.

### Local HTTP Layer
- `swisspol/GCDWebServer` is archived.
- `swhitty/FlyingFox` is active and supports range-friendly file serving patterns.

### Requested Check: `johang/vlc-bittorrent`
- Valuable as VLC plugin reference, but not a direct RN iOS integration path.
- Architecture is plugin-for-VLC, not embedded app-native bridge for Nuvio.

## Stremio Research Summary
- `stremio-shell` desktop runtime expects a separate streaming server flow.
- `stremio-service` packaging is desktop-oriented.
- This confirms Nuvio mobile should use embedded native torrent engine modules per platform, not desktop service porting.

## Decision
1. Android: stay on jlibtorrent-based native module (already integrated).
2. iOS/tvOS: use libtorrent core + Swift bridge + local HTTP range bridge (prefer active server stack like FlyingFox or equivalent custom).
3. Keep one JS contract across platforms (`prepareStream/stopStream/stopAllStreams`) with platform-native implementations.

## Data Points (GitHub API, 2026-02-19)
- `frostwire/frostwire-jlibtorrent`: stars 498, pushed 2026-02-14
- `arvidn/libtorrent`: stars 5,847, pushed 2026-02-18
- `XITRIX/iTorrent`: stars 2,953, pushed 2026-01-29
- `XITRIX/LibTorrent-Swift`: stars 8, pushed 2026-02-03
- `danylokos/SwiftyTorrent`: stars 128, pushed 2024-04-20
- `siuying/peerflix-ios`: stars 84, archived, pushed 2017-03-18
- `swisspol/GCDWebServer`: stars 6,615, archived, pushed 2022-10-05
- `swhitty/FlyingFox`: stars 626, pushed 2026-01-23
- `johang/vlc-bittorrent`: stars 472, pushed 2026-02-04

## Links
- https://github.com/frostwire/frostwire-jlibtorrent
- https://github.com/arvidn/libtorrent
- https://github.com/XITRIX/iTorrent
- https://github.com/XITRIX/LibTorrent-Swift
- https://github.com/danylokos/SwiftyTorrent
- https://github.com/siuying/peerflix-ios
- https://github.com/swhitty/FlyingFox
- https://github.com/swisspol/GCDWebServer
- https://github.com/johang/vlc-bittorrent
- https://github.com/Stremio/stremio-shell
- https://github.com/Stremio/stremio-service
