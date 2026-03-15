import { NativeModules, Platform } from 'react-native';
import type { AppSettings } from '../hooks/useSettings';
import { logger } from '../utils/logger';

export type DoHMode = 'off' | 'auto' | 'strict';
export type DoHProvider = 'cloudflare' | 'google' | 'quad9' | 'custom';

export interface DoHConfig {
  enabled: boolean;
  mode: DoHMode;
  provider: DoHProvider;
  customUrl: string;
}

interface NetworkPrivacyNativeModule {
  applyDohConfig: (config: DoHConfig) => Promise<void>;
}

const NATIVE_DOH_MODULE: NetworkPrivacyNativeModule | undefined =
  Platform.OS === 'android' || Platform.OS === 'ios'
    ? (NativeModules.NetworkPrivacyModule as NetworkPrivacyNativeModule | undefined)
    : undefined;

const DEFAULT_DOH_CONFIG: DoHConfig = {
  enabled: false,
  mode: 'off',
  provider: 'cloudflare',
  customUrl: '',
};

const VALID_MODES: ReadonlyArray<DoHMode> = ['off', 'auto', 'strict'];
const VALID_PROVIDERS: ReadonlyArray<DoHProvider> = ['cloudflare', 'google', 'quad9', 'custom'];

const normalizeMode = (mode: unknown): DoHMode => {
  if (typeof mode === 'string' && VALID_MODES.includes(mode as DoHMode)) {
    return mode as DoHMode;
  }
  return DEFAULT_DOH_CONFIG.mode;
};

const normalizeProvider = (provider: unknown): DoHProvider => {
  if (typeof provider === 'string' && VALID_PROVIDERS.includes(provider as DoHProvider)) {
    return provider as DoHProvider;
  }
  return DEFAULT_DOH_CONFIG.provider;
};

const toConfigKey = (config: DoHConfig): string =>
  `${config.enabled}:${config.mode}:${config.provider}:${config.customUrl}`;

const normalizeDoHConfig = (config: Partial<DoHConfig>): DoHConfig => {
  const normalized: DoHConfig = {
    enabled: Boolean(config.enabled),
    mode: normalizeMode(config.mode),
    provider: normalizeProvider(config.provider),
    customUrl: typeof config.customUrl === 'string' ? config.customUrl.trim() : '',
  };

  if (!normalized.enabled || normalized.mode === 'off') {
    return {
      enabled: false,
      mode: 'off',
      provider: normalized.provider,
      customUrl: normalized.provider === 'custom' ? normalized.customUrl : '',
    };
  }

  if (normalized.provider !== 'custom') {
    normalized.customUrl = '';
  }

  return normalized;
};

const settingsToDoHConfig = (settings: AppSettings): DoHConfig =>
  normalizeDoHConfig({
    enabled: settings.dnsOverHttpsEnabled,
    mode: settings.dnsOverHttpsMode,
    provider: settings.dnsOverHttpsProvider,
    customUrl: settings.dnsOverHttpsCustomUrl,
  });

class NetworkPrivacyService {
  private lastAppliedConfigKey: string | null = null;

  async applyFromSettings(settings: AppSettings): Promise<void> {
    await this.applyConfig(settingsToDoHConfig(settings));
  }

  async applyConfig(config: Partial<DoHConfig>): Promise<void> {
    if (!NATIVE_DOH_MODULE?.applyDohConfig) {
      return;
    }

    const normalized = normalizeDoHConfig(config);
    const nextKey = toConfigKey(normalized);
    if (this.lastAppliedConfigKey === nextKey) {
      return;
    }

    try {
      await NATIVE_DOH_MODULE.applyDohConfig(normalized);
      this.lastAppliedConfigKey = nextKey;
      
      if (!normalized.enabled || normalized.mode === 'off') {
        logger.log('[NetworkPrivacyService] DNS-over-HTTPS disabled (System DNS active)');
      } else {
        logger.log('[NetworkPrivacyService] Applied DoH config', {
          mode: normalized.mode,
          provider: normalized.provider,
        });
      }
    } catch (error) {
      logger.error('[NetworkPrivacyService] Failed to apply DoH config', error);
    }
  }
}

export const networkPrivacyService = new NetworkPrivacyService();
