/**
 * Reports browser errors to the API, which writes them to the server log.
 * A report carries only the error, the page path and the build: never the
 * query string or hash (a gallery ZIP ticket can live there), cookies, or
 * anything typed into the page.
 */

export type ErrorSource = 'error' | 'unhandledrejection' | 'boundary' | 'chunk';

export type ImageFailure = 'error' | 'truncated' | 'timeout';

/** A grid image that kept failing to load. Never its URL: that is signed. */
export interface ImageFailureDetails {
  photoId: string;
  kind: 'thumb' | 'web';
  failure: ImageFailure;
  attempts: number;
}

export interface ClientErrorReport {
  source: ErrorSource | 'image';
  message: string;
  stack?: string;
  url: string;
  release?: string;
  userAgent: string;
  image?: ImageFailureDetails;
}

// Matches the server's limits (backend/src/routes/clientErrors.ts), so a
// report always fits its body limit.
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_PATH = 300;
const MAX_USER_AGENT = 300;

/** Reports sent per page load at most: a render loop must not flood the log. */
export const MAX_REPORTS_PER_PAGE = 5;

/**
 * Image failure reports per page load at most, counted apart from errors: a
 * grid of failing images must not crowd out a crash. One per photo.
 */
export const MAX_IMAGE_REPORTS_PER_PAGE = 20;

// Browser noise that says nothing about this app.
const IGNORED = [/^ResizeObserver loop/, /^Script error\.?$/];

// No lookbehind: older Safari cannot parse it, and a syntax error here would
// stop the whole bundle from loading.
const QUERY_IN_URL = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()]+)[?#][^\s"'<>()]*/gi;
// Path-only URLs as they appear in messages ("GET /gallery/x?access=...").
const QUERY_IN_PATH = /((?:^|[\s"'(])\/[^\s?#"'<>()]*)[?#][^\s"'<>()]*/g;

/** Text with the query string and hash cut from every URL in it. */
export const stripUrlQueries = (text: string): string =>
  text.replace(QUERY_IN_URL, '$1').replace(QUERY_IN_PATH, '$1');

/** A URL or path as its path alone. */
export const pathOf = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};

const describe = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
};

export interface ReporterOptions {
  send: (report: ClientErrorReport) => void;
  /** location.pathname is read at report time; only the path is ever sent. */
  path: () => string;
  userAgent: string;
  release?: string;
  max?: number;
}

export const createReporter = ({ send, path, userAgent, release, max = MAX_REPORTS_PER_PAGE }: ReporterOptions) => {
  const seen = new Set<string>();
  let sent = 0;

  return (source: ErrorSource, error: unknown): void => {
    if (sent >= max) return;
    const { message, stack } = describe(error);
    if (!message || IGNORED.some((pattern) => pattern.test(message))) return;
    const report: ClientErrorReport = {
      source,
      message: stripUrlQueries(message).slice(0, MAX_MESSAGE),
      url: pathOf(path()).slice(0, MAX_PATH),
      userAgent: userAgent.slice(0, MAX_USER_AGENT),
    };
    if (stack) report.stack = stripUrlQueries(stack).slice(0, MAX_STACK);
    if (release) report.release = release;
    // The same error caught twice (a failed chunk, then the boundary it
    // reaches) is one report, whichever handler saw it first.
    const key = `${report.message}\n${report.stack ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    send(report);
  };
};

export const createImageReporter = ({
  send,
  path,
  userAgent,
  release,
  max = MAX_IMAGE_REPORTS_PER_PAGE,
}: ReporterOptions) => {
  const reported = new Set<string>();

  return (image: ImageFailureDetails): void => {
    if (reported.size >= max || reported.has(image.photoId)) return;
    reported.add(image.photoId);
    const report: ClientErrorReport = {
      source: 'image',
      message: `Image failed to load: ${image.kind} ${image.failure} after ${image.attempts} attempts`,
      url: pathOf(path()).slice(0, MAX_PATH),
      userAgent: userAgent.slice(0, MAX_USER_AGENT),
      image,
    };
    if (release) report.release = release;
    send(report);
  };
};

/**
 * Posts a report without delaying the page; keepalive lets it outlive the
 * page unloading. Not sendBeacon: a beacon always carries cookies, and the
 * admin session cookie must never ride along on a report.
 */
export const postTo = (endpoint: string) => (report: ClientErrorReport): void => {
  try {
    void fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(report),
      keepalive: true,
      credentials: 'omit',
      // text/plain needs no CORS preflight; the API parses it as JSON.
      headers: { 'Content-Type': 'text/plain' },
    }).catch(() => {});
  } catch {
    // Reporting must never raise an error of its own.
  }
};

let active: ((source: ErrorSource, error: unknown) => void) | null = null;
let activeImage: ((image: ImageFailureDetails) => void) | null = null;
let removeListeners: (() => void) | null = null;

/** Reports an error caught by the app. A no-op until reporting is installed. */
export const reportClientError = (source: ErrorSource, error: unknown): void => {
  try {
    active?.(source, error);
  } catch {
    // Reporting must never raise an error of its own.
  }
};

/** Reports a grid image that kept failing. A no-op until reporting is installed. */
export const reportImageFailure = (image: ImageFailureDetails): void => {
  try {
    activeImage?.(image);
  } catch {
    // Reporting must never raise an error of its own.
  }
};

/** Starts reporting uncaught errors and rejections for this page load. */
export const installClientErrorReporting = (endpoint: string, release?: string): void => {
  if (active) return;
  const options: ReporterOptions = {
    send: postTo(endpoint),
    path: () => window.location.pathname,
    userAgent: navigator.userAgent,
    release,
  };
  active = createReporter(options);
  activeImage = createImageReporter(options);
  const onError = (event: ErrorEvent) => reportClientError('error', event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportClientError('unhandledrejection', event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  removeListeners = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
};

/** Test hook: removes the installed reporter and its listeners. */
export const resetClientErrorReporting = (): void => {
  removeListeners?.();
  removeListeners = null;
  active = null;
  activeImage = null;
};
