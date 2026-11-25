import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Photo } from '../../../types';
import { PhotoListStore, type LoadPage, type PhotoListState } from '../../../utils/photoListStore';
import type { PhotoList } from '../../../utils/photoList';
import { withFreshSignedUrls } from '../../../utils/expiredImages';

export interface PhotoListHandle extends PhotoListState<Photo> {
  loadMore: () => Promise<boolean>;
  loadAll: () => Promise<Photo[] | null>;
  update: (change: (list: PhotoList<Photo>) => PhotoList<Photo>) => void;
  // The list as of now, for handlers that must not change on every update.
  latest: () => PhotoList<Photo>;
  reload: () => void;
  // Replaces the loaded photos' signed URLs with fresh ones.
  refreshUrls: () => void;
}

/**
 * A paged admin photo list: the first page on mount, more on request. It
 * lives in the page rather than in PhotoManager so the page that receives
 * finished uploads can add them without resetting what the admin has done to
 * the loaded photos. loadPage is read once: key the component to list
 * something else.
 */
export function usePhotoList(loadPage: LoadPage<Photo>): PhotoListHandle {
  const [store] = useState(() => new PhotoListStore(loadPage));

  useEffect(() => {
    store.reload();
    return store.dispose;
  }, [store]);

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const refreshUrls = useCallback(() => {
    store.refresh(withFreshSignedUrls);
  }, [store]);

  return useMemo(
    () => ({
      ...state,
      loadMore: store.loadMore,
      loadAll: store.loadAll,
      update: store.update,
      latest: store.latest,
      reload: store.reload,
      refreshUrls,
    }),
    [state, store, refreshUrls]
  );
}
