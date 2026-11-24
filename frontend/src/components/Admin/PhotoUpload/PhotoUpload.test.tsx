// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DuplicateInfo } from '../../../api/client';
import { AuthContext, type AuthContextType } from '../../../contexts/auth';
import type { Photo } from '../../../types';
import { HEIC_NOT_SUPPORTED } from '../../../utils/uploadQueue';

vi.mock('../../../api/client', () => ({
  uploadPhoto: vi.fn(),
  checkDuplicates: vi.fn(),
}));

const client = await import('../../../api/client');
const { UploadQueueProvider } = await import('../../../contexts/UploadQueueContext');
const { default: PhotoUpload } = await import('./PhotoUpload');

const GALLERY = 'gallery-1';

// jsdom's Blob has no arrayBuffer(), which the queue hashes files with, and
// Node's crypto.subtle refuses an ArrayBuffer from jsdom's realm, so the bytes
// are copied into a Node Buffer. Every browser the admin runs has arrayBuffer().
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const bytes = Buffer.from(new Uint8Array(reader.result as ArrayBuffer));
        resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

const auth: AuthContextType = {
  user: { id: 'admin-1', email: 'admin@example.com' } as AuthContextType['user'],
  isAuthenticated: true,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

/** A JPEG whose bytes are `content`, so two files with the same content are duplicates. */
const image = (name: string, content = name, type = 'image/jpeg') => new File([content], name, { type });

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');

interface Upload {
  galleryId: string | null;
  onProgress: (percent: number) => void;
  resolve: (photo: Photo) => void;
  reject: (err: unknown) => void;
}

/** Uploads that finish only when the test says so, keyed by file name. */
let uploads: Map<string, Upload>;
/** Content of files the server already holds, and where. */
let stored: Map<string, DuplicateInfo>;

const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

function renderUpload(onUploadComplete = vi.fn()) {
  const user = userEvent.setup({ applyAccept: false });
  render(
    <AuthContext.Provider value={auth}>
      <UploadQueueProvider>
        <PhotoUpload galleryId={GALLERY} onUploadComplete={onUploadComplete} />
      </UploadQueueProvider>
    </AuthContext.Provider>
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const dropzone = screen.getByText('Drop photos here or click to upload').closest('div')!.parentElement!;
  return { user, input, dropzone, onUploadComplete };
}

/** Waits for hashing and the duplicate check, until `count` uploads have started. */
async function started(count: number) {
  await act(async () => {
    while (uploads.size < count) await new Promise((r) => setTimeout(r, 0));
  });
}

/** Runs a step of a mocked upload and lets the panel re-render. */
async function step(fn: () => void) {
  await act(async () => fn());
}

/** The row for one file: its name, status and buttons share a parent. */
const row = (name: string) => screen.getByText(name).parentElement!;

const summary = () => document.querySelector('[class*="summaryText"]')?.textContent;

describe('PhotoUpload drop zone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploads = new Map();
    stored = new Map();
    vi.mocked(client.uploadPhoto).mockImplementation(
      (galleryId, file, onProgress) =>
        new Promise<Photo>((resolve, reject) =>
          uploads.set(file.name, { galleryId, onProgress: onProgress!, resolve, reject })
        )
    );
    vi.mocked(client.checkDuplicates).mockImplementation(async (hashes) => {
      const found: Record<string, DuplicateInfo> = {};
      for (const [content, info] of stored) {
        const hash = sha256(content);
        if (hashes.includes(hash)) found[hash] = info;
      }
      return found;
    });
  });

  it('uploads files chosen through the input, showing progress until each is done', async () => {
    const { user, input, onUploadComplete } = renderUpload();

    await user.upload(input, [image('a.jpg'), image('b.jpg')]);
    expect(screen.getByText('a.jpg')).toBeTruthy();
    expect(summary()).toBe('0/2 · 0 uploaded');
    await started(2);

    expect(client.checkDuplicates).toHaveBeenCalledWith([sha256('a.jpg'), sha256('b.jpg')]);
    expect(uploads.get('a.jpg')!.galleryId).toBe(GALLERY);
    expect(within(row('a.jpg')).getByText('0%')).toBeTruthy();
    // The input is cleared, so choosing the same file again fires a change.
    expect(input.value).toBe('');

    await step(() => uploads.get('a.jpg')!.onProgress(40));
    expect(within(row('a.jpg')).getByText('40%')).toBeTruthy();
    expect((row('a.jpg').querySelector('[class*="progressFill"]') as HTMLElement).style.width).toBe('40%');

    // All bytes sent: the server is making the smaller sizes.
    await step(() => uploads.get('a.jpg')!.onProgress(100));
    expect(within(row('a.jpg')).getByText('Processing...')).toBeTruthy();

    const photo = { id: 'photo-a' } as Photo;
    await step(() => uploads.get('a.jpg')!.resolve(photo));
    expect(within(row('a.jpg')).getByText('✓ Done')).toBeTruthy();
    expect(onUploadComplete).toHaveBeenCalledWith(photo);
    expect(summary()).toBe('1/2 · 1 uploaded');

    await step(() => uploads.get('b.jpg')!.resolve({ id: 'photo-b' } as Photo));
    expect(summary()).toBe('Done · 2 uploaded');
    expect(onUploadComplete).toHaveBeenCalledTimes(2);
  });

  it('opens the file picker when the drop zone is clicked', async () => {
    const { user, input, dropzone } = renderUpload();
    const click = vi.spyOn(input, 'click');

    await user.click(dropzone);

    expect(click).toHaveBeenCalled();
  });

  it('uploads files dropped on the drop zone', async () => {
    const { dropzone } = renderUpload();

    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toMatch(/dragging/);
    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toMatch(/dragging/);

    fireEvent.dragOver(dropzone);
    fireEvent.drop(dropzone, { dataTransfer: { files: [image('dropped.jpg')] } });
    expect(dropzone.className).not.toMatch(/dragging/);
    expect(screen.getByText('dropped.jpg')).toBeTruthy();
    await started(1);

    await step(() => uploads.get('dropped.jpg')!.resolve({ id: 'p' } as Photo));
    expect(summary()).toBe('Done · 1 uploaded');
  });

  it('ignores a drop with no files', async () => {
    const { dropzone } = renderUpload();

    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });

    expect(summary()).toBeUndefined();
  });

  it('fails invalid and HEIC files on the spot, without sending them', async () => {
    const { dropzone } = renderUpload();
    const huge = image('huge.jpg');
    Object.defineProperty(huge, 'size', { value: 51 * 1024 * 1024 });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File(['text'], 'notes.txt', { type: 'text/plain' }),
          image('IMG_0001.HEIC', 'heic', 'image/heic'),
          // The browser gives some HEIC files no type at all.
          new File(['heif'], 'IMG_0002.heif', { type: '' }),
          huge,
        ],
      },
    });
    await act(async () => {});

    expect(within(row('notes.txt')).getByText('Not an image file')).toBeTruthy();
    expect(within(row('IMG_0001.HEIC')).getByText(HEIC_NOT_SUPPORTED)).toBeTruthy();
    expect(within(row('IMG_0002.heif')).getByText(HEIC_NOT_SUPPORTED)).toBeTruthy();
    expect(within(row('huge.jpg')).getByText('Larger than the 50MB upload limit')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(summary()).toBe('Done · 0 uploaded · 4 failed');
    expect(client.checkDuplicates).not.toHaveBeenCalled();
    expect(client.uploadPhoto).not.toHaveBeenCalled();
  });

  it('dismisses an error row', async () => {
    const { user, dropzone } = renderUpload();
    fireEvent.drop(dropzone, { dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });

    await user.click(within(row('notes.txt')).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('skips files already uploaded or repeated in the batch', async () => {
    stored.set('known', {
      id: 'p9',
      original_filename: 'DSC_0009.jpg',
      gallery_id: 'g2',
      gallery_title: 'Smith Wedding',
    });
    stored.set('loose', { id: 'p8', original_filename: 'loose.jpg', gallery_id: null, gallery_title: null });
    const { user, input } = renderUpload();

    await user.upload(input, [
      image('copy.jpg', 'known'),
      image('other.jpg', 'loose'),
      image('first.jpg', 'same'),
      image('second.jpg', 'same'),
    ]);
    await started(1);

    expect(
      within(row('copy.jpg')).getByText('Already uploaded in Smith Wedding as DSC_0009.jpg')
    ).toBeTruthy();
    expect(within(row('other.jpg')).getByText('Already uploaded (unassigned) as loose.jpg')).toBeTruthy();
    expect(within(row('second.jpg')).getByText('Duplicate of another file in this batch')).toBeTruthy();
    expect([...uploads.keys()]).toEqual(['first.jpg']);
    expect(summary()).toBe('3/4 · 0 uploaded · 3 skipped');

    await step(() => uploads.get('first.jpg')!.resolve({ id: 'p' } as Photo));
    expect(summary()).toBe('Done · 1 uploaded · 3 skipped');

    await user.click(screen.getByRole('button', { name: 'Clear results' }));
    expect(screen.queryByText('copy.jpg')).toBeNull();
    expect(screen.queryByText('second.jpg')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear results' })).toBeNull();
  });

  it('counts a file the server already holds as skipped, not failed', async () => {
    const { user, input } = renderUpload();
    await user.upload(input, [image('raced.jpg')]);
    await started(1);

    await step(() =>
      uploads.get('raced.jpg')!.reject(failure('Already uploaded as raced.jpg', 409))
    );

    expect(within(row('raced.jpg')).getByText('Already uploaded as raced.jpg')).toBeTruthy();
    expect(summary()).toBe('Done · 0 uploaded · 1 skipped');
  });

  it('offers Retry for a lost connection and uploads the file again', async () => {
    const onUploadComplete = vi.fn();
    const { user, input } = renderUpload(onUploadComplete);
    await user.upload(input, [image('flaky.jpg')]);
    await started(1);

    await step(() => uploads.get('flaky.jpg')!.reject(failure('Upload failed', 0)));
    expect(within(row('flaky.jpg')).getByText('Upload failed')).toBeTruthy();
    expect(summary()).toBe('Done · 0 uploaded · 1 failed');

    uploads.clear();
    await user.click(within(row('flaky.jpg')).getByRole('button', { name: 'Retry' }));
    await started(1);
    expect(client.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Upload failed')).toBeNull();
    expect(summary()).toBe('0/1 · 0 uploaded');

    await step(() => uploads.get('flaky.jpg')!.resolve({ id: 'p' } as Photo));
    expect(summary()).toBe('Done · 1 uploaded');
    expect(onUploadComplete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server error', 500, true],
    ['rate limiting', 429, true],
    ['a refused file type', 415, false],
    ['a file too large for the server', 413, false],
  ])('shows Retry after %s (HTTP %i) only if it can succeed', async (_case, status, retryable) => {
    const { user, input } = renderUpload();
    await user.upload(input, [image('x.jpg')]);
    await started(1);

    await step(() => uploads.get('x.jpg')!.reject(failure(`HTTP ${status}`, status)));

    expect(within(row('x.jpg')).getByText(`HTTP ${status}`)).toBeTruthy();
    expect(within(row('x.jpg')).queryByRole('button', { name: 'Retry' }) !== null).toBe(retryable);
    expect(within(row('x.jpg')).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('in Check only mode reports which files are new without uploading any', async () => {
    stored.set('known', {
      id: 'p9',
      original_filename: 'DSC_0009.jpg',
      gallery_id: GALLERY,
      gallery_title: 'This Gallery',
    });
    const { user, input } = renderUpload();

    await user.click(screen.getByRole('checkbox', { name: /Check only/ }));
    expect(screen.getByText('Drop photos here to check if they are uploaded')).toBeTruthy();
    expect(screen.getByText('Nothing will be uploaded')).toBeTruthy();

    await user.upload(input, [image('old.jpg', 'known'), image('new.jpg', 'fresh')]);
    expect(await within(row('new.jpg')).findByText('Not uploaded yet')).toBeTruthy();
    expect(within(row('old.jpg')).getByText('Already uploaded in This Gallery as DSC_0009.jpg')).toBeTruthy();
    // No "0 uploaded": nothing was meant to be.
    expect(summary()).toBe('Done · 1 skipped · 1 not uploaded yet');
    expect(client.checkDuplicates).toHaveBeenCalledTimes(1);
    expect(client.uploadPhoto).not.toHaveBeenCalled();

    await user.click(within(row('new.jpg')).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('new.jpg')).toBeNull();

    // Unticking goes back to uploading.
    await user.click(screen.getByRole('checkbox', { name: /Check only/ }));
    expect(screen.getByText('Drop photos here or click to upload')).toBeTruthy();
    await user.upload(input, [image('later.jpg', 'later')]);
    await started(1);
    expect([...uploads.keys()]).toEqual(['later.jpg']);
  });
});
