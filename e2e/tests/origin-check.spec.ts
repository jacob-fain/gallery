import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_STATE, PUBLIC, uniqueSlug } from './support';

test.use({ storageState: ADMIN_STATE });

test('a signed-in write from another origin is refused', async ({ page }) => {
  const body = { title: 'Origin check', slug: uniqueSlug('origin'), is_public: true };

  // The public site, a foreign site, and a request naming no origin at all.
  for (const headers of [{ Origin: PUBLIC }, { Origin: 'https://evil.example' }, {}]) {
    const refused = await page.request.post(`${ADMIN}/api/galleries`, { headers, data: body });
    expect(refused.status(), JSON.stringify(headers)).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'Request origin not allowed' });
  }

  // The same request from the admin origin goes through, so the refusals
  // above came from the Origin check and not from a missing session.
  const allowed = await page.request.post(`${ADMIN}/api/galleries`, { headers: { Origin: ADMIN }, data: body });
  expect(allowed.status()).toBe(201);
});
