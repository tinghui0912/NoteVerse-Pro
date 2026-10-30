// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { usePracticeSource } from './use-practice-source';
const fake = vi.hoisted(() => ({ replace: vi.fn(), query: '', api: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: fake.replace }),
  usePathname: () => '/score/score/practice/setup', useSearchParams: () => new URLSearchParams(fake.query) }));
vi.mock('@/hooks/queries/use-score-queries', () => ({ useScoreDetail: () => ({ data: { data: { head_revision_id: 'head', capabilities: { can_practice: true } } } }) }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeScoreArtifact: (...args: unknown[]) => fake.api(...args) } }));
beforeEach(() => { fake.query = ''; fake.replace.mockReset(); fake.api.mockReset().mockImplementation(async (scoreId, revisionId) => ({ data: { source_id: 'source-1', artifact: { ...fixture, scoreId, revisionId } } })); });
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function SourceHarness({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
it('resolves and pins once through the shared source boundary, reusing the immutable query cache after navigation', async () => {
  const wrapper = harness(); const first = renderHook(() => usePracticeSource('score'), { wrapper });
  await waitFor(() => expect(fake.replace).toHaveBeenCalled());
  expect(first.result.current.artifact).toBeNull(); expect(fake.api).not.toHaveBeenCalled();
  fake.query = 'practiceRevisionId=head'; first.rerender();
  await waitFor(() => expect(first.result.current.artifact).not.toBeNull());
  expect(fake.replace).toHaveBeenCalledWith('/score/score/practice/setup?practiceRevisionId=head', { scroll: false });
  expect(fake.api.mock.calls[0].slice(0, 2)).toEqual(['score', 'head']);
  first.unmount(); fake.query = 'practiceRevisionId=head';
  const practice = renderHook(() => usePracticeSource('score'), { wrapper });
  expect(practice.result.current.artifact).not.toBeNull(); expect(fake.api).toHaveBeenCalledOnce();
});
it('honors an exact pinned revision independently of mode, source or scope', async () => {
  fake.query = 'practiceRevisionId=pinned'; const { result } = renderHook(() => usePracticeSource('score'), { wrapper: harness() });
  await waitFor(() => expect(result.current.artifact).not.toBeNull());
  expect(result.current.revisionId).toBe('pinned'); expect(fake.replace).not.toHaveBeenCalled();
  expect(fake.api.mock.calls[0].slice(0, 2)).toEqual(['score', 'pinned']);
});
it.each(['practice_score_invalid', 'practice_source_failed'])('keeps deterministic invalidity distinct from infrastructure: %s', async code => {
  fake.query = 'practiceRevisionId=head';
  fake.api.mockRejectedValue(Object.assign(new Error(code), { code }));
  const { result } = renderHook(() => usePracticeSource('score'), { wrapper: harness() });
  await waitFor(() => expect(result.current.artifactQuery.isError).toBe(true));
  expect(result.current.invalid).toBe(code === 'practice_score_invalid'); expect(result.current.artifact).toBeNull();
});
