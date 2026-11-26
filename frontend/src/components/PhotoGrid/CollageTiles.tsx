import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { aspectRatio, layoutCollage } from './collage';
import type { AlbumPhoto } from './gridItems';
import { TILE_IMAGE_PROPS } from './tileImage';
import TileImage from './TileImage';
import { replanTiles } from './tileScheduler';
import styles from './CollageTiles.module.css';

// A resize lays the collage out again once the width has settled.
const RESIZE_DEBOUNCE_MS = 150;

interface CollageTilesProps {
  // Every photo: the arrangement is worked out for the whole set, so tiles
  // added as the visitor scrolls never move the ones above them.
  photos: AlbumPhoto[];
  seed: number;
  // Bands are rendered until they hold at least this many photos.
  visibleCount: number;
  onOpen: (index: number) => void;
}

function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(el.clientWidth), RESIZE_DEBOUNCE_MS);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer) observer.observe(el);
    else window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return [ref, width] as const;
}

/**
 * The grid's tiles in the collage layout (collage.ts). Tiles are keyed by
 * photo, so a resize or a new arrangement moves the same images rather than
 * remounting them. The class names and images are the album's
 * (TileImage), so the grid's tile styles, scheduling, retries and cancelling
 * apply to both layouts.
 */
const CollageTiles = memo(function CollageTiles({ photos, seed, visibleCount, onOpen }: CollageTilesProps) {
  const [ref, width] = useContainerWidth();
  const collage = useMemo(
    () => layoutCollage(photos.map((p) => aspectRatio(p.width, p.height)), width, seed),
    [photos, width, seed]
  );
  // Tiles that only moved are new to the scheduler's plan.
  useEffect(() => {
    if (ref.current) replanTiles(ref.current);
  }, [ref, collage]);
  const bandCount = collage.bands.findIndex((band) => band.end >= visibleCount) + 1 || collage.bands.length;
  const shownBands = collage.bands.slice(0, bandCount);
  const last = shownBands[shownBands.length - 1];
  const shown = last ? last.end : 0;
  const height = last ? last.top + last.height : 0;

  return (
    <div ref={ref} role="group" aria-label="Photo album" className={styles.collage} style={{ height }}>
      {collage.tiles.slice(0, shown).map(({ index, x, y, width: w, height: h }) => {
        const photo = photos[index];
        return (
          <button
            key={photo.key}
            type="button"
            className={`react-photo-album--photo react-photo-album--button ${styles.tile}`}
            data-photo-index={index}
            style={{ left: x, top: y, width: w, height: h }}
            onClick={() => onOpen(index)}
          >
            <TileImage
              className={`react-photo-album--image ${styles.image}`}
              photoId={photo.key}
              src={photo.src}
              srcSet={photo.srcSet.map((c) => `${c.src} ${c.width}w`).join(', ') || undefined}
              // The tile's own width, so the browser picks a file at least
              // as large as the tile in device pixels.
              sizes={`${Math.ceil(w)}px`}
              width={photo.width}
              height={photo.height}
              alt={photo.alt}
              loading="lazy"
              decoding="async"
              {...TILE_IMAGE_PROPS}
            />
          </button>
        );
      })}
    </div>
  );
});

export default CollageTiles;
