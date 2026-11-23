import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { AUTH_COOKIE_NAME } from '@/generated/browser-protocol';
import proxy from '@/proxy';
import { scoreLocation, scoreEditLocation } from '@/features/scores/routes';
import { guestPreviewLocation } from '@/features/scores/guest-preview/routes';
import { practiceLocation } from '@/lib/practice/configuration/practice-location';
vi.mock('next-intl/navigation', () => ({createNavigation: () => ({})}));
vi.mock('next-intl/middleware', () => ({default: () => () => new Response(null, {status: 200})}));
it('builds encoded Score detail and editor locations', () => {
  expect(scoreLocation('score/id')).toBe('/score/score%2Fid');
  expect(scoreEditLocation('score/id')).toBe('/score/score%2Fid/edit');
});
it('pins Practice navigation to the requested revision', () => {
  expect(practiceLocation('score/id', 'setup', 'revision/id')).toBe('/score/score%2Fid/practice/setup?practiceRevisionId=revision%2Fid');
  expect(practiceLocation('score', 'practice')).toBe('/score/score/practice');
});
it('builds localized Guest Preview destinations', () => {
  expect(guestPreviewLocation('bearer/id', 'en')).toBe('/preview/bearer%2Fid');
  expect(guestPreviewLocation('bearer/id', 'zh')).toBe('/zh/preview/bearer%2Fid');
});
it.each(['/score/score', '/score/score/edit', '/score/score/practice'])('gates %s and preserves its local return intent', (path) => {
  const response = proxy(new NextRequest(`https://customer.test/zh${path}`));
  const login = new URL(response.headers.get('location')!);
  expect(login.pathname).toBe('/zh/auth/login');
  expect(login.searchParams.get('returnUrl')).toBe(`/zh${path}`);
  expect(proxy(new NextRequest(`https://customer.test/zh${path}`, {headers: {cookie: `${AUTH_COOKIE_NAME}=session`}})).status).toBe(200);
});
it.each(['/preview/token', '/invite/token'])('allows the anonymous access entry %s', path => {
  expect(proxy(new NextRequest(`https://customer.test/en${path}`)).status).toBe(200);
});
