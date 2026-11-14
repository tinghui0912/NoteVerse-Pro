import type { Page } from '@playwright/test';

export const preview = {
  title: 'Guest Score',
  shared_by: 'Owner',
  render_assets: [{ asset_id: 'page-a', page_number: 1 }],
  audio_available: true,
};

export async function mockGuestPreview(page: Page, token: string) {
  await page.route(`**/api/v1/guest-previews/${token}`, (route) =>
    route.fulfill({ json: preview })
  );
  await page.route(`**/api/v1/guest-previews/${token}/render-assets/page-a/view`, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><text x="20" y="40">Score page A</text></svg>',
    })
  );
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(16000, 40);
  await page.route(`**/api/v1/guest-previews/${token}/playback`, (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wav })
  );
}
