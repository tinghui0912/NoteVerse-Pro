import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';
import { createLocalMediaAsset } from '@/lib/practice/media/local-media-asset';
// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import practice from '@/../messages/en/practice.json';
import { take, artifact } from '@/lib/practice/video-export/__fixtures__/saved-take';
import { ApiError } from '@/lib/api-client';
import Page from './page';

const calls = vi.hoisted(() => ({ get: vi.fn(), media: vi.fn(), player: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ takeId: 'take-1' }), useRouter: () => ({ push: calls.push }) }));
vi.mock('@/hooks/queries/use-performance-take-queries', () => ({ usePerformanceTakeDetail: () => ({ data: { data: take }, isLoading: false }) }));
vi.mock('@/lib/api-client', async original => ({ ...await original<typeof import('@/lib/api-client')>(), apiClient: { get: calls.get } }));
vi.mock('@/lib/practice/media/performance-take/materialize', () => ({ materializePerformanceTakeMedia: calls.media }));
vi.mock('@/components/practice/performance-replay-player', () => ({ PerformanceReplayPlayer: (props: { actions: React.ReactNode }) => { calls.player(props); return <div data-testid="raw-replay">{props.actions}</div>; } }));
vi.mock('@/components/practice/video-export-studio', () => ({ VideoExportStudio: () => <div data-testid="score-export" /> }));
vi.mock('@/components/score-preview/verovio-score-viewer', () => ({ VerovioScoreViewer: () => <div data-testid="score" /> }));
vi.mock('@/lib/practice/score-view/verovio-adapter', () => ({ PracticeVerovioAdapter: class { dispose() {} } }));

const blob = new Blob(['raw video'], { type: 'video/webm' });
beforeEach(() => {
  vi.clearAllMocks();
  calls.media.mockResolvedValue(localMediaAssetFixture(blob));
  calls.get.mockResolvedValue({ data: { binding: {score_id:take.score_id,revision_id:take.revision_id,bundle_id:take.bundle_id}, artifact: structuredClone(artifact), notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => 'blob:raw'); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function openPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><NextIntlClientProvider locale="en" messages={{ practice }}><Page /></NextIntlClientProvider></QueryClientProvider>);
}
it('loads exact currently authorized Source for optional saved score export', async () => {
  openPage(); await screen.findByTestId('score-export');
  expect(calls.get).toHaveBeenCalledExactlyOnceWith(`/practice/scores/${take.score_id}/revisions/${take.revision_id}/bundle`, { include_notation: true }, { signal: expect.any(AbortSignal) });
  expect(calls.player.mock.calls.at(-1)![0].replay.media.blob).toBe(blob);
});
it.each([403, 404])('keeps raw replay and download usable when Source authorization returns %s', async status => {
  calls.get.mockRejectedValue(new ApiError(status, 'resource_not_found', 'Unavailable'));
  openPage(); await screen.findByTestId('raw-replay');
  await screen.findByText(practice.savedTakeVideoExportRevisionUnavailable);
  expect(screen.queryByTestId('score-export')).toBeNull();
  expect(calls.player.mock.calls.at(-1)![0].replay.media.blob).toBe(blob);
  fireEvent.click(screen.getByRole('button', { name: practice.downloadVideo }));
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob); await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:raw'));
  await waitFor(() => expect(calls.get).toHaveBeenCalledTimes(1));
});
it('refuses different exact representation identity while retaining raw media', async () => {
  calls.get.mockResolvedValue({ data: { binding: {score_id:take.score_id,revision_id:take.revision_id,bundle_id:'another-bundle'}, artifact, notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } });
  openPage(); await screen.findByText(practice.savedTakeVideoExportRevisionUnavailable);
  expect(screen.getByTestId('raw-replay')).toBeVisible(); expect(screen.queryByTestId('score-export')).toBeNull();
});
it('owns one downloaded reference and releases it exactly once on unmount',async()=>{
  const remove=vi.fn(async()=>{}),media=createLocalMediaAsset(blob,remove);
  calls.media.mockResolvedValue(media);
  const view=openPage();await screen.findByTestId('raw-replay');
  expect(calls.media).toHaveBeenCalledWith(expect.objectContaining({takeId:take.take_id,expectedByteSize:take.media_byte_size,expectedMimeType:take.media_mime_type,signal:expect.any(AbortSignal)}));
  expect(remove).not.toHaveBeenCalled();view.unmount();
  await waitFor(()=>expect(remove).toHaveBeenCalledOnce());
});
it('late successful download after route exit retires its handle without publishing',async()=>{
  const remove=vi.fn(async()=>{}),media=createLocalMediaAsset(blob,remove);
  let resolve!:(value:typeof media)=>void;
  calls.media.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const view=openPage();await waitFor(()=>expect(calls.media).toHaveBeenCalledOnce());
  const signal=calls.media.mock.calls[0][0].signal as AbortSignal;
  view.unmount();expect(signal.aborted).toBe(true);resolve(media);
  await waitFor(()=>expect(remove).toHaveBeenCalledOnce());expect(calls.player).not.toHaveBeenCalled();
});
it('failed download retries with a new operation and owns only the successful media',async()=>{
  const remove=vi.fn(async()=>{}),media=createLocalMediaAsset(blob,remove);
  calls.media.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(media);
  const view=openPage();await screen.findByText(practice.savedTakeVideoExportTemporaryUnavailable);
  fireEvent.click(screen.getByRole('button',{name:practice.savedTakeVideoExportRetry}));
  await screen.findByTestId('raw-replay');expect(calls.media).toHaveBeenCalledTimes(2);
  expect(calls.media.mock.calls[0][0].signal.aborted).toBe(true);view.unmount();
  await waitFor(()=>expect(remove).toHaveBeenCalledOnce());
});
