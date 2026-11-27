// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePointerSeen } from './zoomGestures';

const press = () =>
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    vi.runAllTimers();
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('usePointerSeen', () => {
  it('is false until the open viewer sees a press, and again each time it opens', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePointerSeen(open), { initialProps: { open: false } });
    press();
    expect(result.current).toBe(false);

    rerender({ open: true });
    expect(result.current).toBe(false);
    press();
    expect(result.current).toBe(true);

    rerender({ open: false });
    expect(result.current).toBe(false);
    rerender({ open: true });
    expect(result.current).toBe(false);
  });

  it('is still false while the first press is being handled', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePointerSeen(true));
    // A listener on the press itself, as the plugin's is, sees no change yet.
    let during: boolean | undefined;
    const listener = () => {
      during = result.current;
    };
    document.body.addEventListener('pointerdown', listener);
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(during).toBe(false);
    expect(result.current).toBe(false);
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current).toBe(true);
    document.body.removeEventListener('pointerdown', listener);
  });
});
