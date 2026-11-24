import type { ApiResponse } from '../src/types';

/**
 * Reads a fetch response body as the shape the test expects. fetch types
 * json() as unknown; the cast names the contract each assertion relies on,
 * and the assertions are what check it.
 */
export async function readJson<T = ApiResponse<unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
