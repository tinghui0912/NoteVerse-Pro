import { expect, test } from '@playwright/test';

const profileResponse = {
  success: true,
  code: 'profile_retrieved',
  message: 'Profile retrieved',
  data: {
    user: {
      id: 1,
      email: 'smoke@example.com',
      username: 'smoke-user',
      is_active: true,
      avatar_url: null,
    },
  },
};

const shareResponse = {
  success: true,
  code: 'share_retrieved',
  message: 'Share retrieved',
  data: {
    task: {
      task_id: 'task-smoke',
      state: 'SUCCESS',
      progress: 100,
      title: 'Smoke Test Score',
      difficulty: '',
      files: {},
    },
    share_info: {
      shared_by: 'Smoke User',
      expires_at: null,
      can_download: false,
      can_edit: false,
    },
  },
};

test('disables downloads when the share contract denies permission', async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: 'noteverse_session',
      value: 'smoke-session',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await page.route('**/api/v1/profile**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profileResponse),
    });
  });

  await page.route('**/api/v1/shares/smoke-share', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(shareResponse),
    });
  });

  await page.route('**/api/v1/shares/smoke-share/download/final_xml', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      body: '<?xml version="1.0"?><score-partwise version="4.0" />',
    });
  });

  await page.goto('/en/share/smoke-share', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Smoke Test Score')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download Image' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download MusicXML' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
});

test('shows the editor entry only when the share contract allows editing', async ({ context, page }) => {
  await context.addCookies([{ name: 'noteverse_session', value: 'smoke-session', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.route('**/api/v1/profile**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profileResponse) }));
  await page.route('**/api/v1/shares/editable-share', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...shareResponse,
      data: { ...shareResponse.data, share_info: { ...shareResponse.data.share_info, can_edit: true } },
    }),
  }));
  await page.route('**/api/v1/shares/editable-share/download/final_xml', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/xml',
    body: '<?xml version="1.0"?><score-partwise version="4.0" />',
  }));

  await page.goto('/en/share/editable-share', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute(
    'href',
    '/en/editor/task-smoke?source=final&shareToken=editable-share&returnUrl=%2Fen%2Fshare%2Feditable-share'
  );
});
