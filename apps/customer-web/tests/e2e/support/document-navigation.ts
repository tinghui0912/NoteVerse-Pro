import { expect, type Page } from '@playwright/test';
import { browserPolicy } from '../../../src/lib/security/route-policy';

/** Exercise React route retirement while keeping the document's security policy fixed. */
export async function navigateWithinPolicy(page: Page, destination: string) {
  expect(browserPolicy(new URL(page.url()).pathname)).toBe(browserPolicy(destination));
  await page.evaluate((href) => {
    const next = (window as unknown as { next: { router: { push(href: string): void } } }).next;
    next.router.push(href);
  }, destination);
  await page.waitForURL((url) => url.pathname === destination.replace(/^\/en(?=\/)/, ''));
}
