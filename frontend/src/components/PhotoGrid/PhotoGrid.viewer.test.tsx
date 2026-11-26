// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Lightbox from 'yet-another-react-lightbox';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../../types';

vi.mock('../../api/client', () => ({
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
  getPhotoOriginal: vi.fn(),
}));

const client = await import('../../api/client');
const { default: PhotoGrid } = await import('./PhotoGrid');
const { ZoomButtons } = await import('./ViewerChrome');
const { DOUBLE_TAP_MS, VIEWER_IDLE_MS, useViewerIdle } = await import('./viewerIdle');
const { default: viewerStyles } = await import('./Viewer.module.css');

// The album lays out nothing until it knows its width, and jsdom has no
// layout, so every element reports a desktop-sized container.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

function photo(id: string, galleryTitle?: string | null): PublicPhoto {
  return {
    id,
    gallery_id: galleryTitle ? 'g1' : null,
    width: 3000,
    height: 2000,
    exif_data: null,
    webUrl: `https://s3.test/${id}-web.jpg`,
    thumbnailUrl: `https://s3.test/${id}-thumb.jpg`,
    ...(galleryTitle !== undefined && { gallery_title: galleryTitle }),
  };
}

const photos = [photo('a'), photo('b'), photo('c')];

// By attribute rather than role: an open lightbox hides the page from the
// accessibility tree.
function tiles() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-photo-index]'));
}

// The open photo is named in the URL, so each test starts on a clean entry
// rather than reopening the last test's photo.
beforeEach(() => {
  window.history.pushState({ page: 'gallery' }, '', '/g/smith');
});

function lightbox() {
  return screen.getByRole('dialog', { name: 'Lightbox' });
}

function viewerRoot() {
  const root = document.querySelector<HTMLElement>('.photo-grid-lightbox');
  if (!root) throw new Error('no lightbox root');
  return root;
}

function isIdle() {
  return viewerRoot().classList.contains(viewerStyles.idle);
}

describe('viewer label', () => {
  it('names the gallery and the position in it', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} galleryTitle="Smith Wedding" />);

    await user.click(tiles()[1]);
    expect(within(lightbox()).getByText('Smith Wedding · 2 / 3')).toBeTruthy();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(lightbox()).getByText('Smith Wedding · 3 / 3')).toBeTruthy());
  });

  it("names each photo's own gallery on All Photos, and only the position for an unassigned one", async () => {
    const user = userEvent.setup();
    const mixed = [photo('a', 'Iceland'), photo('b', 'Smith Wedding'), photo('c', null)];
    render(<PhotoGrid photos={mixed} />);

    await user.click(tiles()[0]);
    expect(within(lightbox()).getByText('Iceland · 1 / 3')).toBeTruthy();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(lightbox()).getByText('Smith Wedding · 2 / 3')).toBeTruthy());

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(within(lightbox()).getByText('3 / 3')).toBeTruthy());
  });

  it("replaces the Counter plugin's bottom counter", async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[0]);
    expect(within(lightbox()).getByText('1 / 3')).toBeTruthy();
    expect(lightbox().querySelector('.yarl__counter')).toBeNull();
  });
});

describe('zoom buttons', () => {
  it('shows no zoom-out button on a photo that is not zoomed in', async () => {
    const user = userEvent.setup();
    render(<PhotoGrid photos={photos} />);

    await user.click(tiles()[0]);
    expect(within(lightbox()).getByRole('button', { name: 'Zoom in' })).toBeTruthy();
    expect(within(lightbox()).queryByRole('button', { name: 'Zoom out' })).toBeNull();
  });

  // jsdom never loads a slide's image, so the Zoom plugin keeps zoom off;
  // the buttons are rendered in a lightbox with the zoom state given here.
  function renderZoom(zoom: number) {
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const zoomButtons = (level: number) => (
      <Lightbox
        open
        slides={[{ src: 'https://s3.test/a.jpg' }]}
        render={{
          controls: () => (
            <ZoomButtons zoom={level} minZoom={1} maxZoom={4} disabled={false} zoomIn={zoomIn} zoomOut={zoomOut} />
          ),
        }}
      />
    );
    const view = render(zoomButtons(zoom));
    return { zoomIn, zoomOut, setZoom: (level: number) => view.rerender(zoomButtons(level)) };
  }

  it('shows zoom out only while zoomed in', async () => {
    const user = userEvent.setup();
    const { zoomOut, setZoom } = renderZoom(1);
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();

    setZoom(2);
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoomOut).toHaveBeenCalledTimes(1);

    setZoom(1);
    expect(screen.queryByRole('button', { name: 'Zoom out' })).toBeNull();
  });

  it('hands focus to zoom in when zoom out goes away under it', () => {
    const { setZoom } = renderZoom(2);
    screen.getByRole('button', { name: 'Zoom out' }).focus();

    setZoom(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zoom in' }));
  });

  it('hands focus to zoom out when zoom in reaches the limit under it', () => {
    const { setZoom } = renderZoom(2);
    screen.getByRole('button', { name: 'Zoom in' }).focus();

    setZoom(4);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zoom out' }));
  });
});

// Driven with fireEvent: user-event awaits a setTimeout through Testing
// Library, which only Jest's fake timers advance.
describe('viewer idle fade', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function openViewer(n = 0) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<PhotoGrid photos={photos} />);
    fireEvent.click(tiles()[n]);
    expect(lightbox()).toBeTruthy();
  }

  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('fades the controls after a while without input, and brings them back on a mouse move or tap', () => {
    openViewer();
    expect(viewerStyles.idle).toBeTruthy();
    expect(isIdle()).toBe(false);

    wait(VIEWER_IDLE_MS - 100);
    expect(isIdle()).toBe(false);
    wait(100);
    expect(isIdle()).toBe(true);

    fireEvent.pointerMove(lightbox());
    expect(isIdle()).toBe(false);

    wait(VIEWER_IDLE_MS);
    expect(isIdle()).toBe(true);
    fireEvent.pointerDown(lightbox());
    expect(isIdle()).toBe(false);
  });

  it('restarts the wait on each key press', () => {
    openViewer();

    wait(VIEWER_IDLE_MS - 500);
    fireEvent.keyDown(document.body, { key: 'Shift' });
    wait(VIEWER_IDLE_MS - 500);
    expect(isIdle()).toBe(false);

    wait(500);
    expect(isIdle()).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Shift' });
    expect(isIdle()).toBe(false);
  });

  it('keeps the controls while one has keyboard focus', () => {
    openViewer();

    // The focus trap moves Tab onto the first control.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Download');

    wait(VIEWER_IDLE_MS * 2);
    expect(isIdle()).toBe(false);
  });

  // A tap: the pointer goes down, the controls wake, and the click lands on
  // whatever is under the finger once it lifts.
  // jsdom has no PointerEvent, so the pointer type is set by hand.
  function pointer(
    target: Element,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    pointerType: string,
    at: { x?: number; y?: number; id?: number } = {}
  ) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x ?? 100, clientY: at.y ?? 100 });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    Object.defineProperty(event, 'pointerId', { value: at.id ?? 1 });
    fireEvent(target, event);
  }

  function tap(target: Element, pointerType = 'touch') {
    pointer(target, 'pointerdown', pointerType);
    pointer(target, 'pointerup', pointerType);
    fireEvent.click(target);
  }

  const control = (name: string) => within(lightbox()).getByRole('button', { name });

  it('only shows the controls when a tap lands on a hidden Close, and closes on the next tap', () => {
    openViewer();
    wait(VIEWER_IDLE_MS);
    expect(isIdle()).toBe(true);

    tap(control('Close'));
    wait(1000);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(isIdle()).toBe(false);

    tap(control('Close'));
    wait(1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('only shows the controls when a tap lands on a hidden Download, and downloads on the next tap', () => {
    vi.mocked(client.getPhotoDownloadUrl).mockReturnValue(new Promise(() => {}));
    openViewer();
    wait(VIEWER_IDLE_MS);

    tap(control('Download'));
    // A tap waits out the double-tap window before it shows them.
    wait(DOUBLE_TAP_MS);
    expect(client.getPhotoDownloadUrl).not.toHaveBeenCalled();
    expect(isIdle()).toBe(false);

    tap(control('Download'));
    expect(client.getPhotoDownloadUrl).toHaveBeenCalledWith('a', undefined);
  });

  function swipe(target: Element) {
    pointer(target, 'pointerdown', 'touch', { x: 300 });
    pointer(target, 'pointermove', 'touch', { x: 200 });
    pointer(target, 'pointermove', 'touch', { x: 60 });
    pointer(target, 'pointerup', 'touch', { x: 60 });
  }

  it('leaves hidden controls hidden through a swipe to the next photo, until a tap', () => {
    openViewer();
    wait(VIEWER_IDLE_MS);
    expect(isIdle()).toBe(true);

    swipe(lightbox());
    wait(1000);
    expect(isIdle()).toBe(true);

    tap(lightbox());
    wait(DOUBLE_TAP_MS);
    expect(isIdle()).toBe(false);

    tap(control('Close'));
    wait(1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides the controls on a tap on the photo, and shows them on the next', () => {
    openViewer();
    expect(isIdle()).toBe(false);

    tap(lightbox());
    wait(DOUBLE_TAP_MS - 1);
    expect(isIdle()).toBe(false);
    wait(1);
    expect(isIdle()).toBe(true);

    tap(lightbox());
    wait(DOUBLE_TAP_MS);
    expect(isIdle()).toBe(false);
    // Shown by a tap, they still fade after a while.
    wait(VIEWER_IDLE_MS);
    expect(isIdle()).toBe(true);
  });

  it('leaves the controls as they are on a double tap, which zooms', () => {
    openViewer();
    tap(lightbox());
    wait(100);
    tap(lightbox());
    wait(1000);
    expect(isIdle()).toBe(false);
  });

  it('does not take a pinch or a touch moving over the photo for activity', () => {
    openViewer();
    wait(VIEWER_IDLE_MS);
    pointer(lightbox(), 'pointerdown', 'touch', { id: 1, x: 100 });
    pointer(lightbox(), 'pointerdown', 'touch', { id: 2, x: 200 });
    pointer(lightbox(), 'pointermove', 'touch', { id: 2, x: 260 });
    pointer(lightbox(), 'pointerup', 'touch', { id: 2, x: 260 });
    pointer(lightbox(), 'pointerup', 'touch', { id: 1, x: 100 });
    wait(1000);
    expect(isIdle()).toBe(true);
  });

  it('takes a tap for a tap after a touch whose lift was never reported', () => {
    openViewer();
    wait(VIEWER_IDLE_MS);
    // A swipe whose pointerup went missing.
    pointer(lightbox(), 'pointerdown', 'touch', { id: 7, x: 300 });
    pointer(lightbox(), 'pointermove', 'touch', { id: 7, x: 60 });
    // The next touch starts a new sequence: its first pointer is primary.
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
    Object.defineProperties(down, { pointerType: { value: 'touch' }, pointerId: { value: 8 }, isPrimary: { value: true } });
    fireEvent(lightbox(), down);
    pointer(lightbox(), 'pointerup', 'touch', { id: 8 });
    wait(DOUBLE_TAP_MS);
    expect(isIdle()).toBe(false);
  });

  it('keeps the controls up while a shown one is tapped', () => {
    openViewer();
    wait(VIEWER_IDLE_MS - 500);
    tap(control('Zoom in'));
    wait(VIEWER_IDLE_MS - 500);
    expect(isIdle()).toBe(false);
  });

  // In a browser a mouse press never reaches a control with pointer events
  // off; here it checks only that a mouse gesture's click is not dropped.
  it('leaves a mouse click as it was', () => {
    openViewer();
    wait(VIEWER_IDLE_MS);

    tap(control('Close'), 'mouse');
    wait(1000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts shown each time the viewer opens', () => {
    openViewer();
    wait(VIEWER_IDLE_MS);
    expect(isIdle()).toBe(true);

    fireEvent.click(within(lightbox()).getByRole('button', { name: 'Close' }));
    wait(1000);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(tiles()[1]);
    expect(isIdle()).toBe(false);
  });
});

describe('useViewerIdle while zoomed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function press(pointerType: string) {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    act(() => {
      document.dispatchEvent(event);
    });
  }

  it('hides the controls while a touch has the photo zoomed in, and leaves a mouse zoom as it was', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result, rerender } = renderHook(({ zoomed }) => useViewerIdle(true, 'root', zoomed), {
      initialProps: { zoomed: false },
    });
    press('touch');
    rerender({ zoomed: true });
    expect(result.current).toBe(true);
    rerender({ zoomed: false });
    expect(result.current).toBe(false);

    press('mouse');
    rerender({ zoomed: true });
    expect(result.current).toBe(false);
  });
});

describe('grid tiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('are one image each, with no preview in front of it', async () => {
    const { container } = render(<PhotoGrid photos={photos} />);
    const first = screen.getByAltText('Photo 1 of 3');
    await waitFor(() => expect(first.getAttribute('srcset')).toContain('https://s3.test/a-web.jpg'));
    expect(container.querySelectorAll('.react-photo-album img')).toHaveLength(photos.length);
    expect(first.dataset.photo).toBe('a');
  });

  it('show each photo as it loads, and hide only a failed one', async () => {
    render(<PhotoGrid photos={photos} />);
    const first = screen.getByAltText('Photo 1 of 3');
    const second = screen.getByAltText('Photo 2 of 3');
    // The scheduler gives tiles their sources once they are laid out.
    await waitFor(() => expect(first.getAttribute('src')).toBe('https://s3.test/a-thumb.jpg'));
    expect(first.dataset.failed).toBeUndefined();

    fireEvent.error(first);
    fireEvent.load(second);
    expect(first.dataset.failed).toBe('');
    expect(second.dataset.failed).toBeUndefined();
  });
});
