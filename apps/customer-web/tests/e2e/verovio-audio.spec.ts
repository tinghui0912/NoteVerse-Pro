import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

test('local piano soundfont unlocks, decodes, schedules, and closes in Chromium', async ({
  page,
}) => {
  await page.goto('/en/login');
  await page.addScriptTag({
    path: resolve(process.cwd(), 'node_modules/soundfont-player/dist/soundfont-player.min.js'),
  });

  await page.evaluate(() => {
    const soundfont = (window as unknown as {
      Soundfont: {
        instrument: (
          context: AudioContext,
          name: string,
          options: Record<string, unknown>
        ) => Promise<{
          play: (note: string, time: number, options: { duration: number }) => void;
          stop: () => void;
        }>;
      };
    }).Soundfont;
    const audioWindow = window as typeof window & { __audioSmokeResult?: string };
    const button = document.createElement('button');
    button.textContent = 'Run audio smoke';
    button.addEventListener('click', async () => {
      const context = new AudioContext();
      try {
        await context.resume();
        const instrument = await soundfont.instrument(
          context,
          'acoustic_grand_piano',
          {
            soundfont: 'MusyngKite',
            format: 'mp3',
            nameToUrl: () => '/soundfonts/MusyngKite/acoustic_grand_piano-mp3.js',
          }
        );
        instrument.play('C4', context.currentTime, { duration: 0.05 });
        instrument.stop();
        await context.close();
        audioWindow.__audioSmokeResult = context.state;
      } catch (error) {
        audioWindow.__audioSmokeResult = error instanceof Error ? error.message : String(error);
        if (context.state !== 'closed') {
          await context.close();
        }
      }
    });
    document.body.append(button);
  });

  await page.getByRole('button', { name: 'Run audio smoke' }).click({ force: true });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __audioSmokeResult?: string }).__audioSmokeResult))
    .toBe('closed');
});
