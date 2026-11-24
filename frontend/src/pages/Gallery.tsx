import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import PhotoGrid from '../components/PhotoGrid/PhotoGrid';
import {
  getGallery,
  getGalleryPhotos,
  getGalleryDownloadUrl,
  isKnownPrivateGallery,
  verifyGalleryPassword,
} from '../api/client';
import { isNotFound, visitorMessage } from '../api/errors';
import LoadError from '../components/StatusMessage/LoadError';
import NotFound from './NotFound';
import PageTitle from '../components/PageTitle';
import { shuffle } from '../utils/shuffle';
import { withFreshUrls } from '../utils/expiredImages';
import { useGalleryViewTracking } from '../utils/galleryViewTracking';
import type { Gallery as GalleryType, PublicPhoto, PrivateGalleryResponse } from '../types';
import styles from './Gallery.module.css';

// Type guard to check if response is a private gallery requiring password
function isPrivateGallery(
  data: GalleryType | PrivateGalleryResponse
): data is PrivateGalleryResponse {
  return 'requires_password' in data && data.requires_password === true;
}

// Session storage key for gallery access tokens
const getStorageKey = (slug: string) => `gallery_access_${slug}`;

export default function Gallery() {
  const { slug } = useParams<{ slug: string }>();
  const [gallery, setGallery] = useState<GalleryType | PrivateGalleryResponse | null>(null);
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'missing' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Password form state
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const shown = !loading && gallery !== null && (!isPrivateGallery(gallery) || accessToken !== null);
  useGalleryViewTracking(shown ? gallery.slug : null, accessToken);

  const refreshPhotos = useCallback(() => {
    if (!slug) return;
    getGalleryPhotos(slug, accessToken ?? undefined, { fresh: true })
      .then((fresh) => setPhotos((current) => withFreshUrls(current, fresh)))
      // The photos already shown stay; a failed refresh changes nothing.
      .catch(() => {});
  }, [slug, accessToken]);

  // Load gallery info
  useEffect(() => {
    async function loadGallery() {
      if (!slug) return;

      try {
        setLoading(true);

        // Photos load alongside the metadata, except for a gallery already
        // seen as private, whose photos the API refuses without a token.
        const galleryPromise = getGallery(slug);
        const photosPromise = isKnownPrivateGallery(slug) ? null : getGalleryPhotos(slug).catch(() => null);

        const galleryData = await galleryPromise;
        setGallery(galleryData);

        if (!isPrivateGallery(galleryData)) {
          const photosData = await (photosPromise ?? getGalleryPhotos(slug).catch(() => null));
          if (photosData) {
            setPhotos(photosData);
          }
        } else {
          // Private gallery - check for stored access token
          const storedToken = sessionStorage.getItem(getStorageKey(slug));
          if (storedToken) {
            try {
              // Try to fetch photos with stored token
              const photosData = await getGalleryPhotos(slug, storedToken);
              setPhotos(photosData);
              setAccessToken(storedToken);
              // Update gallery state to show as unlocked
              setGallery({
                ...galleryData,
                title: galleryData.title,
                slug: galleryData.slug,
              } as unknown as GalleryType);
            } catch {
              // Token expired or invalid, clear it
              sessionStorage.removeItem(getStorageKey(slug));
            }
          }
        }
      } catch (err) {
        setLoadError(isNotFound(err) ? 'missing' : 'failed');
      } finally {
        setLoading(false);
      }
    }
    loadGallery();
  }, [slug, attempt]);

  // Handle password verification
  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slug || !password.trim()) return;

    setPasswordError('');
    setVerifying(true);

    try {
      const result = await verifyGalleryPassword(slug, password);

      // Store access token in sessionStorage
      sessionStorage.setItem(getStorageKey(slug), result.accessToken);
      setAccessToken(result.accessToken);

      // Update gallery with full data from verification response
      setGallery({
        ...gallery,
        title: result.title,
        slug: result.slug,
        description: result.description,
        is_public: result.is_public,
      } as GalleryType);

      // Fetch photos with access token
      const photosData = await getGalleryPhotos(slug, result.accessToken);
      setPhotos(photosData);
    } catch (err) {
      setPasswordError(visitorMessage(err, 'The password could not be checked. Please try again.'));
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (loadError === 'failed') {
    return (
      <LoadError
        onRetry={() => {
          setLoadError(null);
          setLoading(true);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  if (loadError === 'missing' || !gallery) {
    return (
      <NotFound
        title="Gallery not found"
        message="This gallery does not exist or is no longer available."
        linkTo="/galleries"
        linkLabel="View all galleries"
      />
    );
  }

  // Show password form for private galleries that haven't been unlocked
  if (isPrivateGallery(gallery) && !accessToken) {
    return (
      <div className={styles.container}>
        <PageTitle page={gallery.title} />
        <div className={styles.passwordContainer}>
          <h1 className={styles.title}>{gallery.title}</h1>
          <p className={styles.passwordNote}>
            This gallery is private. Enter the password to view.
          </p>

          <form className={styles.passwordForm} onSubmit={handlePasswordSubmit}>
            {passwordError && (
              <div className={styles.passwordError}>{passwordError}</div>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className={styles.passwordInput}
              disabled={verifying}
              autoFocus
            />
            <button
              type="submit"
              className={styles.passwordButton}
              disabled={verifying || !password.trim()}
            >
              {verifying ? 'Verifying...' : 'View Gallery'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleDownload = () => {
    if (!slug) return;
    const url = getGalleryDownloadUrl(slug, accessToken || undefined);
    window.open(url, '_blank');
  };

  return (
    <div className={styles.container}>
      <PageTitle page={gallery.title} />
      {photos.length > 1 && (
        <button
          className={styles.shuffleBtn}
          onClick={() => setPhotos(shuffle(photos))}
          title="Shuffle photos"
          aria-label="Shuffle photos"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
            <path d="m18 2 4 4-4 4" />
            <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
            <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
            <path d="m18 14 4 4-4 4" />
          </svg>
        </button>
      )}
      {photos.length > 0 && (
        <button
          className={styles.downloadBtn}
          onClick={handleDownload}
          title="Download all photos as ZIP"
          aria-label="Download all photos as ZIP"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      )}
      {photos.length === 0 ? (
        <div className="loading">No photos in this gallery yet.</div>
      ) : (
        <PhotoGrid
          photos={photos}
          galleryTitle={gallery.title}
          accessToken={accessToken ?? undefined}
          onImagesExpired={refreshPhotos}
        />
      )}
    </div>
  );
}
