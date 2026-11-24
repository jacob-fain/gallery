import { useEffect, useState } from 'react';
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  ThemeContext,
  parseStoredTheme,
  resolveTheme,
  type Theme,
} from './theme';

function readChoice(): Theme | null {
  try {
    return parseStoredTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function darkSchemeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_SCHEME_QUERY) : null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState<Theme | null>(readChoice);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => darkSchemeQuery()?.matches ?? false);
  const theme = resolveTheme(choice, systemPrefersDark);

  useEffect(() => {
    const query = darkSchemeQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Saved only here, on a toggle: a saved value means the visitor chose it,
  // and a visitor who never chose keeps following the operating system.
  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setChoice(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
