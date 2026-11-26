import type { DuplicateInfo } from '../api/client';
import type { Photo } from '../types';
import { mayBeStored, uploadOutcome, type UploadOutcome } from './uploadOutcome';
import { STATUS_LABELS } from './reviewStatus';

// Matches the server-side multer limit
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
// Files are hashed and duplicate-checked in batches so uploads can start
// while later files are still being hashed
const CHECK_BATCH_SIZE = 20;
// Parallel uploads across every gallery, so a second drop does not add more.
// Two, not more: behind Cloudflare the server must answer within 100 s of
// receiving a body, and it answers only after pushing the photo to S3 over
// the same home upstream the browser's uploads are using. Every extra upload
// in flight slows that push; at three the slowest answers came close to the
// limit on a slow uplink, at two they kept about half of it free, for a few
// percent more total time.
export const UPLOAD_CONCURRENCY = 2;

/** When a lost upload is tried again. */
export interface RetryTiming {
  /** Wait before each retry; the last one repeats. */
  delaysMs: readonly number[];
  /** Upload attempts before a file is left failed for the admin to retry. */
  maxAttempts: number;
  /** No progress for this long while sending: the connection is dead. */
  stallMs: number;
  /** Every byte sent and no answer for this long: the answer is lost. */
  answerMs: number;
  /** After an answer is lost, how long to keep asking whether the server
   *  stored the photo before sending it again. The server may still be
   *  writing it to S3 after the proxy in front gave up on the request. */
  serverGraceMs: number;
  /** How often to ask during that grace, after a first check at delaysMs[0]. */
  confirmPollMs: number;
}

export const RETRY_TIMING: RetryTiming = {
  delaysMs: [2_000, 5_000, 15_000, 30_000, 60_000],
  maxAttempts: 10,
  stallMs: 60_000,
  // Progress reaches 100% once the browser has buffered the body, not once
  // the server has it, so a stall near the end of the body also ends up
  // here. Behind Cloudflare an answer or its 524 comes within 100 s of the
  // body arriving. On a model calibrated to production (p90 82 s per whole
  // upload) the slowest answer after the body was 53 s, so 90 s gives up on
  // a dead connection sooner without cutting off real answers; one cut off
  // anyway is found by the check that follows.
  answerMs: 90_000,
  // The same model's slowest answer is 53 s, so a photo whose answer was lost
  // is stored within a minute; polling every 10 s finds it soon after.
  serverGraceMs: 60_000,
  confirmPollMs: 10_000,
};

export const ALREADY_UPLOADED = 'Already uploaded';
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
  | 'retrying'
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
  /** SHA-256 of the file, when hashing worked. */
  hash?: string;
  /** Upload attempts made so far. */
  attempts?: number;
  /** When a retrying row tries again (epoch ms), unset while it waits for the network or checks. */
  retryAt?: number;
  /** The wait that retryAt ends, so a countdown never shows more. */
  retryDelayMs?: number;
  /** A retrying row is waiting for the browser to come back online. */
  offline?: boolean;
  /** When an attempt that may have been stored lost its answer (epoch ms). */
  lostAt?: number;
  /** Asking the server whether it stored a photo whose answer was lost. */
  confirming?: boolean;
  /** Scheduled waits so far, which picks the next delay. */
  waits?: number;
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
  /** Rows waiting out a backoff before trying again. */
  retrying: number;
  /** Rows asking the server whether it stored them. */
  confirming: number;
  /** Running rows that are checking, waiting for a slot or sending. */
  moving: number;
  /** The earliest backoff to end (epoch ms), and its wait, for a countdown. */
  nextRetryAt: number | null;
  nextRetryDelayMs: number | null;
  /** Rows that failed and can be retried, in every target, running or not. */
  failed: number;
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

export interface UploadQueueOptions {
  concurrency?: number;
  timing?: Partial<RetryTiming>;
  /** navigator.onLine; retries wait while it is false. */
  isOnline?: () => boolean;
  now?: () => number;
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
  retrying: 0,
  confirming: 0,
  moving: 0,
  nextRetryAt: null,
  nextRetryDelayMs: null,
  failed: 0,
};

export const isInFlight = (item: UploadItem) =>
  item.status === 'checking' ||
  item.status === 'pending' ||
  item.status === 'uploading' ||
  item.status === 'processing' ||
  item.status === 'retrying';

const isRetryableFailure = (item: UploadItem) => item.status === 'error' && item.retryable === true;

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
  let retrying = 0;
  let confirming = 0;
  let moving = 0;
  let nextRetryAt: number | null = null;
  let nextRetryDelayMs: number | null = null;
  let failed = 0;
  for (const t of targets) {
    for (const i of t.items) {
      if (isRetryableFailure(i)) failed += 1;
      else if (i.status === 'retrying' && i.confirming) confirming += 1;
      else if (i.status === 'retrying') {
        retrying += 1;
        if (i.retryAt !== undefined && (nextRetryAt === null || i.retryAt < nextRetryAt)) {
          nextRetryAt = i.retryAt;
          nextRetryDelayMs = i.retryDelayMs ?? null;
        }
      } else if (isInFlight(i)) moving += 1;
    }
    const running = t.items.filter(isInFlight);
    if (running.length === 0) continue;
    targetCount += 1;
    galleryId = running[0].galleryId;
    total += t.stats.total;
    processed += processedCount(t.stats);
    if (running.some((i) => !i.checkOnly)) checkOnly = false;
  }
  if (targetCount === 0) return failed === 0 ? IDLE : { ...IDLE, failed };
  return {
    active: true,
    total,
    processed,
    checkOnly,
    targetCount,
    galleryId,
    retrying,
    confirming,
    moving,
    nextRetryAt,
    nextRetryDelayMs,
    failed,
  };
}

const sameSummary = (a: QueueSummary, b: QueueSummary) =>
  a.active === b.active &&
  a.total === b.total &&
  a.processed === b.processed &&
  a.checkOnly === b.checkOnly &&
  a.targetCount === b.targetCount &&
  a.galleryId === b.galleryId &&
  a.retrying === b.retrying &&
  a.confirming === b.confirming &&
  a.moving === b.moving &&
  a.nextRetryAt === b.nextRetryAt &&
  a.nextRetryDelayMs === b.nextRetryDelayMs &&
  a.failed === b.failed;

/**
 * The admin's uploads, kept outside any page so they survive navigation.
 * State is immutable per target, so a target's snapshot only changes when its
 * own rows do (useSyncExternalStore compares by reference).
 *
 * An upload whose connection or answer is lost is tried again by itself,
 * after a growing wait. Before sending a file again the queue asks the server
 * whether it already has that file's bytes: an answer lost after the server
 * stored the photo is the common case on a slow uplink, and the content hash
 * is unique, so a retry can never store a second copy.
 */
export class UploadQueue {
  private deps: UploadQueueDeps;
  private concurrency: number;
  private timing: RetryTiming;
  private isOnline: () => boolean;
  private now: () => number;
  private targets = new Map<string, TargetState>();
  private summary: QueueSummary = IDLE;
  private listeners = new Set<() => void>();
  private completeListeners = new Set<(photo: Photo, galleryId: string | null) => void>();
  private recoveredListeners = new Set<(galleryId: string | null) => void>();
  private waiting: string[] = [];
  private running = new Map<string, AbortController>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Bumped by abortAll so work started before it drops its results.
  private generation = 0;
  // The signed-in admin's id, or null when signed out.
  private session: string | null = null;
  private nextId = 0;

  constructor(deps: UploadQueueDeps, options: UploadQueueOptions = {}) {
    this.deps = deps;
    this.concurrency = options.concurrency ?? UPLOAD_CONCURRENCY;
    this.timing = { ...RETRY_TIMING, ...options.timing };
    this.isOnline = options.isOnline ?? (() => true);
    this.now = options.now ?? Date.now;
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

  /** A retry found its photo already stored by an attempt whose answer was
   *  lost. There is no photo object to add, so a page showing that target
   *  reloads its list. */
  onRecovered(listener: (galleryId: string | null) => void) {
    this.recoveredListeners.add(listener);
    return () => {
      this.recoveredListeners.delete(listener);
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

  /** Tries a failed row again now, with a fresh set of automatic retries. */
  retry(id: string) {
    const item = this.find(id);
    if (!item || !isRetryableFailure(item)) return;
    this.update(item.galleryId, (t) => ({
      items: t.items.map((u) =>
        u.id === id
          ? {
              ...u,
              status: 'retrying' as const,
              progress: 0,
              error: undefined,
              retryable: undefined,
              attempts: 0,
              waits: 0,
              retryAt: undefined,
              lostAt: undefined,
              confirming: undefined,
            }
          : u
      ),
      stats: { ...t.stats, failed: Math.max(0, t.stats.failed - 1) },
    }));
    void this.resume(id);
  }

  /** Retries every failed row that can succeed, in one target or in all. */
  retryAllFailed(galleryId?: string | null) {
    const targets = galleryId === undefined ? [...this.targets.values()] : [this.getTarget(galleryId)];
    for (const t of targets) {
      for (const item of t.items) if (isRetryableFailure(item)) this.retry(item.id);
    }
  }

  /** The browser is back online: rows waiting for it try again now. */
  resumeOnline() {
    for (const t of [...this.targets.values()]) {
      for (const item of t.items) {
        if (item.status !== 'retrying') continue;
        if (!item.offline && item.retryAt === undefined) continue;
        this.clearRetryTimer(item.id);
        this.patch(item, { offline: undefined, retryAt: undefined });
        void this.resume(item.id);
      }
    }
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
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
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
          this.settle(item, { status: 'duplicate', note: duplicateNote(dup) }, 'skipped');
        } else if (hash && seenHashes.has(hash)) {
          this.settle(item, { status: 'duplicate', note: 'Duplicate of another file in this batch' }, 'skipped');
        } else {
          if (hash) seenHashes.add(hash);
          if (item.checkOnly) {
            this.settle(item, { status: 'new', note: 'Not uploaded yet' }, 'fresh');
          } else {
            this.patch(item, { status: 'pending', hash });
            this.waiting.push(item.id);
          }
        }
      }
      this.pump();
    }
  }

  private pump() {
    // Offline, every attempt would fail at once and use up its retries.
    if (!this.isOnline()) return;
    while (this.running.size < this.concurrency && this.waiting.length > 0) {
      const item = this.find(this.waiting.shift()!);
      if (item && item.status === 'pending') this.start(item);
    }
  }

  private start(item: UploadItem) {
    if (!this.session) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.running.set(item.id, controller);
    const attempts = (item.attempts ?? 0) + 1;
    this.patch(item, { status: 'uploading', progress: 0, error: undefined, attempts, retryAt: undefined });

    // XMLHttpRequest has no idle timeout, and a connection that silently
    // stops carrying packets is never closed by the browser, so a watchdog
    // gives up on one that has gone quiet.
    let sent = false;
    let timedOut = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      watchdog = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        sent ? this.timing.answerMs : this.timing.stallMs
      );
    };
    arm();

    const stale = () => generation !== this.generation;
    this.deps
      .upload(
        item.galleryId,
        item.file,
        (progress) => {
          if (stale() || timedOut) return;
          // The bytes are sent; the server is now making the smaller sizes.
          if (progress === 100) sent = true;
          arm();
          this.patch(item, progress === 100 ? { progress, status: 'processing' } : { progress });
        },
        controller.signal
      )
      .then(
        (photo) => {
          if (stale()) return;
          this.finish(item, { status: 'complete', progress: 100 });
          for (const listener of this.completeListeners) listener(photo, item.galleryId);
        },
        (err: unknown) => {
          if (stale()) return;
          const outcome: UploadOutcome = timedOut
            ? {
                kind: 'failed',
                error: sent ? 'No answer from the server' : 'Upload stalled',
                retryable: true,
                auto: true,
                status: 0,
              }
            : uploadOutcome(err);
          const current = this.find(item.id) ?? item;
          if (outcome.kind === 'duplicate') {
            // A 409 on a retry that names a photo in this same target is this
            // file, stored by an earlier attempt whose answer was lost.
            if (attempts > 1 && outcome.existing && outcome.existing.gallery_id === item.galleryId) {
              this.recover(current);
            } else {
              this.settle(current, { status: 'duplicate', note: outcome.note }, 'skipped');
            }
          } else if (outcome.auto && attempts < this.timing.maxAttempts) {
            const stored = timedOut ? sent : mayBeStored(outcome.status, sent);
            if (stored && current.hash) this.confirm(this.patched(current, { lostAt: this.now() }), outcome.error, true);
            else this.scheduleRetry(current, outcome.error);
          } else {
            const error = outcome.auto ? `${outcome.error} (after ${attempts} attempts)` : outcome.error;
            this.settle(current, { status: 'error', error, retryable: outcome.retryable, retryAt: undefined }, 'failed');
          }
        }
      )
      .finally(() => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        if (stale()) return;
        this.running.delete(item.id);
        this.pump();
      });
  }

  // Waits out the next backoff, then checks once and sends again.
  private scheduleRetry(item: UploadItem, reason: string) {
    const waits = (item.waits ?? 0) + 1;
    const { delaysMs } = this.timing;
    const delay = delaysMs[Math.min(waits - 1, delaysMs.length - 1)];
    this.wait(item, delay, { note: reason, waits, confirming: undefined });
  }

  // Asks again whether the server stored a photo whose answer was lost: first
  // soon, then every confirmPollMs, until serverGraceMs from the loss.
  private confirm(item: UploadItem, reason: string, first = false) {
    const left = (item.lostAt ?? this.now()) + this.timing.serverGraceMs - this.now();
    const delay = Math.max(0, Math.min(first ? this.timing.delaysMs[0] : this.timing.confirmPollMs, left));
    this.wait(item, delay, { note: reason, confirming: true });
  }

  private wait(item: UploadItem, delay: number, patch: Partial<UploadItem>) {
    this.patch(item, {
      ...patch,
      status: 'retrying',
      progress: 0,
      retryAt: this.now() + delay,
      retryDelayMs: delay,
      offline: undefined,
    });
    this.clearRetryTimer(item.id);
    const timer = setTimeout(() => {
      this.retryTimers.delete(item.id);
      void this.resume(item.id);
    }, delay);
    this.retryTimers.set(item.id, timer);
  }

  private withinGrace(item: UploadItem) {
    return (
      item.confirming === true &&
      item.lostAt !== undefined &&
      this.now() - item.lostAt < this.timing.serverGraceMs
    );
  }

  // Asks the server whether it already has the file before sending it again.
  private async resume(id: string) {
    const generation = this.generation;
    let item = this.find(id);
    if (!item || item.status !== 'retrying') return;
    if (!this.isOnline()) {
      this.patch(item, { offline: true, retryAt: undefined });
      return;
    }
    this.patch(item, { retryAt: undefined, offline: undefined });

    if (item.hash) {
      let found: DuplicateInfo | undefined;
      try {
        found = (await this.deps.checkDuplicates([item.hash]))[item.hash];
      } catch {
        if (generation !== this.generation) return;
        item = this.find(id);
        if (!item || item.status !== 'retrying') return;
        // The check is lost too: the connection is still down. It counts as an
        // attempt, so a dead connection still ends in a failed row.
        const attempts = (item.attempts ?? 0) + 1;
        if (attempts >= this.timing.maxAttempts) {
          this.settle(
            item,
            { status: 'error', error: `No connection to the server (after ${attempts} attempts)`, retryable: true, attempts },
            'failed'
          );
        } else {
          const next = this.patched(item, { attempts });
          if (this.withinGrace(next)) this.confirm(next, 'No connection to the server');
          else this.scheduleRetry(next, 'No connection to the server');
        }
        return;
      }
      if (generation !== this.generation) return;
      item = this.find(id);
      if (!item || item.status !== 'retrying') return;
      if (found) {
        if (found.gallery_id === item.galleryId) this.recover(item);
        else this.settle(item, { status: 'duplicate', note: duplicateNote(found) }, 'skipped');
        return;
      }
      if (this.withinGrace(item)) {
        this.confirm(item, item.note ?? 'No answer from the server');
        return;
      }
    }

    this.patch(item, { status: 'pending', note: undefined, confirming: undefined });
    // Ahead of files not yet tried, so a batch does not end on its retries.
    this.waiting.unshift(id);
    this.pump();
  }

  private patched(item: UploadItem, patch: Partial<UploadItem>): UploadItem {
    this.patch(item, patch);
    return this.find(item.id) ?? { ...item, ...patch };
  }

  private recover(item: UploadItem) {
    this.finish(item, { status: 'complete', progress: 100, note: ALREADY_UPLOADED });
    for (const listener of this.recoveredListeners) listener(item.galleryId);
  }

  private finish(item: UploadItem, patch: Partial<UploadItem>) {
    this.settle(item, { ...patch, retryAt: undefined, offline: undefined }, 'uploaded');
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.update(item.galleryId, (t) => ({ ...t, items: t.items.filter((u) => u.id !== item.id) }));
    }, COMPLETE_ROW_MS);
    this.timers.add(timer);
  }

  private clearRetryTimer(id: string) {
    const timer = this.retryTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.retryTimers.delete(id);
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

function duplicateNote(dup: DuplicateInfo): string {
  const where = dup.gallery_title ? ` in ${dup.gallery_title}` : dup.gallery_id === null ? ' (unassigned)' : '';
  // The state says why a re-uploaded photo is not on the site.
  const state = dup.review_status ? ` (${STATUS_LABELS[dup.review_status].toLowerCase()})` : '';
  return `${ALREADY_UPLOADED}${where} as ${dup.original_filename}${state}`;
}
