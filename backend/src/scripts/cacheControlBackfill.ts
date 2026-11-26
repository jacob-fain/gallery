/**
 * Gives photo files uploaded before uploads set Cache-Control the same header
 * (OBJECT_CACHE_CONTROL in services/s3Service.ts). Without it browsers fall
 * back to a heuristic lifetime from Last-Modified, which for a file uploaded
 * an hour ago is a few minutes.
 *
 * S3 cannot change an object's headers in place, so each object without the
 * header is copied onto itself with it, keeping its content type, other
 * headers, user metadata and storage class. The bytes do not change. On a versioned bucket
 * every copy adds a version.
 *
 * Dry run by default: it lists what it would change and writes nothing. With
 * --apply it copies. Run inside the backend container, which has the S3
 * settings:
 *   node dist/scripts/cacheControlBackfill.js
 *   node dist/scripts/cacheControlBackfill.js --apply
 */
import type { StorageClass } from '@aws-sdk/client-s3';
import { OBJECT_CACHE_CONTROL } from '../services/s3Service';

const PREFIX = 'galleries/';
// CopyObject copies at most 5 GB in one request.
const MAX_COPY_BYTES = 5 * 1024 ** 3;

export interface ObjectHead {
  cacheControl?: string;
  contentType?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  metadata?: Record<string, string>;
  // Absent for STANDARD. A copy is STANDARD unless told otherwise.
  storageClass?: string;
  size: number;
}

export interface Deps {
  /** Every key under the prefix, page by page. */
  listKeys(prefix: string): AsyncIterable<string>;
  head(key: string): Promise<ObjectHead>;
  /** Copies the object onto itself with `head`'s headers and the new Cache-Control. */
  copyWithCacheControl(key: string, head: ObjectHead, cacheControl: string): Promise<void>;
  log(line: string): void;
}

export async function run(deps: Deps, apply: boolean) {
  let checked = 0;
  let changed = 0;
  let failed = 0;
  for await (const key of deps.listKeys(PREFIX)) {
    checked += 1;
    try {
      const head = await deps.head(key);
      if (head.cacheControl === OBJECT_CACHE_CONTROL) continue;
      if (head.size > MAX_COPY_BYTES) {
        failed += 1;
        deps.log(`SKIP ${key}: larger than one copy request allows`);
        continue;
      }
      changed += 1;
      deps.log(`${apply ? 'SET' : 'WOULD SET'} ${key} (was ${head.cacheControl ?? 'unset'})`);
      if (apply) await deps.copyWithCacheControl(key, head, OBJECT_CACHE_CONTROL);
    } catch (err) {
      failed += 1;
      deps.log(`FAILED ${key}: ${(err as Error).message}`);
    }
  }
  deps.log(
    `${checked} objects checked, ${changed} ${apply ? 'updated' : 'would be updated'}, ${failed} failed.` +
      (apply ? '' : ' Dry run: nothing was written.')
  );
  return { checked, changed, failed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const { s3Client, S3_BUCKET } = await import('../config/s3');

  const result = await run(
    {
      async *listKeys(prefix) {
        let token: string | undefined;
        do {
          const page = await s3Client.send(
            new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token })
          );
          for (const object of page.Contents ?? []) if (object.Key) yield object.Key;
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
      },
      async head(key) {
        const res = await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return {
          cacheControl: res.CacheControl,
          contentType: res.ContentType,
          contentDisposition: res.ContentDisposition,
          contentEncoding: res.ContentEncoding,
          contentLanguage: res.ContentLanguage,
          metadata: res.Metadata,
          storageClass: res.StorageClass,
          size: res.ContentLength ?? 0,
        };
      },
      async copyWithCacheControl(key, head, cacheControl) {
        await s3Client.send(
          new CopyObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            CopySource: `${S3_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`,
            // REPLACE drops every header not given here, so all are restated.
            MetadataDirective: 'REPLACE',
            CacheControl: cacheControl,
            ContentType: head.contentType,
            ContentDisposition: head.contentDisposition,
            ContentEncoding: head.contentEncoding,
            ContentLanguage: head.contentLanguage,
            Metadata: head.metadata,
            StorageClass: head.storageClass as StorageClass | undefined,
          })
        );
      },
      log: (line) => console.log(line),
    },
    apply
  );
  if (result.failed > 0) process.exitCode = 1;
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
