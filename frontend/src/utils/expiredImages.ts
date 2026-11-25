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
export function withFreshUrls<T extends { id: string }>(current: T[], fresh: T[]): T[] {
  const byId = new Map(fresh.map((photo) => [photo.id, photo]));
  return current.flatMap((photo) => {
    const match = byId.get(photo.id);
    return match ? [match] : [];
  });
}

type SignedUrls = { url?: string; webUrl?: string; thumbnailUrl?: string };

/**
 * The current photos with only their signed URLs replaced from a fresh
 * fetch. Everything else stays as the admin left it (order, hidden state,
 * edits not yet reloaded), and a photo missing from the fresh list keeps its
 * old URLs rather than vanishing from a list the admin is working in. A photo
 * whose URLs did not change keeps its identity, so memoized tiles skip a
 * re-render.
 */
export function withFreshSignedUrls<T extends { id: string } & SignedUrls>(current: T[], fresh: T[]): T[] {
  const byId = new Map(fresh.map((photo) => [photo.id, photo]));
  return current.map((photo) => {
    const match = byId.get(photo.id);
    if (
      !match ||
      (match.url === photo.url && match.webUrl === photo.webUrl && match.thumbnailUrl === photo.thumbnailUrl)
    ) {
      return photo;
    }
    return { ...photo, url: match.url, webUrl: match.webUrl, thumbnailUrl: match.thumbnailUrl };
  });
}
