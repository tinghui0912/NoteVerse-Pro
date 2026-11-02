// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import practice from '@/../messages/en/practice.json';
import { take, artifact } from '@/lib/practice/sharing/video/__fixtures__/saved-take';
import { ApiError } from '@/lib/api-client';
import Page from './page';

const calls = vi.hoisted(() => ({ get: vi.fn(), media: vi.fn(), player: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ takeId: 'take-1' }), useRouter: () => ({ push: calls.push }) }));
vi.mock('@/hooks/queries/use-performance-take-queries', () => ({ usePerformanceTakeDetail: () => ({ data: { data: take }, isLoading: false }) }));
vi.mock('@/lib/api-client', async original => ({ ...await original<typeof import('@/lib/api-client')>(), apiClient: { get: calls.get } }));
vi.mock('@/lib/api/performance-takes', () => ({ downloadPerformanceTakeMediaBlob: calls.media }));
vi.mock('@/components/practice/performance-replay-player', () => ({ PerformanceReplayPlayer: (props: { actions: React.ReactNode }) => { calls.player(props); return <div data-testid="raw-replay">{props.actions}</div>; } }));
vi.mock('@/components/practice/share-video-studio', () => ({ ShareVideoStudio: () => <div data-testid="score-export" /> }));
vi.mock('@/components/score-preview/verovio-score-viewer', () => ({ VerovioScoreViewer: () => <div data-testid="score" /> }));
vi.mock('@/lib/practice/score-view/verovio-adapter', () => ({ PracticeVerovioAdapter: class { dispose() {} } }));

const blob = new Blob(['raw video'], { type: 'video/webm' });
beforeEach(() => {
  vi.clearAllMocks();
  calls.media.mockResolvedValue(blob);
  calls.get.mockResolvedValue({ data: { source_id: take.source_id, artifact: structuredClone(artifact), notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } });
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
  expect(calls.get).toHaveBeenCalledExactlyOnceWith('/practice/sources/source-1', { include_notation: true }, { signal: expect.any(AbortSignal) });
  expect(calls.player.mock.calls.at(-1)![0].replay.blob).toBe(blob);
});
it.each([403, 404])('keeps raw replay and download usable when Source authorization returns %s', async status => {
  calls.get.mockRejectedValue(new ApiError(status, 'resource_not_found', 'Unavailable'));
  openPage(); await screen.findByTestId('raw-replay');
  await screen.findByText(practice.historicalShareRevisionUnavailable);
  expect(screen.queryByTestId('score-export')).toBeNull();
  expect(calls.player.mock.calls.at(-1)![0].replay.blob).toBe(blob);
  fireEvent.click(screen.getByRole('button', { name: practice.downloadVideo }));
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:raw');
  await waitFor(() => expect(calls.get).toHaveBeenCalledTimes(1));
});
it('refuses different exact representation identity while retaining raw media', async () => {
  calls.get.mockResolvedValue({ data: { source_id: 'another-source', artifact, notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } });
  openPage(); await screen.findByText(practice.historicalShareRevisionUnavailable);
  expect(screen.getByTestId('raw-replay')).toBeVisible(); expect(screen.queryByTestId('score-export')).toBeNull();
});
