import { describe, expect, it } from 'vitest';
import themeScript from '../../public/theme.js?raw';
import { DARK_SCHEME_QUERY, THEME_STORAGE_KEY, parseStoredTheme, resolveTheme, type Theme } from './theme';

describe('parseStoredTheme', () => {
  it('reads a saved choice', () => {
    expect(parseStoredTheme('dark')).toBe('dark');
    expect(parseStoredTheme('light')).toBe('light');
  });

  it('treats a missing or unknown value as no choice', () => {
    expect(parseStoredTheme(null)).toBeNull();
    expect(parseStoredTheme('')).toBeNull();
    expect(parseStoredTheme('system')).toBeNull();
  });
});

describe('resolveTheme', () => {
  it('follows the operating system when the visitor never chose', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('keeps the visitor choice over the operating system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

interface ScriptEnv {
  stored: string | null;
  systemDark: boolean;
  storageThrows?: boolean;
  noMatchMedia?: boolean;
}

// Runs public/theme.js against fake browser globals and returns the theme it
// applied before first paint.
function runThemeScript(env: ScriptEnv): Theme {
  const dataset: { theme?: string } = {};
  const localStorage = {
    getItem(key: string) {
      if (env.storageThrows) throw new Error('blocked');
      return key === THEME_STORAGE_KEY ? env.stored : null;
    },
  };
  const window = {
    matchMedia: env.noMatchMedia
      ? undefined
      : (query: string) => ({ matches: query === DARK_SCHEME_QUERY && env.systemDark }),
  };
  const document = { documentElement: { dataset } };
  new Function('localStorage', 'window', 'document', themeScript)(localStorage, window, document);
  return dataset.theme === 'dark' ? 'dark' : 'light';
}

describe('theme.js before first paint', () => {
  const cases: ScriptEnv[] = [
    { stored: null, systemDark: true },
    { stored: null, systemDark: false },
    { stored: 'light', systemDark: true },
    { stored: 'dark', systemDark: false },
    { stored: 'bogus', systemDark: true },
  ];

  it.each(cases)('agrees with resolveTheme for %o', (env) => {
    expect(runThemeScript(env)).toBe(resolveTheme(parseStoredTheme(env.stored), env.systemDark));
  });

  it('follows the operating system when storage is blocked', () => {
    expect(runThemeScript({ stored: 'light', systemDark: true, storageThrows: true })).toBe('dark');
  });

  it('falls back to light without matchMedia', () => {
    expect(runThemeScript({ stored: null, systemDark: true, noMatchMedia: true })).toBe('light');
  });
});
