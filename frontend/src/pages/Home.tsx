import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFeaturedPhotos } from '../api/client';
import type { PublicPhoto } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import { photoAlt } from '../utils/photoAlt';
import { FeaturedImage, HeroImage } from './HomeImages';
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
            {gridPhotos.map((photo, index) => (
              <article
                key={photo.id}
                className={styles.featuredItem}
                style={{ '--delay': `${index * 0.1}s` } as React.CSSProperties}
              >
                <div className={styles.featuredImageWrapper}>
                  <FeaturedImage
                    photo={photo}
                    alt={photoAlt(index, gridPhotos.length, photo.gallery_title)}
                  />
                </div>
                {photo.gallery_slug && (
                  <Link
                    to={`/g/${photo.gallery_slug}`}
                    className={styles.featuredCaption}
                  >
                    {photo.gallery_title}
                  </Link>
                )}
              </article>
            ))}
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
