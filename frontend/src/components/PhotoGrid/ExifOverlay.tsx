import type { ExifData } from '../../types';
import styles from './ExifOverlay.module.css';

interface ExifOverlayProps {
  exif?: ExifData;
}

function formatShutterSpeed(speed: number): string {
  if (speed >= 1) {
    return `${speed}s`;
  }
  return `1/${Math.round(1 / speed)}s`;
}

function formatLens(lens: string): string {
  // Add space before F-stop if missing (e.g., "50mmF2.8" -> "50mm F2.8")
  return lens.replace(/(\d+mm)(F\d)/g, '$1 $2');
}

function formatCamera(exif: ExifData): string {
  // Combine make and model, avoiding duplication
  // e.g., "FUJIFILM" + "X-T5" -> "FUJIFILM X-T5"
  // but "Canon" + "Canon EOS 5D" -> "Canon EOS 5D"
  const make = exif.cameraMake || '';
  const model = exif.cameraModel || '';

  if (!make && !model) return '';
  if (!make) return model;
  if (!model) return make;

  // If model already starts with make, just use model
  if (model.toLowerCase().startsWith(make.toLowerCase())) {
    return model;
  }

  return `${make} ${model}`;
}

export default function ExifOverlay({ exif }: ExifOverlayProps) {
  if (!exif) return null;

  const camera = formatCamera(exif);
  const lens = exif.lensModel ? formatLens(exif.lensModel) : undefined;

  // Build settings string: f/2.8 · 1/125s · ISO 400 · 50mm
  const settings: string[] = [];
  if (exif.aperture) settings.push(`f/${exif.aperture}`);
  if (exif.shutterSpeed) settings.push(formatShutterSpeed(exif.shutterSpeed));
  if (exif.iso) settings.push(`ISO ${exif.iso}`);
  if (exif.focalLength) settings.push(`${exif.focalLength}mm`);

  // Don't render if no useful data
  if (!camera && !lens && settings.length === 0) return null;

  return (
    <div className={styles.overlay}>
      {(camera || lens) && (
        <div className={styles.equipment}>
          {camera}
          {camera && lens && ' · '}
          {lens}
        </div>
      )}
      {settings.length > 0 && (
        <div className={styles.settings}>{settings.join(' · ')}</div>
      )}
    </div>
  );
}
