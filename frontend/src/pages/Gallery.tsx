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
import PageHeading from '../components/PageHeading/PageHeading';
import { DelayedSkeleton, HeadingSkeleton } from '../components/Skeleton/Skeleton';
import PhotoGridSkeleton from '../components/PhotoGrid/PhotoGridSkeleton';
import { shuffle } from '../utils/shuffle';
import LayoutSwitch from '../components/PhotoGrid/LayoutSwitch';
import { useGridLayout } from '../components/PhotoGrid/gridLayout';
import { seedFrom } from '../components/PhotoGrid/collage';
import { withFreshUrls } from '../utils/expiredImages';
import { useGalleryViewTracking } from '../utils/galleryViewTracking';
import { isGallerySlug } from '../utils/slug';
import { galleryTokenKey } from './gridRequests';
import type { Gallery as GalleryType, PublicPhoto, PrivateGalleryResponse } from '../types';
import styles from './Gallery.module.css';

// Type guard to check if response is a private gallery requiring password
function isPrivateGallery(
  data: GalleryType | PrivateGalleryResponse
): data is PrivateGalleryResponse {
  return 'requires_password' in data && data.requires_password === true;
}

const getStorageKey = galleryTokenKey;

// What the unlock response adds to a private gallery's heading. The locked
// response leaves it out, so a revisit with a stored token reads it from here.
type UnlockedDetails = Pick<GalleryType, 'description' | 'photoCount'>;
const getDetailsKey = (slug: string) => `gallery_details_${slug}`;

function readUnlockedDetails(slug: string): UnlockedDetails {
  try {
    const stored = JSON.parse(sessionStorage.getItem(getDetailsKey(slug)) ?? '{}');
    return {
      description: typeof stored.description === 'string' ? stored.description : null,
      photoCount: typeof stored.photoCount === 'number' ? stored.photoCount : undefined,
    };
  } catch {
    return { description: null };
  }
}

export default function Gallery() {
  const { slug: rawSlug } = useParams<{ slug: string }>();
  // React Router decodes the path, so /g/a%2Fb arrives as "a/b".
  const slug = isGallerySlug(rawSlug) ? rawSlug : undefined;
  const [gallery, setGallery] = useState<GalleryType | PrivateGalleryResponse | null>(null);
  const [photos, setPhotos] = useState<PublicPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'missing' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [layout, setLayout] = useGridLayout();

  // Password form state
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // The gallery whose first photo has loaded. The floating buttons wait for
  // it, so they do not hang over an empty page. Kept per slug, since moving
  // to another gallery keeps this component mounted.
  const [photoShownFor, setPhotoShownFor] = useState<string | null>(null);

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

        // Photos load alongside the metadata. A token stored by an earlier
        // unlock goes with that request, so a revisit to a private gallery
        // needs no second fetch. Without a token, a gallery already seen as
        // private is skipped, since the API refuses its photos.
        const storedToken = sessionStorage.getItem(getStorageKey(slug));
        const galleryPromise = getGallery(slug);
        const photosPromise = storedToken
          ? getGalleryPhotos(slug, storedToken).then(
              (data) => ({ ok: true as const, data }),
              () => ({ ok: false as const })
            )
          : isKnownPrivateGallery(slug)
            ? null
            : getGalleryPhotos(slug).then(
                (data) => ({ ok: true as const, data }),
                () => ({ ok: false as const })
              );

        const galleryData = await galleryPromise;
        setGallery(galleryData);

        if (!isPrivateGallery(galleryData)) {
          const result = await (photosPromise ??
            getGalleryPhotos(slug).then(
              (data) => ({ ok: true as const, data }),
              () => ({ ok: false as const })
            ));
          if (result.ok) {
            setPhotos(result.data);
          }
        } else if (storedToken && photosPromise) {
          const result = await photosPromise;
          if (result.ok) {
            setPhotos(result.data);
            setAccessToken(storedToken);
            // Update gallery state to show as unlocked
            setGallery({
              ...galleryData,
              title: galleryData.title,
              slug: galleryData.slug,
              ...readUnlockedDetails(slug),
            } as unknown as GalleryType);
          } else {
            // Token expired or invalid, clear it
            sessionStorage.removeItem(getStorageKey(slug));
            sessionStorage.removeItem(getDetailsKey(slug));
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
      sessionStorage.setItem(
        getDetailsKey(slug),
        JSON.stringify({ description: result.description, photoCount: result.photoCount })
      );
      setAccessToken(result.accessToken);

      // Update gallery with full data from verification response
      setGallery({
        ...gallery,
        title: result.title,
        slug: result.slug,
        description: result.description,
        photoCount: result.photoCount,
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

  if (loading && slug) {
    return (
      <DelayedSkeleton>
        <HeadingSkeleton gallery />
        <PhotoGridSkeleton />
      </DelayedSkeleton>
    );
  }

  if (loadError === 'failed' && slug) {
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

  if (loadError === 'missing' || !gallery || !slug) {
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

  // The ZIP answers with Content-Disposition: attachment, so navigating to it
  // saves the file and leaves the page in place. Navigation, unlike opening a
  // tab, is not blocked after the await for a private gallery's ticket.
  const handleDownload = async () => {
    if (!slug) return;
    try {
      window.location.assign(await getGalleryDownloadUrl(slug, accessToken || undefined));
    } catch (err) {
      console.error('Failed to download gallery:', err);
    }
  };

  // A private gallery's state is still the locked response type here, with
  // the unlock details merged in.
  const unlocked = gallery as GalleryType;
  const photoShown = photoShownFor === slug;
  // Image load and error events do not bubble, but React's capture phase
  // sees them. A failed photo counts too, so a gallery whose images all fail
  // still offers its download.
  const markPhotoShown = () => setPhotoShownFor(slug);

  return (
    <div className={styles.container} onLoadCapture={markPhotoShown} onErrorCapture={markPhotoShown}>
      <PageTitle page={gallery.title} />
      <PageHeading
        title={gallery.title}
        photoCount={unlocked.photoCount ?? photos.length}
        description={unlocked.description}
      />
      {photoShown && photos.length > 1 && (
        <LayoutSwitch layout={layout} onChange={setLayout} className={styles.layoutSwitch} />
      )}
      {photoShown && photos.length > 1 && (
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
      {photoShown && photos.length > 0 && (
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
          layout={layout}
          // Per gallery, so a visitor sees the same collage each visit.
          collageSeed={seedFrom(slug ?? '')}
        />
      )}
    </div>
  );
}
