import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFeaturedPhotos, getGalleries } from '../api/client';
import type { Gallery } from '../types';
import LoadError from '../components/StatusMessage/LoadError';
import { photoAlt } from '../utils/photoAlt';
import { CoverImage, FeaturedImage, HeroImage } from './HomeImages';
import { coverSizes, doorRows } from './homeLayout';
import { startsGalleryRun } from './HomeFeatured';
import styles from './Home.module.css';

function GalleryDoor({ gallery, ratio, share }: { gallery: Gallery; ratio: number; share: number }) {
  return (
    <Link
      to={`/g/${gallery.slug}`}
      className={styles.door}
      style={{ '--ratio': ratio.toFixed(4) } as React.CSSProperties}
    >
      <CoverImage gallery={gallery} sizes={coverSizes(share)} />
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

/**
 * One of the homepage's two requests. Each can fail and be retried on its
 * own: "retrying" keeps the rest of the page in place while a section asks
 * again, where "loading" holds the whole page on the loading screen.
 */
type Load<T> =
  | { state: 'loading' }
  | { state: 'retrying' }
  | { state: 'ok'; data: T }
  | { state: 'failed' };

function SectionError({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className={styles.sectionError} role="status">
      <p>{message}</p>
      <button type="button" onClick={onRetry} disabled={retrying} className={styles.sectionRetry}>
        {retrying ? 'Retrying' : 'Retry'}
      </button>
    </div>
  );
}

function useLoad<T>(request: () => Promise<T>, what: string) {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    request().then(
      (data) => {
        if (current) setLoad({ state: 'ok', data });
      },
      (err: unknown) => {
        console.error(`Failed to load ${what}:`, err);
        if (current) setLoad({ state: 'failed' });
      }
    );
    return () => {
      current = false;
    };
  }, [request, what, attempt]);

  const retry = (state: 'loading' | 'retrying') => {
    setLoad({ state });
    setAttempt((n) => n + 1);
  };
  return [load, retry] as const;
}

export default function Home() {
  const [featured, retryFeatured] = useLoad(getFeaturedPhotos, 'featured photos');
  // The same list, and so the same order, as the Galleries page: it holds
  // only public galleries.
  const [galleryList, retryGalleries] = useLoad(getGalleries, 'galleries');

  const featuredPhotos = featured.state === 'ok' ? featured.data : [];
  const heroPhoto = featuredPhotos[0];
  const gridPhotos = featuredPhotos.slice(1);
  // An empty gallery opens to nothing, so the homepage does not offer it.
  // The Galleries page still lists it.
  const galleries =
    galleryList.state === 'ok' ? galleryList.data.filter((g) => g.photoCount === undefined || g.photoCount > 0) : [];
  const galleriesFailed = galleryList.state === 'failed' || galleryList.state === 'retrying';
  const featuredFailed = featured.state === 'failed' || featured.state === 'retrying';

  if (featured.state === 'loading' || galleryList.state === 'loading') {
    return <div className={styles.loadingScreen} />;
  }

  // Only when nothing loaded does the whole page give way to the retry.
  if (featured.state === 'failed' && galleryList.state === 'failed') {
    return (
      <LoadError
        onRetry={() => {
          retryFeatured('loading');
          retryGalleries('loading');
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

      {(galleries.length > 0 || galleriesFailed) && (
        <section className={styles.galleries} aria-labelledby="home-galleries">
          <h2 id="home-galleries" className={styles.sectionLabel}>
            Galleries
          </h2>
          {galleriesFailed && (
            <SectionError
              message="Couldn't load galleries."
              retrying={galleryList.state === 'retrying'}
              onRetry={() => retryGalleries('retrying')}
            />
          )}
          {galleries.length > 0 && (
            <div className={styles.doors}>
              {doorRows(galleries).map((row) => (
                <div key={row[0].gallery.id} className={styles.doorRow}>
                  {row.map(({ gallery, ratio, share }) => (
                    <GalleryDoor key={gallery.id} gallery={gallery} ratio={ratio} share={share} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {featuredFailed && (
        <section className={styles.featured} aria-labelledby="home-featured">
          <h2 id="home-featured" className={styles.sectionLabel}>
            Selected Work
          </h2>
          <SectionError
            message="Couldn't load selected work."
            retrying={featured.state === 'retrying'}
            onRetry={() => retryFeatured('retrying')}
          />
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
