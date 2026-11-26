import type { ComponentProps } from 'react';

type TileImageProps = ComponentProps<'img'> & {
  // Named in a report of the image failing to load (tileImage.ts).
  photoId: string;
};

/**
 * A grid tile's image, for either layout. Its sources wait in data
 * attributes until the scheduler starts it (tileScheduler.ts).
 */
export default function TileImage({ src, srcSet, photoId, ...props }: TileImageProps) {
  return <img {...props} data-tile="" data-photo={photoId} data-src={src} data-srcset={srcSet} />;
}
