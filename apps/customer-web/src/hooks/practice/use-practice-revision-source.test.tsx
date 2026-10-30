// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { usePracticeRevisionSource, usePracticeSnapshotSource } from './use-practice-revision-source';
const api = vi.hoisted(() => ({ artifact: vi.fn(), content: vi.fn(), snapshotArtifact: vi.fn(), snapshotContent: vi.fn() }));
vi.mock('@/lib/api', () => ({ practiceApi: {
  getPracticeScoreArtifact: (...args: unknown[]) => api.artifact(...args),
  getPracticeReadyScoreContent: (...args: unknown[]) => api.content(...args),
} }));
vi.mock('@/lib/api/performance-takes', () => ({ performanceTakesApi: {
  getPracticeSourceArtifact: (...args: unknown[]) => api.snapshotArtifact(...args),
  getPracticeSourceContent: (...args: unknown[]) => api.snapshotContent(...args),
} }));
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.artifact.mockResolvedValue({ data: { source_id: 'source-1', artifact: { ...fixture, scoreId: 'score', revisionId: 'revision' } } });
  api.content.mockResolvedValue({ data: { source_id: 'source-1', score_id: 'score', revision_id: 'revision', content: '<score />' } });
  api.snapshotArtifact.mockImplementation(api.artifact.getMockImplementation()!);
  api.snapshotContent.mockImplementation(api.content.getMockImplementation()!);
});
it('loads artifact alone for Setup and validates the runtime contract', async () => {
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadContent: false }), { wrapper: harness() });
  await waitFor(() => expect(result.current.artifact).not.toBeNull());
  expect(result.current.sourceId).toBe('source-1');
  expect(result.current.artifact?.moments).toHaveLength(5);
  expect(api.content).not.toHaveBeenCalled();
  expect(result.current.content).toBeNull();
});
it('returns coherent artifact and content for Practice and Review', async () => {
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadContent: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.content).toBe('<score />'));
  expect(result.current.artifact?.scoreId).toBe('score');
  expect(result.current.sourceId).toBe('source-1');
});
it('withholds source until requested content is available', async () => {
  let resolve!: (value: unknown) => void;
  api.content.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadContent: true }), { wrapper: harness() });
  await waitFor(() => expect(api.artifact).toHaveBeenCalled());
  expect(result.current.artifact).toBeNull();
  resolve({ data: { source_id: 'source-1', score_id: 'score', revision_id: 'revision', content: '<score />' } });
  await waitFor(() => expect(result.current.artifact).not.toBeNull());
});
it('fails closed when source identities differ', async () => {
  api.content.mockResolvedValue({ data: { source_id: 'other', score_id: 'score', revision_id: 'revision', content: '<score />' } });
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadContent: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.artifact).toBeNull(); expect(result.current.content).toBeNull(); expect(result.current.sourceId).toBeNull();
});
it.each(['scoreId', 'revisionId'])('rejects mismatched artifact %s', async field => {
  api.artifact.mockResolvedValue({ data: { source_id: 'source-1', artifact: { ...fixture, scoreId: 'score', revisionId: 'revision', [field]: 'other' } } });
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadContent: false }), { wrapper: harness() });
  await waitFor(() => expect(result.current.isError).toBe(true)); expect(result.current.artifact).toBeNull();
});
it.each(['score_id', 'revision_id'])('rejects mismatched content %s', async field => {
  api.content.mockResolvedValue({ data: { source_id: 'source-1', score_id: 'score', revision_id: 'revision', [field]: 'other', content: '<score />' } });
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadContent: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.isError).toBe(true)); expect(result.current.artifact).toBeNull(); expect(result.current.content).toBeNull();
});
it('does not request representations without a pinned revision', () => {
  renderHook(() => usePracticeRevisionSource('score', null, { loadContent: true }), { wrapper: harness() });
  expect(api.artifact).not.toHaveBeenCalled(); expect(api.content).not.toHaveBeenCalled();
});
it('validates saved source against take identity and the common source id', async () => {
  const { result } = renderHook(() => usePracticeSnapshotSource('take', { scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, true), { wrapper: harness() });
  await waitFor(() => expect(result.current.content).toBe('<score />'));
  expect(api.snapshotArtifact).toHaveBeenCalledWith('take', expect.any(AbortSignal));
  expect(api.artifact).not.toHaveBeenCalled();
});
it('rejects a saved artifact not belonging to the take', async () => {
  const { result } = renderHook(() => usePracticeSnapshotSource('take', { scoreId: 'score', revisionId: 'revision', artifactId: 'other' }, true), { wrapper: harness() });
  await waitFor(() => expect(result.current.isError).toBe(true)); expect(result.current.artifact).toBeNull();
});

it('rejects mismatched representations for saved takes before exposing either', async () => {
  api.snapshotContent.mockResolvedValue({ data: { source_id: 'other', score_id: 'score', revision_id: 'revision', content: '<score />' } });
  const { result } = renderHook(() => usePracticeSnapshotSource('take', { scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, true), { wrapper: harness() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.artifact).toBeNull(); expect(result.current.content).toBeNull();
});
it.each([undefined, '', 1])('requires a primitive nonempty source id: %s', async sourceId => {
  api.artifact.mockResolvedValue({ data: { source_id: sourceId, artifact: { ...fixture, scoreId: 'score', revisionId: 'revision' } } });
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadContent: false }), { wrapper: harness() });
  await waitFor(() => expect(result.current.isError).toBe(true)); expect(result.current.artifact).toBeNull();
});
