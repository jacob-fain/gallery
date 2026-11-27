import LayoutSwitch from '../PhotoGrid/LayoutSwitch';
import type { GridLayout } from '../PhotoGrid/gridLayout';
import styles from './FloatingControls.module.css';

interface FloatingControlsProps {
  // The layout switch and Shuffle, for a page with more than one photo.
  layout?: GridLayout;
  onLayoutChange?: (layout: GridLayout) => void;
  // The grid is one column wide, so the single layout is not offered.
  oneColumn?: boolean;
  onShuffle?: () => void;
  // The gallery's download (gallery pages).
  onDownload?: () => void;
}

/**
 * A photo page's floating buttons in the bottom right corner: the layout
 * switch, Shuffle and, on a gallery, Download. Laid out together, so none
 * sits over another at any width, and kept clear of the screen's safe-area
 * insets.
 */
export default function FloatingControls({ layout, onLayoutChange, oneColumn, onShuffle, onDownload }: FloatingControlsProps) {
  if (!onShuffle && !onDownload && !(layout && onLayoutChange)) return null;
  return (
    <div className={`${styles.controls}${onDownload ? ` ${styles.withDownload}` : ''}`}>
      {layout && onLayoutChange && (
        <LayoutSwitch layout={layout} onChange={onLayoutChange} offerSingle={!oneColumn} className={styles.switch} />
      )}
      {onShuffle && (
        <button type="button" className={`${styles.button} ${styles.shuffle}`} onClick={onShuffle} title="Shuffle photos" aria-label="Shuffle photos">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
            <path d="m18 2 4 4-4 4" />
            <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
            <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
            <path d="m18 14 4 4-4 4" />
          </svg>
        </button>
      )}
      {onDownload && (
        <button type="button" className={`${styles.button} ${styles.download}`} onClick={onDownload} title="Download all photos as ZIP" aria-label="Download all photos as ZIP">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      )}
    </div>
  );
}
