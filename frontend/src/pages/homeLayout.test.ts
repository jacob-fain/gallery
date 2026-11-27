import { describe, expect, it } from 'vitest';
import type { Gallery } from '../types';
import { coverRatio, coverSizes } from './homeLayout';

const gallery = (coverWidth: number | null, coverHeight: number | null) =>
  ({ id: 'a', title: 'A', slug: 'a', coverWidth, coverHeight }) as Gallery;

describe('coverRatio', () => {
  it("is the cover's aspect ratio", () => {
    expect(coverRatio(gallery(7728, 4344))).toBeCloseTo(1.779, 3);
  });

  it('treats a cover with no recorded size as 3:2', () => {
    expect(coverRatio(gallery(null, null))).toBe(1.5);
  });
});

describe('coverSizes', () => {
  it("scales each breakpoint's row height by the cover's ratio", () => {
    const sizes = coverSizes(2);
    expect(sizes.match(/\* 2\.0000\)/g)).toHaveLength(3);
    expect(sizes).toContain('(max-width: 640px)');
    expect(sizes).toContain('(max-width: 1024px)');
  });
});
