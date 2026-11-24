// Alt text comes from where a photo sits, never from its filename: camera
// names like "DSCF1234.JPG" tell a screen reader user nothing (#108).
export function photoAlt(index: number, total: number, galleryTitle?: string | null): string {
  const position = `Photo ${index + 1} of ${total}`;
  const title = galleryTitle?.trim();
  return title ? `${position} in ${title}` : position;
}
