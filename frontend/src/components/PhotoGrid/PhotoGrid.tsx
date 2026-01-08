import { useState, useEffect, useRef } from 'react';
import { MasonryPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/masonry.css';
import Lightbox from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Download from 'yet-another-react-lightbox/plugins/download';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { Photo } from '../../types';
import { trackPhotoView, trackPhotoDownload } from '../../api/client';
import styles from './PhotoGrid.module.css';

interface PhotoGridProps {
  photos: Photo[];
}

function getPhotoUrl(photo: Photo, size: 'thumbnail' | 'web' | 'original'): string {
  if (size === 'thumbnail' && photo.thumbnailUrl) {
    return photo.thumbnailUrl;
  }
  if (size === 'web' && photo.webUrl) {
    return photo.webUrl;
  }
  if (size === 'original' && photo.url) {
    return photo.url;
  }
  // Fallback to any available URL
  return photo.webUrl || photo.url || photo.thumbnailUrl || '';
}

export default function PhotoGrid({ photos }: PhotoGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const lastTrackedIndex = useRef(-1);

  // Track photo view when lightbox opens or navigates to a new photo
  useEffect(() => {
    if (lightboxIndex >= 0 && lightboxIndex !== lastTrackedIndex.current) {
      const photo = photos[lightboxIndex];
      if (photo) {
        trackPhotoView(photo.id);
        lastTrackedIndex.current = lightboxIndex;
      }
    }
    // Reset tracking when lightbox closes
    if (lightboxIndex < 0) {
      lastTrackedIndex.current = -1;
    }
  }, [lightboxIndex, photos]);

  const albumPhotos = photos.map((photo) => ({
    src: getPhotoUrl(photo, 'web'),
    width: photo.width,
    height: photo.height,
    alt: photo.original_filename,
  }));

  const lightboxSlides = photos.map((photo) => ({
    src: getPhotoUrl(photo, 'original'),
    width: photo.width,
    height: photo.height,
    alt: photo.original_filename,
    download: getPhotoUrl(photo, 'original'),
  }));

  // Handle download - track before the actual download happens
  const handleDownload = ({ index }: { index: number }) => {
    const photo = photos[index];
    if (photo) {
      trackPhotoDownload(photo.id);
    }
  };

  return (
    <div className={styles.grid}>
      <MasonryPhotoAlbum
        photos={albumPhotos}
        columns={(containerWidth) => {
          if (containerWidth < 500) return 1;
          if (containerWidth < 900) return 2;
          return 3;
        }}
        spacing={12}
        onClick={({ index }) => setLightboxIndex(index)}
      />

      <Lightbox
        slides={lightboxSlides}
        open={lightboxIndex >= 0}
        index={lightboxIndex}
        close={() => setLightboxIndex(-1)}
        on={{
          view: ({ index }) => setLightboxIndex(index),
          download: handleDownload,
        }}
        plugins={[Counter, Download]}
        counter={{ container: { style: { top: 'unset', bottom: 0 } } }}
      />
    </div>
  );
}
