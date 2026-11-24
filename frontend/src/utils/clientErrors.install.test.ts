// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installClientErrorReporting, reportClientError, resetClientErrorReporting } from './clientErrors';

type FetchMock = ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

const sentReports = (fetchMock: FetchMock) =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));

describe('installClientErrorReporting', () => {
  afterEach(() => {
    resetClientErrorReporting();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const install = () => {
    const fetchMock: FetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    installClientErrorReporting('/api/client-errors', 'build-1');
    return { fetchMock, sendBeacon };
  };

  it('reports uncaught errors and unhandled rejections without cookies', () => {
    const { fetchMock, sendBeacon } = install();
    window.history.replaceState(null, '', '/gallery/private?access=tok#x');
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught'), message: 'uncaught' }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('rejected') });
    window.dispatchEvent(rejection);

    const reports = sentReports(fetchMock);
    expect(reports.map((r) => [r.source, r.message])).toEqual([
      ['error', 'Error: uncaught'],
      ['unhandledrejection', 'Error: rejected'],
    ]);
    expect(reports[0]).toMatchObject({ url: '/gallery/private', release: 'build-1', userAgent: navigator.userAgent });
    expect(JSON.stringify(reports)).not.toMatch(/tok|access=/);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/api/client-errors');
      expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    }
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('sends nothing before it is installed', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    reportClientError('boundary', new Error('early'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
