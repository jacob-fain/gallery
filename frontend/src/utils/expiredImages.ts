import type { Photo } from '../types';

/**
 * Returns a check that allows a photo refresh at most once per
 * `minIntervalMs`. An image that fails for a reason other than an expired URL
 * (a missing object, the network dropping) fails again after the refresh, and
 * this keeps that from turning into a request loop.
 */
export function createRefreshGuard(
  minIntervalMs: number,
  now: () => number = Date.now
): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last < minIntervalMs) return false;
    last = t;
    return true;
  };
}

/**
 * The current photos with their URLs taken from a fresh fetch, in the current
 * order, so a shuffled grid keeps its layout. Photos missing from the fresh
 * list are dropped; new ones are left for the next full load.
 */
export function withFreshUrls(current: Photo[], fresh: Photo[]): Photo[] {
  const byId = new Map(fresh.map((photo) => [photo.id, photo]));
  return current.flatMap((photo) => {
    const match = byId.get(photo.id);
    return match ? [match] : [];
  });
}
