// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Gallery } from '../types';

vi.mock('../api/client', () => ({ getGalleries: vi.fn() }));

const client = await import('../api/client');
const { default: Galleries } = await import('./Galleries');

const gallery = (slug: string, photoCount?: number): Gallery => ({
  id: `g-${slug}`,
  title: slug[0].toUpperCase() + slug.slice(1),
  slug,
  coverUrl: null,
  coverWebUrl: null,
  coverWidth: null,
  coverHeight: null,
  photoCount,
});

async function renderGalleries(galleries: Gallery[]) {
  vi.mocked(client.getGalleries).mockResolvedValue(galleries);
  render(
    <MemoryRouter>
      <Galleries />
    </MemoryRouter>
  );
  return screen.findAllByRole('link');
}

describe('Galleries cards', () => {
  it('show each gallery\'s photo count under its name', async () => {
    const cards = await renderGalleries([gallery('chicago', 84), gallery('soccer', 1), gallery('empty', 0)]);
    expect(cards.map((c) => c.textContent)).toEqual(['Chicago84 photos', 'Soccer1 photo', 'Empty0 photos']);
  });

  it('leave the count out when the response has none', async () => {
    const [card] = await renderGalleries([gallery('chicago')]);
    expect(card.textContent).toBe('Chicago');
  });
});
