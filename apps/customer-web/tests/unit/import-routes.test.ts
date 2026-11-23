// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import proxy from '@/proxy';
import { AUTH_COOKIE_NAME } from '@/generated/browser-protocol';
import {
  importActivityLocation, importReviewLocation, importReviewEditLocation, importJobDestination,
} from '@/features/imports/routes';
import { importQueryKeys } from '@/features/imports/query-keys';

vi.mock('next-intl/navigation', () => ({ createNavigation: () => ({}) }));
vi.mock('next-intl/middleware', () => ({ default: () => () => new Response(null, { status: 200 }) }));

describe('Import browser namespace', () => {
  it('owns activity, review and temporary editing locations', () => {
    expect(importActivityLocation()).toBe('/upload#import-activity');
    expect(importReviewLocation('job/id')).toBe('/imports/job%2Fid/review');
    expect(importReviewEditLocation('job/id')).toBe('/imports/job%2Fid/review/edit');
    expect(importJobDestination({ job_id: 'job', state: 'READY_FOR_REVIEW' })).toEqual({ kind: 'review', href: '/imports/job/review' });
  });

  it('shares one cache prefix across job lifecycle and review', () => {
    const keys = [importQueryKeys.jobs.all, importQueryKeys.jobs.lists(), importQueryKeys.jobs.list(1, 20), importQueryKeys.jobs.detail('job'), importQueryKeys.review('job')];
    expect(importQueryKeys.all).toEqual(['imports']);
    expect(keys.every((key) => key[0] === importQueryKeys.all[0])).toBe(true);
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length);
  });

  it.each(['/imports/job/review', '/imports/job/review/edit', '/upload'])(
    'requires authentication for %s and preserves the requested location', (path) => {
      const response = proxy(new NextRequest(`http://localhost/zh${path}`));
      const location = new URL(response.headers.get('location')!);
      expect(location.pathname).toBe('/zh/auth/login');
      expect(location.searchParams.get('returnUrl')).toBe(`/zh${path}`);
      expect(proxy(new NextRequest(`http://localhost/zh${path}`, { headers: { cookie: `${AUTH_COOKIE_NAME}=session` } })).status).toBe(200);
    },
  );

  it('keeps Guest Preview outside authenticated Import access', () => {
    expect(proxy(new NextRequest('http://localhost/zh/preview/bearer')).status).toBe(200);
  });
});
