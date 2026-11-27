import type { Gallery, PublicPhoto } from '../types';
import { responsiveImage } from '../utils/imageSizes';
import { IMAGE_FADE_PROPS } from '../utils/imageFade';
import styles from './Home.module.css';

// The hero fills the viewport width at every breakpoint (Home.module.css).
export const HERO_SIZES = '100vw';
// A Selected Work photo spans .featured less its gutters (16px a side up to
// 640px, 48px above), until .featured stops at 1400px.
export const FEATURED_SIZES =
  '(max-width: 640px) calc(100vw - 32px), (max-width: 1400px) calc(100vw - 96px), 1304px';

export function HeroImage({ photo }: { photo: PublicPhoto }) {
  const image = responsiveImage(photo);
  // The likely LCP element: fetched first and never lazy. Its width and
  // height reserve the box on phones, where the hero takes the image's
  // height, so the page does not jump when it arrives.
  return (
    <img
      {...image}
      sizes={image.srcSet ? HERO_SIZES : undefined}
      alt=""
      className={styles.heroImage}
      fetchPriority="high"
      {...IMAGE_FADE_PROPS}
    />
  );
}

// Covers and Selected Work photos are shown whole at their own proportions:
// the width and height attributes reserve that box, and the image paints into
// it over the placeholder colour as it downloads, with no fade that waits for
// the whole file.

export function CoverImage({ gallery, sizes }: { gallery: Gallery; sizes: string }) {
  const image = responsiveImage({
    width: gallery.coverWidth ?? 0,
    height: gallery.coverHeight ?? 0,
    thumbnailUrl: gallery.coverUrl ?? undefined,
    webUrl: gallery.coverWebUrl ?? undefined,
  });
  if (!image.src) return <div className={styles.coverPlaceholder} aria-hidden="true" />;
  // The caption under the cover names the link, so the image is decorative.
  return (
    <img
      {...image}
      sizes={image.srcSet ? sizes : undefined}
      alt=""
      className={styles.coverImage}
      loading="lazy"
    />
  );
}

export function FeaturedImage({ photo, alt }: { photo: PublicPhoto; alt: string }) {
  const image = responsiveImage(photo);
  return (
    <img
      {...image}
      sizes={image.srcSet ? FEATURED_SIZES : undefined}
      alt={alt}
      className={styles.featuredImage}
      loading="lazy"
    />
  );
}
