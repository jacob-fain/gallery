/**
 * Query-string parsing for the paged photo lists.
 *
 * Public lists page by keyset (a cursor naming the last photo sent), so a
 * visitor's next page is the same whatever was published in between and the
 * query reads from the index instead of skipping rows. Admin lists page by
 * offset, because the admin reorders, deletes and moves the photos being
 * paged: a keyset on sort_order would go stale on every reorder, while the
 * client's count of loaded photos stays the right offset.
 */

/** Largest public page, and the size of the page sent when none is asked for. */
export const PUBLIC_PAGE_MAX = 500;

/** Largest admin page. An admin list asked for without a limit is sent whole. */
export const ADMIN_PAGE_MAX = 200;

/** The last photo of a public page: where the next page starts. */
export interface PublicCursor {
  // Microsecond precision, as Postgres stores it: a JavaScript Date would
  // drop the microseconds and the next page would repeat or skip photos.
  uploadedAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export const encodeCursor = (cursor: PublicCursor): string =>
  Buffer.from(`${cursor.uploadedAt}|${cursor.id}`).toString('base64url');

export const decodeCursor = (value: string): PublicCursor | null => {
  const [uploadedAt, id, ...rest] = Buffer.from(value, 'base64url').toString().split('|');
  if (rest.length || !UTC_MICROS.test(uploadedAt ?? '') || !UUID.test(id ?? '')) return null;
  return { uploadedAt, id };
};

type Query = Record<string, unknown>;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const positiveInt = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && Number.isSafeInteger(n) ? n : null;
};

/**
 * ?limit= and ?cursor= for GET /api/photos. A limit above the maximum is
 * lowered to it rather than refused, so callers written before the cap keep
 * working.
 */
export const parsePublicPage = (q: Query): Parsed<{ limit: number; after: PublicCursor | null }> => {
  let limit = PUBLIC_PAGE_MAX;
  if (q.limit !== undefined) {
    const n = positiveInt(q.limit);
    if (n === null) return { ok: false, error: 'limit must be a positive integer' };
    limit = Math.min(n, PUBLIC_PAGE_MAX);
  }
  let after: PublicCursor | null = null;
  if (q.cursor !== undefined) {
    after = typeof q.cursor === 'string' ? decodeCursor(q.cursor) : null;
    if (!after) return { ok: false, error: 'cursor is not valid' };
  }
  return { ok: true, value: { limit, after } };
};

/**
 * ?limit= and ?offset= for the admin photo lists. null means no limit was
 * given: the whole list, as these endpoints answered before they paged.
 */
export const parseAdminPage = (q: Query): Parsed<{ limit: number; offset: number } | null> => {
  if (q.limit === undefined) {
    return q.offset === undefined
      ? { ok: true, value: null }
      : { ok: false, error: 'offset needs a limit' };
  }
  const limit = positiveInt(q.limit);
  if (limit === null) return { ok: false, error: 'limit must be a positive integer' };
  let offset = 0;
  if (q.offset !== undefined && q.offset !== '0') {
    const n = positiveInt(q.offset);
    if (n === null) return { ok: false, error: 'offset must be a non-negative integer' };
    offset = n;
  }
  return { ok: true, value: { limit: Math.min(limit, ADMIN_PAGE_MAX), offset } };
};

/** The offset of the page after this one, or null when this was the last. */
export const nextOffset = (offset: number, count: number, total: number): number | null =>
  offset + count < total ? offset + count : null;
