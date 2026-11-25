import { useEffect, useState, type RefObject } from 'react';
import { createRefreshGuard } from '../../../utils/expiredImages';

// The same limit as the public grid: an image that fails for a reason other
// than an expired URL fails again after the refresh, and this keeps that from
// becoming a request loop.
export const REFRESH_INTERVAL_MS = 60 * 1000;

/**
 * Calls refresh when an image inside the element fails to load, at most once
 * per REFRESH_INTERVAL_MS. Signed photo URLs expire after an hour, and an
 * admin screen left open longer requests lazy or re-requested thumbnails with
 * URLs S3 now refuses.
 */
export function useRefreshOnImageError(
  ref: RefObject<HTMLElement | null>,
  refresh: () => void
): void {
  const [mayRefresh] = useState(() => createRefreshGuard(REFRESH_INTERVAL_MS));

  // Image error events do not bubble, so they are caught in the capture
  // phase. The listener is on the document because the element can mount
  // after this effect runs (a list still loading renders something else).
  useEffect(() => {
    const handleError = (event: Event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !ref.current?.contains(img)) return;
      if (mayRefresh()) refresh();
    };
    document.addEventListener('error', handleError, true);
    return () => document.removeEventListener('error', handleError, true);
  }, [ref, refresh, mayRefresh]);
}
