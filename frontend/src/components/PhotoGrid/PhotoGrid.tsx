import { useState, useEffect, useRef } from 'react';
import { MasonryPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/masonry.css';
import Lightbox from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Download from 'yet-another-react-lightbox/plugins/download';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { Photo, ExifData } from '../../types';
import { trackPhotoView, trackPhotoDownload } from '../../api/client';
import ExifOverlay from './ExifOverlay';
import { derivedImages } from '../../utils/imageSizes';
import styles from './PhotoGrid.module.css';

// Extend slide type to include EXIF data
interface SlideWithExif {
  src: string;
  srcSet: { src: string; width: number; height: number }[];
  width: number;
  height: number;
  alt: string;
  download: string;
  downloadFilename: string;
  exif?: ExifData;
}

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

  const albumPhotos = photos.map((photo) => {
    const candidates = derivedImages(photo);
    const largest = candidates[candidates.length - 1];
    // The album appends { src, width } to the srcset whenever no candidate
    // matches width, which would advertise the thumbnail at the largest size.
    // Passing the largest real candidate's size keeps the srcset truthful.
    return {
      src: candidates[0]?.src ?? getPhotoUrl(photo, 'web'),
      srcSet: candidates,
      width: largest?.width ?? photo.width,
      height: largest?.height ?? photo.height,
      alt: photo.original_filename,
    };
  });

  const lightboxSlides: SlideWithExif[] = photos.map((photo) => {
    const candidates = derivedImages(photo);
    const largest = candidates[candidates.length - 1];
    return {
      // The web size, not the original: originals can be tens of megabytes
      // and are fetched only by the download button.
      src: largest?.src ?? getPhotoUrl(photo, 'web'),
      srcSet: candidates,
      width: largest?.width ?? photo.width,
      height: largest?.height ?? photo.height,
      alt: photo.original_filename,
      download: getPhotoUrl(photo, 'original'),
      downloadFilename: photo.original_filename,
      exif: photo.exif_data,
    };
  });

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
        render={{
          image: (props) => <img {...props} loading="lazy" />,
        }}
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
        plugins={[Counter, Download, Zoom]}
        controller={{
          closeOnPullUp: true,
          closeOnPullDown: true,
        }}
        zoom={{
          maxZoomPixelRatio: 3,
          scrollToZoom: true,
          doubleTapDelay: 300,
          doubleClickDelay: 300,
        }}
        counter={{ container: { style: { top: 'unset', bottom: 0, left: 'unset', right: 0 } } }}
        render={{
          slideFooter: ({ slide }) => (
            <ExifOverlay exif={(slide as SlideWithExif).exif} />
          ),
        }}
      />
    </div>
  );
}
