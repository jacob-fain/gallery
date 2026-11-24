/**
 * The admin's view of a paged photo list: the photos loaded so far, which are
 * always the front of the list in server order, and the length of the whole
 * list. The next page is fetched at offset items.length, and a reorder of the
 * loaded photos is sent as is, both of which rely on items being a prefix.
 */
export interface PhotoList<T extends { id: string }> {
  items: T[];
  total: number;
}

export const emptyList = <T extends { id: string }>(): PhotoList<T> => ({ items: [], total: 0 });

export const hasMore = <T extends { id: string }>(list: PhotoList<T>): boolean =>
  list.items.length < list.total;

/**
 * The list with a fetched page added after the loaded photos. Photos already
 * loaded are skipped: a reload, an upload, or another tab can shift the
 * server's list so a page repeats some. A page that adds nothing ends the
 * list where it is, so loading never spins on a count that went stale.
 */
export function appendPage<T extends { id: string }>(
  list: PhotoList<T>,
  page: { photos: T[]; total: number }
): PhotoList<T> {
  const loaded = new Set(list.items.map((p) => p.id));
  const added = page.photos.filter((p) => !loaded.has(p.id));
  const items = added.length > 0 ? [...list.items, ...added] : list.items;
  return { items, total: added.length > 0 ? Math.max(page.total, items.length) : items.length };
}

/**
 * The list with a just-uploaded photo, at the place the server lists it:
 * first for the newest-first unassigned list, last for a gallery. A photo
 * that goes last is held back until every page before it is loaded, so the
 * loaded photos stay the front of the gallery; it then arrives with the last
 * page. A photo already in the list (a page fetched after the upload
 * finished) is not added twice.
 */
export function addUploaded<T extends { id: string }>(
  list: PhotoList<T>,
  photo: T,
  where: 'start' | 'end'
): PhotoList<T> {
  if (list.items.some((p) => p.id === photo.id)) return list;
  const total = list.total + 1;
  if (where === 'start') return { items: [photo, ...list.items], total };
  if (hasMore(list)) return { ...list, total };
  return { items: [...list.items, photo], total };
}

/** The list without the given photos (deleted, or moved elsewhere). */
export function removePhotos<T extends { id: string }>(
  list: PhotoList<T>,
  ids: Iterable<string>
): PhotoList<T> {
  const gone = new Set(ids);
  const items = list.items.filter((p) => !gone.has(p.id));
  const removed = list.items.length - items.length;
  if (removed === 0) return list;
  return { items, total: Math.max(items.length, list.total - removed) };
}

/** The list with each photo passed through change; unchanged photos keep their identity. */
export function mapPhotos<T extends { id: string }>(list: PhotoList<T>, change: (photo: T) => T): PhotoList<T> {
  return { ...list, items: list.items.map(change) };
}
