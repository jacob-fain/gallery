import { useCallback, useState } from 'react';

export type ViewMode = 'grid' | 'review';

const KEY = 'admin.photoView';

// Storage can be missing or throw (private windows, blocked site data), and
// the page must work the same without it.
function readMode(): ViewMode {
  try {
    return window.localStorage.getItem(KEY) === 'review' ? 'review' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Grid or Review for the admin photo pages, remembered in this browser. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(readMode);
  const setMode = useCallback((next: ViewMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Not remembered; this page still switches.
    }
  }, []);
  return [mode, setMode];
}
