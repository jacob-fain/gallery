import { S3Client } from '@aws-sdk/client-s3';

// Validate required environment variables
const requiredEnvVars = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'AWS_S3_BUCKET',
] as const;

// Check for missing env vars, but don't throw during import
// (allows app to start for non-S3 operations during development)
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingVars.length > 0) {
  console.warn(
    `Warning: Missing AWS environment variables: ${missingVars.join(', ')}. ` +
    'S3 operations will fail until these are configured.'
  );
}

// Create S3 client
// Will fail on actual operations if credentials are missing
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

// Export bucket name for use in services
export const S3_BUCKET = process.env.AWS_S3_BUCKET || '';

// Helper to check if S3 is configured
export const isS3Configured = (): boolean => {
  return missingVars.length === 0;
};
