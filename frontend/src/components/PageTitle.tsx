import { useSiteTitle, formatPageTitle } from '../contexts/siteTitle';

/**
 * The document title for the page that renders it. React 19 hoists <title>
 * into the head ahead of the static one in index.html, which stays as the
 * title crawlers and link previews read.
 */
export default function PageTitle({ page }: { page?: string }) {
  const { siteTitle } = useSiteTitle();
  return <title>{formatPageTitle(page, siteTitle)}</title>;
}
