/**
 * Fixes photos uploaded before uploads honored EXIF orientation (#73): their
 * web and thumbnail files are sideways, and their width and height are the
 * stored pixels' rather than the displayed ones.
 *
 * Dry run by default: it lists the photos it would change and writes
 * nothing. With --apply it regenerates each affected photo's web and
 * thumbnail files from the original (same keys) and updates width and
 * height. Originals are never written. Re-running is safe: a fixed photo's
 * recorded size matches its displayed size, so it is skipped.
 *
 * Run inside the backend container, which has the database and S3 settings:
 *   node dist/scripts/orientationBackfill.js            (dry run)
 *   node dist/scripts/orientationBackfill.js --apply
 */
import sharp from 'sharp';

export interface PhotoRow {
  id: string;
  s3_key: string;
  s3_web_key: string;
  s3_thumbnail_key: string;
  width: number;
  height: number;
}

export interface Plan {
  id: string;
  orientation: number;
  from: { width: number; height: number };
  to: { width: number; height: number };
}

/**
 * The fix a photo needs, or null. Only quarter-turn orientations (5 to 8)
 * swap the dimensions and were visibly sideways; 2 to 4 (flips and half
 * turns) are left alone here since they cannot be told apart from the stored
 * size, and phones and cameras do not produce them for normal shots.
 */
export function planFor(
  row: PhotoRow,
  meta: { orientation?: number; width?: number; height?: number }
): Plan | null {
  const orientation = meta.orientation ?? 1;
  if (orientation < 5 || !meta.width || !meta.height) return null;
  const to = { width: meta.height, height: meta.width };
  // Already fixed (or recorded upright some other way).
  if (row.width === to.width && row.height === to.height && to.width !== to.height) return null;
  return { id: row.id, orientation, from: { width: row.width, height: row.height }, to };
}

export interface Deps {
  listPhotos(): Promise<PhotoRow[]>;
  /** The start of the object, enough for the JPEG header in almost all files. */
  readHead(key: string): Promise<Buffer>;
  readAll(key: string): Promise<Buffer>;
  upload(buffer: Buffer, key: string, contentType: string): Promise<void>;
  updateSize(id: string, width: number, height: number): Promise<void>;
  processImage(buffer: Buffer): Promise<{
    web: { buffer: Buffer };
    thumbnail: { buffer: Buffer };
    original: { width: number; height: number };
  }>;
  log(line: string): void;
}

const readMeta = async (deps: Deps, key: string) => {
  try {
    return await sharp(await deps.readHead(key)).metadata();
  } catch {
    // The header did not fit in the first bytes; read the whole file.
    return sharp(await deps.readAll(key)).metadata();
  }
};

export async function run(deps: Deps, apply: boolean) {
  const rows = await deps.listPhotos();
  const plans: Plan[] = [];
  let unreadable = 0;
  for (const row of rows) {
    let plan: Plan | null;
    try {
      plan = planFor(row, await readMeta(deps, row.s3_key));
    } catch (err) {
      unreadable += 1;
      deps.log(`SKIP ${row.id}: original unreadable (${(err as Error).message})`);
      continue;
    }
    if (!plan) continue;
    plans.push(plan);
    deps.log(
      `${apply ? 'FIX ' : 'WOULD FIX'} ${plan.id} orientation ${plan.orientation}: ` +
        `${plan.from.width}x${plan.from.height} -> ${plan.to.width}x${plan.to.height}`
    );
    if (!apply) continue;
    const processed = await deps.processImage(await deps.readAll(row.s3_key));
    await deps.upload(processed.web.buffer, row.s3_web_key, 'image/webp');
    await deps.upload(processed.thumbnail.buffer, row.s3_thumbnail_key, 'image/webp');
    await deps.updateSize(row.id, processed.original.width, processed.original.height);
  }
  deps.log(
    `${rows.length} photos checked, ${plans.length} ${apply ? 'fixed' : 'would be fixed'}, ` +
      `${unreadable} unreadable.${apply ? '' : ' Dry run: nothing was written.'}`
  );
  return { checked: rows.length, plans, unreadable };
}

const HEAD_BYTES = 256 * 1024;

async function main() {
  const apply = process.argv.includes('--apply');
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { s3Client, S3_BUCKET } = await import('../config/s3');
  const { query } = await import('../config/db');
  const s3 = await import('../services/s3Service');
  const { processImage } = await import('../services/imageService');

  const get = async (key: string, range?: string) => {
    const res = await s3Client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key, Range: range }));
    return Buffer.from(await res.Body!.transformToByteArray());
  };

  await run(
    {
      listPhotos: async () =>
        (
          await query(
            'SELECT id, s3_key, s3_web_key, s3_thumbnail_key, width, height FROM photos ORDER BY uploaded_at'
          )
        ).rows,
      readHead: (key) => get(key, `bytes=0-${HEAD_BYTES - 1}`),
      readAll: (key) => get(key),
      upload: s3.uploadFile,
      updateSize: async (id, width, height) => {
        await query('UPDATE photos SET width = $1, height = $2 WHERE id = $3', [width, height, id]);
      },
      processImage,
      log: (line) => console.log(line),
    },
    apply
  );
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
