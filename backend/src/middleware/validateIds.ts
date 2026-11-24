import { Request, Response, NextFunction } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Matches the largest list an admin action sends (a whole gallery at most).
const MAX_IDS = 1000;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/**
 * router.param handler: a path id that is not a UUID can name no record, so
 * it answers 404 like any missing one instead of reaching Postgres, which
 * rejects it with an error that surfaced as a 500.
 */
export const uuidParam = (
  _req: Request,
  res: Response,
  next: NextFunction,
  value: string
): void => {
  if (!isUuid(value)) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  next();
};

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
