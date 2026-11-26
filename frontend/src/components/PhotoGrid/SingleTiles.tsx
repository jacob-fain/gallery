import { memo } from 'react';
import { aspectRatio } from './collage';
import { singleTileSizes, type AlbumPhoto } from './gridItems';
import { TILE_IMAGE_PROPS } from './tileImage';
import TileImage from './TileImage';
import styles from './SingleTiles.module.css';

interface SingleTilesProps {
  // The tiles to show, in order.
  photos: AlbumPhoto[];
  onOpen: (index: number) => void;
}

/**
 * The single layout: one photo per row, as wide as the grid, uncropped. The
 * class names and images are the album's (TileImage), so the grid's tile
 * styles, scheduling and retries apply. No preview: the thumbnail would
 * stretch across the whole width while the full image loads.
 */
const SingleTiles = memo(function SingleTiles({ photos, onOpen }: SingleTilesProps) {
  return (
    <div role="group" aria-label="Photo album" className={styles.single}>
      {photos.map((photo, index) => {
        const ratio = aspectRatio(photo.width, photo.height);
        return (
          <button
            key={photo.key}
            type="button"
            className={`react-photo-album--photo react-photo-album--button ${styles.tile}`}
            data-photo-index={index}
            style={{ '--ratio': ratio } as React.CSSProperties}
            onClick={() => onOpen(index)}
          >
            <TileImage
              className={`react-photo-album--image ${styles.image}`}
              src={photo.src}
              srcSet={photo.srcSet.map((c) => `${c.src} ${c.width}w`).join(', ') || undefined}
              sizes={singleTileSizes(ratio)}
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

export default SingleTiles;
