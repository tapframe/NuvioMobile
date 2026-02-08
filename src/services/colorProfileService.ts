import { mmkvStorage } from './mmkvStorage';
import { logger } from '../utils/logger';

export interface VideoSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  hue: number;
}

export const COLOR_PROFILES: Record<string, VideoSettings> = {
  "cinema": { brightness: 2, contrast: 12, saturation: 8, gamma: 5, hue: 0 },
  "cinema_dark": { brightness: -12, contrast: 18, saturation: 6, gamma: 12, hue: -1 },
  "cinema_hdr": { brightness: 5, contrast: 22, saturation: 12, gamma: 3, hue: -1 },
  "anime": { brightness: 10, contrast: 22, saturation: 30, gamma: -3, hue: 3 },
  "anime_vibrant": { brightness: 14, contrast: 28, saturation: 42, gamma: -6, hue: 4 },
  "anime_soft": { brightness: 8, contrast: 16, saturation: 25, gamma: -1, hue: 2 },
  "anime_4k": { brightness: 0, contrast: 20, saturation: 100, gamma: 1, hue: 2 },
  "vivid": { brightness: 8, contrast: 25, saturation: 35, gamma: 2, hue: 1 },
  "vivid_pop": { brightness: 12, contrast: 32, saturation: 48, gamma: 4, hue: 2 },
  "vivid_warm": { brightness: 6, contrast: 24, saturation: 32, gamma: 1, hue: 8 },
  "natural": { brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0 },
  "dark": { brightness: -18, contrast: 15, saturation: -8, gamma: 15, hue: -2 },
  "warm": { brightness: 3, contrast: 10, saturation: 15, gamma: 2, hue: 6 },
  "cool": { brightness: 1, contrast: 8, saturation: 12, gamma: 1, hue: -6 },
  "grayscale": { brightness: 2, contrast: 20, saturation: -100, gamma: 8, hue: 0 },
  "custom": { brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0 },
};

export const PROFILE_DESCRIPTIONS: Record<string, string> = {
  "cinema": "Balanced colors for movie watching",
  "cinema_dark": "Optimized for dark room cinema viewing",
  "cinema_hdr": "Enhanced cinema with HDR-like contrast",
  "anime": "Enhanced colors perfect for animation",
  "anime_vibrant": "Maximum saturation for colorful anime",
  "anime_soft": "Gentle enhancement for pastel anime",
  "anime_4k": "Ultra-sharp with vibrant 4K clarity",
  "vivid": "Bright and punchy colors",
  "vivid_pop": "Maximum vibrancy for eye-catching content",
  "vivid_warm": "Vivid colors with warm temperature",
  "natural": "Default balanced settings",
  "dark": "Optimized for dark environments",
  "warm": "Warmer tones for comfort viewing",
  "cool": "Cooler tones for clarity",
  "grayscale": "Black and white viewing",
  "custom": "Your personalized settings",
};

const STORAGE_KEYS = {
  ACTIVE_PROFILE: 'video_color_profile',
  CUSTOM_SETTINGS: 'video_custom_settings',
};

class VisualEnhancementService {
  private static instance: VisualEnhancementService;
  private activeProfile: string = 'natural';
  private customSettings: VideoSettings = { ...COLOR_PROFILES['custom'] };

  private constructor() {
    this.loadSettings();
  }

  public static getInstance(): VisualEnhancementService {
    if (!VisualEnhancementService.instance) {
      VisualEnhancementService.instance = new VisualEnhancementService();
    }
    return VisualEnhancementService.instance;
  }

  private async loadSettings() {
    try {
      const savedProfile = await mmkvStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE);
      if (savedProfile && COLOR_PROFILES[savedProfile]) {
        this.activeProfile = savedProfile;
      }

      const savedCustom = await mmkvStorage.getItem(STORAGE_KEYS.CUSTOM_SETTINGS);
      if (savedCustom) {
        this.customSettings = JSON.parse(savedCustom);
      }
    } catch (e) {
      logger.error('[VisualEnhancementService] Failed to load settings', e);
    }
  }

  getActiveProfile(): string {
    return this.activeProfile;
  }

  getCustomSettings(): VideoSettings {
    return { ...this.customSettings };
  }

  getCurrentSettings(): VideoSettings {
    if (this.activeProfile === 'custom') {
      return this.customSettings;
    }
    return COLOR_PROFILES[this.activeProfile] || COLOR_PROFILES['natural'];
  }

  async setProfile(profile: string) {
    if (COLOR_PROFILES[profile]) {
      this.activeProfile = profile;
      await mmkvStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE, profile);
    }
  }

  async updateCustomSettings(settings: Partial<VideoSettings>) {
    this.customSettings = { ...this.customSettings, ...settings };
    this.activeProfile = 'custom';
    await mmkvStorage.setItem(STORAGE_KEYS.CUSTOM_SETTINGS, JSON.stringify(this.customSettings));
    await mmkvStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE, 'custom');
  }
}

export const visualEnhancementService = VisualEnhancementService.getInstance();
