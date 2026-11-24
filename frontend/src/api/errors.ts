/**
 * A failed API request. serverMessage is the API's own error text, which is
 * written for people; it is null when the response carried none (a proxy
 * error page, a bare status), so visitors are never shown a status line.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly serverMessage: string | null;
  constructor(message: string, status: number, serverMessage: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/**
 * The text to show a visitor for a failed request: the API's own message when
 * it sent one, otherwise the caller's fallback. Network and parse errors
 * ("Failed to fetch", "Unexpected token") never reach the page.
 */
export function visitorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.serverMessage ? err.serverMessage : fallback;
}

/** True when the API answered 404 for the requested resource. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
