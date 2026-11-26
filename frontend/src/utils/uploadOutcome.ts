/**
 * What a rejected upload means for the admin. The server answers 409 when the
 * file's bytes are already stored, so that file is skipped, not failed. Other
 * 4xx answers (too large, unsupported type) fail the same way on every
 * attempt, so only a lost connection, a timeout, rate limiting or a server
 * error offers a retry.
 */
export type UploadOutcome =
  | { kind: 'duplicate'; note: string; existing?: ExistingPhoto }
  | { kind: 'failed'; error: string; retryable: boolean; auto: boolean };

/** The stored photo a 409 names, so a retry can tell its own earlier attempt
 *  (same gallery) from a photo that was already there. */
export interface ExistingPhoto {
  id: string;
  gallery_id: string | null;
}

// Answers that say the request, or its response, was lost on the way: a retry
// is likely to succeed, so the queue retries these by itself. 0 is no response
// at all (connection reset, aborted, offline). 499 is nginx's code for a client
// that hung up. 520 to 527 are Cloudflare's: 524 is its origin timeout, which
// a slow upload over a weak uplink hits while the server is still saving the
// photo. A plain 500 is left to the admin: it is usually the same on every try.
const AUTO_RETRY_STATUSES = new Set([0, 408, 429, 499, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);

const statusOf = (err: unknown): number =>
  err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' ? err.status : 0;

const existingOf = (err: unknown): ExistingPhoto | undefined => {
  if (!err || typeof err !== 'object' || !('existing' in err)) return undefined;
  const e = err.existing as Partial<ExistingPhoto> | null | undefined;
  return e && typeof e.id === 'string' ? { id: e.id, gallery_id: e.gallery_id ?? null } : undefined;
};

export function uploadOutcome(err: unknown): UploadOutcome {
  const message = err instanceof Error ? err.message : 'Upload failed';
  const status = statusOf(err);
  if (status === 409) {
    const existing = existingOf(err);
    return existing ? { kind: 'duplicate', note: message, existing } : { kind: 'duplicate', note: message };
  }
  const auto = AUTO_RETRY_STATUSES.has(status);
  const permanent = status >= 400 && status < 500 && !auto;
  return { kind: 'failed', error: message, retryable: !permanent, auto };
}
