import { AsyncLocalStorage } from 'async_hooks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type Threshold = LogLevel | 'silent';

const RANK: Record<Threshold, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, unknown>;

/** Per-request context; every line logged while handling a request carries its id. */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

const REDACTED = '[redacted]';

// Keys whose values never reach a log, matched anywhere in the key name.
const SECRET_KEY = /authorization|cookie|password|passwd|secret|token|signature|credential|api[-_]?key|session/i;

// A query string can carry a presigned URL's signature or a gallery ?access
// token, so every URL is logged without it.
const URL_QUERY = /(\bhttps?:\/\/[^\s"'<>?#]+)\?[^\s"'<>]*/gi;
// Path-only URLs as they appear in messages ("GET /api/photos/1?access=...").
const PATH_QUERY = /((?:^|[\s"'(])\/[^\s"'<>?#]*)\?[^\s"'<>]*/g;
// A JWT, wherever it appears.
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
// Credentials embedded in a connection string (postgresql://user:pass@host).
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

/** A string with query strings, JWTs and URL credentials removed. */
export const redactString = (s: string): string =>
  s
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(URL_QUERY, `$1?${REDACTED}`)
    .replace(PATH_QUERY, `$1?${REDACTED}`)
    .replace(JWT, REDACTED);

/** The path of a URL without its query string; only the path is ever logged. */
export const pathOnly = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

// Bounds on the related errors an error line carries: enough to tell which
// address a connect failed on, never a whole chain.
const MAX_INNER_ERRORS = 3;
const MAX_INNER_MESSAGE = 300;

const errorCode = (err: Error): string | number | undefined => {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
};

/** A cause or inner error as name, message and code, without its stack or own causes. */
const summarizeError = (err: unknown): LogFields => {
  if (!(err instanceof Error)) return { message: redactString(String(err).slice(0, MAX_INNER_MESSAGE)) };
  const out: LogFields = { name: err.name, message: redactString(err.message.slice(0, MAX_INNER_MESSAGE)) };
  const code = errorCode(err);
  if (code !== undefined) out.code = code;
  return out;
};

/**
 * An error as loggable fields. Only the name, message, code and stack are
 * kept, plus a summary of its cause and of the first few errors an
 * AggregateError holds (a connect that tried several addresses has an empty
 * message and only the inner errors say why). Driver errors carry other
 * fields (a failed query's parameters, a request's headers) that must not be
 * logged.
 */
export const serializeError = (err: unknown): LogFields => {
  if (!(err instanceof Error)) return { message: redactString(String(err)) };
  const out: LogFields = { name: err.name, message: redactString(err.message) };
  const code = errorCode(err);
  if (code !== undefined) out.code = code;
  if (err.stack) out.stack = redactString(err.stack);
  // Read structurally: the build's ES2020 lib declares neither Error.cause
  // nor AggregateError, though Node has both.
  const { cause, errors } = err as { cause?: unknown; errors?: unknown };
  if (cause !== undefined) out.cause = summarizeError(cause);
  if (err.name === 'AggregateError' && Array.isArray(errors)) {
    out.errors = errors.slice(0, MAX_INNER_ERRORS).map(summarizeError);
    if (errors.length > MAX_INNER_ERRORS) out.moreErrors = errors.length - MAX_INNER_ERRORS;
  }
  return out;
};

const MAX_DEPTH = 5;

/** Fields with secret-named keys removed and every string redacted. */
export const redactFields = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redactFields(v, depth + 1));
  const out: LogFields = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : redactFields(v, depth + 1);
  }
  return out;
};

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

interface LoggerOptions {
  /** Read on every call, so LOG_LEVEL applies even when set after import. */
  level?: () => string | undefined;
  write?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}

// An own-key check, so "toString" and other prototype keys are not levels.
// (Object.hasOwn is not in the build's ES2020 lib.)
const isThreshold = (value: string): value is Threshold => Object.prototype.hasOwnProperty.call(RANK, value);

// Warnings and errors go to stderr, the rest to stdout; Docker keeps both.
const defaultWrite = (level: LogLevel, line: string) => {
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
};

/** A logger that writes one JSON object per line. */
export const createLogger = ({
  level = () => process.env.LOG_LEVEL,
  write = defaultWrite,
  now = () => new Date(),
}: LoggerOptions = {}): Logger => {
  // An unset or empty LOG_LEVEL means info. Any other value that names no
  // level also means info, and is reported once so a typo does not silently
  // hide debug lines or flood the log.
  let reported: string | undefined;
  const threshold = (): Threshold => {
    const raw = level()?.trim().toLowerCase();
    if (!raw) return 'info';
    if (isThreshold(raw)) return raw;
    if (raw !== reported) {
      reported = raw;
      write(
        'warn',
        JSON.stringify({
          time: now().toISOString(),
          level: 'warn',
          msg: 'unknown LOG_LEVEL, using info',
          logLevel: redactString(raw.slice(0, 32)),
        })
      );
    }
    return 'info';
  };
  // Checked once on creation, so a bad value is reported at startup rather
  // than on the first line logged.
  threshold();

  const log = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (RANK[lvl] < RANK[threshold()]) return;
    const requestId = requestContext.getStore()?.requestId;
    const entry: LogFields = {
      time: now().toISOString(),
      level: lvl,
      msg: redactString(msg),
      ...(requestId ? { requestId } : {}),
      ...(fields ? (redactFields(fields) as LogFields) : {}),
    };
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({ time: entry.time, level: lvl, msg: entry.msg, note: 'fields not serializable' });
    }
    write(lvl, line);
  };
  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
  };
};

export const logger = createLogger();
