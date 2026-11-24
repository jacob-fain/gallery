import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFeaturedPhotos } from '../api/client';
import type { PublicPhoto } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import { photoAlt } from '../utils/photoAlt';
import { FeaturedImage, HeroImage } from './HomeImages';
import { startsGalleryRun } from './HomeFeatured';
import styles from './Home.module.css';

export default function Home() {
  const [featuredPhotos, setFeaturedPhotos] = useState<PublicPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const photos = await getFeaturedPhotos();
        setFeaturedPhotos(photos);
      } catch (err) {
        console.error('Failed to load featured photos:', err);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [attempt]);

  // First featured photo becomes hero, rest go in featured grid
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
      {/* Hero Section */}
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

      {/* Featured Section */}
      {gridPhotos.length > 0 && (
        <section className={styles.featured}>
          <header className={styles.featuredHeader}>
            <span className={styles.featuredLabel}>Selected Work</span>
          </header>

          <div className={styles.featuredGrid}>
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
                <article
                  key={photo.id}
                  className={styles.featuredItem}
                  style={{ '--delay': `${index * 0.1}s` } as React.CSSProperties}
                >
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

          <footer className={styles.featuredFooter}>
            <Link to="/galleries" className={styles.viewAllLink}>
              View All Galleries
              <span className={styles.linkArrow}>&#8594;</span>
            </Link>
          </footer>
        </section>
      )}
    </div>
  );
}
