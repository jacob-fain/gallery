import type { ComponentProps } from 'react';
import { PREVIEW_IMAGE_PROPS } from './tileImage';
import styles from './PhotoGrid.module.css';

type TileImageProps = ComponentProps<'img'> & {
  // The photo's thumbnail, shown until the full image has loaded.
  preview?: string;
};

/**
 * A grid tile's images, for either layout. Their sources wait in data
 * attributes until the scheduler starts them (tileScheduler.ts). The preview
 * comes first so the full image, positioned after it, paints over it.
 */
export default function TileImage({ src, srcSet, preview, ...props }: TileImageProps) {
  return (
    <>
      {preview && <img data-src={preview} className={styles.preview} {...PREVIEW_IMAGE_PROPS} />}
      <img {...props} data-tile="" data-src={src} data-srcset={srcSet} />
    </>
  );
}
