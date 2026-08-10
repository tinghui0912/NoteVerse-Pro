import { expect, test } from '@playwright/test';

const integrationUser = {
  email: 'integration@example.com',
  password: 'IntegrationPass123!',
};

function currentCsrfToken(page: import('@playwright/test').Page): Promise<string> {
  return page.context().cookies().then((cookies) => {
    const csrfCookie = cookies.find((cookie) => cookie.name === 'noteverse_csrf');
    expect(csrfCookie).toBeDefined();
    return csrfCookie!.value;
  });
}

async function login(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/en/auth/login');

  const loginResponse = await page.request.post('/api/v1/auth/login', {
    form: {
      username: integrationUser.email,
      password: integrationUser.password,
    },
  });
  expect(loginResponse.status()).toBe(200);
  expect((await loginResponse.json()).success).toBe(true);

  return currentCsrfToken(page);
}

test('Next proxy carries real auth cookies and enforces CSRF', async ({ page }) => {
  const csrfToken = await login(page);

  const profile = await page.request.get('/api/v1/me/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).data.user.email).toBe(integrationUser.email);

  const rejectedLogout = await page.request.post('/api/v1/auth/logout');
  expect(rejectedLogout.status()).toBe(403);
  expect((await rejectedLogout.json()).public_code).toBe('csrf_token_invalid');

  const logout = await page.request.post('/api/v1/auth/logout', {
    headers: {
      'x-csrf-token': csrfToken,
      origin: new URL(page.url()).origin,
    },
  });
  expect(logout.status()).toBe(200);
  expect((await logout.json()).success).toBe(true);
});

test('Next proxy submits and reads an authenticated score import job', async ({ page }) => {
  const csrfToken = await login(page);
  const csrfHeaders = {
    'x-csrf-token': csrfToken,
    origin: new URL(page.url()).origin,
  };

  const upload = await page.request.post('/api/v1/files/upload', {
    headers: csrfHeaders,
    multipart: {
      file: {
        name: 'score.png',
        mimeType: 'image/png',
        buffer: Buffer.from('not-a-real-image'),
      },
    },
  });
  expect(upload.status()).toBe(200);
  const uploadBody = await upload.json();
  expect(uploadBody.success).toBe(true);

  const importJob = await page.request.post('/api/v1/import-jobs', {
    headers: csrfHeaders,
    data: {
      file_ids: [uploadBody.data.file_id],
      idempotency_key: 'integration-score-import-001',
      options: {
        title: 'Integration score',
        taxonomy_tags: [{ category: 'genre', code: 'soundtrack' }],
      },
    },
  });
  const importJobBody = await importJob.json();
  expect(importJob.status(), JSON.stringify(importJobBody)).toBe(202);
  expect(importJobBody.data.state).toBe('PENDING');

  const job = await page.request.get(`/api/v1/import-jobs/${importJobBody.data.job_id}`);
  expect(job.status()).toBe(200);
  const jobBody = await job.json();
  expect(jobBody.data.job_id).toBe(importJobBody.data.job_id);
  expect(jobBody.data.state).toBe('PENDING');
  expect(jobBody.data.title).toBe('Integration score');
  expect(jobBody.data.taxonomy_tags).toEqual([{ category: 'genre', code: 'soundtrack' }]);
});
