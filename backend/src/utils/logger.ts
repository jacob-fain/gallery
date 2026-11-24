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

/**
 * An error as loggable fields. Only the name, message, code and stack are
 * kept: driver errors carry other fields (a failed query's parameters, a
 * request's headers) that must not be logged.
 */
export const serializeError = (err: unknown): LogFields => {
  if (!(err instanceof Error)) return { message: redactString(String(err)) };
  const out: LogFields = { name: err.name, message: redactString(err.message) };
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') out.code = code;
  if (err.stack) out.stack = redactString(err.stack);
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

const threshold = (raw: string | undefined): Threshold =>
  raw && raw in RANK ? (raw as Threshold) : 'info';

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
  const log = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (RANK[lvl] < RANK[threshold(level())]) return;
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
