import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ErrorBoundary from './ErrorBoundary';
import NotFound from '../pages/NotFound';

const render = (node: Parameters<typeof createElement>[0], props = {}) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(node, props)));

describe('NotFound', () => {
  it('names the missing page and links home', () => {
    const html = render(NotFound);
    expect(html).toContain('Page not found');
    expect(html).toContain('href="/"');
    expect(html).toContain('Back to home');
    expect(html).toContain('<meta name="robots" content="noindex"/>');
  });

  it('takes a gallery-specific message and link', () => {
    const html = render(NotFound, {
      title: 'Gallery not found',
      linkTo: '/galleries',
      linkLabel: 'View all galleries',
    });
    expect(html).toContain('Gallery not found');
    expect(html).toContain('href="/galleries"');
  });
});

describe('ErrorBoundary', () => {
  it('switches to its fallback after an error', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it('shows a reload screen once failed', () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { failed: true };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Reload');
  });

  it('renders its children until then', () => {
    const html = renderToStaticMarkup(createElement(ErrorBoundary, null, 'gallery'));
    expect(html).toBe('gallery');
  });
});
