/**
 * Shared Player Hooks
 * Export all reusable hooks for both Android and iOS players
 */

// State Management
export { usePlayerState, type PlayerResizeMode } from './usePlayerState';
export { usePlayerModals } from './usePlayerModals';
export { usePlayerTracks } from './usePlayerTracks';
export { useCustomSubtitles } from './useCustomSubtitles';

// Controls & Playback
export { usePlayerControls } from './usePlayerControls';
export { useSpeedControl } from './useSpeedControl';

// Animation & UI
export { useOpeningAnimation } from './useOpeningAnimation';
export { usePlayerSetup } from './usePlayerSetup';

// Content
export { useNextEpisode } from './useNextEpisode';
export { useWatchProgress } from './useWatchProgress';
export { useSkipSegments } from './useSkipSegments';
