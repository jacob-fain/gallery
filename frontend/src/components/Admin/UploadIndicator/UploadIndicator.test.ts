import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UploadQueueContext } from '../../../contexts/uploads';
import { UploadQueue } from '../../../utils/uploadQueue';
import UploadIndicator from './UploadIndicator';

const image = (name: string) => new File([name], name, { type: 'image/jpeg' });

function queueWith(adds: Array<{ galleryId: string | null; files: File[] }>) {
  const queue = new UploadQueue({
    upload: () => new Promise(() => {}),
    checkDuplicates: async () => ({}),
    hash: (file) => file.text(),
  });
  queue.setSession('user-1');
  for (const { galleryId, files } of adds) queue.add(files, { galleryId, checkOnly: false });
  return queue;
}

const render = (queue: UploadQueue) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(UploadQueueContext.Provider, { value: queue }, createElement(UploadIndicator))
    )
  );

describe('UploadIndicator', () => {
  it('renders nothing with no uploads running', () => {
    expect(render(queueWith([]))).toBe('');
  });

  it('counts the running batch and links to the gallery it uploads to', () => {
    const html = render(queueWith([{ galleryId: 'g1', files: [image('a'), image('b')] }]));
    expect(html).toContain('Uploading 0/2');
    expect(html).toContain('href="/galleries/g1/photos"');
    expect(html).toContain('role="progressbar"');
  });

  it('links unassigned uploads to the unassigned page', () => {
    expect(render(queueWith([{ galleryId: null, files: [image('a')] }]))).toContain('href="/unassigned"');
  });

  it('shows no link when uploads go to more than one place', () => {
    const html = render(
      queueWith([
        { galleryId: 'g1', files: [image('a')] },
        { galleryId: null, files: [image('b')] },
      ])
    );
    expect(html).toContain('Uploading 0/2');
    expect(html).not.toContain('href=');
  });
});
