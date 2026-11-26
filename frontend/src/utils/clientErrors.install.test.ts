// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installClientErrorReporting, reportClientError, reportImageFailure, resetClientErrorReporting } from './clientErrors';

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
    window.history.replaceState(null, '', '/gallery/private?access=SECRET-ACCESS-TOKEN#x');
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
    expect(JSON.stringify(reports)).not.toMatch(/SECRET-ACCESS-TOKEN|access=/);
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
    reportImageFailure({ photoId: '00000000-0000-4000-8000-000000000001', kind: 'web', failure: 'error', attempts: 3 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts image failure reports to the same endpoint', () => {
    const { fetchMock } = install();
    reportImageFailure({ photoId: '00000000-0000-4000-8000-000000000001', kind: 'thumb', failure: 'timeout', attempts: 3 });
    const [report] = sentReports(fetchMock);
    expect(report).toMatchObject({
      source: 'image',
      release: 'build-1',
      image: { photoId: '00000000-0000-4000-8000-000000000001', kind: 'thumb', failure: 'timeout', attempts: 3 },
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/client-errors');
  });
});
