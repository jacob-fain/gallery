import { createContext, useContext } from 'react';

/** Matches index.html, which is all a crawler sees. */
export const DEFAULT_SITE_TITLE = 'Jacob Fain Photography';

export interface SiteTitleContextType {
  siteTitle: string;
  setSiteTitle: (title: string) => void;
}

export const SiteTitleContext = createContext<SiteTitleContextType>({
  siteTitle: DEFAULT_SITE_TITLE,
  setSiteTitle: () => {},
});

export const useSiteTitle = (): SiteTitleContextType => useContext(SiteTitleContext);

/** "Galleries | Jacob Fain Photography", or the site title alone for the home page. */
export function formatPageTitle(page: string | undefined, siteTitle: string): string {
  const site = siteTitle.trim() || DEFAULT_SITE_TITLE;
  const name = page?.trim();
  return name ? `${name} | ${site}` : site;
}
