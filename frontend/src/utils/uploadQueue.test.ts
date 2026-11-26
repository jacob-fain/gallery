import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DuplicateInfo } from '../api/client';
import type { Photo } from '../types';
import {
  COMPLETE_ROW_MS,
  HEIC_NOT_SUPPORTED,
  MAX_FILE_SIZE,
  RETRY_TIMING,
  UPLOAD_CONCURRENCY,
  UploadQueue,
  invalidReason,
  type UploadQueueDeps,
  type UploadQueueOptions,
} from './uploadQueue';

interface Call {
  galleryId: string | null;
  file: File;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
  resolve: (photo: Photo) => void;
  reject: (err: unknown) => void;
}

const photo = (id: string) => ({ id }) as Photo;
const image = (name: string, contents = name) => new File([contents], name, { type: 'image/jpeg' });
const rejected = (message: string, status: number) => Object.assign(new Error(message), { status });

// Lets the queue's awaited hashing and duplicate checks run.
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

function setup(overrides: Partial<UploadQueueDeps> = {}, options: UploadQueueOptions = {}) {
  const calls: Call[] = [];
  const deps: UploadQueueDeps = {
    upload: (galleryId, file, onProgress, signal) =>
      new Promise<Photo>((resolve, reject) => {
        calls.push({ galleryId, file, onProgress, signal, resolve, reject });
      }),
    checkDuplicates: vi.fn(async () => ({})),
    // Files with the same contents hash the same, as with SHA-256.
    hash: (file) => file.text(),
    ...overrides,
  };
  const queue = new UploadQueue(deps, options);
  queue.setSession('user-1');
  return { queue, calls, deps };
}

const statuses = (queue: UploadQueue, galleryId: string | null) =>
  queue.getTarget(galleryId).items.map((i) => `${i.file.name}:${i.status}`);

afterEach(() => {
  vi.useRealTimers();
});

describe('UploadQueue', () => {
  it('runs at most the concurrency limit across every gallery, starting the next as one finishes', async () => {
    const { queue, calls } = setup();
    queue.add([image('a1'), image('a2')], { galleryId: 'a', checkOnly: false });
    queue.add([image('b1'), image('b2')], { galleryId: 'b', checkOnly: false });
    await flush();

    expect(calls).toHaveLength(UPLOAD_CONCURRENCY);
    calls[0].resolve(photo('p1'));
    await flush();
    expect(calls).toHaveLength(UPLOAD_CONCURRENCY + 1);
  });

  it('keeps each gallery its own rows and counters', async () => {
    const { queue, calls } = setup({}, { concurrency: 3 });
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    queue.add([image('u1'), image('u2')], { galleryId: null, checkOnly: false });
    await flush();

    expect(statuses(queue, 'a')).toEqual(['a1:uploading']);
    expect(statuses(queue, null)).toEqual(['u1:uploading', 'u2:uploading']);
    expect(queue.getTarget(null).stats.total).toBe(2);
    expect(calls.map((c) => c.galleryId)).toEqual(['a', null, null]);
    expect(queue.getSummary()).toMatchObject({ active: true, total: 3, processed: 0, targetCount: 2 });
  });

  it('marks a sent file as processing, then complete, tells listeners, and drops the row later', async () => {
    vi.useFakeTimers();
    const { queue, calls } = setup();
    const done = vi.fn();
    queue.onComplete(done);
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();

    calls[0].onProgress(40);
    expect(queue.getTarget('a').items[0]).toMatchObject({ status: 'uploading', progress: 40 });
    calls[0].onProgress(100);
    expect(queue.getTarget('a').items[0].status).toBe('processing');

    calls[0].resolve(photo('p1'));
    await flush();
    expect(statuses(queue, 'a')).toEqual(['a1:complete']);
    expect(queue.getTarget('a').stats.uploaded).toBe(1);
    expect(done).toHaveBeenCalledWith(photo('p1'), 'a');
    expect(queue.getSummary().active).toBe(false);

    vi.advanceTimersByTime(COMPLETE_ROW_MS);
    expect(statuses(queue, 'a')).toEqual([]);
    // The batch summary stays after its rows are gone.
    expect(queue.getTarget('a').stats).toMatchObject({ total: 1, uploaded: 1 });
  });

  it('skips files already stored or repeated in the batch without uploading them', async () => {
    const checkDuplicates = vi.fn(async () => ({
      stored: { id: 'x', original_filename: 'IMG_1.jpg', gallery_id: 'g', gallery_title: 'Wedding', review_status: 'rejected' as const },
    }));
    const { queue, calls } = setup({ checkDuplicates } as Partial<UploadQueueDeps>);
    queue.add([image('a1', 'stored'), image('a2', 'same'), image('a3', 'same')], { galleryId: 'a', checkOnly: false });
    await flush();

    expect(statuses(queue, 'a')).toEqual(['a1:duplicate', 'a2:uploading', 'a3:duplicate']);
    expect(queue.getTarget('a').items[0].note).toBe('Already uploaded in Wedding as IMG_1.jpg (rejected)');
    expect(queue.getTarget('a').items[2].note).toBe('Duplicate of another file in this batch');
    expect(queue.getTarget('a').stats.skipped).toBe(2);
    expect(calls.map((c) => c.file.name)).toEqual(['a2']);
  });

  it('only reports in check-only mode', async () => {
    const { queue, calls } = setup();
    queue.add([image('a1')], { galleryId: 'a', checkOnly: true });
    expect(queue.getSummary()).toMatchObject({ active: true, checkOnly: true });
    await flush();

    expect(statuses(queue, 'a')).toEqual(['a1:new']);
    expect(queue.getTarget('a').stats.fresh).toBe(1);
    expect(calls).toHaveLength(0);
    expect(queue.getSummary().active).toBe(false);
  });

  it('fails files the server would refuse before checking them', async () => {
    const { queue, calls } = setup();
    const huge = image('big.jpg');
    Object.defineProperty(huge, 'size', { value: MAX_FILE_SIZE + 1 });
    queue.add([new File(['x'], 'notes.txt', { type: 'text/plain' }), huge], { galleryId: 'a', checkOnly: false });
    await flush();

    expect(queue.getTarget('a').items.map((i) => i.error)).toEqual([
      'Not an image file',
      'Larger than the 50MB upload limit',
    ]);
    expect(queue.getTarget('a').stats.failed).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it('fails HEIC and HEIF files before upload with no retry', async () => {
    const hash = vi.fn(async (file: File) => file.name);
    const { queue, calls } = setup({ hash });
    queue.add(
      [
        new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' }),
        new File(['x'], 'IMG_0002.heic', { type: '' }),
        image('IMG_0003.jpg'),
      ],
      { galleryId: 'a', checkOnly: false }
    );
    await flush();

    const [heic, untyped] = queue.getTarget('a').items;
    for (const item of [heic, untyped]) {
      expect(item).toMatchObject({ status: 'error', error: HEIC_NOT_SUPPORTED, retryable: false });
    }
    expect(queue.getTarget('a').stats.failed).toBe(2);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.file.name)).toEqual(['IMG_0003.jpg']);
  });

  it('maps rejections through uploadOutcome and retries only what can succeed', async () => {
    const { queue, calls } = setup({}, { concurrency: 3 });
    queue.add([image('a1'), image('a2'), image('a3')], { galleryId: 'a', checkOnly: false });
    await flush();

    calls[0].reject(rejected('Already uploaded as a1', 409));
    calls[1].reject(rejected('Unsupported', 415));
    calls[2].reject(rejected('Server error', 500));
    await flush();
    expect(statuses(queue, 'a')).toEqual(['a1:duplicate', 'a2:error', 'a3:error']);
    expect(queue.getTarget('a').items.map((i) => i.retryable)).toEqual([false, false, true]);
    expect(queue.getTarget('a').stats).toMatchObject({ skipped: 1, failed: 2 });

    queue.retry(queue.getTarget('a').items[1].id);
    queue.retry(queue.getTarget('a').items[2].id);
    await flush();
    expect(calls).toHaveLength(4);
    expect(queue.getTarget('a').stats.failed).toBe(1);
    expect(queue.getSummary().active).toBe(true);
  });

  it('starts a new batch once the last one finished, keeping nothing from it', async () => {
    const { queue, calls } = setup();
    queue.add([new File(['x'], 'notes.txt', { type: 'text/plain' })], { galleryId: 'a', checkOnly: false });
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();

    expect(statuses(queue, 'a')).toEqual(['a1:uploading']);
    expect(queue.getTarget('a').stats).toMatchObject({ total: 1, failed: 0 });
    expect(calls).toHaveLength(1);
  });

  it('aborts running uploads and forgets queued ones when the session ends', async () => {
    const { queue, calls } = setup();
    const done = vi.fn();
    queue.onComplete(done);
    queue.add([image('a1'), image('a2'), image('a3'), image('a4')], { galleryId: 'a', checkOnly: false });
    await flush();

    queue.setSession(null);
    expect(calls.every((c) => c.signal.aborted)).toBe(true);
    expect(queue.getTarget('a').items).toEqual([]);
    expect(queue.getSummary().active).toBe(false);

    // An upload that answers after the abort changes nothing.
    calls[0].resolve(photo('p1'));
    calls[1].reject(rejected('Upload aborted', 0));
    await flush();
    expect(done).not.toHaveBeenCalled();
    expect(queue.getTarget('a').items).toEqual([]);
    expect(calls).toHaveLength(UPLOAD_CONCURRENCY);

    queue.add([image('a5')], { galleryId: 'a', checkOnly: false });
    await flush();
    expect(calls).toHaveLength(UPLOAD_CONCURRENCY);
  });

  it('stops a duplicate check in progress when aborted', async () => {
    let answer: (v: Record<string, never>) => void = () => {};
    const checkDuplicates = vi.fn(() => new Promise<Record<string, never>>((r) => (answer = r)));
    const { queue, calls } = setup({ checkDuplicates });
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();

    queue.abortAll();
    answer({});
    await flush();
    expect(calls).toHaveLength(0);
    expect(queue.getTarget('a').items).toEqual([]);
  });

  it('aborts when a different session signs in, but not when the same one is set again', async () => {
    const { queue, calls } = setup();
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();

    queue.setSession('user-1');
    expect(calls[0].signal.aborted).toBe(false);
    queue.setSession('user-2');
    expect(calls[0].signal.aborted).toBe(true);
  });

  it('keeps snapshots stable so only the affected panel re-renders', async () => {
    const { queue, calls } = setup();
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    queue.add([image('b1')], { galleryId: 'b', checkOnly: false });
    await flush();

    const b = queue.getTarget('b');
    const summary = queue.getSummary();
    calls[0].onProgress(50);
    expect(queue.getTarget('b')).toBe(b);
    expect(queue.getSummary()).toBe(summary);
  });

  it('names the one gallery uploading so the indicator can link to it', async () => {
    const { queue } = setup();
    queue.add([image('u1')], { galleryId: null, checkOnly: false });
    expect(queue.getSummary()).toMatchObject({ targetCount: 1, galleryId: null, checkOnly: false });
  });
});

describe('invalidReason', () => {
  const file = (name: string, type: string) => new File(['x'], name, { type });

  it('names HEIC and HEIF by type or by extension, whatever else the type says', () => {
    for (const f of [
      file('IMG_1.HEIC', 'image/heic'),
      file('IMG_1.heif', 'image/heif'),
      file('burst', 'image/heic-sequence'),
      file('IMG_1.HEIC', ''),
      file('IMG_1.heic', 'image/jpeg'),
    ]) {
      expect(invalidReason(f), `${f.name} ${f.type}`).toBe(HEIC_NOT_SUPPORTED);
    }
  });

  it('lets supported images through', () => {
    expect(invalidReason(file('IMG_1.jpg', 'image/jpeg'))).toBeNull();
    expect(invalidReason(file('IMG_1.tif', ''))).toBeNull();
  });
});

describe('UploadQueue retries', () => {
  // Every file's hash is its contents; the server holds the hashes in `stored`.
  function lossy(options: UploadQueueOptions = {}) {
    const stored = new Map<string, { id: string; gallery_id: string | null }>();
    const checkDuplicates = vi.fn(async (hashes: string[]) => {
      const found: Record<string, DuplicateInfo> = {};
      for (const h of hashes) {
        const s = stored.get(h);
        if (s) found[h] = { ...s, original_filename: h, gallery_title: null, review_status: 'review' };
      }
      return found;
    });
    const setupResult = setup({ checkDuplicates }, options);
    return { ...setupResult, stored, checkDuplicates };
  }

  const row = (queue: UploadQueue, galleryId: string | null, index = 0) => queue.getTarget(galleryId).items[index];
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  };

  it('retries a lost connection by itself after 2, 5, 15, 30 then 60 s, and gives up after 10 attempts', async () => {
    vi.useFakeTimers();
    const { queue, calls } = lossy();
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();

    const waits: number[] = [];
    for (let attempt = 1; attempt <= RETRY_TIMING.maxAttempts; attempt++) {
      expect(calls).toHaveLength(attempt);
      calls[attempt - 1].reject(rejected('Upload failed', 0));
      await flush();
      const item = row(queue, 'a');
      if (attempt === RETRY_TIMING.maxAttempts) break;
      expect(item).toMatchObject({ status: 'retrying', attempts: attempt });
      waits.push(item.retryAt! - Date.now());
      await advance(item.retryAt! - Date.now());
    }

    expect(waits).toEqual([2000, 5000, 15000, 30000, 60000, 60000, 60000, 60000, 60000]);
    expect(row(queue, 'a')).toMatchObject({
      status: 'error',
      error: 'Upload failed (after 10 attempts)',
      retryable: true,
    });
    expect(queue.getTarget('a').stats).toMatchObject({ failed: 1 });
    expect(queue.getSummary()).toMatchObject({ active: false, failed: 1 });
  });

  it.each([
    ['a duplicate', 409, 'duplicate'],
    ['an unsupported type', 415, 'error'],
    ['a file too large', 413, 'error'],
    ['a plain server error', 500, 'error'],
  ])('does not retry %s by itself', async (_case, status, expected) => {
    vi.useFakeTimers();
    const { queue, calls } = lossy();
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();
    calls[0].reject(rejected('No', status));
    await flush();
    await advance(10 * 60_000);
    expect(calls).toHaveLength(1);
    expect(row(queue, 'a').status).toBe(expected);
  });

  it('reports a photo the server stored before its answer was lost (Cloudflare 524) as already uploaded', async () => {
    vi.useFakeTimers();
    const { queue, calls, stored, checkDuplicates } = lossy();
    const done = vi.fn();
    const recovered = vi.fn();
    queue.onComplete(done);
    queue.onRecovered(recovered);
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();

    // Every byte arrives, the server stores the photo, and the browser gets
    // Cloudflare's timeout page instead of the 201.
    calls[0].onProgress(100);
    stored.set('a1', { id: 'p1', gallery_id: 'a' });
    calls[0].reject(rejected('The server took too long to answer (HTTP 524)', 524));
    await flush();
    expect(row(queue, 'a')).toMatchObject({ status: 'retrying' });

    await advance(2000);
    expect(checkDuplicates).toHaveBeenLastCalledWith(['a1']);
    expect(calls).toHaveLength(1);
    expect(row(queue, 'a')).toMatchObject({ status: 'complete', note: 'Already uploaded' });
    expect(queue.getTarget('a').stats).toMatchObject({ uploaded: 1, failed: 0, skipped: 0 });
    expect(recovered).toHaveBeenCalledWith('a');
    expect(done).not.toHaveBeenCalled();
  });

  it('keeps asking, without sending again, while the server may still be storing a photo whose answer was lost', async () => {
    vi.useFakeTimers();
    const { queue, calls, stored } = lossy();
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();
    calls[0].onProgress(100);
    calls[0].reject(rejected('Gateway timeout', 524));
    await flush();

    // Not stored yet at the first two checks (2 s, then 5 s later).
    await advance(2000);
    await advance(5000);
    expect(calls).toHaveLength(1);
    expect(row(queue, 'a')).toMatchObject({ status: 'retrying' });

    stored.set('a1', { id: 'p1', gallery_id: 'a' });
    await advance(15000);
    expect(calls).toHaveLength(1);
    expect(row(queue, 'a')).toMatchObject({ status: 'complete', note: 'Already uploaded' });
  });

  it('sends again once the grace has passed and the server never stored it', async () => {
    vi.useFakeTimers();
    const { queue, calls } = lossy({ timing: { serverGraceMs: 10_000 } });
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();
    calls[0].onProgress(100);
    calls[0].reject(rejected('Gateway timeout', 524));
    await flush();

    await advance(2000);
    await advance(5000);
    expect(calls).toHaveLength(1);
    await advance(15000);
    expect(calls).toHaveLength(2);
    expect(row(queue, 'a')).toMatchObject({ status: 'uploading', attempts: 2 });
  });

  it("treats a retry's 409 naming a photo in the same gallery as its own earlier attempt", async () => {
    vi.useFakeTimers();
    // No hash, so nothing is asked before sending again: the server's 409 decides.
    const { queue, calls } = setup({ hash: () => Promise.reject(new Error('no hashing')) });
    queue.add([image('a1'), image('a2')], { galleryId: 'a', checkOnly: false });
    await flush();
    calls[0].reject(rejected('Upload failed', 0));
    calls[1].reject(rejected('Upload failed', 0));
    await flush();
    await advance(2000);
    expect(calls).toHaveLength(4);

    const dup = (galleryId: string | null) =>
      Object.assign(rejected('Already uploaded as a.jpg (needs review)', 409), {
        existing: { id: 'p1', gallery_id: galleryId },
      });
    calls[2].reject(dup('a'));
    calls[3].reject(dup('elsewhere'));
    await flush();

    expect(row(queue, 'a', 0)).toMatchObject({ status: 'complete', note: 'Already uploaded' });
    expect(row(queue, 'a', 1)).toMatchObject({ status: 'duplicate', note: 'Already uploaded as a.jpg (needs review)' });
    expect(queue.getTarget('a').stats).toMatchObject({ uploaded: 1, skipped: 1, failed: 0 });
  });

  it('gives up on a connection that stops sending, and on an answer that never comes', async () => {
    vi.useFakeTimers();
    const { queue, calls } = lossy();
    queue.add([image('a1'), image('a2')], { galleryId: 'a', checkOnly: false });
    await flush();

    // Progress keeps a slow upload alive.
    calls[0].onProgress(10);
    calls[1].onProgress(10);
    await advance(RETRY_TIMING.stallMs - 1000);
    calls[0].onProgress(50);
    calls[1].onProgress(100);
    await advance(2000);
    expect(calls[0].signal.aborted).toBe(false);
    expect(calls[1].signal.aborted).toBe(false);

    await advance(RETRY_TIMING.stallMs);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].reject(rejected('Upload aborted', 0));
    await flush();
    expect(row(queue, 'a', 0)).toMatchObject({ status: 'retrying', note: 'Upload stalled' });

    await advance(RETRY_TIMING.answerMs - RETRY_TIMING.stallMs);
    expect(calls[1].signal.aborted).toBe(true);
    calls[1].reject(rejected('Upload aborted', 0));
    await flush();
    expect(row(queue, 'a', 1)).toMatchObject({ status: 'retrying', note: 'No answer from the server' });
    expect(row(queue, 'a', 1).lostAt).toBeDefined();
  });

  it('waits while the browser is offline and goes as soon as it is back', async () => {
    vi.useFakeTimers();
    let online = true;
    const { queue, calls } = lossy({ isOnline: () => online });
    queue.add([image('a1'), image('a2'), image('a3')], { galleryId: 'a', checkOnly: false });
    await flush();
    expect(calls).toHaveLength(2);

    online = false;
    calls[0].reject(rejected('Upload failed', 0));
    await flush();
    // The free slot is not used while offline.
    expect(calls).toHaveLength(2);
    await advance(60_000);
    expect(calls).toHaveLength(2);
    expect(row(queue, 'a', 0)).toMatchObject({ status: 'retrying', offline: true });

    online = true;
    queue.resumeOnline();
    await flush();
    // The free slot goes at once; the retry, after its check, is next in line.
    expect(calls.map((c) => c.file.name)).toEqual(['a1', 'a2', 'a3']);
    expect(row(queue, 'a', 0)).toMatchObject({ status: 'pending', offline: undefined });
    calls[1].resolve(photo('p2'));
    await flush();
    expect(calls[3].file.name).toBe('a1');
    expect(row(queue, 'a', 0)).toMatchObject({ status: 'uploading', attempts: 2 });
  });

  it('retries every failed file at once with Retry all failed, in one gallery or all', async () => {
    const { queue, calls } = lossy({ concurrency: 3 });
    queue.add([image('a1'), image('a2')], { galleryId: 'a', checkOnly: false });
    queue.add([image('b1')], { galleryId: 'b', checkOnly: false });
    await flush();
    const call = (name: string) => calls.find((c) => c.file.name === name)!;
    call('a1').reject(rejected('Server error', 500));
    call('a2').reject(rejected('Unsupported', 415));
    call('b1').reject(rejected('Server error', 500));
    await flush();
    expect(queue.getSummary()).toMatchObject({ failed: 2 });

    queue.retryAllFailed('a');
    await flush();
    expect(calls.map((c) => c.file.name).slice(3)).toEqual(['a1']);
    expect(queue.getTarget('b').stats.failed).toBe(1);

    queue.retryAllFailed();
    await flush();
    expect(calls.map((c) => c.file.name).slice(3)).toEqual(['a1', 'b1']);
    expect(statuses(queue, 'a')).toEqual(['a1:uploading', 'a2:error']);
    expect(queue.getSummary()).toMatchObject({ failed: 0 });
  });

  it('stops retries when the session ends', async () => {
    vi.useFakeTimers();
    const { queue, calls } = lossy();
    queue.add([image('a1')], { galleryId: 'a', checkOnly: false });
    await flush();
    calls[0].reject(rejected('Upload failed', 0));
    await flush();
    queue.setSession(null);
    await advance(10 * 60_000);
    expect(calls).toHaveLength(1);
    expect(queue.getTarget('a').items).toEqual([]);
  });
});
