import { ZipArchive } from 'archiver';
import { Readable, Writable } from 'stream';

export interface ZipSource {
  key: string;
  name: string;
}

export type ZipResult =
  | { status: 'complete'; entries: number }
  | { status: 'disconnected' }
  | { status: 'failed'; error: Error };

/**
 * Streams the given objects into a ZIP written to `out`, opening one source
 * at a time: the next stream is requested only after the archive has
 * consumed the previous one, so a gallery of any size holds a single S3
 * connection. Entries are stored, not deflated, because JPEGs are already
 * compressed.
 *
 * A source that cannot be opened is skipped. Once any bytes may have been
 * written, a failure destroys `out` rather than ending it, so the client sees
 * a broken download instead of a ZIP that looks complete but is missing
 * photos.
 */
export const writeZip = async (
  sources: ZipSource[],
  out: Writable,
  openStream: (key: string) => Promise<Readable>
): Promise<ZipResult> => {
  const archive = new ZipArchive({ store: true });
  let current: Readable | null = null;
  let stopped: ZipResult | null = null;
  let onStop: () => void = () => {};
  const stoppedSignal = new Promise<void>((resolve) => {
    onStop = resolve;
  });
  let entryDone: (() => void) | null = null;

  const stop = (result: ZipResult) => {
    if (stopped) return;
    stopped = result;
    current?.destroy();
    archive.unpipe(out);
    archive.abort();
    out.destroy();
    entryDone?.();
    onStop();
  };
  const fail = (error: Error) => stop({ status: 'failed', error });

  out.on('close', () => {
    if (!out.writableFinished) stop({ status: 'disconnected' });
  });
  // Writes racing a destroyed socket raise errors here; the close handler
  // already accounts for the disconnect.
  out.on('error', () => {});
  archive.on('error', fail);
  archive.on('warning', (err) => console.warn('ZIP warning:', err));
  archive.on('entry', () => entryDone?.());
  archive.pipe(out);

  let entries = 0;
  for (const source of sources) {
    if (stopped) break;

    let stream: Readable;
    try {
      stream = await openStream(source.key);
    } catch (err) {
      console.error(`Skipping ${source.key} in ZIP:`, err);
      continue;
    }
    if (stopped) {
      stream.destroy();
      break;
    }

    current = stream;
    // archiver does not forward a source's errors; without this a failed S3
    // read would leave the entry, and the response, hanging.
    stream.once('error', fail);
    await new Promise<void>((resolve) => {
      entryDone = resolve;
      archive.append(stream, { name: source.name });
    });
    entryDone = null;
    current = null;
    if (!stopped) entries += 1;
  }

  if (!stopped) {
    const flushed = new Promise<void>((resolve) => out.once('finish', resolve));
    await Promise.race([archive.finalize().then(() => flushed), stoppedSignal]).catch(fail);
  }

  return stopped ?? { status: 'complete', entries };
};
