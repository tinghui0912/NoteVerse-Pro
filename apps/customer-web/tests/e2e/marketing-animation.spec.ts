import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

test('marketing features reveal on viewport entry and remain revealed after scrolling away', async ({ page }) => {
  await page.route('**/api/v1/me/profile**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
  );
  await page.goto('/en', { waitUntil: 'domcontentloaded' });

  const section = page.getByRole('main').locator('section#features');
  const animationState = () => section.evaluate((element) => {
    const style = getComputedStyle(element);
    const matrix = style.transform === 'none'
      ? new DOMMatrixReadOnly()
      : new DOMMatrixReadOnly(style.transform);
    // Motion can express y through either transform or the independent CSS translate property.
    const translateY = style.translate === 'none'
      ? 0
      : Number.parseFloat(style.translate.split(/\s+/)[1] ?? '0');
    return { opacity: Number.parseFloat(style.opacity), y: matrix.m42 + translateY };
  });

  await expect(section).toBeAttached();
  await expect.poll(() => section.evaluate((element) =>
    element.getBoundingClientRect().top >= window.innerHeight
  )).toBe(true);
  await expect.poll(async () => (await animationState()).opacity).toBeLessThan(0.01);
  await expect.poll(async () => Math.abs((await animationState()).y - 50)).toBeLessThan(1);

  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeInViewport({ ratio: 0.2 });
  await expect.poll(async () => (await animationState()).opacity).toBeGreaterThan(0.99);
  await expect.poll(async () => Math.abs((await animationState()).y)).toBeLessThan(1);
  await expect(section.getByRole('heading', { level: 2 })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(section).not.toBeInViewport();
  // Let real intersection callbacks and the following rendering frames run after scrolling.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(section).toHaveCSS('opacity', '1');
  await expect.poll(async () => Math.abs((await animationState()).y)).toBeLessThan(1);
  await expect(section).toBeAttached();
});
