// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePracticeRouteScore } from './use-practice-route-score';
const fake = vi.hoisted(() => ({ replace: vi.fn(), query: '', api: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: fake.replace }),
  usePathname: () => '/score/score/practice/setup', useSearchParams: () => new URLSearchParams(fake.query) }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScoreDetail: () => ({ data: { data: { head_revision_id: 'head', capabilities: { can_practice: true } } } }) }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeSource: fake.api } }));
beforeEach(() => { fake.query = ''; fake.replace.mockReset(); fake.api.mockReset(); });
it('pins metadata head identity without admitting a source', async () => {
  const { result } = renderHook(() => usePracticeRouteScore('score'));
  await waitFor(() => expect(fake.replace).toHaveBeenCalledWith('/score/score/practice/setup?practiceRevisionId=head', { scroll: false }));
  expect(result.current.revisionId).toBe('head'); expect(result.current.pinned).toBe(false);
  expect(fake.api).not.toHaveBeenCalled();
});
it('preserves an exact pinned revision without fetching any Practice representation', () => {
  fake.query = 'practiceRevisionId=pinned';
  const { result } = renderHook(() => usePracticeRouteScore('score'));
  expect(result.current.revisionId).toBe('pinned'); expect(result.current.pinned).toBe(true);
  expect(fake.replace).not.toHaveBeenCalled(); expect(fake.api).not.toHaveBeenCalled();
});
