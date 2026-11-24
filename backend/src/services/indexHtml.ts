/**
 * The SPA's built index.html, read from the frontend container. The two
 * images are built separately, so the backend has no copy of its own, and
 * the frontend's is the one whose chunk names match the deployed bundles.
 * The service name is the same in every compose file (production, staging,
 * e2e); INDEX_HTML_URL overrides it for local runs.
 */
const indexUrl = (): string => process.env.INDEX_HTML_URL || 'http://frontend/index.html';

/** A share page waits this long for the frontend before nginx falls back to the static file. */
export const INDEX_FETCH_TIMEOUT_MS = 3000;

let cached: { url: string; etag: string; html: string } | null = null;

/**
 * Revalidated on every call rather than kept for a while: a deploy replaces
 * the bundles, and a stale copy would name chunks that no longer exist. nginx
 * answers an unchanged file with a 304, so a revalidation costs no body.
 * Throws when the frontend cannot be reached or answers anything else.
 */
export const getIndexHtml = async (): Promise<string> => {
  const url = indexUrl();
  const headers: Record<string, string> = {};
  if (cached?.url === url) headers['If-None-Match'] = cached.etag;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(INDEX_FETCH_TIMEOUT_MS) });
  if (res.status === 304 && cached?.url === url) return cached.html;
  if (res.status !== 200) throw new Error(`index.html answered ${res.status}`);
  const html = await res.text();
  const etag = res.headers.get('etag');
  cached = etag ? { url, etag, html } : null;
  return html;
};

/** Forgets the cached copy (tests). */
export const resetIndexHtmlCache = (): void => {
  cached = null;
};
