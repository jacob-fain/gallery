import type { UploadItem } from '../../../utils/uploadQueue';

/** What a retrying row says: when it tries again and which attempt that is. */
export function retryText(item: UploadItem, now: number): string {
  const attempt = `(attempt ${(item.attempts ?? 0) + 1})`;
  if (item.offline) return `Waiting for connection ${attempt}`;
  if (item.retryAt === undefined) return 'Checking whether it was saved...';
  // now can lag behind the clock until the row's first tick; the delay caps it.
  const left = Math.min(item.retryAt - now, item.retryDelayMs ?? Infinity);
  const seconds = Math.max(0, Math.ceil(left / 1000));
  return `Retrying in ${seconds}s ${attempt}`;
}
