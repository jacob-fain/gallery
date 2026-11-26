import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFeaturedPhotos, getGalleries } from '../api/client';
import type { Gallery, PublicPhoto } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import { photoAlt } from '../utils/photoAlt';
import { CoverImage, FeaturedImage, HeroImage } from './HomeImages';
import { startsGalleryRun } from './HomeFeatured';
import styles from './Home.module.css';

function GalleryDoor({ gallery }: { gallery: Gallery }) {
  return (
    <Link to={`/g/${gallery.slug}`} className={styles.door}>
      <CoverImage gallery={gallery} />
      <span className={styles.doorCaption}>
        <span className={styles.doorTitle}>
          {gallery.title}{' '}
          <span className={styles.captionArrow} aria-hidden="true">
            &#8594;
          </span>
        </span>
        {gallery.photoCount !== undefined && (
          <span className={styles.doorCount}>
            {gallery.photoCount} {gallery.photoCount === 1 ? 'photo' : 'photos'}
          </span>
        )}
      </span>
    </Link>
  );
}

export default function Home() {
  const [featuredPhotos, setFeaturedPhotos] = useState<PublicPhoto[]>([]);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        // The same list, and so the same order, as the Galleries page: it
        // holds only public galleries.
        const [photos, list] = await Promise.all([getFeaturedPhotos(), getGalleries()]);
        setFeaturedPhotos(photos);
        setGalleries(list);
      } catch (err) {
        console.error('Failed to load the homepage:', err);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [attempt]);

  const heroPhoto = featuredPhotos[0];
  const gridPhotos = featuredPhotos.slice(1);

  if (loading) {
    return <div className={styles.loadingScreen} />;
  }

  if (failed) {
    return (
      <LoadError
        onRetry={() => {
          setFailed(false);
          setLoading(true);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        {heroPhoto && (
          <div className={styles.heroImageWrapper}>
            <HeroImage photo={heroPhoto} />
            <div className={styles.heroOverlay} />
          </div>
        )}

        <div className={styles.heroBranding}>
          <h1 className={styles.heroName}>Jacob Fain</h1>
          <p className={styles.heroTagline}>Photography</p>
        </div>

        <div className={styles.scrollIndicator}>
          <span className={styles.scrollArrow} />
        </div>
      </section>

      {galleries.length > 0 && (
        <section className={styles.galleries} aria-labelledby="home-galleries">
          <h2 id="home-galleries" className={styles.sectionLabel}>
            Galleries
          </h2>
          <div className={styles.doors}>
            {galleries.map((gallery) => (
              <GalleryDoor key={gallery.id} gallery={gallery} />
            ))}
          </div>
        </section>
      )}

      {gridPhotos.length > 0 && (
        <section className={styles.featured} aria-labelledby="home-featured">
          <h2 id="home-featured" className={styles.sectionLabel}>
            Selected Work
          </h2>
          <div className={styles.featuredList}>
            {gridPhotos.map((photo, index) => {
              const image = (
                <div className={styles.featuredImageWrapper}>
                  <FeaturedImage
                    photo={photo}
                    alt={photoAlt(index, gridPhotos.length, photo.gallery_title)}
                  />
                </div>
              );
              return (
                <article key={photo.id}>
                  {/* Photos from a private gallery link too: the gallery asks
                      for its password, as the caption link always did. */}
                  {photo.gallery_slug ? (
                    <Link
                      to={`/g/${photo.gallery_slug}`}
                      className={styles.featuredLink}
                      aria-label={
                        photo.gallery_title ? `Open the ${photo.gallery_title} gallery` : 'Open the gallery'
                      }
                    >
                      {image}
                      {startsGalleryRun(gridPhotos, index) && (
                        <span className={styles.featuredCaption}>
                          {photo.gallery_title}{' '}
                          <span className={styles.captionArrow} aria-hidden="true">
                            &#8594;
                          </span>
                        </span>
                      )}
                    </Link>
                  ) : (
                    image
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className={styles.viewAll}>
        <Link to="/photos" className={styles.viewAllLink}>
          View all photos
          <span className={styles.linkArrow} aria-hidden="true">
            &#8594;
          </span>
        </Link>
      </div>
    </div>
  );
}
