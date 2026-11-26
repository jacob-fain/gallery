import { useCallback, useState } from 'react';

/**
 * The public grid's layout: columns (the masonry) or the collage. Chosen per
 * browser and remembered in local storage; columns until a visitor picks.
 */
export type GridLayout = 'columns' | 'collage';

export const GRID_LAYOUT_KEY = 'gridLayout';

function storedLayout(): GridLayout {
  try {
    return localStorage.getItem(GRID_LAYOUT_KEY) === 'collage' ? 'collage' : 'columns';
  } catch {
    // Storage can be blocked (private mode, site data off): the default.
    return 'columns';
  }
}

export function useGridLayout(): [GridLayout, (layout: GridLayout) => void] {
  const [layout, setLayoutState] = useState(storedLayout);
  const setLayout = useCallback((next: GridLayout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(GRID_LAYOUT_KEY, next);
    } catch {
      // Kept for this page only.
    }
  }, []);
  return [layout, setLayout];
}
