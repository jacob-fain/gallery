import { describe, expect, it } from 'vitest';
import { PassThrough, Readable, Writable } from 'stream';
import { writeZip } from './zipStream';

const CHUNK = Buffer.alloc(64 * 1024, 7);

// A source that yields `chunks` chunks over several ticks and records how
// many sources are open at once.
const tracker = () => {
  let open = 0;
  let maxOpen = 0;
  const opened: string[] = [];
  const destroyed: string[] = [];
  const openStream = async (key: string, chunks = 8): Promise<Readable> => {
    opened.push(key);
    open += 1;
    maxOpen = Math.max(maxOpen, open);
    let sent = 0;
    const stream = new Readable({
      read() {
        setImmediate(() => {
          if (sent++ < chunks) this.push(CHUNK);
          else this.push(null);
        });
      },
    });
    stream.on('close', () => {
      open -= 1;
    });
    stream.on('end', () => stream.destroy());
    const origDestroy = stream.destroy.bind(stream);
    stream.destroy = (err?: Error) => {
      if (!stream.readableEnded) destroyed.push(key);
      return origDestroy(err);
    };
    return stream;
  };
  return { openStream, opened, destroyed, maxOpen: () => maxOpen };
};

const collect = () => {
  const chunks: Buffer[] = [];
  const out = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  return { out, bytes: () => Buffer.concat(chunks) };
};

// Local file header names in archive order (signature PK\x03\x04).
const entryNames = (zip: Buffer): string[] => {
  const names: string[] = [];
  let i = zip.indexOf('PK\x03\x04');
  while (i !== -1) {
    const method = zip.readUInt16LE(i + 8);
    const nameLen = zip.readUInt16LE(i + 26);
    expect(method).toBe(0);
    names.push(zip.subarray(i + 30, i + 30 + nameLen).toString('utf8'));
    i = zip.indexOf('PK\x03\x04', i + 30 + nameLen);
  }
  return names;
};

describe('writeZip', () => {
  it('opens one source at a time and stores every entry uncompressed', async () => {
    const t = tracker();
    const { out, bytes } = collect();
    const sources = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, name: `${k}.jpg` }));

    const result = await writeZip(sources, out, (key) => t.openStream(key));

    expect(result).toEqual({ status: 'complete', entries: 4 });
    expect(t.maxOpen()).toBe(1);
    const zip = bytes();
    expect(entryNames(zip)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    // Stored entries are at least as large as their data.
    expect(zip.length).toBeGreaterThan(4 * 8 * CHUNK.length);
  });

  it('skips a source that cannot be opened', async () => {
    const t = tracker();
    const { out, bytes } = collect();
    const sources = ['a', 'missing', 'c'].map((k) => ({ key: k, name: `${k}.jpg` }));

    const result = await writeZip(sources, out, async (key) => {
      if (key === 'missing') throw new Error('NoSuchKey');
      return t.openStream(key);
    });

    expect(result).toEqual({ status: 'complete', entries: 2 });
    expect(entryNames(bytes())).toEqual(['a.jpg', 'c.jpg']);
  });

  it('destroys the output when a source fails mid-read', async () => {
    const { out } = collect();
    let calls = 0;
    const result = await writeZip(
      [
        { key: 'a', name: 'a.jpg' },
        { key: 'b', name: 'b.jpg' },
      ],
      out,
      async () => {
        calls += 1;
        let sent = 0;
        return new Readable({
          read() {
            setImmediate(() => {
              if (sent++ < 2) this.push(CHUNK);
              else this.destroy(new Error('socket reset'));
            });
          },
        });
      }
    );

    expect(result.status).toBe('failed');
    expect(calls).toBe(1);
    expect(out.destroyed).toBe(true);
    expect(out.writableFinished).toBe(false);
  });

  it('stops reading and opens nothing more when the client disconnects', async () => {
    const t = tracker();
    const out = new PassThrough();
    let received = 0;
    out.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > CHUNK.length * 3) out.destroy();
    });
    const sources = ['a', 'b', 'c'].map((k) => ({ key: k, name: `${k}.jpg` }));

    const result = await writeZip(sources, out, (key) => t.openStream(key, 1000));

    expect(result).toEqual({ status: 'disconnected' });
    expect(t.opened).toEqual(['a']);
    expect(t.destroyed).toEqual(['a']);
  });
});
