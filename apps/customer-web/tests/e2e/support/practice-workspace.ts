import { expect, type Page } from '@playwright/test';

/** Controlled browser protocol double. Model/ONNX construction itself is tested at the model-session boundary. */
export async function installAcousticEngineFixture(page: Page) {
  await page.addInitScript(() => {
    const nativeWorker = window.Worker;
    const stats = { loads: 0, sessions: 0, inferences: 0, terminations: 0, pitches: [] as string[], fail: () => {} };
    (window as unknown as { __practiceAcousticEngineFixture: typeof stats }).__practiceAcousticEngineFixture = stats;
    class EngineWorker extends EventTarget {
      private closed = false;
      private token: string | null = null;
      private job = 0;
      constructor(url: string | URL, options?: WorkerOptions) {
        super();
        if (!String(url).includes('acoustic-worker')) return new nativeWorker(url, options) as unknown as EngineWorker;
        stats.fail = () => this.dispatchEvent(new ErrorEvent('error', { message: 'ACOUSTIC_WORKER_CRASH' }));
      }
      postMessage(message: { id: number; type: string; sessionId?: string; input?: { window: { jobIndex: number; ownedStartTarget: number } } }) {
        queueMicrotask(() => {
          if (this.closed) return;
          let result: unknown, error: string | undefined;
          if (message.type === 'LOAD') { stats.loads++; result = { actualSessionLoadCount: stats.loads, automaticFallback: false }; }
          else if (message.type === 'BEGIN_SESSION' && !this.token && message.sessionId) { this.token = message.sessionId; this.job = 0; stats.sessions++; }
          else if (message.type === 'INFER' && message.sessionId === this.token && message.input?.window.jobIndex === this.job) {
            stats.inferences++; result = { events: stats.pitches.map(pitch => ({ pitch, midiPitch: pitch === 'D4' ? 62 : 60,
              targetSample: Math.ceil(message.input!.window.ownedStartTarget) + 8000, confidence: .8, onsetScore: .8, frameScore: .8 })),
              inferenceMs: 0, decodeMs: 0, actualSessionRunCount: ++this.job };
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

/** Enter the workspace through the real Setup admission boundary. */
export async function openPreparedPractice(page: Page, scoreId: string, revisionId: string) {
  await page.goto(`/zh/score/${scoreId}/practice?practiceRevisionId=${encodeURIComponent(revisionId)}`);
  await page.waitForURL(/\/practice\/setup\?/);
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  await selectPracticeConfiguration(page, 'STEP', 'MIDI', 'OFF');
  expect(await preparePracticeSetup(page)).toBe('READY');
}

export async function openPracticeSetup(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '更改练习配置', exact: true }).click();
  await page.waitForURL(/\/practice\/setup\?/);
  await expect(page.getByTestId('practice-setup')).toBeVisible();
}

export async function selectPracticeConfiguration(page: Page, mode: 'STEP' | 'CONTINUOUS', input: 'MIDI' | 'MICROPHONE', recording: 'OFF' | 'AUDIO' | 'VIDEO') {
  const setup = page.getByTestId('practice-setup');
  // Recording intent is explicit even when the selected mode does not use it.
  await setup.getByRole('button', { name: '连贯演奏', exact: true }).click();
  await setup.getByRole('button', { name: { OFF: '不录制', AUDIO: '录音', VIDEO: '录像' }[recording], exact: true }).click();
  await setup.getByRole('button', { name: mode === 'STEP' ? '逐音练习' : '连贯演奏', exact: true }).click();
  await setup.getByRole('button', { name: input === 'MIDI' ? 'MIDI 键盘' : '麦克风', exact: true }).click();
  await expect(setup.getByRole('switch')).toHaveCount(0);
}

export async function configurePractice(page: Page, mode: 'STEP' | 'CONTINUOUS' = 'CONTINUOUS', input: 'MIDI' | 'MICROPHONE' = 'MIDI', recording: 'OFF' | 'AUDIO' | 'VIDEO' = 'OFF') {
  await openPracticeSetup(page); await selectPracticeConfiguration(page, mode, input, recording);
  return preparePracticeSetup(page);
}

export async function preparePracticeSetup(page: Page): Promise<'READY' | 'BLOCKED'> {
  await page.getByTestId('practice-setup').getByRole('button', { name: /^(准备练习|进入练习)$/ }).click();
  await expect.poll(async () => !page.url().includes('/setup') || await page.getByTestId('practice-setup').getByRole('alert').count() > 0).toBe(true);
  if (page.url().includes('/setup')) return 'BLOCKED';
  await expect(page.getByRole('button', { name: '结束', exact: true })).toBeVisible();
  return 'READY';
}
