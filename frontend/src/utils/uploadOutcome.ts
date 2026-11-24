/**
 * What a rejected upload means for the admin. The server answers 409 when the
 * file's bytes are already stored, so that file is skipped, not failed. Other
 * 4xx answers (too large, unsupported type) fail the same way on every
 * attempt, so only a lost connection, a timeout, rate limiting or a server
 * error offers a retry.
 */
export type UploadOutcome =
  | { kind: 'duplicate'; note: string }
  | { kind: 'failed'; error: string; retryable: boolean };

const RETRYABLE_CLIENT_STATUSES = [408, 429];

export function uploadOutcome(err: unknown): UploadOutcome {
  const message = err instanceof Error ? err.message : 'Upload failed';
  const status =
    err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 0;
  if (status === 409) return { kind: 'duplicate', note: message };
  const permanent = status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.includes(status);
  return { kind: 'failed', error: message, retryable: !permanent };
}
