import { useCallback, useEffect, useState } from 'react';
import type { StatusFilter } from '../../../api/client';
import type { ReviewStatus, StatusCounts } from '../../../types';

export interface ReviewFilter {
  // undefined until the first counts arrive and pick the default.
  status: StatusFilter | undefined;
  setStatus: (status: StatusFilter) => void;
  counts: StatusCounts | null;
  setCounts: (counts: StatusCounts | undefined) => void;
  // A photo moved between states; null on one side for one added or removed.
  shift: (from: ReviewStatus | null, to: ReviewStatus | null, n?: number) => void;
  // Asks the server again, after changes the page did not count itself.
  refreshCounts: () => void;
}

/**
 * The status filter of an admin photo list and the counts on its pills.
 * The filter starts on Needs review when any photo needs it, otherwise on
 * All. fetchCounts (memoize it) answers the unfiltered list's counts; a new
 * one (another gallery in All Photos) refreshes them and keeps the filter.
 */
export function useReviewFilter(fetchCounts: () => Promise<StatusCounts | undefined>): ReviewFilter {
  const [status, setStatusState] = useState<StatusFilter | undefined>(undefined);
  const [counts, setCountsState] = useState<StatusCounts | null>(null);

  // A promise chain rather than an async function: react-hooks counts a
  // setState after an await as synchronous, but not one in a .then.
  const refreshCounts = useCallback(() => {
    fetchCounts()
      .then((fresh) => {
        if (fresh) setCountsState(fresh);
        setStatusState((current) => (current === undefined ? (fresh && fresh.review > 0 ? 'review' : null) : current));
      })
      .catch(() => {
        setStatusState((current) => (current === undefined ? null : current));
      });
  }, [fetchCounts]);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const setCounts = useCallback((fresh: StatusCounts | undefined) => {
    if (fresh) setCountsState(fresh);
  }, []);

  const shift = useCallback((from: ReviewStatus | null, to: ReviewStatus | null, n = 1) => {
    setCountsState((c) => {
      if (!c) return c;
      const next = { ...c };
      if (from) next[from] = Math.max(0, next[from] - n);
      if (to) next[to] += n;
      if (!from) next.all += n;
      if (!to) next.all = Math.max(0, next.all - n);
      return next;
    });
  }, []);

  const setStatus = useCallback((next: StatusFilter) => setStatusState(next), []);

  return { status, setStatus, counts, setCounts, shift, refreshCounts };
}

/** Whether a photo in `status` belongs in a list filtered to `filter`. */
export const matchesFilter = (status: ReviewStatus, filter: StatusFilter | undefined): boolean =>
  !filter || status === filter;
