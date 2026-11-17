// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDownload } from '@/hooks/use-download';
import type { RenderAssetRead } from '@/generated/api';
import { SCORE_PRESENTATION_RENDER_PROFILE } from '@/lib/score/render-profile';

const api = vi.hoisted(() => ({ downloadRenderAsset: vi.fn(), downloadRenderAssetArchive: vi.fn() }));
vi.mock('@/lib/api', () => ({ scoresApi: api }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/observability', () => ({ reportUnexpectedClientError: vi.fn() }));

function page(profile: string, number: number): RenderAssetRead {
  return { render_asset_id: `${profile}-${number}`, revision_id: 'r1', kind: 'RENDERED_PAGE',
    render_profile: profile, page_number: number, filename: `${number}.svg`,
    mime_type: 'image/svg+xml', size_bytes: 5, created_at: '2026-07-01T00:00:00Z' };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:render'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  api.downloadRenderAsset.mockResolvedValue(new Blob(['image'], { type: 'image/svg+xml' }));
  api.downloadRenderAssetArchive.mockResolvedValue(new Blob(['archive']));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('downloads the presentation page without treating other profiles as extra pages', async () => {
  const hook = renderHook(() => useDownload({ id: 'score', assets: {
    revision_sources: [], render_assets: [page('print', 1), page(SCORE_PRESENTATION_RENDER_PROFILE, 1)],
  } }));
  await act(async () => { await hook.result.current.handleDownload('image'); });
  expect(api.downloadRenderAsset).toHaveBeenCalledWith(`${SCORE_PRESENTATION_RENDER_PROFILE}-1`);
  expect(api.downloadRenderAssetArchive).not.toHaveBeenCalled();
});

it('requests an archive with the explicit presentation profile', async () => {
  const hook = renderHook(() => useDownload({ id: 'score', assets: {
    revision_sources: [], render_assets: [page('print', 1), page(SCORE_PRESENTATION_RENDER_PROFILE, 1), page(SCORE_PRESENTATION_RENDER_PROFILE, 2)],
  } }));
  await act(async () => { await hook.result.current.handleDownload('image'); });
  expect(api.downloadRenderAssetArchive).toHaveBeenCalledWith('score', 'r1', 'RENDERED_PAGE', SCORE_PRESENTATION_RENDER_PROFILE);
  expect(api.downloadRenderAsset).not.toHaveBeenCalled();
});
