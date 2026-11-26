/**
 * The collage layout: photos of different sizes fitted together with even
 * gaps and flush left and right edges, each at its exact aspect ratio (no
 * cropping, no stretching).
 *
 * A piece is a photo, a row (children side by side at one height) or a
 * column (children stacked at one width). For any piece, height is a linear
 * function of width, h = a * w + b, where b carries the gaps. That makes a
 * band (a row of pieces) solvable exactly: given the grid's width, every
 * photo's size follows. The page is a stack of bands, each picked from many
 * random candidates for fitting the size limits and for varied sizes.
 */

// a and b give the piece's height at a width w: h = a * w + b.
export type Piece = { a: number; b: number } & (
  | { kind: 'photo'; index: number }
  | { kind: 'row' | 'column'; children: Piece[] }
);

export interface CollageTile {
  // The photo's index in the list laid out.
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollageBand {
  // The band holds photos start to end - 1, in order.
  start: number;
  end: number;
  top: number;
  height: number;
  // False for a fallback row, which may be centred and outside the limits.
  fitted: boolean;
}

export interface Collage {
  // In photo order.
  tiles: CollageTile[];
  bands: CollageBand[];
  height: number;
}

/** Limits as fractions of the grid's width. */
export interface CollageLimits {
  minPhotoWidth: number;
  maxPhotoWidth: number;
  minBandHeight: number;
  maxBandHeight: number;
}

export const DESKTOP_LIMITS: CollageLimits = {
  minPhotoWidth: 0.2,
  maxPhotoWidth: 0.58,
  minBandHeight: 0.24,
  maxBandHeight: 0.5,
};

export const PHONE_LIMITS: CollageLimits = {
  minPhotoWidth: 0.44,
  maxPhotoWidth: 1,
  minBandHeight: 0.45,
  maxBandHeight: 1.4,
};

// A grid narrower than this is laid out as a phone's.
export const PHONE_GRID_WIDTH = 500;
const BAND_TRIES = 120;
// A last odd photo on a wide grid, when no band fits it, is shown alone at
// this share of the width rather than across all of it.
const LONE_PHOTO_WIDTH = 0.5;
// Spread beyond this (largest photo area over smallest) earns no more credit,
// so a band is not chosen for one tiny photo.
const MAX_SPREAD_CREDIT = 4;
const DEFAULT_RATIO = 3 / 2;

export function collageGap(gridWidth: number): number {
  return gridWidth < PHONE_GRID_WIDTH ? 6 : 12;
}

/** A small seeded generator (mulberry32): the same seed deals the same layout. */
export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31) + 1;
}

/** A seed derived from a string (a gallery's id), stable across visits. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Width over height, with a usual photo shape for one of unknown size. */
export function aspectRatio(width: number | null | undefined, height: number | null | undefined): number {
  return width && height && width > 0 && height > 0 ? width / height : DEFAULT_RATIO;
}

// Builds pieces with their a and b worked out once, from their children's.
function pieces(ratios: number[], gap: number) {
  const photo = (index: number): Piece => ({ kind: 'photo', index, a: 1 / ratios[index], b: 0 });
  const column = (children: Piece[]): Piece => {
    // Stacked at one width: heights and gaps add up.
    let a = 0;
    let b = gap * (children.length - 1);
    for (const c of children) {
      a += c.a;
      b += c.b;
    }
    return { kind: 'column', children, a, b };
  };
  const row = (children: Piece[]): Piece => {
    // Side by side at one height h: widths (h - b) / a and the gaps add up
    // to w, so h = (w + gaps + sum(b / a)) / sum(1 / a).
    let inverse = 0;
    let offset = -gap * (children.length - 1);
    for (const c of children) {
      inverse += 1 / c.a;
      offset += c.b / c.a;
    }
    return { kind: 'row', children, a: 1 / inverse, b: offset / inverse };
  };
  return { photo, column, row };
}

type Builders = ReturnType<typeof pieces>;

function place(piece: Piece, x: number, y: number, width: number, gap: number, out: CollageTile[]): number {
  const height = piece.a * width + piece.b;
  if (piece.kind === 'photo') {
    out.push({ index: piece.index, x, y, width, height });
    return height;
  }
  let offset = piece.kind === 'column' ? y : x;
  for (const child of piece.children) {
    if (piece.kind === 'column') {
      offset += place(child, x, offset, width, gap, out) + gap;
    } else {
      const childWidth = (height - child.b) / child.a;
      place(child, offset, y, childWidth, gap, out);
      offset += childWidth + gap;
    }
  }
  return height;
}

function count(piece: Piece): number {
  return piece.kind === 'photo' ? 1 : piece.children.reduce((s, c) => s + count(c), 0);
}

// One piece of a band: a photo, a column of two or three (one of which may be
// a pair), or a pair above a photo.
function randomPiece({ photo, column, row }: Builders, take: () => number, random: () => number): Piece {
  const roll = random();
  if (roll < 0.34) return photo(take());
  if (roll < 0.8) {
    const k = random() < 0.65 ? 2 : 3;
    return column(
      Array.from({ length: k }, () => (random() < 0.22 ? row([photo(take()), photo(take())]) : photo(take())))
    );
  }
  return column([row([photo(take()), photo(take())]), photo(take())]);
}

/**
 * Lays out photos (by aspect ratio, width over height) across a grid of the
 * given width. Photos keep their order: each band takes the next ones.
 */
export function layoutCollage(
  ratios: number[],
  gridWidth: number,
  seed: number,
  gap: number = collageGap(gridWidth)
): Collage {
  const tiles: CollageTile[] = [];
  const bands: CollageBand[] = [];
  if (gridWidth <= 0 || ratios.length === 0) return { tiles, bands, height: 0 };
  const W = gridWidth;
  const phone = W < PHONE_GRID_WIDTH;
  const limits = phone ? PHONE_LIMITS : DESKTOP_LIMITS;
  const random = seededRandom(seed);
  let y = 0;
  let i = 0;

  const build = pieces(ratios, gap);
  const addBand = (band: Piece, x: number, width: number, n: number, fitted = false) => {
    const height = place(band, x, y, width, gap, tiles);
    bands.push({ start: i, end: i + n, top: y, height, fitted });
    y += height + gap;
    i += n;
  };

  while (i < ratios.length) {
    let best: { band: Piece; score: number; n: number } | null = null;
    for (let tries = 0; tries < BAND_TRIES; tries++) {
      let next = i;
      const take = () => next++;
      const k = phone ? (random() < 0.5 ? 1 : 2) : [2, 3, 3, 4][Math.floor(random() * 4)];
      const band = build.row(Array.from({ length: k }, () => randomPiece(build, take, random)));
      const n = count(band);
      if (i + n > ratios.length) continue;
      const trial: CollageTile[] = [];
      const h = place(band, 0, 0, W, gap, trial);
      let minWidth = Infinity;
      let maxWidth = 0;
      let minArea = Infinity;
      let maxArea = 0;
      for (const t of trial) {
        minWidth = Math.min(minWidth, t.width);
        maxWidth = Math.max(maxWidth, t.width);
        minArea = Math.min(minArea, t.width * t.height);
        maxArea = Math.max(maxArea, t.width * t.height);
      }
      const fits =
        h > W * limits.minBandHeight &&
        h < W * limits.maxBandHeight &&
        minWidth >= W * limits.minPhotoWidth &&
        maxWidth <= W * limits.maxPhotoWidth;
      const spread = maxArea / minArea;
      const score = (fits ? 0 : 1000) - (trial.length > 1 ? Math.min(spread, MAX_SPREAD_CREDIT) : 0);
      if (!best || score < best.score) best = { band, score, n };
    }

    if (best && best.score < 900) {
      addBand(best.band, 0, W, best.n, true);
      continue;
    }

    // Nothing fits: a plain row of the next two (one on a phone).
    const n = Math.min(ratios.length - i, phone ? 1 : 2);
    if (n === 1 && !phone) {
      addBand(build.photo(i), (W * (1 - LONE_PHOTO_WIDTH)) / 2, W * LONE_PHOTO_WIDTH, 1);
      continue;
    }
    const band = build.row(Array.from({ length: n }, (_, k) => build.photo(i + k)));
    const trial: CollageTile[] = [];
    place(band, 0, 0, W, gap, trial);
    // Scaled down and centred when a photo would be wider than the limit.
    const scale = phone ? 1 : Math.min(1, (W * limits.maxPhotoWidth) / Math.max(...trial.map((t) => t.width)));
    const width = W * scale;
    addBand(band, (W - width) / 2, width, n);
  }

  return { tiles, bands, height: y - gap };
}
