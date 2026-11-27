import { useCallback, useSyncExternalStore, useState } from 'react';

/**
 * The public grid's layout: columns (the masonry), the collage, or single
 * (one photo per row). Chosen per browser and remembered in local storage;
 * columns until a visitor picks.
 */
export type GridLayout = 'columns' | 'collage' | 'single';

export const GRID_LAYOUT_KEY = 'gridLayout';
const LAYOUTS: readonly GridLayout[] = ['columns', 'collage', 'single'];

// The grid is under 500px wide (one column, gridItems.ts) below this
// viewport width, since .grid pads it by 24px a side there. Columns is then
// already one photo per row, so single is not offered.
export const ONE_COLUMN_QUERY = '(max-width: 547px)';

function storedLayout(): GridLayout {
  try {
    const stored = localStorage.getItem(GRID_LAYOUT_KEY);
    return LAYOUTS.find((layout) => layout === stored) ?? 'columns';
  } catch {
    // Storage can be blocked (private mode, site data off): the default.
    return 'columns';
  }
}

function subscribeOneColumn(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(ONE_COLUMN_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const oneColumnNow = () => typeof window.matchMedia === 'function' && window.matchMedia(ONE_COLUMN_QUERY).matches;

/** Whether the grid is a single column wide, so single is columns. */
export function useOneColumnGrid(): boolean {
  return useSyncExternalStore(subscribeOneColumn, oneColumnNow, () => false);
}

/**
 * The layout to show and the one to remember. On a one-column grid a stored
 * single shows as columns but stays stored, so a wider screen shows it again.
 */
export function useGridLayout(): [GridLayout, (layout: GridLayout) => void, { oneColumn: boolean }] {
  const [layout, setLayoutState] = useState(storedLayout);
  const oneColumn = useOneColumnGrid();
  const setLayout = useCallback((next: GridLayout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(GRID_LAYOUT_KEY, next);
    } catch {
      // Kept for this page only.
    }
  }, []);
  return [oneColumn && layout === 'single' ? 'columns' : layout, setLayout, { oneColumn }];
}
