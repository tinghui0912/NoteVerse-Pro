// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { queryKeys } from '@/lib/query-client';
import { ApiError } from '@/lib/api-client';
import { useSavedTakeExportBundle } from './use-saved-take-export-bundle';
const api = vi.hoisted(() => ({ exactSource: vi.fn() }));
vi.mock('@/lib/api/practice', () => ({ practiceApi: { getPracticeBundle: api.exactSource } }));
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.exactSource.mockResolvedValue({ data: { binding: {score_id: 'score', revision_id: 'revision', bundle_id:'source-1'}, artifact: fixture,
    notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } });
});
it('saved take rendering requests one verified source with notation', async () => {
  const { result } = renderHook(() => useSavedTakeExportBundle({ bundleId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.musicXml).toBe('<score />'));
  expect(api.exactSource).toHaveBeenCalledExactlyOnceWith('score', 'revision', true, expect.any(AbortSignal));
});
it.each(['scoreId', 'revisionId', 'artifactId'])('rejects saved source %s mismatch', async field => {
  const identity = { bundleId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [field]: 'other' };
  const { result } = renderHook(() => useSavedTakeExportBundle(identity, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull();
});

it('saved Take rejects a different source with identical artifact projections', async () => {
  const { result } = renderHook(() => useSavedTakeExportBundle({ bundleId: 'different', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
});

it('missing source identity does not initiate a representation read', () => {
  const { result } = renderHook(() => useSavedTakeExportBundle({ bundleId: '', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId }, {}), { wrapper: harness() });
  expect(result.current.artifact).toBeNull();expect(api.exactSource).not.toHaveBeenCalled();
});

it.each(['scoreId', 'revisionId', 'artifactId'] as const)('saved Take requires its descriptive %s projection at runtime', async key => {
  const identity = { bundleId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId, [key]: undefined as unknown as string };
  const { result } = renderHook(() => useSavedTakeExportBundle(identity, {}), { wrapper: harness() });
  await waitFor(() => expect(result.current.invalid).toBe(true));
  expect(result.current.artifact).toBeNull();
});

it('requires current authorization on entry and does not expose a previously cached Source', async () => {
  const identity = { bundleId: 'source-1', scoreId: 'score', revisionId: 'revision', artifactId: fixture.artifactId };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([...queryKeys.savedTakeExport.bundle(identity.bundleId), identity], {
    binding: { scoreId: 'score-1', revisionId: 'revision-1', bundleId: identity.bundleId }, artifact: fixture, musicXml: '<cached-score />',
  });
  let deny!: (error: unknown) => void;
  api.exactSource.mockImplementation(() => new Promise((_resolve, reject) => { deny = reject; }));
  const { result } = renderHook(() => useSavedTakeExportBundle(identity, {}), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  expect(api.exactSource).toHaveBeenCalledOnce();
  expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull();
  deny(new ApiError(404, 'resource_not_found', 'Unavailable'));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.artifact).toBeNull(); expect(result.current.musicXml).toBeNull();
});
