import type { Gallery } from '../types';

// A cover with no recorded size is drawn at 3:2, like its placeholder.
export function coverRatio(gallery: Gallery): number {
  const { coverWidth: w, coverHeight: h } = gallery;
  return w && h ? w / h : 3 / 2;
}

// The strip's row height per breakpoint, in step with --cover-height in
// Home.module.css: about four 3:2 covers across the content width on wide
// screens, two on tablets, and one with the next peeking in on phones. A
// cover's width is that height times its aspect ratio, which is its sizes.
export function coverSizes(ratio: number): string {
  const r = ratio.toFixed(4);
  return (
    `(max-width: 640px) calc((100vw - 32px) / 1.9 * ${r}), ` +
    `(max-width: 1024px) calc((100vw - 120px) / 3 * ${r}), ` +
    `calc((min(100vw, 1600px) - 168px) / 6 * ${r})`
  );
}
