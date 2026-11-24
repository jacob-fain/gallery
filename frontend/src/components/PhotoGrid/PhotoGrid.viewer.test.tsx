// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Lightbox from 'yet-another-react-lightbox';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPhoto } from '../../types';

vi.mock('../../api/client', () => ({
  trackPhotoView: vi.fn(),
  getPhotoDownloadUrl: vi.fn(),
}));

const { default: PhotoGrid } = await import('./PhotoGrid');
const { ZoomButtons } = await import('./ViewerChrome');
const { VIEWER_IDLE_MS } = await import('./viewerIdle');
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

describe('grid tiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stay on their placeholder until each photo loads, then fade it in', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    render(<PhotoGrid photos={photos} />);
    const first = screen.getByAltText('Photo 1 of 3');
    const second = screen.getByAltText('Photo 2 of 3');
    expect(first.dataset.loaded).toBeUndefined();
    expect(second.dataset.loaded).toBeUndefined();

    now += 500;
    fireEvent.load(first);
    expect(first.dataset.loaded).toBe('fade');
    expect(second.dataset.loaded).toBeUndefined();
  });
});
