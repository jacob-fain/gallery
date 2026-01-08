import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import PhotoGrid from '../components/PhotoGrid/PhotoGrid';
import { getGallery, getGalleryPhotos, verifyGalleryPassword } from '../api/client';
import type { Gallery as GalleryType, Photo, PrivateGalleryResponse } from '../types';
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
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Password form state
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Load gallery info
  useEffect(() => {
    async function loadGallery() {
      if (!slug) return;

      try {
        setLoading(true);
        const galleryData = await getGallery(slug);
        setGallery(galleryData);

        // If public gallery, fetch photos immediately
        if (!isPrivateGallery(galleryData)) {
          const photosData = await getGalleryPhotos(slug);
          setPhotos(photosData);
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
        setError(err instanceof Error ? err.message : 'Failed to load gallery');
      } finally {
        setLoading(false);
      }
    }
    loadGallery();
  }, [slug]);

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
      setPasswordError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!gallery) {
    return <div className="error">Gallery not found</div>;
  }

  // Show password form for private galleries that haven't been unlocked
  if (isPrivateGallery(gallery) && !accessToken) {
    return (
      <div className={styles.container}>
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

  return (
    <div className={styles.container}>
      {photos.length === 0 ? (
        <div className="loading">No photos in this gallery yet.</div>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </div>
  );
}
