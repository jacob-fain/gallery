import { useEffect, useRef } from 'react';
import { trackGalleryView } from '../api/client';

/**
 * Counts one view each time a gallery is shown: pass the slug once
 * the page shows the gallery (public, or unlocked), null while it is loading
 * or behind the password screen. The ref keeps StrictMode's repeated effects
 * and re-renders of the same gallery from counting twice.
 */
export function useGalleryViewTracking(shownSlug: string | null, accessToken: string | null): void {
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (shownSlug && shownSlug !== tracked.current) {
      trackGalleryView(shownSlug, accessToken ?? undefined);
    }
    tracked.current = shownSlug;
  }, [shownSlug, accessToken]);
}
