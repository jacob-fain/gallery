import { compose, removeImages } from './stack';

export default function globalTeardown(): void {
  if (process.env.E2E_KEEP_STACK) return;
  compose('down', '--volumes', '--remove-orphans');
  removeImages();
}
