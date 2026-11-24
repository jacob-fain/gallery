// The format the API accepts for a gallery slug (galleryController.ts). A
// slug outside it names no gallery, so the page answers without asking.
const GALLERY_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isGallerySlug = (slug: string | undefined): slug is string =>
  slug !== undefined && GALLERY_SLUG.test(slug);
