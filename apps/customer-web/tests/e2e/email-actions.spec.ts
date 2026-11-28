import { expect, test } from '@playwright/test';
import { mockAnonymousSession } from './support/api-mocks';

test.beforeEach(async ({page}) => { await mockAnonymousSession(page); });

for (const action of [
  {page: 'verify-email', api: 'email/verify', heading: 'Email Verified'},
  {page: 'confirm-email-change', api: 'email/change/confirm', heading: 'Email Changed'},
]) {
  test(`${action.page} consumes only a fragment and scrubs browser history`, async ({page}) => {
    const token = `${action.page}-credential`;
    const bodies: unknown[] = [];
    const urls: string[] = [];
    page.on('request', request => urls.push(request.url()));
    await page.route(`**/api/v1/auth/${action.api}`, async route => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({json: {email: 'verified@example.com'}});
    });
    await page.goto(`/en/auth/${action.page}?from=mail#token=${token}`);
    await expect(page.getByRole('heading', {name: action.heading, exact: true})).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    expect(new URL(page.url()).search).toBe('?from=mail');
    expect(bodies).toEqual([{token}]);
    expect(urls.every(url => !url.includes(token))).toBe(true);
    await page.goto(`/en/auth/${action.page}?token=query-only`);
    await expect(page.getByText('This ' + (action.page === 'verify-email' ? 'verification' : 'email change') + ' link is invalid or has expired.')).toBeVisible();
    expect(bodies).toHaveLength(1);
  });
}

test('reset uses an in-memory fragment credential and returns to login', async ({page}) => {
  const bodies: unknown[] = [];
  await page.route('**/api/v1/auth/password/reset', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({status: 204});
  });
  await page.goto('/en/auth/reset-password#token=reset-credential');
  await expect(page.getByLabel('New Password', {exact: true})).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await page.getByLabel('New Password', {exact: true}).fill('new-password-123');
  await page.getByLabel('Confirm Password', {exact: true}).fill('new-password-123');
  await page.getByRole('button', {name: 'Reset Password', exact: true}).click();
  await expect(page).toHaveURL(/\/auth\/login\?reset=success$/);
  expect(bodies).toEqual([{token: 'reset-credential', new_password: 'new-password-123', locale: 'en'}]);
});
