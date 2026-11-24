// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installClientErrorReporting, reportClientError, resetClientErrorReporting } from './clientErrors';

// jsdom's Blob has no text(), so it is read the older way.
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

const sentReports = (sendBeacon: ReturnType<typeof vi.fn>) =>
  Promise.all(sendBeacon.mock.calls.map(async ([, blob]) => JSON.parse(await readBlob(blob as Blob))));

describe('installClientErrorReporting', () => {
  afterEach(() => {
    resetClientErrorReporting();
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  const install = () => {
    const sendBeacon = vi.fn<(url: string, body?: BodyInit | null) => boolean>(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    installClientErrorReporting('/api/client-errors', 'build-1');
    return sendBeacon;
  };

  it('reports uncaught errors and unhandled rejections', async () => {
    const sendBeacon = install();
    window.history.replaceState(null, '', '/gallery/private?access=tok#x');
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught'), message: 'uncaught' }));
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejection, 'reason', { value: new Error('rejected') });
    window.dispatchEvent(rejection);

    const reports = await sentReports(sendBeacon);
    expect(reports.map((r) => [r.source, r.message])).toEqual([
      ['error', 'Error: uncaught'],
      ['unhandledrejection', 'Error: rejected'],
    ]);
    expect(reports[0]).toMatchObject({ url: '/gallery/private', release: 'build-1', userAgent: navigator.userAgent });
    expect(JSON.stringify(reports)).not.toMatch(/tok|access=/);
  });

  it('sends nothing before it is installed', () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });
    reportClientError('boundary', new Error('early'));
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
