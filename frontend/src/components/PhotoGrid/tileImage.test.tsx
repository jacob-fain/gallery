// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  LOAD_TIMEOUT_MS,
  REPORT_AFTER_FAILURES,
  RETRY_DELAYS_MS,
  RETRY_INTERVAL_MS,
  setSources,
  TILE_IMAGE_PROPS,
} from './tileImage';

const { reportImageFailure } = vi.hoisted(() => ({ reportImageFailure: vi.fn() }));
vi.mock('../../utils/clientErrors', () => ({ reportImageFailure }));

const THUMB = 'https://s3.test/a-thumb.webp?X-Amz-Signature=secret';
const WEB = 'https://s3.test/a-web.webp?X-Amz-Signature=secret';
const SRCSET = `${THUMB} 600w, ${WEB} 1920w`;

function Tile({ src = THUMB, srcSet = SRCSET }: { src?: string; srcSet?: string }) {
  return (
    <img
      alt="tile"
      src={src}
      srcSet={srcSet}
      width={1920}
      height={1280}
      data-photo="00000000-0000-4000-8000-000000000001"
      {...TILE_IMAGE_PROPS}
    />
  );
}

function tile() {
  return screen.getByAltText('tile') as HTMLImageElement;
}

// Calls that set a source, which is what starts a load in a browser.
function loadsStarted(spy: MockInstance<Element['setAttribute']>) {
  return spy.mock.calls.filter(([name]) => name === 'src').map(([, value]) => value);
}

// jsdom decodes nothing and lays nothing out. A test sets what the browser
// would report for the image it loaded: the file it picked, its decoded size
// (for a srcset candidate, scaled to the 440px source size when the file is
// as wide as listed), and whether decode() resolves. The tile is 440px wide.
let decoded = { currentSrc: WEB, width: 440, height: 293, decodes: true };

function mockImage<K extends 'currentSrc' | 'naturalWidth' | 'naturalHeight' | 'complete'>(name: K, get: () => HTMLImageElement[K]) {
  vi.spyOn(HTMLImageElement.prototype, name, 'get').mockImplementation(get);
}

async function load(img: HTMLImageElement) {
  fireEvent.load(img);
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  decoded = { currentSrc: WEB, width: 440, height: 293, decodes: true };
  vi.spyOn(HTMLImageElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 440, top: 0, bottom: 293 } as DOMRect);
  mockImage('currentSrc', () => decoded.currentSrc);
  mockImage('naturalWidth', () => decoded.width);
  mockImage('naturalHeight', () => decoded.height);
  HTMLImageElement.prototype.decode = () =>
    decoded.decodes ? Promise.resolve() : Promise.reject(new DOMException('The source image cannot be decoded.', 'EncodingError'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  reportImageFailure.mockReset();
  delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
});

describe('grid tile images', () => {
  it('have no hidden or loaded state: they show as they arrive and stay shown', async () => {
    render(<Tile />);
    expect(tile().dataset.failed).toBeUndefined();
    await load(tile());
    expect(tile().dataset.failed).toBeUndefined();
    expect(tile().dataset.loaded).toBeUndefined();
  });

  it('do not count a cancelled download, which has no sources, as failed', () => {
    render(<img alt="tile" {...TILE_IMAGE_PROPS} />);
    fireEvent.error(tile());
    expect(tile().dataset.failed).toBeUndefined();
  });

  it('hide a failed load and retry it, then show it when it loads', async () => {
    render(<Tile />);
    const img = tile();
    const setAttribute = vi.spyOn(img, 'setAttribute');

    fireEvent.error(img);
    expect(img.dataset.failed).toBe('');
    expect(loadsStarted(setAttribute)).toEqual([]);

    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual([THUMB]);
    expect(img.getAttribute('srcset')).toBe(SRCSET);
    // The retry paints as it arrives, like a first load.
    expect(img.dataset.failed).toBeUndefined();

    await load(img);
    expect(img.dataset.failed).toBeUndefined();
  });

  it.each([2, 3])('recover after %i failures in a row, retrying the same URL with growing delays', async (failures) => {
    render(<Tile />);
    const img = tile();
    const setAttribute = vi.spyOn(img, 'setAttribute');
    for (let i = 0; i < failures; i++) {
      fireEvent.error(img);
      // Not before its delay.
      act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[i] - 1));
      expect(loadsStarted(setAttribute)).toHaveLength(i);
      act(() => vi.advanceTimersByTime(1));
      expect(loadsStarted(setAttribute)).toHaveLength(i + 1);
    }
    expect(new Set(loadsStarted(setAttribute))).toEqual(new Set([THUMB]));
    await load(img);
    expect(img.dataset.failed).toBeUndefined();

    // A later failure starts the delays over.
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toHaveLength(failures + 1);
  });

  it('keep retrying every 30 s after the quick retries, but only while on screen', () => {
    render(<Tile />);
    const img = tile();
    for (const delay of RETRY_DELAYS_MS) {
      fireEvent.error(img);
      act(() => vi.advanceTimersByTime(delay));
    }
    const setAttribute = vi.spyOn(img, 'setAttribute');
    const rect = vi.spyOn(img, 'getBoundingClientRect');

    rect.mockReturnValue({ top: 2000, bottom: 2300 } as DOMRect);
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_INTERVAL_MS * 2));
    expect(loadsStarted(setAttribute)).toEqual([]);

    rect.mockReturnValue({ top: 100, bottom: 400 } as DOMRect);
    act(() => vi.advanceTimersByTime(RETRY_INTERVAL_MS));
    expect(loadsStarted(setAttribute)).toEqual([THUMB]);

    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_INTERVAL_MS));
    expect(loadsStarted(setAttribute)).toHaveLength(2);
  });

  it('give a new src its own retry', () => {
    const { rerender } = render(<Tile />);
    const img = tile();
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    fireEvent.error(img);

    rerender(<Tile src="https://s3.test/a-fresh.webp" />);
    const setAttribute = vi.spyOn(img, 'setAttribute');
    fireEvent.error(img);
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual(['https://s3.test/a-fresh.webp']);
  });

  it('leave a load started again before the retry, by the scheduler, to finish', () => {
    render(<Tile />);
    const img = tile();
    fireEvent.error(img);
    setSources(img, THUMB, SRCSET);
    const setAttribute = vi.spyOn(img, 'setAttribute');
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual([]);
  });

  it('leave a src that changed before the retry to load by itself', () => {
    const { rerender } = render(<Tile />);
    const img = tile();
    fireEvent.error(img);

    rerender(<Tile src="https://s3.test/a-fresh.webp" />);
    const setAttribute = vi.spyOn(img, 'setAttribute');
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual([]);
    expect(img.getAttribute('src')).toBe('https://s3.test/a-fresh.webp');
  });

  it('stop the download of an image removed before it loaded', async () => {
    const { unmount } = render(<Tile />);
    const img = tile();
    fireEvent.error(img);
    unmount();
    await act(async () => {});
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.hasAttribute('srcset')).toBe(false);

    // Nor is a removed image retried.
    const setAttribute = vi.spyOn(img, 'setAttribute');
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual([]);
  });

  it('keep the source of a removed image that had loaded', async () => {
    mockImage('complete', () => true);
    const { unmount } = render(<Tile />);
    const img = tile();
    unmount();
    await act(async () => {});
    expect(img.getAttribute('src')).toBe(THUMB);
  });

  it('keep loading when StrictMode releases and reattaches the ref', async () => {
    render(
      <StrictMode>
        <Tile />
      </StrictMode>
    );
    await act(async () => {});
    expect(tile().getAttribute('src')).toBe(THUMB);
  });
});

describe('a grid tile load cut short', () => {
  it('counts as failed when the image does not decode, and is fetched again', async () => {
    render(<Tile />);
    const img = tile();
    const setAttribute = vi.spyOn(img, 'setAttribute');
    decoded.decodes = false;
    await load(img);
    expect(img.dataset.failed).toBe('');

    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    // Both sources are removed and set again: a new request, not the same
    // half-loaded image.
    expect(setAttribute.mock.calls.map(([name]) => name)).toEqual(['srcset', 'src']);
    decoded.decodes = true;
    await load(img);
    expect(img.dataset.failed).toBeUndefined();
  });

  it('counts as failed when the image has no pixels', async () => {
    render(<Tile />);
    decoded.width = 0;
    decoded.height = 0;
    await load(tile());
    expect(tile().dataset.failed).toBe('');
  });

  it('counts as failed when the image is far smaller than the file listed for it', async () => {
    render(<Tile />);
    // A 600px file where the 1920px one was listed: 440 * 600 / 1920.
    decoded.width = 138;
    decoded.height = 92;
    await load(tile());
    expect(tile().dataset.failed).toBe('');
  });

  it('passes a thumbnail picked from the srcset, and a file somewhat narrower than listed', async () => {
    render(<Tile />);
    decoded = { currentSrc: THUMB, width: 440, height: 293, decodes: true };
    await load(tile());
    expect(tile().dataset.failed).toBeUndefined();

    // A 1280px file listed as 1920px.
    decoded = { currentSrc: WEB, width: 293, height: 440, decodes: true };
    await load(tile());
    expect(tile().dataset.failed).toBeUndefined();
  });

  it('passes an image with no srcset at whatever size it decodes', async () => {
    render(<Tile srcSet="" />);
    decoded = { currentSrc: THUMB, width: 100, height: 80, decodes: true };
    await load(tile());
    expect(tile().dataset.failed).toBeUndefined();
  });

  it('is ignored once the image has a new source, which has a load of its own', async () => {
    const { rerender } = render(<Tile />);
    const img = tile();
    let rejectDecode: (error: Error) => void = () => {};
    HTMLImageElement.prototype.decode = () => new Promise((_, reject) => (rejectDecode = reject));
    fireEvent.load(img);
    rerender(<Tile src="https://s3.test/a-fresh.webp" />);
    await act(async () => rejectDecode(new DOMException('Aborted', 'EncodingError')));
    expect(img.dataset.failed).toBeUndefined();
  });
});

describe('a stalled grid tile download', () => {
  it('is retried once it has not finished in time', () => {
    mockImage('complete', () => false);
    render(<img alt="tile" data-photo="p" {...TILE_IMAGE_PROPS} />);
    const img = tile();
    setSources(img, THUMB, SRCSET);
    act(() => vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1));
    expect(img.dataset.failed).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));
    expect(img.dataset.failed).toBe('');

    const setAttribute = vi.spyOn(img, 'setAttribute');
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    expect(loadsStarted(setAttribute)).toEqual([THUMB]);
  });

  it('is not timed out once it has loaded or was cancelled', async () => {
    let complete = false;
    mockImage('complete', () => complete);
    render(<img alt="tile" {...TILE_IMAGE_PROPS} />);
    const img = tile();
    setSources(img, THUMB, SRCSET);
    complete = true;
    await load(img);
    act(() => vi.advanceTimersByTime(LOAD_TIMEOUT_MS));
    expect(img.dataset.failed).toBeUndefined();

    complete = false;
    setSources(img, THUMB, SRCSET);
    setSources(img, null, null);
    act(() => vi.advanceTimersByTime(LOAD_TIMEOUT_MS));
    expect(img.dataset.failed).toBeUndefined();
  });
});

describe('grid tile failure reports', () => {
  it(`report the photo, size, failure and attempts once it has failed ${REPORT_AFTER_FAILURES} times`, async () => {
    render(<Tile />);
    const img = tile();
    for (let i = 0; i < REPORT_AFTER_FAILURES - 1; i++) {
      fireEvent.error(img);
      act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[i]));
    }
    expect(reportImageFailure).not.toHaveBeenCalled();

    decoded.decodes = false;
    await load(img);
    expect(reportImageFailure).toHaveBeenCalledOnce();
    expect(reportImageFailure).toHaveBeenCalledWith({
      photoId: '00000000-0000-4000-8000-000000000001',
      kind: 'web',
      failure: 'truncated',
      attempts: REPORT_AFTER_FAILURES,
    });
    expect(JSON.stringify(reportImageFailure.mock.calls)).not.toContain('s3.test');
  });

  it('name the thumbnail when that is the file that failed', () => {
    render(<Tile />);
    decoded.currentSrc = THUMB;
    for (let i = 0; i < REPORT_AFTER_FAILURES; i++) {
      fireEvent.error(tile());
      act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[i]));
    }
    expect(reportImageFailure).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'thumb', failure: 'error' }));
  });

  it('are not sent for a load that recovers before then', async () => {
    render(<Tile />);
    fireEvent.error(tile());
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]));
    await load(tile());
    expect(reportImageFailure).not.toHaveBeenCalled();
  });
});
