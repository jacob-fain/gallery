import type { UploadItem } from '../../../utils/uploadQueue';

/** A photo whose answer was lost, while the queue asks whether it was stored. */
export const CONFIRMING = 'Confirming upload...';

/** The countdown to the end of a backoff, capped at its wait: now can lag
 *  behind the clock until a component's first tick. */
export function secondsLeft(retryAt: number, delayMs: number | null | undefined, now: number): number {
  return Math.max(0, Math.ceil(Math.min(retryAt - now, delayMs ?? Infinity) / 1000));
}

/** What a retrying row says: when it tries again and which attempt that is. */
export function retryText(item: UploadItem, now: number): string {
  const attempt = `(attempt ${(item.attempts ?? 0) + 1})`;
  if (item.offline) return `Waiting for connection ${attempt}`;
  if (item.confirming) return CONFIRMING;
  if (item.retryAt === undefined) return 'Checking whether it was saved...';
  return `Retrying in ${secondsLeft(item.retryAt, item.retryDelayMs, now)}s ${attempt}`;
}
