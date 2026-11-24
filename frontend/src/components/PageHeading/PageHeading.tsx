import styles from './PageHeading.module.css';

interface PageHeadingProps {
  title: string;
  // Set on a gallery page, which also shows the count and the description
  // and takes more room above the grid than an index page.
  photoCount?: number;
  description?: string | null;
}

export default function PageHeading({ title, photoCount, description }: PageHeadingProps) {
  const isGallery = photoCount !== undefined;
  return (
    <header className={isGallery ? styles.galleryHeader : styles.indexHeader}>
      <h1 className={styles.title}>{title}</h1>
      {isGallery && (
        <p className={styles.count}>
          {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
        </p>
      )}
      {isGallery && description && <p className={styles.description}>{description}</p>}
    </header>
  );
}
