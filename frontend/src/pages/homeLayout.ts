import type { Gallery } from '../types';

// A gallery cover spans the full width less a 16px gutter each side up to
// 640px. Above that it takes its share of a .doorRow: the row less the 48px
// gutters and the 24px gap, until .doors stops at 1600px, split in proportion
// to the covers' aspect ratios (Home.tsx).
export function coverSizes(share: number): string {
  return `(max-width: 640px) calc(100vw - 32px), calc((min(100vw, 1600px) - 120px) * ${share.toFixed(4)})`;
}

// A cover with no recorded size is drawn at 3:2, like its placeholder.
export function coverRatio(gallery: Gallery): number {
  const { coverWidth: w, coverHeight: h } = gallery;
  return w && h ? w / h : 3 / 2;
}

/**
 * The covers two to a row. Each cover's width is its share of the row in
 * proportion to its aspect ratio, so both come out the same height: whole,
 * uncropped, with their captions on one line. A last cover on its own takes
 * half a row.
 */
export function doorRows(galleries: Gallery[]) {
  const rows: { gallery: Gallery; ratio: number; share: number }[][] = [];
  for (let i = 0; i < galleries.length; i += 2) {
    const pair = galleries.slice(i, i + 2).map((gallery) => ({ gallery, ratio: coverRatio(gallery) }));
    const total = pair.length === 2 ? pair[0].ratio + pair[1].ratio : pair[0].ratio * 2;
    rows.push(pair.map((door) => ({ ...door, share: door.ratio / total })));
  }
  return rows;
}
