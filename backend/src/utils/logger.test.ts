import { describe, expect, it } from 'vitest';
import { createLogger, pathOnly, redactFields, redactString, requestContext, serializeError } from './logger';

const capture = (level = 'debug') => {
  const lines: { level: string; entry: Record<string, unknown> }[] = [];
  const logger = createLogger({
    level: () => level,
    write: (lvl, line) => lines.push({ level: lvl, entry: JSON.parse(line) }),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
  });
  return { logger, lines };
};

describe('redaction', () => {
  it('drops the query string of a presigned URL', () => {
    const url =
      'https://bucket.s3.us-east-1.amazonaws.com/web/a.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA123&X-Amz-Signature=abc';
    expect(redactString(`fetch failed for ${url} now`)).toBe(
      'fetch failed for https://bucket.s3.us-east-1.amazonaws.com/web/a.webp?[redacted] now'
    );
  });

  it('drops an ?access token from a path', () => {
    expect(redactString('GET /api/galleries/smith/photos?access=eyJabc.def.ghi&page=2')).toBe(
      'GET /api/galleries/smith/photos?[redacted]'
    );
  });

  it('removes JWTs and connection string passwords wherever they appear', () => {
    expect(redactString('token eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl rejected')).toBe('token [redacted] rejected');
    expect(redactString('connect postgresql://gallery:hunter2@db:5432/gallery failed')).toBe(
      'connect postgresql://[redacted]@db:5432/gallery failed'
    );
  });

  it('replaces secret-named fields at any depth', () => {
    expect(
      redactFields({
        headers: { Authorization: 'Bearer x', cookie: 'admin_session=y', 'content-type': 'json' },
        password: 'p',
        jwtSecret: 's',
        accessToken: 't',
        list: [{ apiKey: 'k', ok: 1 }],
      })
    ).toEqual({
      headers: { Authorization: '[redacted]', cookie: '[redacted]', 'content-type': 'json' },
      password: '[redacted]',
      jwtSecret: '[redacted]',
      accessToken: '[redacted]',
      list: [{ apiKey: '[redacted]', ok: 1 }],
    });
  });

  it('keeps only the name, message, code and stack of an error', () => {
    const err = Object.assign(new Error('bad https://x.test/a?sig=1'), {
      code: '23505',
      parameters: ['secret value'],
      $response: { headers: { authorization: 'x' } },
    });
    const out = serializeError(err);
    expect(Object.keys(out).sort()).toEqual(['code', 'message', 'name', 'stack']);
    expect(out.message).toBe('bad https://x.test/a?[redacted]');
    expect(out.stack).not.toContain('sig=1');
  });

  it('pathOnly cuts the query and fragment', () => {
    expect(pathOnly('/api/photos/1/download?access=abc')).toBe('/api/photos/1/download');
    expect(pathOnly('/a#b')).toBe('/a');
    expect(pathOnly('/plain')).toBe('/plain');
  });
});

describe('createLogger', () => {
  it('writes one JSON line with time, level, message and fields', () => {
    const { logger, lines } = capture();
    logger.info('hello', { n: 1 });
    expect(lines).toEqual([
      { level: 'info', entry: { time: '2026-01-02T03:04:05.000Z', level: 'info', msg: 'hello', n: 1 } },
    ]);
  });

  it('logs an error with its stack and redacted fields', () => {
    const { logger, lines } = capture();
    logger.error('failed', { err: new Error('boom'), cookie: 'admin_session=abc' });
    const entry = lines[0].entry as { err: { stack: string; message: string }; cookie: string };
    expect(entry.err.message).toBe('boom');
    expect(entry.err.stack).toContain('Error: boom');
    expect(entry.cookie).toBe('[redacted]');
  });

  it('drops lines below the level and logs nothing when silent', () => {
    const warnOnly = capture('warn');
    warnOnly.logger.info('no');
    warnOnly.logger.warn('yes');
    expect(warnOnly.lines.map((l) => l.entry.msg)).toEqual(['yes']);
    const silent = capture('silent');
    silent.logger.error('no');
    expect(silent.lines).toEqual([]);
  });

  it('defaults to info for an unknown level', () => {
    const { logger, lines } = capture('loud');
    logger.debug('no');
    logger.info('yes');
    expect(lines.map((l) => l.entry.msg)).toEqual(['yes']);
  });

  it('adds the request id of the request being handled', () => {
    const { logger, lines } = capture();
    requestContext.run({ requestId: 'req-1' }, () => logger.warn('inside'));
    logger.warn('outside');
    expect(lines[0].entry.requestId).toBe('req-1');
    expect(lines[1].entry).not.toHaveProperty('requestId');
  });

  it('writes dates as ISO strings', () => {
    const { logger, lines } = capture();
    logger.info('at', { when: new Date('2026-01-01T00:00:00.000Z') });
    expect(lines[0].entry.when).toBe('2026-01-01T00:00:00.000Z');
  });

  it('survives fields that cannot be serialized', () => {
    const { logger, lines } = capture();
    logger.info('big', { n: BigInt(1) });
    expect(lines[0].entry).toMatchObject({ msg: 'big', note: 'fields not serializable' });
  });
});
