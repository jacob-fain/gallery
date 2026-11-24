import type { DuplicateInfo } from '../api/client';
import type { Photo } from '../types';
import { uploadOutcome } from './uploadOutcome';

// Matches the server-side multer limit
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
// Files are hashed and duplicate-checked in batches so uploads can start
// while later files are still being hashed
const CHECK_BATCH_SIZE = 20;
// Parallel uploads across every gallery, so a second drop does not add more
export const UPLOAD_CONCURRENCY = 3;
// How long a finished row stays so the admin sees it succeed
export const COMPLETE_ROW_MS = 1500;
// A file the browser gives no type is judged by extension; the server checks
// the bytes.
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|tiff?)$/i;

const isImageFile = (file: File) =>
  file.type ? file.type.startsWith('image/') : IMAGE_EXTENSION.test(file.name);

export const HEIC_NOT_SUPPORTED =
  "HEIC photos aren't supported yet. Export as JPEG (on iPhone: Settings > Camera > Formats > Most Compatible)";

// The server cannot decode HEVC-compressed HEIF, which is what an iPhone
// shoots (#131), and refuses it by type or name, so it is failed here before
// it is hashed or sent.
const isHeic = (file: File) =>
  /^image\/hei[cf](-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/** Why the server would refuse this file, or null if it may be sent. */
export const invalidReason = (file: File): string | null =>
  isHeic(file)
    ? HEIC_NOT_SUPPORTED
    : !isImageFile(file)
    ? 'Not an image file'
    : file.size > MAX_FILE_SIZE
    ? 'Larger than the 50MB upload limit'
    : null;

export type UploadStatus =
  | 'checking'
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'complete'
  | 'error'
  | 'duplicate'
  | 'new';

export interface UploadItem {
  id: string;
  file: File;
  galleryId: string | null;
  checkOnly: boolean;
  progress: number;
  status: UploadStatus;
  error?: string;
  note?: string;
  retryable?: boolean;
}

export interface BatchStats {
  total: number;
  uploaded: number;
  skipped: number;
  fresh: number;
  failed: number;
}

/** The rows and counters one upload panel (a gallery, or unassigned) shows. */
export interface TargetState {
  items: readonly UploadItem[];
  stats: BatchStats;
}

/** Everything still running, across every gallery, for the admin layout. */
export interface QueueSummary {
  active: boolean;
  /** Files in the batches that are still running, finished or not. */
  total: number;
  processed: number;
  /** Every running file is only being checked, not uploaded. */
  checkOnly: boolean;
  targetCount: number;
  /** The one running target when targetCount is 1. */
  galleryId: string | null;
}

export interface UploadQueueDeps {
  upload: (
    galleryId: string | null,
    file: File,
    onProgress: (percent: number) => void,
    signal: AbortSignal
  ) => Promise<Photo>;
  checkDuplicates: (hashes: string[]) => Promise<Record<string, DuplicateInfo>>;
  hash: (file: File) => Promise<string>;
}

const EMPTY_STATS: BatchStats = { total: 0, uploaded: 0, skipped: 0, fresh: 0, failed: 0 };
export const EMPTY_TARGET: TargetState = { items: [], stats: EMPTY_STATS };
const IDLE: QueueSummary = {
  active: false,
  total: 0,
  processed: 0,
  checkOnly: false,
  targetCount: 0,
  galleryId: null,
};

export const isInFlight = (item: UploadItem) =>
  item.status === 'checking' ||
  item.status === 'pending' ||
  item.status === 'uploading' ||
  item.status === 'processing';

export const processedCount = (s: BatchStats) => s.uploaded + s.skipped + s.fresh + s.failed;

// Gallery ids are UUIDs, so the empty string cannot collide with one.
const keyOf = (galleryId: string | null) => galleryId ?? '';

/** SHA-256 of a file's bytes: matches the content_hash stored at upload
 *  time because originals are preserved exactly as uploaded. */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function summarize(targets: Iterable<TargetState>): QueueSummary {
  let total = 0;
  let processed = 0;
  let targetCount = 0;
  let galleryId: string | null = null;
  let checkOnly = true;
  for (const t of targets) {
    const running = t.items.filter(isInFlight);
    if (running.length === 0) continue;
    targetCount += 1;
    galleryId = running[0].galleryId;
    total += t.stats.total;
    processed += processedCount(t.stats);
    if (running.some((i) => !i.checkOnly)) checkOnly = false;
  }
  if (targetCount === 0) return IDLE;
  return { active: true, total, processed, checkOnly, targetCount, galleryId };
}

const sameSummary = (a: QueueSummary, b: QueueSummary) =>
  a.active === b.active &&
  a.total === b.total &&
  a.processed === b.processed &&
  a.checkOnly === b.checkOnly &&
  a.targetCount === b.targetCount &&
  a.galleryId === b.galleryId;

/**
 * The admin's uploads, kept outside any page so they survive navigation.
 * State is immutable per target, so a target's snapshot only changes when its
 * own rows do (useSyncExternalStore compares by reference).
 */
export class UploadQueue {
  private deps: UploadQueueDeps;
  private targets = new Map<string, TargetState>();
  private summary: QueueSummary = IDLE;
  private listeners = new Set<() => void>();
  private completeListeners = new Set<(photo: Photo, galleryId: string | null) => void>();
  private waiting: string[] = [];
  private running = new Map<string, AbortController>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  // Bumped by abortAll so work started before it drops its results.
  private generation = 0;
  // The signed-in admin's id, or null when signed out.
  private session: string | null = null;
  private nextId = 0;

  constructor(deps: UploadQueueDeps) {
    this.deps = deps;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onComplete(listener: (photo: Photo, galleryId: string | null) => void) {
    this.completeListeners.add(listener);
    return () => {
      this.completeListeners.delete(listener);
    };
  }

  getTarget(galleryId: string | null): TargetState {
    return this.targets.get(keyOf(galleryId)) ?? EMPTY_TARGET;
  }

  getSummary = (): QueueSummary => this.summary;

  /** A different session (or none) cannot finish the old one's uploads. */
  setSession(session: string | null) {
    if (session === this.session) return;
    if (this.session !== null) this.abortAll();
    this.session = session;
  }

  add(files: readonly File[], options: { galleryId: string | null; checkOnly: boolean }) {
    if (!this.session || files.length === 0) return;
    const { galleryId, checkOnly } = options;

    const newItems: UploadItem[] = files.map((file) => {
      const reason = invalidReason(file);
      return {
        id: `upload-${++this.nextId}`,
        file,
        galleryId,
        checkOnly,
        progress: 0,
        status: reason ? 'error' : 'checking',
        error: reason ?? undefined,
        retryable: false,
      };
    });
    const invalidCount = newItems.filter((i) => i.status === 'error').length;

    this.update(galleryId, (t) => {
      // Nothing in flight: start a new batch, keeping no finished rows
      const fresh = t.stats.total === 0 || processedCount(t.stats) >= t.stats.total;
      const stats = fresh
        ? { ...EMPTY_STATS, total: files.length }
        : { ...t.stats, total: t.stats.total + files.length };
      const kept = fresh ? t.items.filter(isInFlight) : t.items;
      return {
        items: [...kept, ...newItems],
        stats: { ...stats, failed: stats.failed + invalidCount },
      };
    });

    void this.check(this.generation, newItems.filter((i) => i.status === 'checking'));
  }

  retry(id: string) {
    const item = this.find(id);
    if (!item || item.status !== 'error' || !item.retryable) return;
    this.update(item.galleryId, (t) => ({
      items: t.items.map((u) =>
        u.id === id ? { ...u, status: 'pending' as const, progress: 0, error: undefined, retryable: undefined } : u
      ),
      stats: { ...t.stats, failed: Math.max(0, t.stats.failed - 1) },
    }));
    this.waiting.push(id);
    this.pump();
  }

  dismiss(id: string) {
    const item = this.find(id);
    if (!item || isInFlight(item)) return;
    this.update(item.galleryId, (t) => ({ ...t, items: t.items.filter((u) => u.id !== id) }));
  }

  clearResults(galleryId: string | null) {
    this.update(galleryId, (t) => ({
      ...t,
      items: t.items.filter((u) => u.status !== 'duplicate' && u.status !== 'new'),
    }));
  }

  /** Stops every check and upload and forgets every row. */
  abortAll() {
    this.generation += 1;
    this.waiting = [];
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.targets.clear();
    this.emit();
  }

  // Hashes and duplicate-checks files in batches, feeding the upload queue
  // while later batches are still being hashed. If hashing or the check
  // fails, files fall through to upload: the server rejects duplicates too.
  private async check(generation: number, items: UploadItem[]) {
    const seenHashes = new Set<string>();
    for (let i = 0; i < items.length; i += CHECK_BATCH_SIZE) {
      const batch = items.slice(i, i + CHECK_BATCH_SIZE);

      const batchHashes = new Map<string, string>();
      for (const item of batch) {
        try {
          batchHashes.set(item.id, await this.deps.hash(item.file));
        } catch {
          // Hashing unavailable: treat as new
        }
        if (generation !== this.generation) return;
      }

      let existing: Record<string, DuplicateInfo> = {};
      try {
        const unchecked = [...new Set(batchHashes.values())].filter((h) => !seenHashes.has(h));
        if (unchecked.length > 0) existing = await this.deps.checkDuplicates(unchecked);
      } catch {
        // Check failed: proceed with uploads
      }
      if (generation !== this.generation) return;

      for (const item of batch) {
        const hash = batchHashes.get(item.id);
        const dup = hash ? existing[hash] : undefined;
        if (dup) {
          const where = dup.gallery_title
            ? ` in ${dup.gallery_title}`
            : dup.gallery_id === null
            ? ' (unassigned)'
            : '';
          this.settle(item, { status: 'duplicate', note: `Already uploaded${where} as ${dup.original_filename}` }, 'skipped');
        } else if (hash && seenHashes.has(hash)) {
          this.settle(item, { status: 'duplicate', note: 'Duplicate of another file in this batch' }, 'skipped');
        } else {
          if (hash) seenHashes.add(hash);
          if (item.checkOnly) {
            this.settle(item, { status: 'new', note: 'Not uploaded yet' }, 'fresh');
          } else {
            this.patch(item, { status: 'pending' });
            this.waiting.push(item.id);
          }
        }
      }
      this.pump();
    }
  }

  private pump() {
    while (this.running.size < UPLOAD_CONCURRENCY && this.waiting.length > 0) {
      const item = this.find(this.waiting.shift()!);
      if (item && item.status === 'pending') this.start(item);
    }
  }

  private start(item: UploadItem) {
    if (!this.session) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.running.set(item.id, controller);
    this.patch(item, { status: 'uploading', progress: 0, error: undefined });

    const stale = () => generation !== this.generation;
    this.deps
      .upload(
        item.galleryId,
        item.file,
        (progress) => {
          if (stale()) return;
          // The bytes are sent; the server is now making the smaller sizes.
          this.patch(item, progress === 100 ? { progress, status: 'processing' } : { progress });
        },
        controller.signal
      )
      .then(
        (photo) => {
          if (stale()) return;
          this.settle(item, { status: 'complete', progress: 100 }, 'uploaded');
          for (const listener of this.completeListeners) listener(photo, item.galleryId);
          const timer = setTimeout(() => {
            this.timers.delete(timer);
            this.update(item.galleryId, (t) => ({ ...t, items: t.items.filter((u) => u.id !== item.id) }));
          }, COMPLETE_ROW_MS);
          this.timers.add(timer);
        },
        (err: unknown) => {
          if (stale()) return;
          const outcome = uploadOutcome(err);
          if (outcome.kind === 'duplicate') {
            this.settle(item, { status: 'duplicate', note: outcome.note }, 'skipped');
          } else {
            this.settle(item, { status: 'error', error: outcome.error, retryable: outcome.retryable }, 'failed');
          }
        }
      )
      .finally(() => {
        if (stale()) return;
        this.running.delete(item.id);
        this.pump();
      });
  }

  private find(id: string): UploadItem | undefined {
    for (const t of this.targets.values()) {
      const item = t.items.find((u) => u.id === id);
      if (item) return item;
    }
    return undefined;
  }

  private patch(item: UploadItem, patch: Partial<UploadItem>) {
    this.update(item.galleryId, (t) => ({
      ...t,
      items: t.items.map((u) => (u.id === item.id ? { ...u, ...patch } : u)),
    }));
  }

  private settle(item: UploadItem, patch: Partial<UploadItem>, counter: Exclude<keyof BatchStats, 'total'>) {
    this.update(item.galleryId, (t) => ({
      items: t.items.map((u) => (u.id === item.id ? { ...u, ...patch } : u)),
      stats: { ...t.stats, [counter]: t.stats[counter] + 1 },
    }));
  }

  private update(galleryId: string | null, fn: (t: TargetState) => TargetState) {
    const key = keyOf(galleryId);
    this.targets.set(key, fn(this.targets.get(key) ?? EMPTY_TARGET));
    this.emit();
  }

  private emit() {
    const summary = summarize(this.targets.values());
    if (!sameSummary(summary, this.summary)) this.summary = summary;
    for (const listener of this.listeners) listener();
  }
}
