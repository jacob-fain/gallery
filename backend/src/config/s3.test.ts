import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// s3.ts reads the environment when it loads, so each case loads it afresh.
async function signedUrlFor(env: Record<string, string>): Promise<URL> {
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('AWS_REGION', 'us-east-1');
  vi.stubEnv('AWS_S3_BUCKET', 'bucket');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { s3Client } = await import('./s3');
  const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: 'bucket', Key: 'a/b.jpg' }));
  return new URL(url);
}

describe('s3Client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs for AWS with the bucket as a subdomain when no endpoint is set', async () => {
    const url = await signedUrlFor({ AWS_S3_ENDPOINT: '' });
    expect(url.host).toBe('bucket.s3.us-east-1.amazonaws.com');
    expect(url.pathname).toBe('/a/b.jpg');
  });

  it('signs for AWS_S3_ENDPOINT with the bucket in the path when it is set', async () => {
    const url = await signedUrlFor({ AWS_S3_ENDPOINT: 'https://s3.example.test:9000' });
    expect(url.host).toBe('s3.example.test:9000');
    expect(url.pathname).toBe('/bucket/a/b.jpg');
  });
});
