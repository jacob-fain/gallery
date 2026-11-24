import { describe, expect, it } from 'vitest';
import themeScript from '../../public/theme.js?raw';
import {
  DARK_SCHEME_QUERY,
  LEGACY_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY,
  parseStoredTheme,
  readAndMigrateChoice,
  resolveTheme,
  storedChoice,
  type Theme,
} from './theme';

type Stored = Record<string, string>;

function fakeStorage(initial: Stored, throws = false) {
  const items: Stored = { ...initial };
  const guard = () => {
    if (throws) throw new Error('blocked');
  };
  return {
    items,
    getItem: (key: string) => (guard(), key in items ? items[key] : null),
    setItem: (key: string, value: string) => {
      guard();
      items[key] = value;
    },
    removeItem: (key: string) => {
      guard();
      delete items[key];
    },
  };
}

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

describe('storedChoice', () => {
  it('prefers the current key', () => {
    expect(storedChoice('light', 'dark')).toBe('light');
    expect(storedChoice('dark', null)).toBe('dark');
  });

  it("honors a legacy 'dark' and ignores a legacy 'light'", () => {
    expect(storedChoice(null, 'dark')).toBe('dark');
    expect(storedChoice(null, 'light')).toBeNull();
    expect(storedChoice(null, null)).toBeNull();
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

// Each case: what storage holds before load, and what it holds after the
// migration. Shared by readAndMigrateChoice and theme.js so they cannot drift.
const migrations: { before: Stored; after: Stored; choice: Theme | null }[] = [
  { before: {}, after: {}, choice: null },
  { before: { [LEGACY_THEME_STORAGE_KEY]: 'dark' }, after: { [THEME_STORAGE_KEY]: 'dark' }, choice: 'dark' },
  { before: { [LEGACY_THEME_STORAGE_KEY]: 'light' }, after: {}, choice: null },
  { before: { [THEME_STORAGE_KEY]: 'light' }, after: { [THEME_STORAGE_KEY]: 'light' }, choice: 'light' },
  {
    before: { [THEME_STORAGE_KEY]: 'light', [LEGACY_THEME_STORAGE_KEY]: 'dark' },
    after: { [THEME_STORAGE_KEY]: 'light' },
    choice: 'light',
  },
  { before: { [THEME_STORAGE_KEY]: 'bogus' }, after: { [THEME_STORAGE_KEY]: 'bogus' }, choice: null },
];

describe('readAndMigrateChoice', () => {
  it.each(migrations)('reads $before as $choice and leaves $after', ({ before, after, choice }) => {
    const storage = fakeStorage(before);
    expect(readAndMigrateChoice(storage)).toBe(choice);
    expect(storage.items).toEqual(after);
  });

  it('reads no choice when storage is blocked', () => {
    expect(readAndMigrateChoice(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }, true))).toBeNull();
  });
});

interface ScriptEnv {
  storage: ReturnType<typeof fakeStorage>;
  systemDark: boolean;
  noMatchMedia?: boolean;
}

// Runs public/theme.js against fake browser globals and returns the theme it
// applied before first paint.
function runThemeScript(env: ScriptEnv): Theme {
  const dataset: { theme?: string } = {};
  const window = {
    matchMedia: env.noMatchMedia
      ? undefined
      : (query: string) => ({ matches: query === DARK_SCHEME_QUERY && env.systemDark }),
  };
  const document = { documentElement: { dataset } };
  new Function('localStorage', 'window', 'document', themeScript)(env.storage, window, document);
  return dataset.theme === 'dark' ? 'dark' : 'light';
}

describe('theme.js before first paint', () => {
  const cases = migrations.flatMap((m) => [true, false].map((systemDark) => ({ ...m, systemDark })));

  it.each(cases)(
    'agrees with the app for $before with system dark $systemDark',
    ({ before, after, choice, systemDark }) => {
      const storage = fakeStorage(before);
      expect(runThemeScript({ storage, systemDark })).toBe(resolveTheme(choice, systemDark));
      expect(storage.items).toEqual(after);
    }
  );

  it('follows the operating system when storage is blocked', () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'light' }, true);
    expect(runThemeScript({ storage, systemDark: true })).toBe('dark');
  });

  it('falls back to light without matchMedia', () => {
    expect(runThemeScript({ storage: fakeStorage({}), systemDark: true, noMatchMedia: true })).toBe('light');
  });
});
