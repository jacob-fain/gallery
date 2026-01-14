import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFeaturedPhotos } from '../api/client';
import type { Photo } from '../types';
import styles from './Home.module.css';

export default function Home() {
  const [featuredPhotos, setFeaturedPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const photos = await getFeaturedPhotos();
        setFeaturedPhotos(photos);
      } catch (err) {
        console.error('Failed to load featured photos:', err);
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // First featured photo becomes hero, rest go in featured grid
  const heroPhoto = featuredPhotos[0];
  const gridPhotos = featuredPhotos.slice(1);

  if (loading) {
    return <div className={styles.loadingScreen} />;
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Error loading page</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Hero Section */}
      <section className={styles.hero}>
        {heroPhoto && (
          <div className={styles.heroImageWrapper}>
            <img
              src={heroPhoto.webUrl}
              alt=""
              className={`${styles.heroImage} ${heroLoaded ? styles.heroImageLoaded : ''}`}
              onLoad={() => setHeroLoaded(true)}
            />
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
                  <img
                    src={photo.webUrl}
                    alt={photo.original_filename}
                    className={styles.featuredImage}
                    loading="lazy"
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
