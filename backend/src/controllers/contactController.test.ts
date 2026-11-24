import { describe, expect, it } from 'vitest';
import { contactAvailable } from './contactController';

const smtp = { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' };

describe('contactAvailable', () => {
  it('is off unless explicitly enabled', () => {
    expect(contactAvailable({ NODE_ENV: 'production', ...smtp })).toBe(false);
    expect(contactAvailable({ NODE_ENV: 'development' })).toBe(false);
  });

  it('in production, also needs SMTP so messages are never silently dropped', () => {
    expect(contactAvailable({ CONTACT_FORM_ENABLED: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(contactAvailable({ CONTACT_FORM_ENABLED: 'true', NODE_ENV: 'production', ...smtp })).toBe(true);
  });

  it('in development, works without SMTP (messages are logged)', () => {
    expect(contactAvailable({ CONTACT_FORM_ENABLED: 'true', NODE_ENV: 'development' })).toBe(true);
  });
});
