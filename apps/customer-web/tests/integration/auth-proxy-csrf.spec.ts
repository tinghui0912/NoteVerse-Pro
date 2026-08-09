import { expect, test } from '@playwright/test';

const integrationUser = {
  email: 'integration@example.com',
  password: 'IntegrationPass123!',
};

test('Next proxy carries real auth cookies and enforces CSRF', async ({ page }) => {
  await page.goto('/en/auth/login');

  const login = await page.request.post('/api/v1/auth/login', {
    form: {
      username: integrationUser.email,
      password: integrationUser.password,
    },
  });
  expect(login.status()).toBe(200);
  expect((await login.json()).success).toBe(true);

  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find((cookie) => cookie.name === 'noteverse_csrf');
  expect(csrfCookie).toBeDefined();

  const profile = await page.request.get('/api/v1/me/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).data.user.email).toBe(integrationUser.email);

  const rejectedLogout = await page.request.post('/api/v1/auth/logout');
  expect(rejectedLogout.status()).toBe(403);
  expect((await rejectedLogout.json()).public_code).toBe('csrf_token_invalid');

  const logout = await page.request.post('/api/v1/auth/logout', {
    headers: {
      'x-csrf-token': csrfCookie!.value,
      origin: new URL(page.url()).origin,
    },
  });
  expect(logout.status()).toBe(200);
  expect((await logout.json()).success).toBe(true);
});
