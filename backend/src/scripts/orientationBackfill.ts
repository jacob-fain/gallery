/**
 * Fixes photos uploaded before uploads honored EXIF orientation (#73): their
 * web and thumbnail files are sideways, upside down or mirrored, and for
 * quarter turns their width and height are the stored pixels' rather than
 * the displayed ones.
 *
 * Every photo uploaded before the cutoff whose original has an orientation
 * other than 1 is regenerated. The cutoff is when the fix reached
 * production: photos uploaded after it are already right. A photo's size
 * cannot tell whether it was fixed (flips and squares keep their size), so
 * the cutoff is what decides, and regenerating twice gives the same files.
 *
 * Dry run by default: it lists the photos it would change and writes
 * nothing. With --apply it regenerates the web and thumbnail files from the
 * original (same keys) and records the displayed width and height.
 * Originals are never written.
 *
 * Run inside the backend container, which has the database and S3 settings:
 *   node dist/scripts/orientationBackfill.js --uploaded-before 2026-11-24T14:00:00Z
 *   node dist/scripts/orientationBackfill.js --uploaded-before 2026-11-24T14:00:00Z --apply
 */
import sharp from 'sharp';

export interface PhotoRow {
  id: string;
  s3_key: string;
  s3_web_key: string;
  s3_thumbnail_key: string;
  width: number;
  height: number;
  uploaded_at: Date;
}

export interface Plan {
  id: string;
  orientation: number;
  from: { width: number; height: number };
  to: { width: number; height: number };
}

/** The fix a photo needs, or null. */
export function planFor(
  row: PhotoRow,
  meta: { orientation?: number; width?: number; height?: number },
  cutoff: Date
): Plan | null {
  const orientation = meta.orientation ?? 1;
  if (orientation < 2 || orientation > 8 || !meta.width || !meta.height) return null;
  if (new Date(row.uploaded_at) >= cutoff) return null;
  const quarterTurn = orientation >= 5;
  const to = quarterTurn
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
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

export async function run(deps: Deps, apply: boolean, cutoff: Date) {
  const rows = await deps.listPhotos();
  const plans: Plan[] = [];
  let unreadable = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.s3_web_key === row.s3_key || row.s3_thumbnail_key === row.s3_key) {
      // Writing a derived file here would overwrite the original.
      failed += 1;
      deps.log(`REFUSE ${row.id}: a derived key equals the original's key`);
      continue;
    }
    let plan: Plan | null;
    try {
      plan = planFor(row, await readMeta(deps, row.s3_key), cutoff);
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
    try {
      const processed = await deps.processImage(await deps.readAll(row.s3_key));
      await deps.upload(processed.web.buffer, row.s3_web_key, 'image/webp');
      await deps.upload(processed.thumbnail.buffer, row.s3_thumbnail_key, 'image/webp');
      // Last, so a photo that failed part way is still planned on a re-run.
      await deps.updateSize(row.id, processed.original.width, processed.original.height);
    } catch (err) {
      failed += 1;
      deps.log(`FAILED ${row.id}: ${(err as Error).message}`);
    }
  }
  deps.log(
    `${rows.length} photos checked, ${plans.length} ${apply ? 'planned' : 'would be fixed'}, ` +
      `${failed} failed, ${unreadable} unreadable.${apply ? '' : ' Dry run: nothing was written.'}`
  );
  return { checked: rows.length, plans, unreadable, failed };
}

const HEAD_BYTES = 256 * 1024;

async function main() {
  const apply = process.argv.includes('--apply');
  const at = process.argv.indexOf('--uploaded-before');
  const cutoff = new Date(at > 0 ? process.argv[at + 1] : NaN);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error('Pass --uploaded-before <ISO time the orientation fix reached production>');
  }
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
            'SELECT id, s3_key, s3_web_key, s3_thumbnail_key, width, height, uploaded_at FROM photos ORDER BY uploaded_at'
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
    apply,
    cutoff
  ).then((result) => {
    if (result.failed > 0) process.exitCode = 1;
  });
}

if (require.main === module) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
