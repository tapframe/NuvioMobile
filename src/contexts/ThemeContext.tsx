import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { mmkvStorage } from '../services/mmkvStorage';
import { settingsEmitter } from '../hooks/useSettings';
import { colors as defaultColors } from '../styles/colors';

// Define the Theme interface
export interface Theme {
  id: string;
  name: string;
  colors: typeof defaultColors;
  isEditable: boolean;
}

// Default built-in themes
export const DEFAULT_THEMES: Theme[] = [
  {
    id: 'default',
    name: 'default_dark',
    colors: defaultColors,
    isEditable: false,
  },
  {
    id: 'ocean',
    name: 'ocean_blue',
    colors: {
      ...defaultColors,
      primary: '#3498db',
      secondary: '#2ecc71',
      darkBackground: '#0a192f',
    },
    isEditable: false,
  },
  {
    id: 'sunset',
    name: 'sunset',
    colors: {
      ...defaultColors,
      primary: '#ff7e5f',
      secondary: '#feb47b',
      darkBackground: '#1a0f0b',
    },
    isEditable: false,
  },
  {
    id: 'moonlight',
    name: 'moonlight',
    colors: {
      ...defaultColors,
      primary: '#c084fc',
      secondary: '#60a5fa',
      darkBackground: '#060609',
    },
    isEditable: false,
  },
  {
    id: 'emerald',
    name: 'emerald',
    colors: {
      ...defaultColors,
      primary: '#2ecc71',
      secondary: '#3498db',
      darkBackground: '#0e1e13',
    },
    isEditable: false,
  },
  {
    id: 'ruby',
    name: 'ruby',
    colors: {
      ...defaultColors,
      primary: '#e74c3c',
      secondary: '#9b59b6',
      darkBackground: '#1a0a0a',
    },
    isEditable: false,
  },
  {
    id: 'amethyst',
    name: 'amethyst',
    colors: {
      ...defaultColors,
      primary: '#9b59b6',
      secondary: '#3498db',
      darkBackground: '#140a1c',
    },
    isEditable: false,
  },
  {
    id: 'amber',
    name: 'amber',
    colors: {
      ...defaultColors,
      primary: '#f39c12',
      secondary: '#d35400',
      darkBackground: '#1a140a',
    },
    isEditable: false,
  },
  {
    id: 'mint',
    name: 'mint',
    colors: {
      ...defaultColors,
      primary: '#1abc9c',
      secondary: '#16a085',
      darkBackground: '#0a1a17',
    },
    isEditable: false,
  },
  {
    id: 'slate',
    name: 'slate',
    colors: {
      ...defaultColors,
      primary: '#7f8c8d',
      secondary: '#95a5a6',
      darkBackground: '#10191a',
    },
    isEditable: false,
  },
  {
    id: 'neon',
    name: 'neon',
    colors: {
      ...defaultColors,
      primary: '#00ff00',
      secondary: '#ff00ff',
      darkBackground: '#0a0a0a',
    },
    isEditable: false,
  },
  {
    id: 'retro',
    name: 'retro_wave',
    colors: {
      ...defaultColors,
      primary: '#ff00ff',
      secondary: '#00ffff',
      darkBackground: '#150036',
    },
    isEditable: false,
  },
];

// Theme context props
interface ThemeContextProps {
  currentTheme: Theme;
  availableThemes: Theme[];
  setCurrentTheme: (themeId: string) => void;
  addCustomTheme: (theme: Omit<Theme, 'id' | 'isEditable'>) => void;
  updateCustomTheme: (theme: Theme) => void;
  deleteCustomTheme: (themeId: string) => void;
}

// Create the context
const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

// Storage keys (kept for backward compatibility). Primary source of truth is app_settings
const CURRENT_THEME_KEY = 'current_theme';
const CUSTOM_THEMES_KEY = 'custom_themes';

// Provider component
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentThemeState] = useState<Theme>(DEFAULT_THEMES[0]);
  const [availableThemes, setAvailableThemes] = useState<Theme[]>(DEFAULT_THEMES);

  // Load themes from app_settings (scoped), with legacy fallbacks
  useEffect(() => {
    const loadThemes = async () => {
      try {
        const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
        const appSettingsJson = await mmkvStorage.getItem(`@user:${scope}:app_settings`);
        const appSettings = appSettingsJson ? JSON.parse(appSettingsJson) : {};
        const savedThemeId = appSettings.themeId || (await mmkvStorage.getItem(CURRENT_THEME_KEY));
        const customThemesJson = appSettings.customThemes ? JSON.stringify(appSettings.customThemes) : await mmkvStorage.getItem(CUSTOM_THEMES_KEY);
        const customThemes = customThemesJson ? JSON.parse(customThemesJson) : [];
        const allThemes = [...DEFAULT_THEMES, ...customThemes];
        setAvailableThemes(allThemes);
        if (savedThemeId) {
          const theme = allThemes.find(t => t.id === savedThemeId);
          if (theme) setCurrentThemeState(theme);
        }
      } catch (error) {
        if (__DEV__) console.error('Failed to load themes:', error);
      }
    };
    loadThemes();
    // Stop live refresh from remote; only refresh on app restart or local changes
    return () => {};
  }, []);

  // Set current theme
  const setCurrentTheme = async (themeId: string) => {
    const theme = availableThemes.find(t => t.id === themeId);
    if (theme) {
      setCurrentThemeState(theme);
      // Persist into scoped app_settings and legacy key for backward compat
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const key = `@user:${scope}:app_settings`;
      let settings = {} as any;
      try { settings = JSON.parse((await mmkvStorage.getItem(key)) || '{}'); } catch {}
      settings.themeId = themeId;
      await mmkvStorage.setItem(key, JSON.stringify(settings));
      await mmkvStorage.setItem(CURRENT_THEME_KEY, themeId);
      // Do not emit global settings sync for themes (sync on app restart only)
    }
  };

  // Add custom theme
  const addCustomTheme = async (themeData: Omit<Theme, 'id' | 'isEditable'>) => {
    try {
      // Generate unique ID
      const id = `custom_${Date.now()}`;
      
      // Create new theme object
      const newTheme: Theme = {
        id,
        ...themeData,
        isEditable: true,
      };
      
      // Add to available themes
      const customThemes = availableThemes.filter(t => t.isEditable);
      const updatedCustomThemes = [...customThemes, newTheme];
      const updatedAllThemes = [...DEFAULT_THEMES, ...updatedCustomThemes];
      
      // Save to storage (scoped app_settings + legacy key)
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const key = `@user:${scope}:app_settings`;
      let settings = {} as any;
      try { settings = JSON.parse((await mmkvStorage.getItem(key)) || '{}'); } catch {}
      settings.customThemes = updatedCustomThemes;
      await mmkvStorage.setItem(key, JSON.stringify(settings));
      await mmkvStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(updatedCustomThemes));
      
      // Update state
      setAvailableThemes(updatedAllThemes);
      
      // Set as current theme
      setCurrentThemeState(newTheme);
      await mmkvStorage.setItem(CURRENT_THEME_KEY, id);
      // Do not emit global settings sync for themes
    } catch (error) {
      if (__DEV__) console.error('Failed to add custom theme:', error);
    }
  };

  // Update custom theme
  const updateCustomTheme = async (updatedTheme: Theme) => {
    try {
      if (!updatedTheme.isEditable) {
        throw new Error('Cannot edit built-in themes');
      }
      
      // Find and update the theme
      const customThemes = availableThemes.filter(t => t.isEditable);
      const updatedCustomThemes = customThemes.map(t => 
        t.id === updatedTheme.id ? updatedTheme : t
      );
      
      // Update available themes
      const updatedAllThemes = [...DEFAULT_THEMES, ...updatedCustomThemes];
      
      // Save to storage (scoped app_settings + legacy key)
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const key = `@user:${scope}:app_settings`;
      let settings = {} as any;
      try { settings = JSON.parse((await mmkvStorage.getItem(key)) || '{}'); } catch {}
      settings.customThemes = updatedCustomThemes;
      await mmkvStorage.setItem(key, JSON.stringify(settings));
      await mmkvStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(updatedCustomThemes));
      
      // Update state
      setAvailableThemes(updatedAllThemes);
      
      // Update current theme if needed
      if (currentTheme.id === updatedTheme.id) {
        setCurrentThemeState(updatedTheme);
      }
      // Do not emit global settings sync for themes
    } catch (error) {
      if (__DEV__) console.error('Failed to update custom theme:', error);
    }
  };

  // Delete custom theme
  const deleteCustomTheme = async (themeId: string) => {
    try {
      // Find theme to delete
      const themeToDelete = availableThemes.find(t => t.id === themeId);
      
      if (!themeToDelete || !themeToDelete.isEditable) {
        throw new Error('Cannot delete built-in themes or theme not found');
      }
      
      // Filter out the theme
      const customThemes = availableThemes.filter(t => t.isEditable && t.id !== themeId);
      const updatedAllThemes = [...DEFAULT_THEMES, ...customThemes];
      
      // Save to storage (scoped app_settings + legacy key)
      const scope = (await mmkvStorage.getItem('@user:current')) || 'local';
      const key = `@user:${scope}:app_settings`;
      let settings = {} as any;
      try { settings = JSON.parse((await mmkvStorage.getItem(key)) || '{}'); } catch {}
      settings.customThemes = customThemes;
      await mmkvStorage.setItem(key, JSON.stringify(settings));
      await mmkvStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
      
      // Update state
      setAvailableThemes(updatedAllThemes);
      
      // Reset to default theme if current theme was deleted
      if (currentTheme.id === themeId) {
        setCurrentThemeState(DEFAULT_THEMES[0]);
        await mmkvStorage.setItem(CURRENT_THEME_KEY, DEFAULT_THEMES[0].id);
      }
      // Do not emit global settings sync for themes
    } catch (error) {
      if (__DEV__) console.error('Failed to delete custom theme:', error);
    }
  };

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        availableThemes,
        setCurrentTheme,
        addCustomTheme,
        updateCustomTheme,
        deleteCustomTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

// Custom hook to use the theme context
export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
} 