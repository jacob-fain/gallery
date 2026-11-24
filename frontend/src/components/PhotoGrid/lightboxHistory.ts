import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { ControllerRef } from 'yet-another-react-lightbox';
import type { PublicPhoto } from '../../types';

const HISTORY_MARKER = 'photoLightbox';
// Only the photo's id: a private gallery's access token never goes in a URL.
export const PHOTO_PARAM = 'photo';

function hasMarker(state: unknown): boolean {
  return typeof state === 'object' && state !== null && HISTORY_MARKER in state;
}

// The router's own state is copied into every entry written here, so the
// router sees the same location key on either side of the lightbox.
function stateWithMarker(marked: boolean): Record<string, unknown> {
  const state = { ...(window.history.state ?? {}) };
  if (marked) state[HISTORY_MARKER] = true;
  else delete state[HISTORY_MARKER];
  return state;
}

function linkedPhotoId(): string | null {
  return new URLSearchParams(window.location.search).get(PHOTO_PARAM);
}

function urlWithPhoto(photoId: string | null): string {
  const url = new URL(window.location.href);
  if (photoId) url.searchParams.set(PHOTO_PARAM, photoId);
  else url.searchParams.delete(PHOTO_PARAM);
  return url.pathname + url.search + url.hash;
}

function indexOf(photos: PublicPhoto[], photoId: string | null): number {
  return photoId ? photos.findIndex((photo) => photo.id === photoId) : -1;
}

/**
 * The open lightbox owns a history entry whose URL names its photo
 * (`?photo=<id>`), so a photo can be shared, Back (the phone's usual way out
 * of a full-screen view) closes it, and moving between photos rewrites that
 * one entry. A page loaded with the parameter opens on that photo.
 */
export function useLightboxHistory(photos: PublicPhoto[], controller: RefObject<ControllerRef | null>) {
  const [linked] = useState(() => {
    const id = linkedPhotoId();
    return { id, index: indexOf(photos, id) };
  });
  const [pathname] = useState(() => window.location.pathname);
  const [index, setIndex] = useState(linked.index);

  useEffect(() => {
    if (linked.index >= 0) {
      // Reached through a link: the gallery gets an entry of its own beneath
      // the photo's, so Back closes the photo instead of leaving the site. A
      // reload of the photo's entry already has one.
      if (!hasMarker(window.history.state)) {
        window.history.replaceState(stateWithMarker(false), '', urlWithPhoto(null));
        window.history.pushState(stateWithMarker(true), '', urlWithPhoto(linked.id));
      }
    } else if (linked.id !== null || hasMarker(window.history.state)) {
      // A photo no longer in the gallery, or a reload of an entry from
      // before photos were named: the entry becomes the gallery's own.
      window.history.replaceState(stateWithMarker(false), '', urlWithPhoto(null));
    }
  }, [linked]);

  useEffect(() => {
    const onPopState = () => {
      // The route is leaving this page; the router unmounts it.
      if (window.location.pathname !== pathname) return;
      const next = hasMarker(window.history.state) ? indexOf(photos, linkedPhotoId()) : -1;
      if (next >= 0) setIndex(next);
      else if (index >= 0) controller.current?.close();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [photos, index, pathname, controller]);

  const open = useCallback(
    (next: number) => {
      const photo = photos[next];
      if (!photo) return;
      if (hasMarker(window.history.state)) {
        window.history.replaceState(window.history.state, '', urlWithPhoto(photo.id));
      } else {
        window.history.pushState(stateWithMarker(true), '', urlWithPhoto(photo.id));
      }
      setIndex(next);
    },
    [photos]
  );

  const view = useCallback(
    (next: number) => {
      setIndex(next);
      const photo = photos[next];
      if (photo && hasMarker(window.history.state)) {
        window.history.replaceState(window.history.state, '', urlWithPhoto(photo.id));
      }
    },
    [photos]
  );

  // Closed some other way than Back: drop the entry, so the next Back leaves
  // the page as it would have without the lightbox.
  const close = useCallback(() => {
    setIndex(-1);
    if (hasMarker(window.history.state)) window.history.back();
  }, []);

  return { index, open, view, close };
}
