import axios from 'axios';
import { mmkvStorage } from './mmkvStorage';
import { logger } from '../utils/logger';
import EventEmitter from 'eventemitter3';
import { localScraperService } from './pluginService';
import { DEFAULT_SETTINGS, AppSettings } from '../hooks/useSettings';
import { TMDBService } from './tmdbService';
import { safeAxiosConfig, createSafeAxiosConfig } from '../utils/axiosConfig';

// Create an event emitter for addon changes
export const addonEmitter = new EventEmitter();
export const ADDON_EVENTS = {
  ORDER_CHANGED: 'order_changed',
  ADDON_ADDED: 'addon_added',
  ADDON_REMOVED: 'addon_removed'
};

// Basic types for Stremio
export interface Meta {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: 'poster' | 'square' | 'landscape'; // For variable aspect ratios
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  year?: number;
  genres?: string[];
  runtime?: string;
  cast?: string[];
  director?: string | string[];
  writer?: string | string[];
  certification?: string;
  // Extended fields available from some addons
  country?: string;
  imdb_id?: string;
  slug?: string;
  released?: string;
  trailerStreams?: Array<{
    title: string;
    ytId: string;
  }>;
  links?: Array<{
    name: string;
    category: string;
    url: string;
  }>;
  behaviorHints?: {
    defaultVideoId?: string;
    hasScheduledVideos?: boolean;
    [key: string]: any;
  };
  app_extras?: {
    cast?: Array<{
      name: string;
      character?: string;
      photo?: string;
    }>;
  };
}

export interface Subtitle {
  id: string;           // Required per protocol
  url: string;
  lang: string;
  fps?: number;
  addon?: string;
  addonName?: string;
  format?: 'srt' | 'vtt' | 'ass' | 'ssa';
}

// Source object for archive streams per protocol
export interface SourceObject {
  url: string;
  bytes?: number;
}

export interface Stream {
  // Primary stream source - one of these must be provided
  url?: string;                    // Direct HTTP(S)/FTP(S)/RTMP URL
  ytId?: string;                   // YouTube video ID
  infoHash?: string;               // BitTorrent info hash
  externalUrl?: string;            // External URL to open in browser
  nzbUrl?: string;                 // Usenet NZB file URL
  rarUrls?: SourceObject[];        // RAR archive files
  zipUrls?: SourceObject[];        // ZIP archive files
  '7zipUrls'?: SourceObject[];     // 7z archive files
  tgzUrls?: SourceObject[];        // TGZ archive files
  tarUrls?: SourceObject[];        // TAR archive files

  // Stream selection within archives/torrents
  fileIdx?: number;                // File index in archive/torrent
  fileMustInclude?: string;        // Regex for file matching in archives
  servers?: string[];              // NNTP servers for nzbUrl

  // Display information
  name?: string;                   // Stream name (usually quality)
  title?: string;                  // Stream title/description (deprecated for description)
  description?: string;            // Stream description

  // Addon identification
  addon?: string;
  addonId?: string;
  addonName?: string;

  // Stream properties
  size?: number;
  isFree?: boolean;
  isDebrid?: boolean;
  quality?: string;
  headers?: Record<string, string>;

  // Embedded subtitles per protocol
  subtitles?: Subtitle[];

  // Additional tracker/DHT sources
  sources?: string[];

  // Complete behavior hints per protocol
  behaviorHints?: {
    bingeGroup?: string;           // Group for binge watching
    notWebReady?: boolean;         // True if not HTTPS MP4
    countryWhitelist?: string[];   // ISO 3166-1 alpha-3 codes (lowercase)
    cached?: boolean;              // Debrid cached status
    proxyHeaders?: {               // Custom headers for stream
      request?: Record<string, string>;
      response?: Record<string, string>;
    };
    videoHash?: string;            // OpenSubtitles hash
    videoSize?: number;            // Video file size in bytes
    filename?: string;             // Video filename
    [key: string]: any;
  };
}

export interface StreamResponse {
  streams: Stream[];
  addon: string;
  addonName: string;
}

export interface SubtitleResponse {
  subtitles: Subtitle[];
  addon: string;
  addonName: string;
}

// Modify the callback signature to include addon ID and installation ID
interface StreamCallback {
  (streams: Stream[] | null, addonId: string | null, addonName: string | null, error: Error | null, installationId?: string | null): void;
}

interface CatalogFilter {
  title: string;
  value: any;
}

interface Catalog {
  type: string;
  id: string;
  name: string;
  extraSupported?: string[];
  extraRequired?: string[];
  itemCount?: number;
  // Per Stremio protocol - extra properties for filtering
  extra?: CatalogExtra[];
}

// Extra property definition per protocol
export interface CatalogExtra {
  name: string;           // Property name (e.g., 'genre', 'search', 'skip')
  isRequired?: boolean;   // If true, must always be provided
  options?: string[];     // Available options (e.g., genre list)
  optionsLimit?: number;  // Max selections allowed (default 1)
}

interface ResourceObject {
  name: string;
  types: string[];
  idPrefixes?: string[];
  idPrefix?: string[];
}

export interface Manifest {
  id: string;
  installationId?: string;             // Unique ID for this installation (allows multiple installs of same addon)
  name: string;
  version: string;
  description: string;
  url?: string;
  originalUrl?: string;
  catalogs?: Catalog[];
  resources?: ResourceObject[];
  types?: string[];
  idPrefixes?: string[];
  manifestVersion?: string;
  queryParams?: string;
  behaviorHints?: {
    configurable?: boolean;
    configurationRequired?: boolean;  // Per protocol
    adult?: boolean;                   // Adult content flag
    p2p?: boolean;                     // P2P content flag
  };
  config?: ConfigObject[];             // User configuration
  addonCatalogs?: Catalog[];           // Addon catalogs
  background?: string;                 // Background image URL
  logo?: string;                       // Logo URL
  contactEmail?: string;               // Contact email
}

// Config object for addon configuration per protocol
interface ConfigObject {
  key: string;
  type: 'text' | 'number' | 'password' | 'checkbox' | 'select';
  default?: string;
  title?: string;
  options?: string[];
  required?: boolean;
}

// Meta Link object per protocol
export interface MetaLink {
  name: string;
  category: string;  // 'actor', 'director', 'writer', etc.
  url: string;       // External URL or stremio:/// deep link
}

export interface MetaDetails extends Meta {
  videos?: {
    id: string;
    title: string;
    released: string;
    season?: number;
    episode?: number;
    thumbnail?: string;
    streams?: Stream[];      // Embedded streams (used by PPV-style addons)
    available?: boolean;     // Availability flag per protocol
    overview?: string;       // Episode summary per protocol
    trailers?: Stream[];     // Trailer streams per protocol
  }[];
  links?: MetaLink[];        // Actor/Director/Genre links per protocol
}

export interface AddonCapabilities {
  name: string;
  id: string;
  version: string;
  catalogs: {
    type: string;
    id: string;
    name: string;
  }[];
  resources: {
    name: string;
    types: string[];
    idPrefixes?: string[];
  }[];
  types: string[];
}

class StremioService {
  private static instance: StremioService;
  private installedAddons: Map<string, Manifest> = new Map(); // Key is installationId
  private addonOrder: string[] = []; // Array of installationIds
  private readonly STORAGE_KEY = 'stremio-addons';
  private readonly ADDON_ORDER_KEY = 'stremio-addon-order';
  private readonly MAX_CONCURRENT_REQUESTS = 3;
  private readonly DEFAULT_PAGE_SIZE = 100; // Protocol standard page size
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private catalogHasMore: Map<string, boolean> = new Map();

  private constructor() {
    // Start initialization but don't wait for it
    this.initializationPromise = this.initialize();
  }

  // Generate a unique installation ID for an addon
  private generateInstallationId(addonId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `${addonId}-${timestamp}-${random}`;
  }


  private addonProvidesStreams(manifest: Manifest): boolean {
    if (!manifest.resources || !Array.isArray(manifest.resources)) {
      return false;
    }

    return manifest.resources.some(resource => {
      if (typeof resource === 'string') {
        return resource === 'stream';
      } else if (typeof resource === 'object' && resource !== null && 'name' in resource) {
        return (resource as ResourceObject).name === 'stream';
      }
      return false;
    });
  }

  // Dynamic validator for content IDs based on installed addon capabilities
  public async isValidContentId(type: string, id: string | null | undefined): Promise<boolean> {
    // Ensure addons are initialized before checking types
    await this.ensureInitialized();

    // Get all supported types from installed addons
    const supportedTypes = this.getAllSupportedTypes();
    const isValidType = supportedTypes.includes(type);

    const lowerId = (id || '').toLowerCase();
    const isNullishId = !id || lowerId === 'null' || lowerId === 'undefined';
    const providerLikeIds = new Set<string>(['moviebox', 'torbox']);
    const isProviderSlug = providerLikeIds.has(lowerId);

    if (!isValidType || isNullishId || isProviderSlug) return false;

    // Get all supported ID prefixes from installed addons
    const supportedPrefixes = this.getAllSupportedIdPrefixes(type);

    // If no addons declare specific prefixes, allow any non-empty string
    if (supportedPrefixes.length === 0) {
      return true;
    }

    // Check if the ID matches any supported prefix
    return supportedPrefixes.some(prefix => lowerId.startsWith(prefix.toLowerCase()));
  }

  // Get all content types supported by installed addons
  public getAllSupportedTypes(): string[] {
    const addons = this.getInstalledAddons();
    const types = new Set<string>();

    for (const addon of addons) {
      // Check addon-level types
      if (addon.types && Array.isArray(addon.types)) {
        addon.types.forEach(type => types.add(type));
      }

      // Check resource-level types
      if (addon.resources && Array.isArray(addon.resources)) {
        for (const resource of addon.resources) {
          if (typeof resource === 'object' && resource !== null && 'name' in resource) {
            const typedResource = resource as ResourceObject;
            if (Array.isArray(typedResource.types)) {
              typedResource.types.forEach(type => types.add(type));
            }
          }
        }
      }

      // Check catalog-level types
      if (addon.catalogs && Array.isArray(addon.catalogs)) {
        for (const catalog of addon.catalogs) {
          if (catalog.type) {
            types.add(catalog.type);
          }
        }
      }
    }

    return Array.from(types);
  }

  // Get all ID prefixes supported by installed addons for a given content type
  public getAllSupportedIdPrefixes(type: string): string[] {
    const addons = this.getInstalledAddons();
    const prefixes = new Set<string>();

    for (const addon of addons) {
      // Check addon-level idPrefixes
      if (addon.idPrefixes && Array.isArray(addon.idPrefixes)) {
        addon.idPrefixes.forEach(prefix => prefixes.add(prefix));
      }

      // Check resource-level idPrefixes
      if (addon.resources && Array.isArray(addon.resources)) {
        for (const resource of addon.resources) {
          if (typeof resource === 'object' && resource !== null && 'name' in resource) {
            const typedResource = resource as ResourceObject;
            // Only include prefixes for resources that support the content type
            if (Array.isArray(typedResource.types) && typedResource.types.includes(type)) {
              if (Array.isArray(typedResource.idPrefixes)) {
                typedResource.idPrefixes.forEach(prefix => prefixes.add(prefix));
              }
            }
          }
        }
      }
    }

    return Array.from(prefixes);
  }

  // Check if a content ID belongs to a collection addon
  public isCollectionContent(id: string): { isCollection: boolean; addon?: Manifest } {
    const addons = this.getInstalledAddons();

    for (const addon of addons) {
      // Check if this addon supports collections
      const supportsCollections = addon.types?.includes('collections') ||
        addon.catalogs?.some(catalog => catalog.type === 'collections');

      if (!supportsCollections) continue;

      // Check if our ID matches this addon's prefixes
      const addonPrefixes = addon.idPrefixes || [];
      const resourcePrefixes = addon.resources
        ?.filter(resource => typeof resource === 'object' && resource !== null && 'name' in resource)
        ?.filter(resource => (resource as any).name === 'meta' || (resource as any).name === 'catalog')
        ?.flatMap(resource => (resource as any).idPrefixes || []) || [];

      const allPrefixes = [...addonPrefixes, ...resourcePrefixes];
      if (allPrefixes.some(prefix => id.startsWith(prefix))) {
        return { isCollection: true, addon };
      }
    }

    return { isCollection: false };
  }

  static getInstance(): StremioService {
    if (!StremioService.instance) {
      StremioService.instance = new StremioService();
    }
    return StremioService.instance;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      // Prefer scoped storage, but fall back to legacy keys to preserve older installs
      let storedAddons = await mmkvStorage.getItem(`@user:${scope}:${this.STORAGE_KEY}`);
      if (!storedAddons) storedAddons = await mmkvStorage.getItem(this.STORAGE_KEY);
      if (!storedAddons) storedAddons = await mmkvStorage.getItem(`@user:local:${this.STORAGE_KEY}`);

      if (storedAddons) {
        const parsed = JSON.parse(storedAddons);

        // Convert to Map using installationId as key
        this.installedAddons = new Map();
        for (const addon of parsed) {
          if (addon && addon.id) {
            // Generate installationId for existing addons that don't have one (migration)
            if (!addon.installationId) {
              addon.installationId = this.generateInstallationId(addon.id);
            }
            this.installedAddons.set(addon.installationId, addon);
          }
        }
      }

      // Install Cinemeta for new users, but allow existing users to uninstall it
      const cinemetaId = 'com.linvo.cinemeta';
      const hasUserRemovedCinemeta = await this.hasUserRemovedAddon(cinemetaId);

      // Check if Cinemeta is already installed (by checking addon.id, not installationId)
      const hasCinemeta = Array.from(this.installedAddons.values()).some(addon => addon.id === cinemetaId);

      if (!hasCinemeta && !hasUserRemovedCinemeta) {
        try {
          const cinemetaManifest = await this.getManifest('https://v3-cinemeta.strem.io/manifest.json');
          cinemetaManifest.installationId = this.generateInstallationId(cinemetaId);
          this.installedAddons.set(cinemetaManifest.installationId, cinemetaManifest);
        } catch (error) {
          // Fallback to minimal manifest if fetch fails
          const fallbackManifest: Manifest = {
            id: cinemetaId,
            installationId: this.generateInstallationId(cinemetaId),
            name: 'Cinemeta',
            version: '3.0.13',
            description: 'Provides metadata for movies and series from TheTVDB, TheMovieDB, etc.',
            url: 'https://v3-cinemeta.strem.io',
            originalUrl: 'https://v3-cinemeta.strem.io/manifest.json',
            types: ['movie', 'series'],
            catalogs: [
              {
                type: 'movie',
                id: 'top',
                name: 'Popular',
                extraSupported: ['search', 'genre', 'skip']
              },
              {
                type: 'series',
                id: 'top',
                name: 'Popular',
                extraSupported: ['search', 'genre', 'skip']
              }
            ],
            resources: [
              {
                name: 'catalog',
                types: ['movie', 'series'],
                idPrefixes: ['tt']
              },
              {
                name: 'meta',
                types: ['movie', 'series'],
                idPrefixes: ['tt']
              }
            ],
            behaviorHints: {
              configurable: false
            }
          };
          this.installedAddons.set(fallbackManifest.installationId!, fallbackManifest);
        }
      }

      // Install OpenSubtitles v3 by default unless user has explicitly removed it
      const opensubsId = 'org.stremio.opensubtitlesv3';
      const hasUserRemovedOpenSubtitles = await this.hasUserRemovedAddon(opensubsId);

      // Check if OpenSubtitles is already installed (by checking addon.id, not installationId)
      const hasOpenSubs = Array.from(this.installedAddons.values()).some(addon => addon.id === opensubsId);

      if (!hasOpenSubs && !hasUserRemovedOpenSubtitles) {
        try {
          const opensubsManifest = await this.getManifest('https://opensubtitles-v3.strem.io/manifest.json');
          opensubsManifest.installationId = this.generateInstallationId(opensubsId);
          this.installedAddons.set(opensubsManifest.installationId, opensubsManifest);
        } catch (error) {
          const fallbackManifest: Manifest = {
            id: opensubsId,
            installationId: this.generateInstallationId(opensubsId),
            name: 'OpenSubtitles v3',
            version: '1.0.0',
            description: 'OpenSubtitles v3 Addon for Stremio',
            url: 'https://opensubtitles-v3.strem.io',
            originalUrl: 'https://opensubtitles-v3.strem.io/manifest.json',
            types: ['movie', 'series'],
            catalogs: [],
            resources: [
              {
                name: 'subtitles',
                types: ['movie', 'series'],
                idPrefixes: ['tt']
              }
            ],
            behaviorHints: {
              configurable: false
            }
          };
          this.installedAddons.set(fallbackManifest.installationId!, fallbackManifest);
        }
      }

      // Load addon order if exists (scoped first, then legacy, then @user:local for migration safety)
      let storedOrder = await mmkvStorage.getItem(`@user:${scope}:${this.ADDON_ORDER_KEY}`);
      if (!storedOrder) storedOrder = await mmkvStorage.getItem(this.ADDON_ORDER_KEY);
      if (!storedOrder) storedOrder = await mmkvStorage.getItem(`@user:local:${this.ADDON_ORDER_KEY}`);
      if (storedOrder) {
        this.addonOrder = JSON.parse(storedOrder);
        // Filter out any installationIds that aren't in installedAddons
        this.addonOrder = this.addonOrder.filter(installationId => this.installedAddons.has(installationId));
      }

      // Add Cinemeta to order only if user hasn't removed it
      const hasUserRemovedCinemetaOrder = await this.hasUserRemovedAddon(cinemetaId);
      const cinemetaInstallation = Array.from(this.installedAddons.values()).find(addon => addon.id === cinemetaId);
      if (cinemetaInstallation && cinemetaInstallation.installationId &&
          !this.addonOrder.includes(cinemetaInstallation.installationId) && !hasUserRemovedCinemetaOrder) {
        this.addonOrder.push(cinemetaInstallation.installationId);
      }

      // Only add OpenSubtitles to order if user hasn't removed it
      const hasUserRemovedOpenSubtitlesOrder = await this.hasUserRemovedAddon(opensubsId);
      const opensubsInstallation = Array.from(this.installedAddons.values()).find(addon => addon.id === opensubsId);
      if (opensubsInstallation && opensubsInstallation.installationId &&
          !this.addonOrder.includes(opensubsInstallation.installationId) && !hasUserRemovedOpenSubtitlesOrder) {
        this.addonOrder.push(opensubsInstallation.installationId);
      }

      // Add any missing addons to the order (use installationIds)
      const installedInstallationIds = Array.from(this.installedAddons.keys());
      const missingInstallationIds = installedInstallationIds.filter(installationId => !this.addonOrder.includes(installationId));
      this.addonOrder = [...this.addonOrder, ...missingInstallationIds];

      // Ensure order and addons are saved
      await this.saveAddonOrder();
      await this.saveInstalledAddons();

      this.initialized = true;
    } catch (error) {
      // Initialize with empty state on error
      this.installedAddons = new Map();
      this.addonOrder = [];
      this.initialized = true;
    }
  }

  // Ensure service is initialized before any operation
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  private async retryRequest<T>(request: () => Promise<T>, retries = 1, delay = 1000): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < retries + 1; attempt++) {
      try {
        return await request();
      } catch (error: any) {
        lastError = error;

        // Don't retry on 404 errors (content not found) - these are expected for some content
        if (error.response?.status === 404) {
          throw error;
        }

        // Only log warnings for non-404 errors to reduce noise
        if (error.response?.status !== 404) {
          logger.warn(`Request failed (attempt ${attempt + 1}/${retries + 1}):`, {
            message: error.message,
            code: error.code,
            isAxiosError: error.isAxiosError,
            status: error.response?.status,
          });
        }

        if (attempt < retries) {
          const backoffDelay = delay * Math.pow(2, attempt);
          logger.log(`Retrying in ${backoffDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }
    throw lastError;
  }

  private async saveInstalledAddons(): Promise<void> {
    try {
      const addonsArray = Array.from(this.installedAddons.values());
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      // Write to both scoped and legacy keys for compatibility
      await Promise.all([
        mmkvStorage.setItem(`@user:${scope}:${this.STORAGE_KEY}`, JSON.stringify(addonsArray)),
        mmkvStorage.setItem(this.STORAGE_KEY, JSON.stringify(addonsArray)),
      ]);
    } catch (error) {
      // Continue even if save fails
    }
  }

  private async saveAddonOrder(): Promise<void> {
    try {
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      // Write to both scoped and legacy keys for compatibility
      await Promise.all([
        mmkvStorage.setItem(`@user:${scope}:${this.ADDON_ORDER_KEY}`, JSON.stringify(this.addonOrder)),
        mmkvStorage.setItem(this.ADDON_ORDER_KEY, JSON.stringify(this.addonOrder)),
      ]);
    } catch (error) {
      // Continue even if save fails
    }
  }

  async getManifest(url: string): Promise<Manifest> {
    try {
      // Clean up URL - ensure it ends with manifest.json
      const manifestUrl = url.endsWith('manifest.json')
        ? url
        : `${url.replace(/\/$/, '')}/manifest.json`;

      const response = await this.retryRequest(async () => {
        return await axios.get(manifestUrl, safeAxiosConfig);
      });

      const manifest = response.data;

      // Add some extra fields for internal use
      manifest.originalUrl = url;
      manifest.url = url.replace(/manifest\.json$/, '');

      // Ensure ID exists
      if (!manifest.id) {
        manifest.id = this.formatId(url);
      }

      return manifest;
    } catch (error) {
      logger.error(`Failed to fetch manifest from ${url}:`, error);
      throw new Error(`Failed to fetch addon manifest from ${url}`);
    }
  }

  async installAddon(url: string): Promise<void> {
    const manifest = await this.getManifest(url);
    if (manifest && manifest.id) {
      // Check if this addon is already installed
      const existingInstallations = Array.from(this.installedAddons.values()).filter(a => a.id === manifest.id);
      const isAlreadyInstalled = existingInstallations.length > 0;

      // Only allow multiple installations for stream-providing addons
      if (isAlreadyInstalled && !this.addonProvidesStreams(manifest)) {
        throw new Error('This addon is already installed. Multiple installations are only allowed for stream providers.');
      }

      // Generate a unique installation ID for this installation
      manifest.installationId = this.generateInstallationId(manifest.id);

      // Store using installationId as key (allows multiple installations of same addon)
      this.installedAddons.set(manifest.installationId, manifest);

      // If addon was previously removed by user, unmark it on reinstall and clean up
      await this.unmarkAddonAsRemovedByUser(manifest.id);
      await this.cleanupRemovedAddonFromStorage(manifest.id);

      // Add installationId to order (new addons go to the end)
      if (!this.addonOrder.includes(manifest.installationId)) {
        this.addonOrder.push(manifest.installationId);
      }

      await this.saveInstalledAddons();
      await this.saveAddonOrder();
      // Emit an event that an addon was added (include both ids for compatibility)
      addonEmitter.emit(ADDON_EVENTS.ADDON_ADDED, { installationId: manifest.installationId, addonId: manifest.id });
    } else {
      throw new Error('Invalid addon manifest');
    }
  }

  async removeAddon(installationId: string): Promise<void> {
    // Allow removal of any addon installation, including pre-installed ones like Cinemeta
    if (this.installedAddons.has(installationId)) {
      const addon = this.installedAddons.get(installationId);
      this.installedAddons.delete(installationId);
      // Remove from order using installationId
      this.addonOrder = this.addonOrder.filter(id => id !== installationId);

      // Track user explicit removal only if this is the last installation of this addon
      if (addon) {
        const remainingInstallations = Array.from(this.installedAddons.values()).filter(a => a.id === addon.id);
        if (remainingInstallations.length === 0) {
          // This was the last installation, mark addon as removed by user
          await this.markAddonAsRemovedByUser(addon.id);
          // Proactively clean up any persisted orders/legacy keys for this addon
          await this.cleanupRemovedAddonFromStorage(addon.id);
        }
      }

      // Persist removals before app possibly exits
      await this.saveInstalledAddons();
      await this.saveAddonOrder();
      // Emit an event that an addon was removed
      addonEmitter.emit(ADDON_EVENTS.ADDON_REMOVED, installationId);
    }
  }

  getInstalledAddons(): Manifest[] {
    // Return addons in the specified order (using installationIds)
    const result = this.addonOrder
      .filter(installationId => this.installedAddons.has(installationId))
      .map(installationId => this.installedAddons.get(installationId)!);
    return result;
  }

  async getInstalledAddonsAsync(): Promise<Manifest[]> {
    await this.ensureInitialized();
    return this.getInstalledAddons();
  }

  // Check if an addon is pre-installed and cannot be removed
  isPreInstalledAddon(id: string): boolean {
    // Allow removing all addons, including Cinemeta
    return false;
  }

  // Check if user has explicitly removed an addon
  async hasUserRemovedAddon(addonId: string): Promise<boolean> {
    try {
      const removedAddons = await mmkvStorage.getItem('user_removed_addons');
      if (!removedAddons) return false;
      const removedList = JSON.parse(removedAddons);
      return Array.isArray(removedList) && removedList.includes(addonId);
    } catch (error) {
      return false;
    }
  }

  // Mark an addon as removed by user
  private async markAddonAsRemovedByUser(addonId: string): Promise<void> {
    try {
      const removedAddons = await mmkvStorage.getItem('user_removed_addons');
      let removedList = removedAddons ? JSON.parse(removedAddons) : [];
      if (!Array.isArray(removedList)) removedList = [];

      if (!removedList.includes(addonId)) {
        removedList.push(addonId);
        await mmkvStorage.setItem('user_removed_addons', JSON.stringify(removedList));
      }
    } catch (error) {
      // Silently fail - this is not critical functionality
    }
  }

  // Remove an addon from the user removed list (allows reinstallation)
  async unmarkAddonAsRemovedByUser(addonId: string): Promise<void> {
    try {
      const removedAddons = await mmkvStorage.getItem('user_removed_addons');
      if (!removedAddons) return;

      let removedList = JSON.parse(removedAddons);
      if (!Array.isArray(removedList)) return;

      const updatedList = removedList.filter(id => id !== addonId);
      await mmkvStorage.setItem('user_removed_addons', JSON.stringify(updatedList));
    } catch (error) {
      // Silently fail - this is not critical functionality
    }
  }

  // Clean up removed addon from all storage locations
  private async cleanupRemovedAddonFromStorage(addonId: string): Promise<void> {
    try {
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';

      // Remove from all possible addon order storage keys
      const keys = [
        `@user:${scope}:${this.ADDON_ORDER_KEY}`,
        this.ADDON_ORDER_KEY,
        `@user:local:${this.ADDON_ORDER_KEY}`
      ];

      for (const key of keys) {
        const storedOrder = await mmkvStorage.getItem(key);
        if (storedOrder) {
          const order = JSON.parse(storedOrder);
          if (Array.isArray(order)) {
            const updatedOrder = order.filter(id => id !== addonId);
            await mmkvStorage.setItem(key, JSON.stringify(updatedOrder));
          }
        }
      }
    } catch (error) {
      // Silently fail - this is not critical functionality
    }
  }

  private formatId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  }

  async getAllCatalogs(): Promise<{ [addonId: string]: Meta[] }> {
    const result: { [addonId: string]: Meta[] } = {};
    const addons = this.getInstalledAddons();

    const promises = addons.map(async (addon) => {
      if (!addon.catalogs || addon.catalogs.length === 0) return;

      const catalog = addon.catalogs[0]; // Just take the first catalog for now

      try {
        const items = await this.getCatalog(addon, catalog.type, catalog.id);
        if (items.length > 0) {
          result[addon.id] = items;
        }
      } catch (error) {
        logger.error(`Failed to fetch catalog from ${addon.name}:`, error);
      }
    });

    await Promise.all(promises);
    return result;
  }

  private getAddonBaseURL(url: string): { baseUrl: string; queryParams?: string } {
    // Extract query parameters if they exist
    const [baseUrl, queryString] = url.split('?');

    // Remove trailing manifest.json and slashes
    let cleanBaseUrl = baseUrl.replace(/manifest\.json$/, '').replace(/\/$/, '');

    // Ensure URL has protocol
    if (!cleanBaseUrl.startsWith('http')) {
      cleanBaseUrl = `https://${cleanBaseUrl}`;
    }

    return { baseUrl: cleanBaseUrl, queryParams: queryString };
  }

  async getCatalog(manifest: Manifest, type: string, id: string, page = 1, filters: CatalogFilter[] = []): Promise<Meta[]> {
    // Build URLs per Stremio protocol: /{resource}/{type}/{id}/{extraArgs}.json
    // Extra args (search, genre, skip) go in path segment, NOT query params
    const encodedId = encodeURIComponent(id);
    const pageSkip = (page - 1) * this.DEFAULT_PAGE_SIZE;

    // For all addons
    if (!manifest.url) {
      throw new Error('Addon URL is missing');
    }

    try {
      if (__DEV__) console.log(`🔍 [getCatalog] Manifest URL for ${manifest.name}: ${manifest.url}`);
      const { baseUrl, queryParams } = this.getAddonBaseURL(manifest.url);

      // Build extraArgs as combined path segment per protocol
      // Format: /catalog/{type}/{id}/{extraArgs}.json where extraArgs is like "genre=Action&skip=100"
      const extraParts: string[] = [];

      // Add filters to extra args (genre, search, etc.)
      if (filters && filters.length > 0) {
        filters.filter(f => f && f.value).forEach(f => {
          extraParts.push(`${encodeURIComponent(f.title)}=${encodeURIComponent(f.value)}`);
        });
      }

      // Add skip for pagination (only if not page 1)
      if (pageSkip > 0) {
        extraParts.push(`skip=${pageSkip}`);
      }

      // Build the extraArgs path segment
      const extraArgsPath = extraParts.length > 0 ? `/${extraParts.join('&')}` : '';

      // Construct URLs per protocol
      // Primary: Path-style with extra args in path segment
      const urlPathStyle = `${baseUrl}/catalog/${type}/${encodedId}${extraArgsPath}.json${queryParams ? `?${queryParams}` : ''}`;

      // Fallback for page 1 without filters: simple URL
      const urlSimple = `${baseUrl}/catalog/${type}/${encodedId}.json${queryParams ? `?${queryParams}` : ''}`;

      // Legacy fallback: Query-style URL (for older addons)
      const legacyFilterQuery = (filters || [])
        .filter(f => f && f.value)
        .map(f => `&${encodeURIComponent(f.title)}=${encodeURIComponent(f.value!)}`)
        .join('');
      let urlQueryStyle = `${baseUrl}/catalog/${type}/${encodedId}.json?skip=${pageSkip}&limit=${this.DEFAULT_PAGE_SIZE}`;
      if (queryParams) urlQueryStyle += `&${queryParams}`;
      urlQueryStyle += legacyFilterQuery;

      // Try URLs in order of compatibility
      let response;
      try {
        // For page 1 without filters, try simple URL first (best compatibility)
        if (pageSkip === 0 && extraParts.length === 0) {
          if (__DEV__) console.log(`🔍 [getCatalog] Trying simple URL for ${manifest.name}: ${urlSimple}`);
          response = await this.retryRequest(async () => axios.get(urlSimple, safeAxiosConfig));
          // Check if we got valid metas - if empty, try other styles
          if (!response?.data?.metas || response.data.metas.length === 0) {
            throw new Error('Empty response from simple URL');
          }
        } else {
          throw new Error('Has extra args, use path-style');
        }
      } catch (e) {
        try {
          // Try path-style URL (correct per protocol)
          if (__DEV__) console.log(`🔍 [getCatalog] Trying path-style URL for ${manifest.name}: ${urlPathStyle}`);
          response = await this.retryRequest(async () => axios.get(urlPathStyle, safeAxiosConfig));
          // Check if we got valid metas - if empty, try query-style
          if (!response?.data?.metas || response.data.metas.length === 0) {
            throw new Error('Empty response from path-style URL');
          }
        } catch (e2) {
          try {
            // Try legacy query-style URL as last resort
            if (__DEV__) console.log(`🔍 [getCatalog] Trying query-style URL for ${manifest.name}: ${urlQueryStyle}`);
            response = await this.retryRequest(async () => axios.get(urlQueryStyle, safeAxiosConfig));
          } catch (e3) {
            if (__DEV__) console.log(`❌ [getCatalog] All URL styles failed for ${manifest.name}`);
            throw e3;
          }
        }
      }

      if (response && response.data) {
        const hasMore = typeof response.data.hasMore === 'boolean' ? response.data.hasMore : undefined;
        try {
          const key = `${manifest.id}|${type}|${id}`;
          if (typeof hasMore === 'boolean') this.catalogHasMore.set(key, hasMore);
        } catch { }
        if (response.data.metas && Array.isArray(response.data.metas)) {
          return response.data.metas;
        }
      }
      return [];
    } catch (error) {
      logger.error(`Failed to fetch catalog from ${manifest.name}:`, error);
      throw error;
    }
  }

  public getCatalogHasMore(manifestId: string, type: string, id: string): boolean | undefined {
    const key = `${manifestId}|${type}|${id}`;
    return this.catalogHasMore.get(key);
  }

  async getMetaDetails(type: string, id: string, preferredAddonId?: string): Promise<MetaDetails | null> {
    try {
      // Validate content ID first
      const isValidId = await this.isValidContentId(type, id);

      if (!isValidId) {
        return null;
      }

      const addons = this.getInstalledAddons();

      // If a preferred addon is specified, try it first
      if (preferredAddonId) {
        const preferredAddon = addons.find(addon => addon.id === preferredAddonId);

        if (preferredAddon && preferredAddon.resources) {
          // Build URL for metadata request
          const { baseUrl, queryParams } = this.getAddonBaseURL(preferredAddon.url || '');
          const encodedId = encodeURIComponent(id);
          const url = queryParams ? `${baseUrl}/meta/${type}/${encodedId}.json?${queryParams}` : `${baseUrl}/meta/${type}/${encodedId}.json`;

          // Check if addon supports meta resource for this type
          let hasMetaSupport = false;
          let supportsIdPrefix = false;

          for (const resource of preferredAddon.resources) {
            // Check if the current element is a ResourceObject
            if (typeof resource === 'object' && resource !== null && 'name' in resource) {
              const typedResource = resource as ResourceObject;
              if (typedResource.name === 'meta' &&
                Array.isArray(typedResource.types) &&
                typedResource.types.includes(type)) {
                hasMetaSupport = true;
                // Check idPrefix support
                if (Array.isArray(typedResource.idPrefixes) && typedResource.idPrefixes.length > 0) {
                  supportsIdPrefix = typedResource.idPrefixes.some(p => id.startsWith(p));
                } else {
                  supportsIdPrefix = true;
                }
                break;
              }
            }
            // Check if the element is the simple string "meta" AND the addon has a top-level types array
            else if (typeof resource === 'string' && resource === 'meta' && preferredAddon.types) {
              if (Array.isArray(preferredAddon.types) && preferredAddon.types.includes(type)) {
                hasMetaSupport = true;
                // Check addon-level idPrefixes
                if (preferredAddon.idPrefixes && Array.isArray(preferredAddon.idPrefixes) && preferredAddon.idPrefixes.length > 0) {
                  supportsIdPrefix = preferredAddon.idPrefixes.some(p => id.startsWith(p));
                } else {
                  supportsIdPrefix = true;
                }
                break;
              }
            }
          }


          // Only require ID prefix compatibility if the addon has declared specific prefixes
          const requiresIdPrefix = preferredAddon.idPrefixes && preferredAddon.idPrefixes.length > 0;
          const isSupported = hasMetaSupport && (!requiresIdPrefix || supportsIdPrefix);

          if (isSupported) {
            try {
              const response = await this.retryRequest(async () => {
                return await axios.get(url, createSafeAxiosConfig(10000));
              });


              if (response.data && response.data.meta && response.data.meta.id) {
                return response.data.meta;
              } else {
                if (__DEV__) console.warn(`⚠️ [getMetaDetails] Preferred addon ${preferredAddon.name} returned empty/invalid meta`);
              }
            } catch (error: any) {
              // Continue trying other addons
            }
          } else {
          }
        }
      }

      // Try Cinemeta with different base URLs
      const cinemetaUrls = [
        'https://v3-cinemeta.strem.io',
        'http://v3-cinemeta.strem.io'
      ];


      for (const baseUrl of cinemetaUrls) {
        try {
          const encodedId = encodeURIComponent(id);
          const url = `${baseUrl}/meta/${type}/${encodedId}.json`;


          const response = await this.retryRequest(async () => {
            return await axios.get(url, createSafeAxiosConfig(10000));
          });


          if (response.data && response.data.meta && response.data.meta.id) {
            return response.data.meta;
          } else {
            if (__DEV__) console.log(`[getMetaDetails] Cinemeta URL ${baseUrl} returned empty/invalid meta`);
          }
        } catch (error: any) {
          continue; // Try next URL
        }
      }

      // If Cinemeta fails, try other addons (excluding the preferred one already tried)
      for (const addon of addons) {
        if (!addon.resources || addon.id === 'com.linvo.cinemeta' || addon.id === preferredAddonId) continue;

        // Check if addon supports meta resource for this type AND idPrefix (handles both string and object formats)
        let hasMetaSupport = false;
        let supportsIdPrefix = false;

        for (const resource of addon.resources) {
          // Check if the current element is a ResourceObject
          if (typeof resource === 'object' && resource !== null && 'name' in resource) {
            const typedResource = resource as ResourceObject;
            if (typedResource.name === 'meta' &&
              Array.isArray(typedResource.types) &&
              typedResource.types.includes(type)) {
              hasMetaSupport = true;
              // Match idPrefixes if present; otherwise assume support
              if (Array.isArray(typedResource.idPrefixes) && typedResource.idPrefixes.length > 0) {
                supportsIdPrefix = typedResource.idPrefixes.some(p => id.startsWith(p));
              } else {
                supportsIdPrefix = true;
              }
              break;
            }
          }
          // Check if the element is the simple string "meta" AND the addon has a top-level types array
          else if (typeof resource === 'string' && resource === 'meta' && addon.types) {
            if (Array.isArray(addon.types) && addon.types.includes(type)) {
              hasMetaSupport = true;
              // For simple resources, check addon-level idPrefixes if present
              if (addon.idPrefixes && Array.isArray(addon.idPrefixes) && addon.idPrefixes.length > 0) {
                supportsIdPrefix = addon.idPrefixes.some(p => id.startsWith(p));
              } else {
                supportsIdPrefix = true;
              }
              break;
            }
          }
        }

        // Require meta support, but allow any ID if addon doesn't declare specific prefixes

        // Only require ID prefix compatibility if the addon has declared specific prefixes
        const requiresIdPrefix = addon.idPrefixes && addon.idPrefixes.length > 0;
        const isSupported = hasMetaSupport && (!requiresIdPrefix || supportsIdPrefix);

        if (!isSupported) {
          continue;
        }

        try {
          const { baseUrl, queryParams } = this.getAddonBaseURL(addon.url || '');
          const encodedId = encodeURIComponent(id);
          const url = queryParams ? `${baseUrl}/meta/${type}/${encodedId}.json?${queryParams}` : `${baseUrl}/meta/${type}/${encodedId}.json`;


          const response = await this.retryRequest(async () => {
            return await axios.get(url, createSafeAxiosConfig(10000));
          });


          if (response.data && response.data.meta && response.data.meta.id) {
            return response.data.meta;
          } else {
            if (__DEV__) console.log(`[getMetaDetails] Addon ${addon.name} returned empty/invalid meta`);
          }
        } catch (error: any) {
          continue; // Try next addon
        }
      }

      return null;
    } catch (error) {
      logger.error('Error in getMetaDetails:', error);
      return null;
    }
  }

  /**
   * Memory-efficient method to fetch only upcoming episodes within a specific date range
   * This prevents over-fetching all episode data and reduces memory consumption
   */
  async getUpcomingEpisodes(
    type: string,
    id: string,
    options: {
      daysBack?: number;
      daysAhead?: number;
      maxEpisodes?: number;
      preferredAddonId?: string;
    } = {}
  ): Promise<{ seriesName: string; poster: string; episodes: any[] } | null> {
    const { daysBack = 14, daysAhead = 28, maxEpisodes = 50, preferredAddonId } = options;

    try {
      // Get metadata first (this is lightweight compared to episodes)
      const metadata = await this.getMetaDetails(type, id, preferredAddonId);
      if (!metadata) {
        return null;
      }

      // If no videos array exists, return basic info
      if (!metadata.videos || metadata.videos.length === 0) {
        return {
          seriesName: metadata.name,
          poster: metadata.poster || '',
          episodes: []
        };
      }

      const now = new Date();
      const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
      const endDate = new Date(now.getTime() + (daysAhead * 24 * 60 * 60 * 1000));

      // Filter episodes to only include those within our date range
      // This is done immediately after fetching to reduce memory footprint

      const filteredEpisodes = metadata.videos
        .filter(video => {
          if (!video.released) {
            logger.log(`[StremioService] Episode ${video.id} has no release date`);
            return false;
          }
          const releaseDate = new Date(video.released);
          const inRange = releaseDate >= startDate && releaseDate <= endDate;
          return inRange;
        })
        .sort((a, b) => new Date(a.released).getTime() - new Date(b.released).getTime())
        .slice(0, maxEpisodes); // Limit number of episodes to prevent memory overflow


      return {
        seriesName: metadata.name,
        poster: metadata.poster || '',
        episodes: filteredEpisodes
      };
    } catch (error) {
      logger.error(`[StremioService] Error fetching upcoming episodes for ${id}:`, error);
      return null;
    }
  }

  // Modify getStreams to use this.getInstalledAddons() instead of getEnabledAddons
  async getStreams(type: string, id: string, callback?: StreamCallback): Promise<void> {
    await this.ensureInitialized();

    const addons = this.getInstalledAddons();

    // Some addons use non-standard meta types (e.g. "anime") but expect streams under the "series" endpoint.
    // We'll try the requested type first, then (if no addons match) fall back to "series".
    const pickStreamAddons = (requestType: string) =>
      addons.filter(addon => {
        if (!addon.resources || !Array.isArray(addon.resources)) {
          logger.log(`⚠️ [getStreams] Addon ${addon.id} has no valid resources array`);
          return false;
        }

        let hasStreamResource = false;
        let supportsIdPrefix = false;

        for (const resource of addon.resources) {
          if (typeof resource === 'object' && resource !== null && 'name' in resource) {
            const typedResource = resource as ResourceObject;
            if (typedResource.name === 'stream' &&
              Array.isArray(typedResource.types) &&
              typedResource.types.includes(requestType)) {
              hasStreamResource = true;

              if (Array.isArray(typedResource.idPrefixes) && typedResource.idPrefixes.length > 0) {
                supportsIdPrefix = typedResource.idPrefixes.some(p => id.startsWith(p));
              } else {
                supportsIdPrefix = true;
              }
              break;
            }
          } else if (typeof resource === 'string' && resource === 'stream' && addon.types) {
            if (Array.isArray(addon.types) && addon.types.includes(requestType)) {
              hasStreamResource = true;
              if (addon.idPrefixes && Array.isArray(addon.idPrefixes) && addon.idPrefixes.length > 0) {
                supportsIdPrefix = addon.idPrefixes.some(p => id.startsWith(p));
              } else {
                supportsIdPrefix = true;
              }
              break;
            }
          }
        }

        return hasStreamResource && supportsIdPrefix;
      });

    // Check if local scrapers are enabled and execute them first
    try {
      // Load settings from AsyncStorage directly (scoped with fallback)
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const settingsJson = (await mmkvStorage.getItem(`@user:${scope}:app_settings`))
        || (await mmkvStorage.getItem('app_settings'));
      const rawSettings = settingsJson ? JSON.parse(settingsJson) : {};
      const settings: AppSettings = { ...DEFAULT_SETTINGS, ...rawSettings };

      if (settings.enableLocalScrapers) {
        const hasScrapers = await localScraperService.hasScrapers();
        if (hasScrapers) {
          logger.log('🔧 [getStreams] Executing local scrapers for', type, id);

          // Map Stremio types to local scraper types
          const scraperType = type === 'series' ? 'tv' : type;

          // Parse the Stremio ID to extract ID and season/episode info
          let tmdbId: string | null = null;
          let season: number | undefined = undefined;
          let episode: number | undefined = undefined;
          let idType: 'imdb' | 'kitsu' | 'tmdb' = 'imdb';

          try {
            const idParts = id.split(':');
            let baseId: string;

            // Handle different episode ID formats
            if (idParts[0] === 'series') {
              // Format: series:imdbId:season:episode or series:kitsu:7442:season:episode
              baseId = idParts[1];
              if (scraperType === 'tv' && idParts.length >= 4) {
                season = parseInt(idParts[2], 10);
                episode = parseInt(idParts[3], 10);
              }
              // Check if it's a kitsu ID
              if (idParts[1] === 'kitsu') {
                idType = 'kitsu';
                baseId = idParts[2]; // kitsu:7442:season:episode -> baseId = 7442
                if (scraperType === 'tv' && idParts.length >= 5) {
                  season = parseInt(idParts[3], 10);
                  episode = parseInt(idParts[4], 10);
                }
              }
            } else if (idParts[0].startsWith('tt')) {
              // Format: imdbId:season:episode (direct IMDb ID)
              baseId = idParts[0];
              idType = 'imdb';
              if (scraperType === 'tv' && idParts.length >= 3) {
                season = parseInt(idParts[1], 10);
                episode = parseInt(idParts[2], 10);
              }
            } else if (idParts[0] === 'kitsu') {
              // Format: kitsu:7442:season:episode (direct Kitsu ID)
              baseId = idParts[1];
              idType = 'kitsu';
              if (scraperType === 'tv' && idParts.length >= 4) {
                season = parseInt(idParts[2], 10);
                episode = parseInt(idParts[3], 10);
              }
            } else if (idParts[0] === 'tmdb') {
              // Format: tmdb:286801:season:episode (direct TMDB ID)
              baseId = idParts[1];
              idType = 'tmdb';
              if (scraperType === 'tv' && idParts.length >= 4) {
                season = parseInt(idParts[2], 10);
                episode = parseInt(idParts[3], 10);
              }
            } else {
              // Fallback: assume first part is the ID
              baseId = idParts[0];
              if (scraperType === 'tv' && idParts.length >= 3) {
                season = parseInt(idParts[1], 10);
                episode = parseInt(idParts[2], 10);
              }
            }

            // Handle ID conversion for local scrapers (they need TMDB ID)
            if (idType === 'imdb') {
              // Convert IMDb ID to TMDB ID
              const tmdbService = TMDBService.getInstance();
              const tmdbIdNumber = await tmdbService.findTMDBIdByIMDB(baseId);
              if (tmdbIdNumber) {
                tmdbId = tmdbIdNumber.toString();
              } else {
                logger.log('🔧 [getStreams] Skipping local scrapers: could not convert IMDb to TMDB for', baseId);
              }
            } else if (idType === 'tmdb') {
              // Already have TMDB ID, use it directly
              tmdbId = baseId;
              logger.log('🔧 [getStreams] Using TMDB ID directly for local scrapers:', tmdbId);
            } else if (idType === 'kitsu') {
              // For kitsu IDs, skip local scrapers as they don't support kitsu
              logger.log('🔧 [getStreams] Skipping local scrapers for kitsu ID:', baseId);
            } else {
              // For other ID types, try to use as TMDB ID
              tmdbId = baseId;
              logger.log('🔧 [getStreams] Using base ID as TMDB ID for local scrapers:', tmdbId);
            }
          } catch (error) {
            logger.warn('🔧 [getStreams] Skipping local scrapers due to ID parsing error:', error);
          }

          // Execute local scrapers asynchronously with TMDB ID (when available)
          if (tmdbId) {
            localScraperService.getStreams(scraperType, tmdbId, season, episode, (streams, scraperId, scraperName, error) => {
              // Always call callback to ensure UI updates, regardless of result
              if (callback) {
                if (error) {
                  callback(null, scraperId, scraperName, error);
                } else if (streams && streams.length > 0) {
                  callback(streams, scraperId, scraperName, null);
                } else {
                  // Handle case where scraper completed successfully but returned no streams
                  // This ensures the scraper is removed from "fetching" state in UI
                  callback([], scraperId, scraperName, null);
                }
              }
            });
          } else {
            logger.log('🔧 [getStreams] Local scrapers not executed - no TMDB ID available');
            // Notify UI that local scrapers won't execute by calling their callbacks
            try {
              const installedScrapers = await localScraperService.getInstalledScrapers();
              const enabledScrapers = installedScrapers.filter(s => s.enabled);
              enabledScrapers.forEach(scraper => {
                if (callback) {
                  callback([], scraper.id, scraper.name, null);
                }
              });
            } catch (error) {
              logger.warn('🔧 [getStreams] Failed to notify UI about skipped local scrapers:', error);
            }
          }
        }
      }
    } catch (error) {
      // Continue even if local scrapers fail
    }

    // Check specifically for TMDB Embed addon
    const tmdbEmbed = addons.find(addon => addon.id === 'org.tmdbembedapi');
    if (!tmdbEmbed) {
      // TMDB Embed addon not found
    }

    let effectiveType = type;
    let streamAddons = pickStreamAddons(type);

    logger.log(`🧭 [getStreams] Resolving stream addons for type='${type}' id='${id}' (matched=${streamAddons.length})`);

    if (streamAddons.length === 0) {
      const fallbackTypes = ['series', 'movie', 'tv', 'channel'].filter(t => t !== type);
      for (const fallbackType of fallbackTypes) {
        const fallbackAddons = pickStreamAddons(fallbackType);
        if (fallbackAddons.length > 0) {
          effectiveType = fallbackType;
          streamAddons = fallbackAddons;
          logger.log(`🔁 [getStreams] No stream addons for type '${type}', falling back to '${effectiveType}' for id '${id}'`);
          break;
        }
      }
    }

    if (effectiveType !== type) {
      logger.log(`🧭 [getStreams] Using effectiveType='${effectiveType}' (requested='${type}') for id='${id}'`);
    }

    if (streamAddons.length === 0) {
      logger.warn('⚠️ [getStreams] No addons found that can provide streams');
      
      // Log what the URL would have been for debugging
      const encodedId = encodeURIComponent(id);
      const exampleUrl = `/stream/${effectiveType}/${encodedId}.json`;
      logger.log(`🚫 [getStreams] No stream addons matched. Would have requested: ${exampleUrl}`);
      logger.log(`🚫 [getStreams] Details: requestedType='${type}' effectiveType='${effectiveType}' id='${id}'`);
      
      // Show which addons have stream capability but didn't match
      const streamCapableAddons = addons.filter(addon => {
        if (!addon.resources || !Array.isArray(addon.resources)) return false;
        return addon.resources.some(resource => {
          if (typeof resource === 'object' && resource !== null && 'name' in resource) {
            return (resource as ResourceObject).name === 'stream';
          }
          return typeof resource === 'string' && resource === 'stream';
        });
      });
      
      if (streamCapableAddons.length > 0) {
        logger.log(`🚫 [getStreams] Found ${streamCapableAddons.length} stream-capable addon(s) that didn't match:`);
        
        for (const addon of streamCapableAddons) {
          const streamResources = addon.resources!.filter(resource => {
            if (typeof resource === 'object' && resource !== null && 'name' in resource) {
              return (resource as ResourceObject).name === 'stream';
            }
            return typeof resource === 'string' && resource === 'stream';
          });
          
          for (const resource of streamResources) {
            if (typeof resource === 'object' && resource !== null) {
              const typedResource = resource as ResourceObject;
              const types = typedResource.types || [];
              const prefixes = typedResource.idPrefixes || [];
              const typeMatch = types.includes(effectiveType);
              const prefixMatch = prefixes.length === 0 || prefixes.some(p => id.startsWith(p));
              
              if (addon.url) {
                const { baseUrl, queryParams } = this.getAddonBaseURL(addon.url);
                const wouldBeUrl = queryParams
                  ? `${baseUrl}/stream/${effectiveType}/${encodedId}.json?${queryParams}`
                  : `${baseUrl}/stream/${effectiveType}/${encodedId}.json`;
                
                console.log(
                  `  ❌ ${addon.name} (${addon.id}):\n` +
                  `     types=[${types.join(',')}] typeMatch=${typeMatch}\n` +
                  `     prefixes=[${prefixes.join(',')}] prefixMatch=${prefixMatch}\n` +
                  `     url=${wouldBeUrl}`
                );
              } else {
                console.log(`  ❌ ${addon.name} (${addon.id}): no URL configured`);
              }
            } else if (typeof resource === 'string' && resource === 'stream') {
              // String resource - check addon-level types and prefixes
              const addonTypes = addon.types || [];
              const addonPrefixes = addon.idPrefixes || [];
              const typeMatch = addonTypes.includes(effectiveType);
              const prefixMatch = addonPrefixes.length === 0 || addonPrefixes.some(p => id.startsWith(p));
              
              if (addon.url) {
                const { baseUrl, queryParams } = this.getAddonBaseURL(addon.url);
                const wouldBeUrl = queryParams
                  ? `${baseUrl}/stream/${effectiveType}/${encodedId}.json?${queryParams}`
                  : `${baseUrl}/stream/${effectiveType}/${encodedId}.json`;
                
                console.log(
                  `  ❌ ${addon.name} (${addon.id}) [addon-level]:\n` +
                  `     types=[${addonTypes.join(',')}] typeMatch=${typeMatch}\n` +
                  `     prefixes=[${addonPrefixes.join(',')}] prefixMatch=${prefixMatch}\n` +
                  `     url=${wouldBeUrl}`
                );
              }
            }
          }
        }
      } else {
        logger.log(`🚫 [getStreams] No stream-capable addons installed`);
      }
      
      return;
    }

    // Process each addon and call the callback individually
    streamAddons.forEach(addon => {
      // Use an IIFE to create scope for async operation inside forEach
      (async () => {
        try {
          if (!addon.url) {
            logger.warn(`⚠️ [getStreams] Addon ${addon.id} has no URL`);
            if (callback) callback(null, addon.id, addon.name, new Error('Addon has no URL'), addon.installationId);
            return;
          }

          const { baseUrl, queryParams } = this.getAddonBaseURL(addon.url);
          const encodedId = encodeURIComponent(id);
          const url = queryParams ? `${baseUrl}/stream/${effectiveType}/${encodedId}.json?${queryParams}` : `${baseUrl}/stream/${effectiveType}/${encodedId}.json`;

          logger.log(
            `🔗 [getStreams] GET ${url} (addon='${addon.name}' id='${addon.id}' install='${addon.installationId}' requestedType='${type}' effectiveType='${effectiveType}' rawId='${id}')`
          );

          const response = await this.retryRequest(async () => {
            return await axios.get(url, safeAxiosConfig);
          });

          let processedStreams: Stream[] = [];
          if (response.data && response.data.streams) {
            logger.log(`✅ [getStreams] Got ${response.data.streams.length} streams from ${addon.name} (${addon.id}) [${addon.installationId}]`);
            processedStreams = this.processStreams(response.data.streams, addon);
            logger.log(`✅ [getStreams] Processed ${processedStreams.length} valid streams from ${addon.name} (${addon.id}) [${addon.installationId}]`);
          } else {
            logger.log(`⚠️ [getStreams] No streams found in response from ${addon.name} (${addon.id}) [${addon.installationId}]`);
          }

          if (callback) {
            // Call callback with processed streams (can be empty array), include installationId
            callback(processedStreams, addon.id, addon.name, null, addon.installationId);
          }
        } catch (error) {
          if (callback) {
            // Call callback with error, include installationId
            callback(null, addon.id, addon.name, error as Error, addon.installationId);
          }
        }
      })(); // Immediately invoke the async function
    });

    // No longer waiting here, callbacks handle results asynchronously
    // Removed: await Promise.all(addonPromises.values());
    // No longer returning aggregated results
    // Removed: return streamResponses; 
  }

  private async fetchStreamsFromAddon(addon: Manifest, type: string, id: string): Promise<StreamResponse | null> {
    if (!addon.url) {
      logger.warn(`Addon ${addon.id} has no URL defined`);
      return null;
    }

    const { baseUrl, queryParams } = this.getAddonBaseURL(addon.url);
    const encodedId = encodeURIComponent(id);
    const streamPath = `/stream/${type}/${encodedId}.json`;
    const url = queryParams ? `${baseUrl}${streamPath}?${queryParams}` : `${baseUrl}${streamPath}`;

    logger.log(
      `🔗 [fetchStreamsFromAddon] GET ${url} (addon='${addon.name}' id='${addon.id}' install='${addon.installationId}' type='${type}' rawId='${id}')`
    );

    try {
      // Increase timeout for debrid services
      const timeout = addon.id.toLowerCase().includes('torrentio') ? 60000 : 10000;

      const response = await this.retryRequest(async () => {
        logger.log(`🌐 [fetchStreamsFromAddon] Requesting ${url} (timeout=${timeout}ms)`);
        return await axios.get(url, createSafeAxiosConfig(timeout, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36'
          }
        }));
      }, 5); // Increase retries for stream fetching

      if (response.data && response.data.streams && Array.isArray(response.data.streams)) {
        const streams = this.processStreams(response.data.streams, addon);
        logger.log(`Successfully processed ${streams.length} streams from ${addon.id}`);

        return {
          streams,
          addon: addon.id,
          addonName: addon.name
        };
      } else {
        logger.warn(`Invalid response format from ${addon.id}:`, response.data);
      }
    } catch (error: any) {
      const errorDetails = {
        addonId: addon.id,
        addonName: addon.name,
        url,
        message: error.message,
        code: error.code,
        isAxiosError: error.isAxiosError,
        status: error.response?.status,
        responseData: error.response?.data
      };
      // Re-throw the error with more context
      throw new Error(`Failed to fetch streams from ${addon.name}: ${error.message}`);
    }

    return null;
  }

  private isDirectStreamingUrl(url?: string): boolean {
    if (typeof url !== 'string') return false;
    return url.startsWith('http://') || url.startsWith('https://');
  }

  private getStreamUrl(stream: any): string {
    // Prefer plain string URLs; guard against objects or unexpected types
    if (typeof stream?.url === 'string') {
      return stream.url;
    }
    // Some addons might nest the URL inside an object; try common shape
    if (stream?.url && typeof stream.url === 'object' && typeof stream.url.url === 'string') {
      return stream.url.url;
    }

    // Handle YouTube video ID per protocol
    if (stream.ytId) {
      return `https://www.youtube.com/watch?v=${stream.ytId}`;
    }

    if (stream.infoHash) {
      const trackers = [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://9.rarbg.com:2810/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://open.stealth.si:80/announce',
        'udp://tracker.leechers-paradise.org:6969/announce',
        'udp://tracker.coppersurfer.tk:6969/announce',
        'udp://tracker.internetwarriors.net:1337/announce'
      ];
      // Add sources from stream if available per protocol
      const additionalTrackers = (stream.sources || [])
        .filter((s: string) => s.startsWith('tracker:'))
        .map((s: string) => s.replace('tracker:', ''));
      const allTrackers = [...trackers, ...additionalTrackers];
      const trackersString = allTrackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
      const encodedTitle = encodeURIComponent(stream.title || stream.name || 'Unknown');
      return `magnet:?xt=urn:btih:${stream.infoHash}&dn=${encodedTitle}${trackersString}`;
    }

    return '';
  }

  private processStreams(streams: any[], addon: Manifest): Stream[] {
    return streams
      .filter(stream => {
        // Basic filtering - ensure there's a way to play per protocol
        // One of: url, ytId, infoHash, externalUrl, nzbUrl, or archive arrays
        const hasPlayableLink = !!(
          stream.url ||
          stream.infoHash ||
          stream.ytId ||
          stream.externalUrl ||
          stream.nzbUrl ||
          (stream.rarUrls && stream.rarUrls.length > 0) ||
          (stream.zipUrls && stream.zipUrls.length > 0) ||
          (stream['7zipUrls'] && stream['7zipUrls'].length > 0) ||
          (stream.tgzUrls && stream.tgzUrls.length > 0) ||
          (stream.tarUrls && stream.tarUrls.length > 0)
        );
        const hasIdentifier = !!(stream.title || stream.name);
        return stream && hasPlayableLink && hasIdentifier;
      })
      .map(stream => {
        const streamUrl = this.getStreamUrl(stream);
        const isDirectStreamingUrl = this.isDirectStreamingUrl(streamUrl);
        const isMagnetStream = streamUrl?.startsWith('magnet:');
        const isExternalUrl = !!stream.externalUrl;
        const isYouTube = !!stream.ytId;

        // Prefer full, untruncated text to preserve complete addon details
        let displayTitle = stream.title || stream.name || 'Unnamed Stream';
        if (stream.description && stream.description.includes('\n') && stream.description.length > (stream.title?.length || 0)) {
          // If description exists and is likely the formatted metadata, prefer it as-is
          displayTitle = stream.description;
        }

        // Use full name for primary identifier if available
        let name = stream.name || stream.title || 'Unnamed Stream';

        // Extract size: Prefer behaviorHints.videoSize, fallback to top-level size
        const sizeInBytes = stream.behaviorHints?.videoSize || stream.size || undefined;

        // Preserve complete behaviorHints per protocol
        const behaviorHints: Stream['behaviorHints'] = {
          notWebReady: !isDirectStreamingUrl || isExternalUrl,
          cached: stream.behaviorHints?.cached || undefined,
          bingeGroup: stream.behaviorHints?.bingeGroup || undefined,
          // Per protocol: Country whitelist for geo-restrictions
          countryWhitelist: stream.behaviorHints?.countryWhitelist || undefined,
          // Per protocol: Proxy headers for custom stream headers
          proxyHeaders: stream.behaviorHints?.proxyHeaders || undefined,
          // Per protocol: Video metadata for subtitle matching
          videoHash: stream.behaviorHints?.videoHash || undefined,
          videoSize: stream.behaviorHints?.videoSize || undefined,
          filename: stream.behaviorHints?.filename || undefined,
          // Include essential torrent data for magnet streams
          ...(isMagnetStream ? {
            infoHash: stream.infoHash || streamUrl?.match(/btih:([a-zA-Z0-9]+)/)?.[1],
            fileIdx: stream.fileIdx,
            type: 'torrent',
          } : {}),
        };

        // Explicitly construct the final Stream object with all protocol fields
        const processedStream: Stream = {
          // Primary URL (may be empty for ytId/externalUrl streams)
          url: streamUrl || undefined,
          name: name,
          title: displayTitle,
          addonName: addon.name,
          addonId: addon.id,

          // Include description as-is to preserve full details
          description: stream.description,

          // Alternative source types per protocol
          ytId: stream.ytId || undefined,
          externalUrl: stream.externalUrl || undefined,
          nzbUrl: stream.nzbUrl || undefined,
          rarUrls: stream.rarUrls || undefined,
          zipUrls: stream.zipUrls || undefined,
          '7zipUrls': stream['7zipUrls'] || undefined,
          tgzUrls: stream.tgzUrls || undefined,
          tarUrls: stream.tarUrls || undefined,
          servers: stream.servers || undefined,

          // Torrent/archive file selection
          infoHash: stream.infoHash || undefined,
          fileIdx: stream.fileIdx,
          fileMustInclude: stream.fileMustInclude || undefined,

          // Stream metadata
          size: sizeInBytes,
          isFree: stream.isFree,
          isDebrid: !!(stream.behaviorHints?.cached),

          // Embedded subtitles per protocol
          subtitles: stream.subtitles?.map((sub: any, index: number) => ({
            id: sub.id || `${addon.id}-${sub.lang || 'unknown'}-${index}`,
            ...sub,
          })) || undefined,

          // Additional tracker/DHT sources per protocol
          sources: stream.sources || undefined,

          // Complete behavior hints
          behaviorHints: behaviorHints,
        };

        return processedStream;
      });
  }

  getAddonCapabilities(): AddonCapabilities[] {
    return this.getInstalledAddons().map(addon => {
      return {
        name: addon.name,
        id: addon.id,
        version: addon.version,
        catalogs: addon.catalogs || [],
        resources: addon.resources || [],
        types: addon.types || [],
      };
    });
  }

  async getCatalogPreview(addonId: string, type: string, id: string, limit: number = 5): Promise<{
    addon: string;
    type: string;
    id: string;
    items: Meta[];
  }> {
    const addon = this.getInstalledAddons().find(a => a.id === addonId);

    if (!addon) {
      throw new Error(`Addon ${addonId} not found`);
    }

    const items = await this.getCatalog(addon, type, id);
    return {
      addon: addonId,
      type,
      id,
      items: items.slice(0, limit)
    };
  }

  async getSubtitles(type: string, id: string, videoId?: string): Promise<Subtitle[]> {
    await this.ensureInitialized();
    // Collect from all installed addons that expose a subtitles resource
    const addons = this.getInstalledAddons();

    // The ID to check for prefix matching - use videoId for series (e.g., tt1234567:1:1), otherwise use id
    const idForChecking = type === 'series' && videoId
      ? videoId.replace('series:', '')
      : id;

    const subtitleAddons = addons.filter(addon => {
      if (!addon.resources) return false;

      // Check if addon has subtitles resource
      const subtitlesResource = addon.resources.find((resource: any) => {
        if (typeof resource === 'string') return resource === 'subtitles';
        return resource && resource.name === 'subtitles';
      });

      if (!subtitlesResource) return false;

      // Check type support - either from the resource object or addon-level types
      let supportsType = true;
      if (typeof subtitlesResource === 'object' && subtitlesResource.types) {
        supportsType = subtitlesResource.types.includes(type);
      } else if (addon.types) {
        supportsType = addon.types.includes(type);
      }

      if (!supportsType) {
        logger.log(`[getSubtitles] Addon ${addon.name} does not support type ${type}`);
        return false;
      }

      // Check idPrefixes - either from the resource object or addon-level
      let supportsIdPrefix = true;
      let idPrefixes: string[] | undefined;

      if (typeof subtitlesResource === 'object' && subtitlesResource.idPrefixes) {
        idPrefixes = subtitlesResource.idPrefixes;
      } else if (addon.idPrefixes) {
        idPrefixes = addon.idPrefixes;
      }

      if (idPrefixes && idPrefixes.length > 0) {
        supportsIdPrefix = idPrefixes.some(prefix => idForChecking.startsWith(prefix));
      }

      if (!supportsIdPrefix) {
        logger.log(`[getSubtitles] Addon ${addon.name} does not support ID prefix for ${idForChecking} (requires: ${idPrefixes?.join(', ')})`);
        return false;
      }

      return true;
    });

    if (subtitleAddons.length === 0) {
      logger.warn('No subtitle-capable addons installed that support the requested type/id');
      return [];
    }

    logger.log(`[getSubtitles] Found ${subtitleAddons.length} subtitle addons for ${type}/${id}: ${subtitleAddons.map(a => a.name).join(', ')}`);

    const requests = subtitleAddons.map(async (addon) => {
      if (!addon.url) return [] as Subtitle[];
      try {
        const { baseUrl, queryParams } = this.getAddonBaseURL(addon.url || '');
        let url = '';
        if (type === 'series' && videoId) {
          const episodeInfo = encodeURIComponent(videoId.replace('series:', ''));
          url = queryParams
            ? `${baseUrl}/subtitles/series/${episodeInfo}.json?${queryParams}`
            : `${baseUrl}/subtitles/series/${episodeInfo}.json`;
        } else {
          const encodedId = encodeURIComponent(id);
          url = queryParams
            ? `${baseUrl}/subtitles/${type}/${encodedId}.json?${queryParams}`
            : `${baseUrl}/subtitles/${type}/${encodedId}.json`;
        }
        logger.log(`[getSubtitles] Fetching subtitles from ${addon.name}: ${url}`);
        const response = await this.retryRequest(async () => axios.get(url, createSafeAxiosConfig(10000)));
        if (response.data && Array.isArray(response.data.subtitles)) {
          logger.log(`[getSubtitles] Got ${response.data.subtitles.length} subtitles from ${addon.name}`);
          return response.data.subtitles.map((sub: any, index: number) => ({
            // Ensure ID is always present per protocol (required field)
            id: sub.id || `${addon.id}-${sub.lang || 'unknown'}-${index}`,
            ...sub,
            addon: addon.id,
            addonName: addon.name,
          })) as Subtitle[];
        } else {
          logger.log(`[getSubtitles] No subtitles array in response from ${addon.name}`);
        }
      } catch (error: any) {
        logger.error(`[getSubtitles] Failed to fetch subtitles from ${addon.name}:`, error?.message || error);
      }
      return [] as Subtitle[];
    });

    const all = await Promise.all(requests);
    // Flatten and de-duplicate by URL
    const merged = ([] as Subtitle[]).concat(...all);
    const seen = new Set<string>();
    const deduped = merged.filter(s => {
      const key = s.url;
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    logger.log(`[getSubtitles] Total: ${deduped.length} unique subtitles from all addons`);
    return deduped;
  }

  // Add methods to move addons in the order (using installationIds)
  moveAddonUp(installationId: string): boolean {
    const index = this.addonOrder.indexOf(installationId);
    if (index > 0) {
      // Swap with the previous item
      [this.addonOrder[index - 1], this.addonOrder[index]] =
        [this.addonOrder[index], this.addonOrder[index - 1]];
      this.saveAddonOrder();
      // Emit an event that the order has changed
      addonEmitter.emit(ADDON_EVENTS.ORDER_CHANGED);
      return true;
    }
    return false;
  }

  moveAddonDown(installationId: string): boolean {
    const index = this.addonOrder.indexOf(installationId);
    if (index >= 0 && index < this.addonOrder.length - 1) {
      // Swap with the next item
      [this.addonOrder[index], this.addonOrder[index + 1]] =
        [this.addonOrder[index + 1], this.addonOrder[index]];
      this.saveAddonOrder();
      // Emit an event that the order has changed
      addonEmitter.emit(ADDON_EVENTS.ORDER_CHANGED);
      return true;
    }
    return false;
  }

  // Reconcile local addon order to match a remote ordered list of addon manifest URLs.
  // Any local addons not present in the remote list are appended in their current order.
  async applyAddonOrderFromManifestUrls(manifestUrls: string[]): Promise<boolean> {
    await this.ensureInitialized();
    if (!Array.isArray(manifestUrls) || manifestUrls.length === 0) return false;

    const normalizeManifestUrl = (raw: string): string => {
      const value = (raw || '').trim();
      if (!value) return '';
      const withManifest = value.includes('manifest.json')
        ? value
        : `${value.replace(/\/$/, '')}/manifest.json`;
      return withManifest.toLowerCase();
    };

    const localByNormalizedUrl = new Map<string, string[]>();
    for (const installationId of this.addonOrder) {
      const addon = this.installedAddons.get(installationId);
      if (!addon) continue;
      const normalized = normalizeManifestUrl(addon.originalUrl || addon.url || '');
      if (!normalized) continue;
      const list = localByNormalizedUrl.get(normalized) || [];
      list.push(installationId);
      localByNormalizedUrl.set(normalized, list);
    }

    const nextOrder: string[] = [];
    const seenInstallations = new Set<string>();

    for (const remoteUrl of manifestUrls) {
      const normalizedRemote = normalizeManifestUrl(remoteUrl);
      if (!normalizedRemote) continue;
      const candidates = localByNormalizedUrl.get(normalizedRemote);
      if (!candidates || candidates.length === 0) continue;
      const installationId = candidates.shift();
      if (!installationId || seenInstallations.has(installationId)) continue;
      nextOrder.push(installationId);
      seenInstallations.add(installationId);
    }

    for (const installationId of this.addonOrder) {
      if (!this.installedAddons.has(installationId)) continue;
      if (seenInstallations.has(installationId)) continue;
      nextOrder.push(installationId);
      seenInstallations.add(installationId);
    }

    const changed =
      nextOrder.length !== this.addonOrder.length ||
      nextOrder.some((id, index) => id !== this.addonOrder[index]);

    if (!changed) return false;

    this.addonOrder = nextOrder;
    await this.saveAddonOrder();
    addonEmitter.emit(ADDON_EVENTS.ORDER_CHANGED);
    return true;
  }

  // Check if any installed addons can provide streams (including embedded streams in metadata)
  async hasStreamProviders(type?: string): Promise<boolean> {
    await this.ensureInitialized();
    // App-level content type "tv" maps to Stremio "series"
    const normalizedType = type === 'tv' ? 'series' : type;
    const addons = Array.from(this.installedAddons.values());

    for (const addon of addons) {
      if (addon.resources && Array.isArray(addon.resources)) {
        // Check for explicit 'stream' resource
        const hasStreamResource = addon.resources.some(resource =>
          typeof resource === 'string'
            ? resource === 'stream'
            : (resource as any).name === 'stream'
        );

        if (hasStreamResource) {
          // If type specified, also check if addon supports this type
          if (normalizedType) {
            const supportsType = addon.types?.includes(normalizedType) ||
              addon.resources.some(resource =>
                typeof resource === 'object' &&
                (resource as any).name === 'stream' &&
                (resource as any).types?.includes(normalizedType)
              );
            if (supportsType) return true;
          } else {
            return true;
          }
        }

        // Also check for addons with meta resource that support the type
        // These addons might provide embedded streams within metadata
        if (normalizedType) {
          const hasMetaResource = addon.resources.some(resource =>
            typeof resource === 'string'
              ? resource === 'meta'
              : (resource as any).name === 'meta'
          );

          if (hasMetaResource && addon.types?.includes(normalizedType)) {
            // This addon provides meta for the type - might have embedded streams
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Fetch addon catalogs from addons that provide the addon_catalog resource per protocol.
   * Returns a list of other addon manifests that can be installed.
   */
  async getAddonCatalogs(type: string, id: string): Promise<AddonCatalogItem[]> {
    await this.ensureInitialized();

    // Find addons that provide addon_catalog resource
    const addons = this.getInstalledAddons().filter(addon => {
      if (!addon.resources) return false;
      return addon.resources.some(r =>
        typeof r === 'string' ? r === 'addon_catalog' : (r as any).name === 'addon_catalog'
      );
    });

    if (addons.length === 0) {
      logger.log('[getAddonCatalogs] No addons provide addon_catalog resource');
      return [];
    }

    const results: AddonCatalogItem[] = [];

    for (const addon of addons) {
      try {
        const { baseUrl, queryParams } = this.getAddonBaseURL(addon.url || '');
        const url = `${baseUrl}/addon_catalog/${type}/${encodeURIComponent(id)}.json${queryParams ? `?${queryParams}` : ''}`;

        logger.log(`[getAddonCatalogs] Fetching from ${addon.name}: ${url}`);
        const response = await this.retryRequest(() => axios.get(url, createSafeAxiosConfig(10000)));

        if (response.data?.addons && Array.isArray(response.data.addons)) {
          results.push(...response.data.addons);
        }
      } catch (error) {
        logger.warn(`[getAddonCatalogs] Failed to fetch from ${addon.name}:`, error);
      }
    }

    return results;
  }

}

// Addon catalog item per protocol
export interface AddonCatalogItem {
  transportName: string;  // 'http'
  transportUrl: string;   // URL to manifest.json
  manifest: Manifest;
}

export const stremioService = StremioService.getInstance();
export default stremioService;
