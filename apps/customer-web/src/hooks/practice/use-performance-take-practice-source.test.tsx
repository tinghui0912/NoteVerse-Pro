// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { usePerformanceTakePracticeSource } from './use-performance-take-practice-source';
const api = vi.hoisted(() => ({ source: vi.fn(), savedSource: vi.fn() }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeSource: api.source } }));
vi.mock('@/lib/api/performance-takes', () => ({ performanceTakesApi: { getPracticeSource: api.savedSource } }));
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.savedSource.mockResolvedValue({ data: { source_id: 'source-1', artifact: { ...fixture, scoreId: 'score', revisionId: 'revision' },
    notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } });
});
it('saved take rendering requests one verified source with notation', async () => {
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', { sourceId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.musicXml).toBe('<score />'));
  expect(api.savedSource).toHaveBeenCalledExactlyOnceWith('take', true, expect.any(AbortSignal));
  expect(api.source).not.toHaveBeenCalled();
});
it.each(['scoreId', 'revisionId', 'artifactId'])('rejects saved source %s mismatch', async field => {
  const identity = { sourceId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [field]: 'other' };
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', identity, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull();
});

it('saved Take rejects a different source with identical artifact projections', async () => {
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', { sourceId: 'different', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
});

it.each(['', undefined])('saved Take requires its canonical source identity at runtime: %s', async sourceId => {
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', { sourceId: sourceId as string, scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull();
});

it.each(['scoreId', 'revisionId', 'artifactId'] as const)('saved Take requires its descriptive %s projection at runtime', async key => {
  const identity = { sourceId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [key]: undefined as unknown as string };
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', identity, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull();
});
