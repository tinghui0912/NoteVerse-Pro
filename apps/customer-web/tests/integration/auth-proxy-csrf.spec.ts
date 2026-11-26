import { expect, test } from '@playwright/test';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../../src/generated/browser-protocol';

const integrationUser = {
  email: 'integration@example.com',
  password: 'IntegrationPass123!',
};

function currentCsrfToken(page: import('@playwright/test').Page): Promise<string> {
  return page.context().cookies().then((cookies) => {
    const csrfCookie = cookies.find((cookie) => cookie.name === CSRF_COOKIE_NAME);
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
  expect(loginResponse.status()).toBe(204);
  expect((await loginResponse.body()).byteLength).toBe(0);

  return currentCsrfToken(page);
}

test('Next proxy carries real auth cookies and enforces CSRF', async ({ page }) => {
  const csrfToken = await login(page);

  const profile = await page.request.get('/api/v1/me/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).user.email).toBe(integrationUser.email);

  const rejectedLogout = await page.request.post('/api/v1/auth/logout');
  expect(rejectedLogout.status()).toBe(403);
  expect((await rejectedLogout.json()).code).toBe('csrf_token_invalid');

  const logout = await page.request.post('/api/v1/auth/logout', {
    headers: {
      [CSRF_HEADER_NAME]: csrfToken,
      origin: new URL(page.url()).origin,
    },
  });
  expect(logout.status()).toBe(204);
  expect((await logout.body()).byteLength).toBe(0);
});

test('Next proxy submits and reads an authenticated score import job', async ({ page }) => {
  const csrfToken = await login(page);
  const csrfHeaders = {
    [CSRF_HEADER_NAME]: csrfToken,
    origin: new URL(page.url()).origin,
  };

  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC','base64');
  const admission=await page.request.post('/api/v1/uploads',{headers:csrfHeaders,data:{client_request_id:crypto.randomUUID(),filename:'score.png',byte_size:bytes.length,content_type:'image/png'}});
  expect(admission.status()).toBe(200);
  const {upload_session:session}=await admission.json();
  const put=await page.request.put(session.upload_target.url,{headers:session.upload_target.headers,data:bytes});
  expect(put.ok()).toBe(true);
  const complete=await page.request.post(`/api/v1/upload-sessions/${session.session_id}/complete`,{headers:csrfHeaders});
  expect(complete.status()).toBe(200);
  const upload=await page.request.post(`/api/v1/uploads/${session.session_id}/finalize`,{headers:csrfHeaders});
  expect(upload.status()).toBe(200);
  const uploadBody=await upload.json();

  const importJob = await page.request.post('/api/v1/import-jobs', {
    headers: csrfHeaders,
    data: {
      upload_ids: [uploadBody.upload_id],
      idempotency_key: 'integration-score-import-001',
      options: {
        title: 'Integration score',
        genres: ['soundtrack'],
      },
    },
  });
  const importJobBody = await importJob.json();
  expect(importJob.status(), JSON.stringify(importJobBody)).toBe(202);
  expect(importJobBody.state).toBe('PENDING');

  const job = await page.request.get(`/api/v1/import-jobs/${importJobBody.job_id}`);
  expect(job.status()).toBe(200);
  const jobBody = await job.json();
  expect(jobBody.job_id).toBe(importJobBody.job_id);
  expect(jobBody.state).toBe('PENDING');
  expect(jobBody.title).toBe('Integration score');
  expect(jobBody.genres).toEqual(['soundtrack']);
});

