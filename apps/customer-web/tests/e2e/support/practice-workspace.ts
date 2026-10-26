import { expect, type Page } from '@playwright/test';

/** Controlled browser protocol double. Model/ONNX construction itself is tested at the model-session boundary. */
export async function installAcousticEngineFixture(page: Page) {
  await page.addInitScript(() => {
    const nativeWorker = window.Worker;
    const stats = { loads: 0, sessions: 0, inferences: 0, terminations: 0 };
    (window as unknown as { __practiceAcousticEngineFixture: typeof stats }).__practiceAcousticEngineFixture = stats;
    class EngineWorker extends EventTarget {
      private closed = false;
      private token: string | null = null;
      private job = 0;
      constructor(url: string | URL, options?: WorkerOptions) {
        super();
        if (!String(url).includes('acoustic-worker')) return new nativeWorker(url, options) as unknown as EngineWorker;
      }
      postMessage(message: { id: number; type: string; sessionId?: string; input?: { window: { jobIndex: number } } }) {
        queueMicrotask(() => {
          if (this.closed) return;
          let result: unknown, error: string | undefined;
          if (message.type === 'LOAD') { stats.loads++; result = { actualSessionLoadCount: stats.loads, automaticFallback: false }; }
          else if (message.type === 'BEGIN_SESSION' && !this.token && message.sessionId) { this.token = message.sessionId; this.job = 0; stats.sessions++; }
          else if (message.type === 'INFER' && message.sessionId === this.token && message.input?.window.jobIndex === this.job) {
            stats.inferences++; result = { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: ++this.job };
          } else if (message.type === 'END_SESSION' && message.sessionId === this.token) { this.token = null; this.job = 0; }
          else if (message.type === 'DISPOSE') this.token = null;
          else error = 'INVALID_FIXTURE_ENGINE_PROTOCOL';
          this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, result, error } }));
        });
      }
      terminate() { this.closed = true; stats.terminations++; }
    }
    window.Worker = EngineWorker as unknown as typeof Worker;
  });
}

/** Existing runtime scenarios enter through real Setup with explicit MIDI/no-recording intent. */
export async function openPreparedPractice(page: Page, scoreId: string, revisionId: string) {
  await page.goto(`/zh/score/${scoreId}/practice?practiceRevisionId=${encodeURIComponent(revisionId)}`);
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  await page.getByRole('button', { name: '连贯演奏', exact: true }).click();
  await page.getByRole('button', { name: '不录制', exact: true }).click();
  await page.getByRole('button', { name: '逐音练习', exact: true }).click();
  await page.getByRole('button', { name: 'MIDI 键盘', exact: true }).click();
  await page.getByRole('button', { name: '准备练习', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
}

export async function prepareSelectedPractice(page: Page, reopenSettings = false): Promise<'READY' | 'BLOCKED'> {
  const close = page.getByRole('button', { name: /close/i });
  if (await close.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(close).toBeHidden();
  }
  const prepare = page.getByRole('button', { name: '准备练习', exact: true });
  if (await prepare.isVisible()) {
    await prepare.click();
    await expect(page.getByTestId('practice-setup')).toBeVisible();
    await page.getByRole('button', { name: '准备练习', exact: true }).click();
    await expect.poll(async () => !page.url().includes('/setup') || await page.getByTestId('practice-setup').getByRole('alert').count() > 0).toBe(true);
    if (page.url().includes('/setup')) return 'BLOCKED';
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  }
  if (reopenSettings) await page.getByRole('button', { name: '设置', exact: true }).click();
  return 'READY';
}
