import { compose, ensureCertificate } from './stack';

export default function globalSetup(): void {
  ensureCertificate();
  compose('up', '--detach', '--build', '--wait', '--wait-timeout', '180');
}
