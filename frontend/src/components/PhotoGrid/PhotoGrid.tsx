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

// Placeholder S3 URL builder - will be updated when S3 is integrated
function getPhotoUrl(photo: Photo, _size: 'thumbnail' | 'web' | 'original'): string {
  // For now, use placeholder images based on dimensions
  // Later: return S3 URLs using photo.s3_thumbnail_key, photo.s3_web_key, or photo.s3_key
  return `https://placehold.co/${photo.width}x${photo.height}/1a1a1a/ffffff?text=${photo.width}x${photo.height}`;
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
