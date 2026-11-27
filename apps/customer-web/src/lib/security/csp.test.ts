import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createNonce, customerSecurity, objectStorageOrigins } from './csp';
import { browserPolicy, requiresDocumentNavigation } from './route-policy';
import proxy from '@/proxy';

vi.mock('@/i18n/routing', () => ({ routing: { locales: ['zh', 'en'], defaultLocale: 'en' } }));

vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    default: () => (request: NextRequest) => {
      const headers = new Headers(request.headers);
      headers.set('x-next-intl-locale', 'zh');
      return NextResponse.rewrite(new URL('/zh/auth/login', request.url), { request: { headers } });
    },
  };
});

const origins = objectStorageOrigins('https://objects.test, https://cdn.test/');
const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + ' '))!;
const policy = (path: string) => customerSecurity({ pathname: path, nonce: 'test-nonce', origins });
afterEach(() => vi.unstubAllEnvs());

it('creates independent 128-bit base64 document nonces', () => {
  const nonces = Array.from({ length: 64 }, createNonce);
  expect(new Set(nonces).size).toBe(64);
  nonces.forEach((value) => expect(atob(value).length).toBe(16));
});

it.each([
  ['/en/auth/login', 'auth'],
  ['/zh/auth/reset-password', 'auth'],
  ['/auth/register', 'auth'],
  ['/en/settings/security', 'default'],
  ['/zh/settings/profile', 'default'],
  ['/help', 'default'],
  ['/en/plans', 'default'],
  ['/invite/token', 'default'],
  ['/library', 'library'],
  ['/en/upload', 'upload'],
  ['/zh/score/abc/edit', 'score'],
  ['/score/abc', 'score'],
  ['/en/imports/job/review', 'review'],
  ['/imports/job/review/edit', 'review'],
  ['/en/my-performances', 'media'],
  ['/my-performances/take/score-video', 'score-video'],
  ['/en/preview/tok', 'preview'],
  ['/en/score/abc/practice', 'practice'],
  ['/zh/score/abc/practice/review', 'practice'],
  ['/score/abc/practice/setup', 'practice'],
  ['/score/abc/practices', 'score'],
  ['/unknown', 'default'],
] as const)('classifies %s with precise segment boundaries', (path, expected) => {
  expect(browserPolicy(path)).toBe(expected);
  const { headers } = policy(path),
    csp = headers['Content-Security-Policy'];
  expect(directive(csp, 'script-src')).not.toMatch(/'unsafe-(?:inline|eval)'/);
  for (const name of ['script-src', 'connect-src', 'default-src'])
    expect(directive(csp, name).split(' ')).not.toEqual(
      expect.arrayContaining(['*', 'http:', 'https:']),
    );
  expect(csp).toContain("'nonce-test-nonce'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(headers['Permissions-Policy']).toContain(
    expected === 'practice' ? 'microphone=(self)' : 'microphone=()',
  );
  expect(headers['Permissions-Policy']).toContain(
    expected === 'practice' ? 'camera=(self)' : 'camera=()',
  );
  expect(headers['Permissions-Policy']).toContain(
    expected === 'practice' ? 'midi=(self)' : 'midi=()',
  );
  expect(headers['Referrer-Policy']).toBe(
    expected === 'auth' ? 'no-referrer' : 'strict-origin-when-cross-origin',
  );
});

it.each([
  '/auth/login',
  '/settings/profile',
  '/library',
  '/upload',
  '/my-performances',
  '/preview/tok',
])('keeps unnecessary WASM and workers disabled on %s', (path) => {
  const csp = policy(path).headers['Content-Security-Policy'];
  expect(directive(csp, 'script-src')).not.toContain('wasm-unsafe-eval');
  expect(directive(csp, 'worker-src')).toBe("worker-src 'none'");
});

it('grants precise image, connection, WASM and media authorities', () => {
  expect(
    directive(policy('/settings/profile').headers['Content-Security-Policy'], 'connect-src'),
  ).toBe("connect-src 'self'");
  expect(directive(policy('/library').headers['Content-Security-Policy'], 'media-src')).toContain(
    'https://objects.test',
  );
  expect(directive(policy('/upload').headers['Content-Security-Policy'], 'connect-src')).toBe(
    "connect-src 'self' blob: https://objects.test https://cdn.test",
  );
  expect(
    directive(policy('/score/abc/edit').headers['Content-Security-Policy'], 'script-src'),
  ).toContain("'wasm-unsafe-eval'");
  expect(
    directive(policy('/score/abc/edit').headers['Content-Security-Policy'], 'worker-src'),
  ).toBe("worker-src 'none'");
  expect(
    directive(policy('/score/abc/practice').headers['Content-Security-Policy'], 'worker-src'),
  ).toBe("worker-src 'self' blob:");
});

it.each([
  '*',
  'null',
  'https:',
  'http:',
  'https://*.test',
  'https://objects.test/path',
  'https://user:pass@objects.test',
  'https://objects.test?x=1',
  'https://objects.test#',
  'https://objects.test,',
  'data:abc',
  'https://objects.test;script-src *',
  'https://objects.test;upgrade-insecure-requests',
  "https://objects.test'",
  'https://objects.test%2f',
])('rejects ambiguous storage authority %s', (value) => {
  expect(() => objectStorageOrigins(value)).toThrow();
});

it('normalizes and deduplicates explicit runtime origins', () => {
  expect(objectStorageOrigins('https://objects.test,https://objects.test/')).toEqual([
    'https://objects.test',
  ]);
  expect(objectStorageOrigins(undefined)).toEqual([]);
});

it('composes locale routing with a fresh non-user-controlled nonce', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CSP_OBJECT_STORAGE_ORIGINS', 'https://objects.test');
  const response = proxy(
    new NextRequest('https://app.test/zh/auth/login', {
      headers: {
        'x-nonce': 'injected',
        'Content-Security-Policy': 'default-src *',
        'x-browser-policy': 'practice',
      },
    }),
  );
  const nonce = response.headers.get('x-middleware-request-x-nonce')!;
  expect(atob(nonce).length).toBe(16);
  expect(nonce).not.toBe('injected');
  expect(response.headers.get('x-middleware-request-x-browser-policy')).toBe('auth');
  expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(
    response.headers.get('Content-Security-Policy'),
  );
  expect(response.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`);
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
});

it('secures locale and unauthenticated redirects', () => {
  const response = proxy(new NextRequest('https://app.test/zh/score/abc/practice'));
  expect(response.status).toBe(307);
  expect(response.headers.get('Content-Security-Policy')).toContain("object-src 'none'");
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});

it('document policy changes require full navigation in both directions', () => {
  expect(requiresDocumentNavigation('auth', '/en/score/a/practice')).toBe(true);
  expect(requiresDocumentNavigation('practice', '/en/settings/profile')).toBe(true);
  expect(requiresDocumentNavigation('score', '/zh/score/b/edit')).toBe(false);
  expect(requiresDocumentNavigation('default', '/en/auth/login')).toBe(true);
});

it('only development adds JavaScript eval', () => {
  expect(
    customerSecurity({ pathname: '/auth/login', nonce: 'nonce', origins: [], development: true })
      .headers['Content-Security-Policy'],
  ).toContain("'unsafe-eval'");
});

it('standalone resource responses bound Worker WASM and external connections', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CSP_OBJECT_STORAGE_ORIGINS', 'https://objects.test');
  const response = proxy(
    new NextRequest('https://app.test/_next/static/chunks/worker.js', {
      headers: { 'sec-fetch-dest': 'worker' },
    }),
  );
  const csp = response.headers.get('Content-Security-Policy')!;
  expect(directive(csp, 'default-src')).toBe("default-src 'none'");
  expect(directive(csp, 'script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'");
  expect(directive(csp, 'connect-src')).toBe("connect-src 'self' blob: https://objects.test");
  expect(response.headers.get('x-middleware-request-content-security-policy')).toBeNull();
  expect(response.headers.get('x-middleware-request-x-browser-policy')).toBeNull();
});

it('direct document navigation to an asset path receives the strict document policy', () => {
  const response = proxy(
    new NextRequest('https://app.test/images/missing', {
      headers: { 'sec-fetch-dest': 'document' },
    }),
  );
  const csp = response.headers.get('Content-Security-Policy')!;
  expect(directive(csp, 'script-src')).not.toContain('wasm-unsafe-eval');
  expect(response.headers.get('x-middleware-request-x-browser-policy')).toBe('default');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
