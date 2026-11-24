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

// public/theme.js reads the same key and query before first paint and must
// agree with resolveTheme, or the page flashes when React takes over.
export const THEME_STORAGE_KEY = 'theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** The visitor's saved choice, or null when they have never toggled. */
export function parseStoredTheme(value: string | null): Theme | null {
  return value === 'dark' || value === 'light' ? value : null;
}

/** A saved choice wins; without one the theme follows the operating system. */
export function resolveTheme(choice: Theme | null, systemPrefersDark: boolean): Theme {
  return choice ?? (systemPrefersDark ? 'dark' : 'light');
}
