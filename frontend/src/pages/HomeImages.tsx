import type { PublicPhoto } from '../types';
import { responsiveImage } from '../utils/imageSizes';
import styles from './Home.module.css';

// The hero fills the viewport width at every breakpoint (Home.module.css).
export const HERO_SIZES = '100vw';
// Featured images span .featured less its side padding, capped by its
// 1200px max-width; from 900px up, alternating 15% padding leaves 85%.
export const FEATURED_SIZES =
  '(max-width: 640px) calc(100vw - 48px), (max-width: 899px) calc(100vw - 96px), ' +
  '(max-width: 1200px) calc((100vw - 96px) * 0.85), 939px';

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
      decoding="async"
    />
  );
}
