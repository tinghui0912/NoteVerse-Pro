import { expect, test } from '@playwright/test';

const taskId = 'task-results-layout';
const scoreTitle = 'Layout Test Score';
const musicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part>
</score-partwise>`;

test('shows explicit breadcrumbs, grouped actions, and a real editable share dialog', async ({
  context,
  page,
}) => {
  await context.addCookies([{
    name: 'noteverse_session',
    value: 'results-layout-session',
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }]);

  const taskUpdatePayloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/profile**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: { user: { id: 1, email: 'layout@example.com', display_name: 'Layout', is_active: true } },
    }),
  }));
  await page.route(`**/api/v1/tasks/${taskId}`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.fallback();
      return;
    }

    const payload = route.request().postDataJSON() as Record<string, unknown>;
    taskUpdatePayloads.push(payload);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          task_id: taskId,
          state: 'SUCCESS',
          progress: 100,
          title: typeof payload.title === 'string' ? payload.title : scoreTitle,
          difficulty: typeof payload.difficulty === 'string'
            ? payload.difficulty
            : 'difficultyIntermediate',
          updated_at: '2026-06-21T10:00:00Z',
        },
      }),
    });
  });
  await page.route(`**/api/v1/tasks/${taskId}/details**`, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        task_id: taskId,
        state: 'SUCCESS',
        progress: 100,
        title: scoreTitle,
        difficulty: 'difficultyIntermediate',
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-21T09:30:00Z',
        steps: [],
        files: { final_image: [{ storage_key: 'page-1.svg', filename: 'page-1.svg' }] },
      },
    }),
  }));
  await page.route(`**/api/v1/xml/${taskId}/xml**`, async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { content: musicXml } }),
  }));

  let createPayload: Record<string, unknown> | null = null;
  await page.route('**/api/v1/shares**', async (route) => {
    if (route.request().method() === 'POST') {
      createPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { share_token: 'editable-token', expires_at: null },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { shares: [], total: 0, page: 1, page_size: 20 },
      }),
    });
  });

  await page.goto(`/en/results/${taskId}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: 'Go back' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('History');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).not.toContainText('My Uploads');

  const metadata = page.getByTestId('results-metadata');
  await metadata.getByRole('button', { name: 'Edit' }).click();
  await metadata.getByLabel('Name').fill('Renamed Layout Score');
  await metadata.getByLabel('Name').blur();
  await expect.poll(() => taskUpdatePayloads).toContainEqual({ title: 'Renamed Layout Score' });

  const difficulty = page.getByTestId('results-difficulty');
  await difficulty.getByLabel('Advanced').click();
  await expect.poll(() => taskUpdatePayloads).toContainEqual({ difficulty: 'difficultyAdvanced' });

  const actions = page.getByTestId('results-actions');
  await expect(actions.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Generate Fingering' })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'Practice Mode' })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'Edit' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Create Share' })).toBeVisible();

  await actions.getByRole('button', { name: 'Create Share' }).click();
  await expect(page.getByRole('heading', { name: 'Create Share Link' })).toBeVisible();
  await expect(page.getByText(`Score: ${scoreTitle}`)).toBeVisible();
  await expect(page.getByRole('tab', { name: 'View only' })).toHaveAttribute('data-state', 'active');

  await page.getByRole('tab', { name: 'Can edit' }).click();
  await page.getByRole('button', { name: 'Generate editable link' }).click();
  await expect.poll(() => createPayload).toEqual({
    task_id: taskId,
    can_download: true,
    can_edit: true,
    expires_in_days: null,
  });
  await expect(page.locator('input[readonly][value="http://localhost:9002/en/share/editable-token"]')).toBeVisible();
});
