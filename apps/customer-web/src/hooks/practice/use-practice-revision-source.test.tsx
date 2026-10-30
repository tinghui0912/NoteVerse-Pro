// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import * as artifactContract from '@/lib/practice/kernel/artifact';
import { usePracticeRevisionSource, usePracticeSnapshotSource } from './use-practice-revision-source';
const api = vi.hoisted(() => ({ source: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeSource: (...args: unknown[]) => api.source(...args) } }));
vi.mock('@/lib/api/performance-takes', () => ({ performanceTakesApi: { getPracticeSource: (...args: unknown[]) => api.snapshot(...args) } }));
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
function envelope(loadNotation: boolean) {
  return { data: { source_id: 'source-1', artifact: { ...fixture, scoreId: 'score', revisionId: 'revision' },
    notation: loadNotation ? { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } : null } };
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  api.source.mockImplementation(async (_score, _revision, loadNotation) => envelope(loadNotation));
  api.snapshot.mockImplementation(async (_take, loadNotation) => envelope(loadNotation));
});
it('Setup requests one artifact-only source and receives no notation', async () => {
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: false }), { wrapper: harness() });
  await waitFor(() => expect(result.current.artifact).not.toBeNull());
  expect(api.source).toHaveBeenCalledExactlyOnceWith('score', 'revision', false, expect.any(AbortSignal));
  expect(result.current.sourceId).toBe('source-1'); expect(result.current.musicXml).toBeNull();
  expect(result.current.sourceQuery.data?.musicXml).toBeNull();
});
it.each(['Practice', 'Review'])('%s consumes one parsed source envelope with notation', async () => {
  const parse = vi.spyOn(artifactContract, 'parsePracticeScoreArtifact');
  const { result, rerender } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.musicXml).toBe('<score />'));
  expect(api.source).toHaveBeenCalledExactlyOnceWith('score', 'revision', true, expect.any(AbortSignal));
  expect(result.current.artifact?.moments).toHaveLength(5);
  expect(parse).toHaveBeenCalledOnce(); rerender(); expect(parse).toHaveBeenCalledOnce();
});
it('withholds source until the single request completes', async () => {
  let resolve!: (value: unknown) => void;
  api.source.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: true }), { wrapper: harness() });
  expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull();
  resolve(envelope(true)); await waitFor(() => expect(result.current.artifact).not.toBeNull());
});
it.each(['scoreId', 'revisionId'])('rejects mismatched live artifact %s', async field => {
  const response = envelope(true); response.data.artifact = { ...response.data.artifact, [field]: 'other' };
  api.source.mockResolvedValue(response);
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull(); expect(result.current.sourceId).toBeNull();
});
it('rejects malformed canonical ownership through the runtime parser', async () => {
  api.source.mockResolvedValue({ data: { ...envelope(false).data, artifact: { ...fixture, notes: [] } } });
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: false }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true)); expect(result.current.artifact).toBeNull();
});
it.each([undefined, '', 1])('requires a primitive nonempty source id: %s', async sourceId => {
  api.source.mockResolvedValue({ data: { ...envelope(false).data, source_id: sourceId } });
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: false }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true)); expect(result.current.artifact).toBeNull();
});
it.each([null, { musicxml: 123 }, { musicxml: '<score />', mime_type: 'text/plain' }])('rejects missing or malformed requested notation: %j', async notation => {
  api.source.mockResolvedValue({ data: { ...envelope(true).data, notation } });
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true)); expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull();
});
it('requires notation=null for an artifact-only request', async () => {
  api.source.mockResolvedValue(envelope(true));
  const { result } = renderHook(() => usePracticeRevisionSource('score', 'revision', { loadNotation: false }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
});
it('uses the notation option in source cache identity', async () => {
  const wrapper = harness();
  const { result, rerender } = renderHook(({ loadNotation }) => usePracticeRevisionSource('score', 'revision', { loadNotation }), { wrapper, initialProps: { loadNotation: false } });
  await waitFor(() => expect(result.current.artifact).not.toBeNull());
  rerender({ loadNotation: true });
  expect(result.current.artifact).toBeNull();
  await waitFor(() => expect(result.current.musicXml).toBe('<score />'));
  expect(api.source).toHaveBeenCalledTimes(2);
});
it('does not request a source without a pinned revision', () => {
  renderHook(() => usePracticeRevisionSource('score', null, { loadNotation: true }), { wrapper: harness() });
  expect(api.source).not.toHaveBeenCalled();
});
it('saved take rendering requests one verified source with notation', async () => {
  const { result } = renderHook(() => usePracticeSnapshotSource('take', { scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.musicXml).toBe('<score />'));
  expect(api.snapshot).toHaveBeenCalledExactlyOnceWith('take', true, expect.any(AbortSignal));
  expect(api.source).not.toHaveBeenCalled();
});
it.each(['scoreId', 'revisionId', 'artifactId'])('rejects saved source %s mismatch', async field => {
  const identity = { scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [field]: 'other' };
  const { result } = renderHook(() => usePracticeSnapshotSource('take', identity, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull();
});

it('Source failures carry a closed invalid/load distinction and original transport cause', async () => {
  const cause=Object.assign(new Error('private transport URL'),{code:'practice_source_failed',status:503}); api.source.mockRejectedValue(cause);
  const {result}=renderHook(()=>usePracticeRevisionSource('score','revision',{loadNotation:false}),{wrapper:harness()});
  await waitFor(()=>expect(result.current.isError).toBe(true));
  expect(result.current.error).toMatchObject({kind:'SOURCE',code:'LOAD_FAILED',cause});
  expect(result.current.transportError).toBe(cause); expect(result.current.invalid).toBe(false);
});
