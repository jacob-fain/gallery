import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
 * the loaded photos. Each fetch uses the latest loadPage. A new listKey (a
 * status filter) lists something else: the list empties and loads its first
 * page again. Key the component instead where nothing should carry over.
 */
export function usePhotoList(loadPage: LoadPage<Photo>, listKey = ''): PhotoListHandle {
  const [store] = useState(() => new PhotoListStore(loadPage));
  useLayoutEffect(() => {
    store.setLoader(loadPage);
  }, [store, loadPage]);
  const listed = useRef(listKey);

  useEffect(() => {
    store.reload();
    return store.dispose;
  }, [store]);

  // Before paint, so the old list is never shown under the new key.
  useLayoutEffect(() => {
    if (listed.current === listKey) return;
    listed.current = listKey;
    store.restart();
  }, [store, listKey]);

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
