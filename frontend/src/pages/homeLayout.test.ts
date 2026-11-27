import { describe, expect, it } from 'vitest';
import type { Gallery } from '../types';
import { doorRows } from './homeLayout';

const gallery = (id: string, coverWidth: number | null, coverHeight: number | null) =>
  ({ id, title: id, slug: id, coverWidth, coverHeight }) as Gallery;

describe('doorRows', () => {
  it('splits a row between two covers in proportion to their aspect ratios', () => {
    const [row] = doorRows([gallery('a', 4000, 3000), gallery('b', 16000, 9000)]);
    const [a, b] = row;
    expect(a.share + b.share).toBeCloseTo(1);
    // Equal heights: each share divided by its ratio is the same.
    expect(a.share / a.ratio).toBeCloseTo(b.share / b.ratio);
  });

  it('gives a last cover on its own half a row', () => {
    const rows = doorRows([gallery('a', 3, 2), gallery('b', 4, 3), gallery('c', 2, 3)]);
    expect(rows.map((r) => r.length)).toEqual([2, 1]);
    expect(rows[1][0].share).toBeCloseTo(0.5);
  });

  it('treats a cover with no recorded size as 3:2', () => {
    const [[door]] = doorRows([gallery('a', null, null)]);
    expect(door.ratio).toBeCloseTo(1.5);
  });
});
