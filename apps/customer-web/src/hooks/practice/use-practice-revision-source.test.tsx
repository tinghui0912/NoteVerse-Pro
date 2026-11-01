// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import * as artifactContract from '@/lib/practice/kernel/artifact';
import { usePracticeSourceById, usePracticeRevisionSource, usePerformanceTakePracticeSource } from './use-practice-revision-source';
const api = vi.hoisted(() => ({ exact: vi.fn(), source: vi.fn(), savedSource: vi.fn() }));
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeSourceById: (...args: unknown[]) => api.exact(...args), getPracticeSource: (...args: unknown[]) => api.source(...args) } }));
vi.mock('@/lib/api/performance-takes', () => ({ performanceTakesApi: { getPracticeSource: (...args: unknown[]) => api.savedSource(...args) } }));
function harness(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
function envelope(loadNotation: boolean) {
  return { data: { source_id: 'source-1', artifact: { ...fixture, scoreId: 'score', revisionId: 'revision' },
    notation: loadNotation ? { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } : null } };
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.resetAllMocks();
  api.exact.mockImplementation(async (_sourceId, loadNotation) => envelope(loadNotation));
  api.source.mockImplementation(async (_score, _revision, loadNotation) => envelope(loadNotation));
  api.savedSource.mockImplementation(async (_take, loadNotation) => envelope(loadNotation));
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
  api.exact.mockImplementation(async (_sourceId, loadNotation) => envelope(loadNotation));
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
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', { sourceId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.musicXml).toBe('<score />'));
  expect(api.savedSource).toHaveBeenCalledExactlyOnceWith('take', true, expect.any(AbortSignal));
  expect(api.source).not.toHaveBeenCalled();
});
it.each(['scoreId', 'revisionId', 'artifactId'])('rejects saved source %s mismatch', async field => {
  const identity = { sourceId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [field]: 'other' };
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', identity, { loadNotation: true }), { wrapper: harness() });
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

it('Review loads the requested exact source through one query and parser', async () => {
  const parser = vi.spyOn(artifactContract, 'parsePracticeScoreArtifact');
  const identity = { scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId };
  const { result } = renderHook(() => usePracticeSourceById('source-1', identity, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.sourceId).toBe('source-1'));
  expect(api.exact).toHaveBeenCalledExactlyOnceWith('source-1', true, expect.any(AbortSignal));
  expect(api.source).not.toHaveBeenCalled();
  expect(parser).toHaveBeenCalledOnce();
});
it.each(['sourceId', 'scoreId', 'revisionId', 'artifactId'] as const)('exact source fails closed on %s mismatch', async key => {
  const identity = { sourceId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [key]: 'different' };
  const { result } = renderHook(() => usePracticeSourceById(identity.sourceId, identity, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull();
});
it('saved Take rejects a different source with identical artifact projections', async () => {
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', { sourceId: 'different', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
});

it.each(['', undefined])('saved Take requires its canonical source identity at runtime: %s', async sourceId => {
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', { sourceId: sourceId as string, scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull();
});

it.each(['scoreId', 'revisionId', 'artifactId'] as const)('saved Take requires its descriptive %s projection at runtime', async key => {
  const identity = { sourceId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [key]: undefined as unknown as string };
  const { result } = renderHook(() => usePerformanceTakePracticeSource('take', identity, { loadNotation: true }), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull();
});

it('explicit fresh admission cancels an in-flight query and never reuses cached success',async()=>{
  let resolve!:(value:ReturnType<typeof envelope>)=>void;
  api.source.mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValueOnce({data:{...envelope(false).data,source_id:'source-B'}});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const {result}=renderHook(()=>usePracticeRevisionSource('score','revision',{loadNotation:false,enabled:false}),{wrapper:harness(client)});
  const firstCommand=new AbortController();
  const first=result.current.loadFresh(firstCommand.signal).catch(error=>error);
  await waitFor(()=>expect(api.source).toHaveBeenCalledOnce());const firstSignal=api.source.mock.calls[0][3] as AbortSignal;
  firstCommand.abort();
  expect(firstSignal.aborted).toBe(true); // Caller abort reaches transport before any new query cancellation.
  await act(async()=>{const next=await result.current.loadFresh(new AbortController().signal);expect(next.sourceId).toBe('source-B');});
  const secondSignal=api.source.mock.calls[1][3] as AbortSignal;
  expect(secondSignal).not.toBe(firstSignal);expect(secondSignal.aborted).toBe(false);
  expect(firstSignal.aborted).toBe(true);expect(api.source).toHaveBeenCalledTimes(2);
  await act(async()=>{resolve(envelope(false));await first;});
  expect(client.getQueriesData({})).toEqual([[expect.any(Array),expect.objectContaining({sourceId:'source-B'})]]);
  await act(async()=>{await result.current.loadFresh(new AbortController().signal);});expect(api.source).toHaveBeenCalledTimes(3);
});

it.each(['caller','query'] as const)('%s cancellation aborts the actual fresh Source transport without a replacement request',async owner=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),command=new AbortController();
  api.source.mockImplementationOnce((_score,_revision,_notation,signal:AbortSignal)=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }));
  const {result}=renderHook(()=>usePracticeRevisionSource('score','revision',{loadNotation:false,enabled:false}),{wrapper:harness(client)});
  const pending=result.current.loadFresh(command.signal).catch(error=>error);
  await waitFor(()=>expect(api.source).toHaveBeenCalledOnce());const transport=api.source.mock.calls[0][3] as AbortSignal;
  expect(transport.aborted).toBe(false);
  await act(async()=>{if(owner==='caller')command.abort();else await client.cancelQueries();await pending;});
  expect(transport.aborted).toBe(true);expect(command.signal.aborted).toBe(owner==='caller');
  expect(api.source).toHaveBeenCalledOnce();expect(result.current.sourceQuery.data).toBeUndefined();
});
it('an already-aborted fresh command starts no transport even when cache contains admitted data',async()=>{
  const {result}=renderHook(()=>usePracticeRevisionSource('score','revision',{loadNotation:false}),{wrapper:harness()});
  await waitFor(()=>expect(result.current.artifact).not.toBeNull());const command=new AbortController();command.abort();
  await expect(result.current.loadFresh(command.signal)).rejects.toBe(command.signal.reason);
  expect(api.source).toHaveBeenCalledOnce();
});
