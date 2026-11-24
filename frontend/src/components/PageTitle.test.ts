import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageTitle from './PageTitle';
import { SiteTitleContext, formatPageTitle } from '../contexts/siteTitle';

describe('formatPageTitle', () => {
  it('puts the page before the site title', () => {
    expect(formatPageTitle('Galleries', 'Jacob Fain Photography')).toBe('Galleries | Jacob Fain Photography');
  });

  it('uses the site title alone when there is no page name', () => {
    expect(formatPageTitle(undefined, 'Jacob Fain Photography')).toBe('Jacob Fain Photography');
    expect(formatPageTitle('  ', 'Jacob Fain Photography')).toBe('Jacob Fain Photography');
  });

  it('falls back to the default when the site title setting is blank', () => {
    expect(formatPageTitle('Iceland', '')).toBe('Iceland | Jacob Fain Photography');
  });
});

describe('PageTitle', () => {
  it('renders a title element with the default site title', () => {
    expect(renderToStaticMarkup(createElement(PageTitle, { page: 'Photos' }))).toBe(
      '<title>Photos | Jacob Fain Photography</title>'
    );
  });

  it('follows the site title from settings', () => {
    const html = renderToStaticMarkup(
      createElement(
        SiteTitleContext.Provider,
        { value: { siteTitle: 'JF Studio', setSiteTitle: () => {} } },
        createElement(PageTitle, { page: 'Galleries' })
      )
    );
    expect(html).toBe('<title>Galleries | JF Studio</title>');
  });
});
