import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REPORTS_PER_PAGE,
  beaconTo,
  createReporter,
  pathOf,
  stripUrlQueries,
  type ClientErrorReport,
} from './clientErrors';

const setup = (path = '/gallery/wedding', max?: number) => {
  const sent: ClientErrorReport[] = [];
  const report = createReporter({
    send: (r) => sent.push(r),
    path: () => path,
    userAgent: 'Mozilla/5.0 test',
    release: 'abc123',
    max,
  });
  return { sent, report };
};

describe('createReporter', () => {
  it('sends message, stack, path, release and user agent', () => {
    const { sent, report } = setup();
    const error = new TypeError('x is undefined');
    report('error', error);
    expect(sent).toEqual([
      {
        source: 'error',
        message: 'TypeError: x is undefined',
        stack: error.stack,
        url: '/gallery/wedding',
        release: 'abc123',
        userAgent: 'Mozilla/5.0 test',
      },
    ]);
  });

  it('sends the same error once, whichever handler reports it', () => {
    const { sent, report } = setup();
    const error = new Error('chunk failed');
    report('chunk', error);
    report('boundary', error);
    report('error', error);
    expect(sent).toHaveLength(1);
    expect(sent[0].source).toBe('chunk');
  });

  it(`stops after ${MAX_REPORTS_PER_PAGE} reports per page load`, () => {
    const { sent, report } = setup();
    for (let i = 0; i < 20; i++) report('error', new Error(`error ${i}`));
    expect(sent).toHaveLength(MAX_REPORTS_PER_PAGE);
  });

  it('does not count duplicates against the cap', () => {
    const { sent, report } = setup('/', 2);
    const error = new Error('same');
    report('error', error);
    report('error', error);
    report('error', new Error('other'));
    expect(sent.map((r) => r.message)).toEqual(['Error: same', 'Error: other']);
  });

  it('sends the path without its query string or hash', () => {
    const { sent, report } = setup('/gallery/private?access=secret-token#photo-3');
    report('error', new Error('boom'));
    expect(sent[0].url).toBe('/gallery/private');
    expect(JSON.stringify(sent[0])).not.toMatch(/secret-token|access=|photo-3/);
  });

  it('cuts query strings from URLs in the message and stack', () => {
    const { sent, report } = setup();
    const error = new Error('Failed to load https://bucket.example.com/p.jpg?X-Amz-Signature=sig1');
    error.stack = 'Error\n    at load (/gallery/x?access=tok2:1:2)\n    at https://example.com/a.js?v=3#h:4:5';
    report('error', error);
    const text = JSON.stringify(sent[0]);
    expect(text).not.toMatch(/sig1|tok2|X-Amz|access=|v=3/);
    expect(sent[0].message).toBe('Error: Failed to load https://bucket.example.com/p.jpg');
  });

  it('truncates a long message and stack', () => {
    const { sent, report } = setup();
    const error = new Error('m'.repeat(5000));
    error.stack = 's'.repeat(10_000);
    report('error', error);
    expect(sent[0].message.length).toBe(500);
    expect(sent[0].stack?.length).toBe(4000);
  });

  it('describes rejections that are not errors', () => {
    const { sent, report } = setup();
    report('unhandledrejection', 'plain string');
    report('unhandledrejection', { code: 42 });
    expect(sent.map((r) => r.message)).toEqual(['plain string', '{"code":42}']);
    expect(sent[0]).not.toHaveProperty('stack');
  });

  it('ignores browser noise', () => {
    const { sent, report } = setup();
    report('error', 'ResizeObserver loop completed with undelivered notifications.');
    report('error', 'Script error.');
    expect(sent).toHaveLength(0);
  });
});

describe('stripUrlQueries and pathOf', () => {
  it('leave text without query strings alone', () => {
    expect(stripUrlQueries('at Gallery (https://example.com/assets/G-1.js:10:5)')).toBe(
      'at Gallery (https://example.com/assets/G-1.js:10:5)'
    );
    expect(stripUrlQueries('Is this right? Yes')).toBe('Is this right? Yes');
  });

  it('cut the query and hash', () => {
    expect(stripUrlQueries('GET /api/galleries/x?access=t failed')).toBe('GET /api/galleries/x failed');
    expect(pathOf('/a/b?c=d#e')).toBe('/a/b');
    expect(pathOf('/a/b#e?c')).toBe('/a/b');
  });
});

describe('beaconTo', () => {
  afterEach(() => vi.unstubAllGlobals());

  const report: ClientErrorReport = { source: 'error', message: 'Error: x', url: '/', userAgent: 'ua' };

  it('sends a text/plain beacon', async () => {
    const sendBeacon = vi.fn(() => true);
    const fetchMock = vi.fn();
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('fetch', fetchMock);
    beaconTo('/api/client-errors')(report);
    expect(sendBeacon).toHaveBeenCalledOnce();
    const [endpoint, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(endpoint).toBe('/api/client-errors');
    expect(blob.type).toBe('text/plain');
    expect(JSON.parse(await blob.text())).toEqual(report);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a keepalive fetch without credentials', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('navigator', { sendBeacon: () => false });
    vi.stubGlobal('fetch', fetchMock);
    beaconTo('/api/client-errors')(report);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/client-errors',
      expect.objectContaining({ method: 'POST', keepalive: true, credentials: 'omit', body: JSON.stringify(report) })
    );
  });

  it('never throws, even when both transports do', () => {
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('fetch', () => {
      throw new Error('blocked');
    });
    expect(() => beaconTo('/api/client-errors')(report)).not.toThrow();
  });
});
