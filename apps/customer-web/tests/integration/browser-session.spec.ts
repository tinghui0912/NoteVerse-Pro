import { expect, test } from '@playwright/test';
import type {
  ImportJobRead,
  ImportJobSubmitRead,
  ImportJobSubmitRequest,
  ProfileUserRead,
  UploadAdmissionRead,
  UploadRead,
} from '../../src/generated/api';

if (!process.env.NOTEVERSE_INTEGRATION_PASSWORD)
  throw new Error('Integration password is required');
const integrationUser = {
  email: 'integration@example.com',
  password: process.env.NOTEVERSE_INTEGRATION_PASSWORD!,
};

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/en/auth/login');

  const loginResponse = await page.request.post('/api/v1/auth/login', {
    headers: { origin: new URL(page.url()).origin },
    data: {
      email: integrationUser.email,
      password: integrationUser.password,
    },
  });
  expect(loginResponse.status()).toBe(200);
  const principal: ProfileUserRead = await loginResponse.json();
  expect(principal.email).toBe(integrationUser.email);
  expect(principal.id).toBeGreaterThan(0);
}

test('Same-origin gateway carries auth cookies and requires an explicit origin', async ({
  page,
}) => {
  await login(page);

  const profile = await page.request.get('/api/v1/me/profile');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).user.email).toBe(integrationUser.email);

  const rejectedLogout = await page.request.post('/api/v1/auth/logout');
  expect(rejectedLogout.status()).toBe(403);
  expect((await rejectedLogout.json()).code).toBe('request_origin_invalid');

  const logout = await page.request.post('/api/v1/auth/logout', {
    headers: {
      origin: new URL(page.url()).origin,
    },
  });
  expect(logout.status()).toBe(204);
  expect((await logout.body()).byteLength).toBe(0);
});

test('Same-origin gateway submits and reads an authenticated score import job', async ({
  page,
}) => {
  await login(page);
  const originHeaders = {
    origin: new URL(page.url()).origin,
  };

  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
    'base64',
  );
  const admission = await page.request.post('/api/v1/uploads', {
    headers: originHeaders,
    data: {
      client_request_id: crypto.randomUUID(),
      filename: 'score.png',
      byte_size: bytes.length,
      content_type: 'image/png',
    },
  });
  expect(admission.status()).toBe(200);
  const admissionBody: UploadAdmissionRead = await admission.json();
  const session = admissionBody.upload_session;
  const target = session.upload_target;
  expect(session.mode).toBe('SINGLE_PUT');
  if (!target) throw new Error('Active session requires its signed upload capability');
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const safe = message
      .text()
      .replace(/https?:\/\/[^\s'"]+/g, (value) =>
        value.startsWith('http://localhost:3000') ? 'http://localhost:3000' : '[storage-url]',
      );
    if (/CORS|cross-origin|Access-Control/i.test(safe)) browserErrors.push(safe);
  });
  const put = await page.evaluate(
    async ({ target, content }) => {
      const headers = Object.fromEntries(
        Object.entries(target.headers as Record<string, string>).filter(
          ([name]) => name.toLowerCase() !== 'content-length',
        ),
      );
      try {
        const response = await fetch(target.url, {
          method: 'PUT',
          headers,
          body: new Blob([new Uint8Array(content)], { type: 'image/png' }),
          credentials: 'omit',
        });
        return { status: response.status, etag: response.headers.get('etag'), error: null };
      } catch (error) {
        return {
          status: 0,
          etag: null,
          error: error instanceof Error ? error.name : 'NetworkError',
        };
      }
    },
    { target, content: [...bytes] },
  );
  expect(
    put.status,
    JSON.stringify({
      origin: new URL(page.url()).origin,
      transport: put,
      browserErrors,
    }),
  ).toBe(200);
  expect(put.etag, 'Bucket CORS must expose ETag to the browser').toBeTruthy();
  const complete = await page.request.post(
    `/api/v1/upload-sessions/${session.session_id}/complete`,
    {
      headers: originHeaders,
    },
  );
  expect(complete.status()).toBe(200);
  const upload = await page.request.post(`/api/v1/uploads/${session.session_id}/finalize`, {
    headers: originHeaders,
  });
  expect(upload.status()).toBe(200);
  const uploadBody: UploadRead = await upload.json();

  const requestBody: ImportJobSubmitRequest = {
    upload_ids: [uploadBody.upload_id],
    idempotency_key: 'integration-score-import-001',
    options: {
      display_title: 'Integration score',
      genres: ['soundtrack'],
    },
  };
  const importJob = await page.request.post('/api/v1/import-jobs', {
    headers: originHeaders,
    data: requestBody,
  });
  const importJobBody: ImportJobSubmitRead = await importJob.json();
  expect(importJob.status(), JSON.stringify(importJobBody)).toBe(202);
  expect(importJobBody.state).toBe('QUEUED');

  const job = await page.request.get(`/api/v1/import-jobs/${importJobBody.job_id}`);
  expect(job.status()).toBe(200);
  const jobBody: ImportJobRead = await job.json();
  expect(jobBody.job_id).toBe(importJobBody.job_id);
  expect(jobBody.state).toBe('QUEUED');
  expect(jobBody.display_title).toBe('Integration score');
  expect(jobBody.genres).toEqual(['soundtrack']);
});
