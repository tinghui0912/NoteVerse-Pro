/** Real Chromium requests to a live signed target. No provider response is mocked. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const target = JSON.parse(readFileSync(0, 'utf8'));
const requireCustomer = createRequire(new URL('../../../apps/customer-web/package.json', import.meta.url));
const { chromium } = requireCustomer('@playwright/test');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // Supply only the app-origin empty document; do not intercept the provider.
  await page.route(`${target.origin}/__asset_qualification`, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Provider qualification</title>',
  }));
  await page.goto(`${target.origin}/__asset_qualification`);
  const result = await page.evaluate(async ({ url }) => {
    try {
      const response = await fetch(url, {
        method: 'PUT', credentials: 'omit',
        headers: { 'content-type': 'application/octet-stream' },
        body: new TextEncoder().encode('actual-browser-part'),
      });
      return { status: response.ok && response.headers.get('etag') ? 'PASS' : 'BLOCKED',
        http_status: response.status, etag_visible: Boolean(response.headers.get('etag')) };
    } catch (error) {
      return { status: 'BLOCKED', error_class: error.name };
    }
  }, target);
  console.log(JSON.stringify({ browser: 'Chromium', origin: target.origin,
    real_signed_part_request: true, app_document: 'local route fixture only', ...result }));
} catch (error) {
  console.log(JSON.stringify({ status: 'BLOCKED', error_class: error.name }));
} finally {
  await browser?.close();
}
