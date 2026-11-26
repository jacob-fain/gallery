import { describe, expect, it } from 'vitest';
import {
  DESKTOP_LIMITS,
  PHONE_LIMITS,
  aspectRatio,
  collageGap,
  layoutCollage,
  seedFrom,
  seededRandom,
  type Collage,
} from './collage';

// The shapes of a real portfolio: 3:2, 4:3, 16:9, and portraits down to 9:16.
const MIXED = [
  1.5, 4 / 3, 4 / 3, 16 / 9, 1.5, 16 / 9, 4 / 3, 9 / 16, 16 / 9, 4 / 3, 9 / 16, 4 / 3, 0.564, 1.5, 1.5, 16 / 9,
  16 / 9, 0.738, 16 / 9, 0.651, 16 / 9, 16 / 9, 16 / 9, 4 / 3, 16 / 9, 16 / 9, 16 / 9, 1.5, 0.562, 16 / 9, 16 / 9,
  0.562, 16 / 9, 16 / 9, 16 / 9, 9 / 16,
];
const PORTRAITS = Array.from({ length: 30 }, (_, i) => [2 / 3, 3 / 4, 9 / 16][i % 3]);
const DESKTOP = 1824;
const PHONE = 342;
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const EPS = 1e-6;

function bandTiles(collage: Collage, band: Collage['bands'][number]) {
  return collage.tiles.slice(band.start, band.end);
}

function isFlush(collage: Collage, band: Collage['bands'][number], width: number) {
  const tiles = bandTiles(collage, band);
  const left = Math.min(...tiles.map((t) => t.x));
  const right = Math.max(...tiles.map((t) => t.x + t.width));
  return Math.abs(left) < EPS && Math.abs(right - width) < EPS;
}

// Tiles overlap when their boxes, grown by just under the gap, intersect.
function overlaps(a: Collage['tiles'][number], b: Collage['tiles'][number], gap: number) {
  const g = gap - 0.01;
  return a.x < b.x + b.width + g && b.x < a.x + a.width + g && a.y < b.y + b.height + g && b.y < a.y + a.height + g;
}

describe('layoutCollage', () => {
  it('places every photo once, in order, band after band', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const collage = layoutCollage(MIXED, DESKTOP, seed);
      expect(collage.tiles.map((t) => t.index)).toEqual(MIXED.map((_, i) => i));
      let next = 0;
      for (const band of collage.bands) {
        expect(band.start).toBe(next);
        expect(band.end).toBeGreaterThan(band.start);
        next = band.end;
      }
      expect(next).toBe(MIXED.length);
    }
  });

  it('keeps each photo at its exact aspect ratio', () => {
    for (const [ratios, width] of [
      [MIXED, DESKTOP],
      [MIXED, PHONE],
      [PORTRAITS, DESKTOP],
      [PORTRAITS, PHONE],
    ] as const) {
      for (const seed of SEEDS) {
        for (const tile of layoutCollage(ratios, width, seed).tiles) {
          expect(Math.abs(tile.width / ratios[tile.index] - tile.height)).toBeLessThan(0.5);
        }
      }
    }
  });

  it('solves bands to the full width, flush at both edges, with even gaps', () => {
    for (const width of [DESKTOP, 1344, PHONE]) {
      const gap = collageGap(width);
      let fittedBands = 0;
      let allBands = 0;
      for (const seed of SEEDS.slice(0, 50)) {
        const collage = layoutCollage(MIXED, width, seed);
        const fitted = collage.bands.filter((band) => band.fitted);
        fittedBands += fitted.length;
        allBands += collage.bands.length;
        for (const band of fitted) {
          expect(isFlush(collage, band, width)).toBe(true);
          const tiles = bandTiles(collage, band);
          // The band's bottom edge is flush too: every column ends at it.
          const bottom = Math.max(...tiles.map((t) => t.y + t.height));
          expect(bottom - (band.top + band.height)).toBeLessThan(EPS);
          // The area the tiles leave uncovered is exactly their gaps: each
          // tile touches its neighbours at one gap's distance.
          for (const tile of tiles) {
            const right = tile.x + tile.width;
            if (Math.abs(right - width) > EPS) {
              const neighbour = tiles.some(
                (o) => Math.abs(o.x - (right + gap)) < EPS && o.y < tile.y + tile.height && tile.y < o.y + o.height
              );
              expect(neighbour).toBe(true);
            }
          }
        }
        for (let i = 0; i < collage.tiles.length; i++) {
          for (let j = i + 1; j < collage.tiles.length; j++) {
            expect(overlaps(collage.tiles[i], collage.tiles[j], gap)).toBe(false);
          }
        }
        // Bands are one gap apart.
        for (let b = 1; b < collage.bands.length; b++) {
          const prev = collage.bands[b - 1];
          expect(collage.bands[b].top - (prev.top + prev.height)).toBeCloseTo(gap, 9);
        }
        const last = collage.bands[collage.bands.length - 1];
        expect(collage.height).toBeCloseTo(last.top + last.height, 9);
      }
      // Most bands fit; the rest are fallback rows, which tall portraits need.
      expect(fittedBands / allBands).toBeGreaterThan(0.7);
    }
  });

  it('respects the size limits on wide grids', () => {
    for (const ratios of [MIXED, PORTRAITS]) {
      for (const seed of SEEDS) {
        const collage = layoutCollage(ratios, DESKTOP, seed);
        for (const band of collage.bands) {
          const tiles = bandTiles(collage, band);
          for (const tile of tiles) expect(tile.width).toBeLessThanOrEqual(DESKTOP * DESKTOP_LIMITS.maxPhotoWidth + EPS);
          if (!band.fitted) continue;
          expect(band.height).toBeGreaterThan(DESKTOP * DESKTOP_LIMITS.minBandHeight);
          expect(band.height).toBeLessThan(DESKTOP * DESKTOP_LIMITS.maxBandHeight);
          for (const tile of tiles) expect(tile.width).toBeGreaterThanOrEqual(DESKTOP * DESKTOP_LIMITS.minPhotoWidth - EPS);
        }
      }
    }
  });

  it('respects the size limits on phones', () => {
    for (const ratios of [MIXED, PORTRAITS]) {
      for (const seed of SEEDS) {
        const collage = layoutCollage(ratios, PHONE, seed);
        for (const band of collage.bands) {
          const tiles = bandTiles(collage, band);
          // A phone never centres: a lone photo spans the width.
          expect(isFlush(collage, band, PHONE)).toBe(true);
          for (const tile of tiles) {
            expect(tile.width).toBeLessThanOrEqual(PHONE * PHONE_LIMITS.maxPhotoWidth + EPS);
            expect(tile.width).toBeGreaterThanOrEqual(PHONE * PHONE_LIMITS.minPhotoWidth - EPS);
          }
        }
      }
    }
  });

  it('gives sizes a spread: photos are not all the same size', () => {
    const collage = layoutCollage(MIXED, DESKTOP, 7);
    const widths = new Set(collage.tiles.map((t) => Math.round(t.width / 20)));
    expect(widths.size).toBeGreaterThan(5);
  });

  it('deals the same layout from the same seed and another from another seed', () => {
    expect(layoutCollage(MIXED, DESKTOP, 42)).toEqual(layoutCollage(MIXED, DESKTOP, 42));
    expect(layoutCollage(MIXED, DESKTOP, 42)).not.toEqual(layoutCollage(MIXED, DESKTOP, 43));
  });

  it('lays out one to three photos', () => {
    const one = layoutCollage([1.5], DESKTOP, 1);
    expect(one.tiles).toHaveLength(1);
    // Alone on a wide grid, at half its width and centred.
    expect(one.tiles[0].width).toBeCloseTo(DESKTOP / 2, 9);
    expect(one.tiles[0].x).toBeCloseTo(DESKTOP / 4, 9);
    expect(one.height).toBeCloseTo(DESKTOP / 2 / 1.5, 9);

    const phoneOne = layoutCollage([2 / 3], PHONE, 1);
    expect(phoneOne.tiles[0].width).toBeCloseTo(PHONE, 9);

    for (const ratios of [[1.5, 0.75], [9 / 16, 9 / 16], [1.5, 2 / 3, 16 / 9], [2 / 3, 2 / 3, 2 / 3]]) {
      for (const width of [DESKTOP, PHONE]) {
        for (const seed of SEEDS.slice(0, 20)) {
          const collage = layoutCollage(ratios, width, seed);
          expect(collage.tiles.map((t) => t.index)).toEqual(ratios.map((_, i) => i));
          for (const tile of collage.tiles) {
            expect(tile.x).toBeGreaterThanOrEqual(-EPS);
            expect(tile.x + tile.width).toBeLessThanOrEqual(width + EPS);
            expect(tile.width / ratios[tile.index]).toBeCloseTo(tile.height, 6);
          }
        }
      }
    }
  });

  it('lays out nothing without photos or width', () => {
    expect(layoutCollage([], DESKTOP, 1)).toEqual({ tiles: [], bands: [], height: 0 });
    expect(layoutCollage([1.5], 0, 1).tiles).toEqual([]);
  });
});

describe('seeds', () => {
  it('repeat a sequence per seed', () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    const values = Array.from({ length: 10 }, () => a());
    expect(values).toEqual(Array.from({ length: 10 }, () => b()));
    for (const v of values) expect(v >= 0 && v < 1).toBe(true);
  });

  it('come stably from a string', () => {
    expect(seedFrom('iceland')).toBe(seedFrom('iceland'));
    expect(seedFrom('iceland')).not.toBe(seedFrom('chicago'));
  });
});

describe('aspectRatio', () => {
  it('falls back to 3:2 for a photo of unknown size', () => {
    expect(aspectRatio(3000, 2000)).toBe(1.5);
    expect(aspectRatio(0, 2000)).toBe(1.5);
    expect(aspectRatio(null, undefined)).toBe(1.5);
  });
});
