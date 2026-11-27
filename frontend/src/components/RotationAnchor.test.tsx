// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RotationAnchor, { SETTLE_MS } from './RotationAnchor';

// jsdom has no layout: the page's geometry is set by hand. One photo tile,
// whose box moves when the page's width changes, as a reflow moves it.
let width = 390;
let tileTop = -200;
let tileHeight = 600;
const tile = document.createElement('div');
tile.setAttribute('data-photo-index', '7');

const box = (top: number, height: number) => ({ top, height, bottom: top + height }) as DOMRect;

function setWidth(value: number) {
  width = value;
}

beforeEach(() => {
  width = 390;
  tileTop = -200;
  tileHeight = 600;
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
  document.body.append(tile);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 3000 });
  document.elementFromPoint = vi.fn(() => tile);
  tile.getBoundingClientRect = () => box(tileTop, tileHeight);
  window.scrollBy = vi.fn((_x: number | ScrollToOptions, y?: number) => {
    tileTop -= y ?? 0;
  }) as typeof window.scrollBy;
});

afterEach(() => {
  vi.useRealTimers();
  tile.remove();
  Reflect.deleteProperty(document, 'elementFromPoint');
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
});

// The probe point, a third of the way down the screen, was this far down the tile.
const probeFraction = () => (window.innerHeight / 3 - tileTop) / tileHeight;

describe('RotationAnchor', () => {
  it('keeps the photo in view on the same spot after the width changes', () => {
    render(<RotationAnchor />);
    const before = probeFraction();

    // Rotated: the page reflows, the tile is now far below and shorter.
    act(() => {
      setWidth(844);
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 });
      tileTop = 2400;
      tileHeight = 300;
      window.dispatchEvent(new Event('orientationchange'));
      vi.advanceTimersByTime(20);
    });
    expect(window.scrollBy).toHaveBeenCalled();
    expect(probeFraction()).toBeCloseTo(before, 6);

    // A layout that settles later moves the tile again; the hold follows it.
    act(() => {
      tileTop += 500;
      vi.advanceTimersByTime(20);
    });
    expect(probeFraction()).toBeCloseTo(before, 6);
  });

  it('finds the photo again when the layout replaces its tile with a new element', () => {
    // A tile that names its photo, as every grid layout's do.
    const img = document.createElement('img');
    img.setAttribute('data-photo', 'photo-25');
    tile.append(img);
    render(<RotationAnchor />);
    const before = probeFraction();

    // Rotated: the masonry goes from one column to two and renders new tiles.
    const replacement = document.createElement('div');
    replacement.setAttribute('data-photo-index', '7');
    const replacementImg = document.createElement('img');
    replacementImg.setAttribute('data-photo', 'photo-25');
    replacement.append(replacementImg);
    replacement.getBoundingClientRect = () => box(tileTop, tileHeight);
    act(() => {
      tile.replaceWith(replacement);
      setWidth(844);
      tileTop = 1900;
      tileHeight = 250;
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(20);
    });
    expect(window.scrollBy).toHaveBeenCalled();
    expect(probeFraction()).toBeCloseTo(before, 6);
    replacement.remove();
    img.remove();
  });

  it('keeps the held photo through the next turn, even where a fresh probe finds its neighbour', () => {
    const img = document.createElement('img');
    img.setAttribute('data-photo', 'photo-25');
    tile.append(img);
    // The photo in the other column, which the probe hits once two columns
    // put a gap at the centre.
    const neighbour = document.createElement('div');
    neighbour.setAttribute('data-photo-index', '8');
    const neighbourImg = document.createElement('img');
    neighbourImg.setAttribute('data-photo', 'photo-26');
    neighbour.append(neighbourImg);
    neighbour.getBoundingClientRect = () => box(0, 300);
    document.body.append(neighbour);
    render(<RotationAnchor />);
    const before = probeFraction();

    act(() => {
      setWidth(844);
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 });
      tileTop = 2400;
      tileHeight = 300;
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(SETTLE_MS + 50);
    });
    expect(probeFraction()).toBeCloseTo(before, 6);
    vi.mocked(document.elementFromPoint).mockReturnValue(neighbour);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(20);
    });

    // Back to portrait: the same photo comes back to the probe line.
    act(() => {
      setWidth(390);
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
      tileTop = 4000;
      tileHeight = 600;
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(20);
    });
    expect(probeFraction()).toBeCloseTo(before, 6);
    neighbour.remove();
    img.remove();
  });

  it('leaves a height-only change (a toolbar showing) to the browser', () => {
    render(<RotationAnchor />);
    act(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 });
      tileTop = 900;
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it('lets a visitor who scrolls during the hold take over', () => {
    render(<RotationAnchor />);
    act(() => {
      setWidth(844);
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('touchstart'));
      tileTop = 5000;
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});
