// Per history entry values (a scroll position, how many tiles were shown),
// kept in session storage so they outlive a reload or a visit to another
// site in the same tab.

const ENTRY_ID = 'entryId';

/**
 * The key under which the current history entry's values are kept: the
 * router's location key, which stays with the entry across Back, Forward and
 * reload. The router keys a tab's first entry "default" in every document it
 * loads, so that entry gets an id of its own in its history state instead;
 * the router ignores fields it did not write. Call it while the entry is the
 * current one, since it reads (and may write) that entry's state.
 */
export function entryKey(locationKey: string): string {
  if (locationKey !== 'default') return locationKey;
  const state = window.history.state ?? {};
  if (typeof state[ENTRY_ID] === 'string') return state[ENTRY_ID];
  const id = `first-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.history.replaceState({ ...state, [ENTRY_ID]: id }, '');
  return id;
}

export interface HistoryMemory {
  get(key: string): number | undefined;
  set(key: string, value: number): void;
}

export function createHistoryMemory(name: string): HistoryMemory {
  // Storage can refuse (private mode, quota); this document still remembers.
  const memory = new Map<string, number>();
  const storageKey = (key: string) => `${name}:${key}`;

  return {
    get(key) {
      if (memory.has(key)) return memory.get(key);
      try {
        const stored = Number(sessionStorage.getItem(storageKey(key)) ?? NaN);
        return Number.isFinite(stored) ? stored : undefined;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        sessionStorage.setItem(storageKey(key), String(value));
      } catch {
        // Kept in memory only.
      }
    },
  };
}
