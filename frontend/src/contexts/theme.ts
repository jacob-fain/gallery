import { createContext, useContext } from 'react';

export type Theme = 'light' | 'dark';

export interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// public/theme.js reads the same keys and query before first paint and must
// agree with these functions, or the page flashes when React takes over.
export const THEME_STORAGE_KEY = 'theme-choice';
// Written by an older version on every first visit, so a saved 'light' there
// is a default, not a choice. Only a saved 'dark' was chosen.
export const LEGACY_THEME_STORAGE_KEY = 'theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** The visitor's saved choice, or null when they have never toggled. */
export function parseStoredTheme(value: string | null): Theme | null {
  return value === 'dark' || value === 'light' ? value : null;
}

/**
 * The saved choice, given both keys' values. A legacy 'dark' counts as a
 * choice when the current key holds none; a legacy 'light' never does.
 */
export function storedChoice(current: string | null, legacy: string | null): Theme | null {
  return parseStoredTheme(current) ?? (legacy === 'dark' ? 'dark' : null);
}

/** A saved choice wins; without one the theme follows the operating system. */
export function resolveTheme(choice: Theme | null, systemPrefersDark: boolean): Theme {
  return choice ?? (systemPrefersDark ? 'dark' : 'light');
}

/**
 * Reads the saved choice and moves a legacy value to the current key, so the
 * legacy key is read at most once. Null when storage is unavailable.
 */
export function readAndMigrateChoice(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Theme | null {
  try {
    const legacy = storage.getItem(LEGACY_THEME_STORAGE_KEY);
    const choice = storedChoice(storage.getItem(THEME_STORAGE_KEY), legacy);
    if (legacy !== null) {
      if (choice) storage.setItem(THEME_STORAGE_KEY, choice);
      storage.removeItem(LEGACY_THEME_STORAGE_KEY);
    }
    return choice;
  } catch {
    return null;
  }
}
