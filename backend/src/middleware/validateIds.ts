import { Request, Response, NextFunction } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Reorder, shuffle and move send every photo id in a gallery, so the cap
// must cover the largest gallery. A UUID costs about 39 bytes of JSON, so
// 5000 ids is about 195 KB, inside JSON_BODY_LIMIT (app.ts). Raise both
// together.
export const MAX_IDS = 5000;
export const JSON_BODY_LIMIT = '256kb';

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** Lowercase letters and digits, with single hyphens between words. */
export const GALLERY_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isGallerySlug = (value: unknown): value is string =>
  typeof value === 'string' && GALLERY_SLUG.test(value);

const formatParam =
  (isValid: (value: string) => boolean) =>
  (notFoundMessage: string) =>
  (_req: Request, res: Response, next: NextFunction, value: string): void => {
    if (!isValid(value)) {
      res.status(404).json({ success: false, error: notFoundMessage });
      return;
    }
    next();
  };

/**
 * router.param handler factory: a path id that is not a UUID can name no
 * record, so it answers with the router's own missing-record body instead
 * of reaching Postgres, which rejects it with an error that surfaced as a
 * 500.
 */
export const uuidParam = formatParam(isUuid);

/**
 * router.param handler factory for gallery slugs. Express decodes the path,
 * so a slug can arrive holding "/", "?" or "..": one that no gallery could
 * have answers as missing before any handler or query sees it.
 */
export const slugParam = formatParam(isGallerySlug);

type IdRule = 'uuid' | 'uuid?' | 'uuid[]';

/**
 * Checks id fields in the JSON or form body before the handler runs.
 * 'uuid' is required, 'uuid?' may be absent, null or an empty string, and
 * 'uuid[]' is a non-empty array of at most MAX_IDS UUIDs.
 */
export const validateBodyIds =
  (rules: Record<string, IdRule>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    for (const [field, rule] of Object.entries(rules)) {
      const value = body[field];
      const ok =
        rule === 'uuid'
          ? isUuid(value)
          : rule === 'uuid?'
            ? value === undefined || value === null || value === '' || isUuid(value)
            : Array.isArray(value) &&
              value.length > 0 &&
              value.length <= MAX_IDS &&
              value.every(isUuid);
      if (!ok) {
        res.status(400).json({
          success: false,
          error:
            rule === 'uuid[]'
              ? `${field} must be a list of 1 to ${MAX_IDS} ids`
              : `${field} must be a valid id`,
        });
        return;
      }
    }
    next();
  };
