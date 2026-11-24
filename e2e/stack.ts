import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;

// A project of its own, never "gallery": that name is the dev and production
// stacks', and compose would attach to their volumes.
export const project = process.env.E2E_PROJECT ?? 'gallery-e2e';

export function compose(...args: string[]): void {
  execFileSync('docker', ['compose', '-p', project, '-f', path.join(dir, 'compose.yml'), ...args], {
    cwd: dir,
    stdio: 'inherit',
  });
}

/** A self-signed certificate for every host the stack serves, made once. */
export function ensureCertificate(): void {
  const certs = path.join(dir, '.certs');
  if (existsSync(path.join(certs, 'cert.pem'))) return;
  mkdirSync(certs, { recursive: true });
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
    '-subj', '/CN=gallery e2e',
    '-addext', 'subjectAltName=DNS:gallery.localhost,DNS:manage.gallery.localhost,DNS:s3.e2e.amazonaws.com',
    // The backend trusts this certificate as its own root (NODE_EXTRA_CA_CERTS).
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-keyout', path.join(certs, 'key.pem'),
    '-out', path.join(certs, 'cert.pem'),
  ], { stdio: 'ignore' });
}
