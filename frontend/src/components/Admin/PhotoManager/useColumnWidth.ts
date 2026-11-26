import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * The width of a CSS grid's first column, in CSS pixels, and a ref for the
 * grid. 0 until measured, and where the browser lays nothing out (tests).
 * Measured before paint, so images rendered with it request the right file
 * from the start.
 */
export function useColumnWidth() {
  const [grid, setGrid] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => setGrid(el), []);

  useLayoutEffect(() => {
    if (!grid) return;
    const measure = () => {
      const first = Number.parseFloat(getComputedStyle(grid).gridTemplateColumns);
      setWidth(Number.isFinite(first) ? Math.round(first) : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [grid]);

  return [ref, width] as const;
}
