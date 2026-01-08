import { useState } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import Lightbox from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Download from 'yet-another-react-lightbox/plugins/download';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { Photo } from '../../types';
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

  return (
    <div className={styles.grid}>
      <RowsPhotoAlbum
        photos={albumPhotos}
        targetRowHeight={300}
        spacing={6}
        onClick={({ index }) => setLightboxIndex(index)}
      />

      <Lightbox
        slides={lightboxSlides}
        open={lightboxIndex >= 0}
        index={lightboxIndex}
        close={() => setLightboxIndex(-1)}
        plugins={[Counter, Download]}
        counter={{ container: { style: { top: 'unset', bottom: 0 } } }}
      />
    </div>
  );
}
