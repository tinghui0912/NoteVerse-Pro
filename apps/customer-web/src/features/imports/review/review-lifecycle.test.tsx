// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useReviewEditorDocument } from './use-review-editor-document';
import { useReviewPageData } from './use-review-page-data';
import type { ImportJobReviewRead } from '@/generated/api';

const state = vi.hoisted(() => ({
  review: undefined as ImportJobReviewRead | undefined,
  error: null as Error | null,
  xml: '<score-partwise/>' as string | null,
  load: vi.fn(), clear: vi.fn(), completeSave: vi.fn(), clearDraft: vi.fn(),
  update: vi.fn(), confirm: vi.fn(), push: vi.fn(), replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push, replace: state.replace }) }));
vi.mock('next-intl', () => ({ useTranslations: () => Object.assign((key: string) => key, { has: () => false }) }));
vi.mock('@/features/imports/queries', () => ({
  useImportJobReview: () => ({ data: state.review, error: state.error, isLoading: false }),
  useUpdateImportJobReview: () => ({ mutate: state.update, isPending: false }),
  useConfirmImportJobReview: () => ({ mutate: state.confirm, isPending: false }),
}));
vi.mock('@/contexts/editor-session-context', () => ({ useEditorSession: () => ({ loadMusicXml: state.load, clearDocument: state.clear, serializedXml: state.xml }) }));
vi.mock('@/hooks/editor/use-auto-save', () => ({ useAutoSave: () => ({ clearDraft: state.clearDraft, isSaving: false }) }));
vi.mock('@/hooks/editor/use-editor-original-images', () => ({ useEditorOriginalImages: () => [] }));
vi.mock('@/hooks/editor/use-editor-save-error-toast', () => ({ useEditorSaveErrorToast: () => vi.fn() }));
vi.mock('@/hooks/editor/use-editor-save-completion', () => ({ useEditorSaveCompletion: () => state.completeSave }));
vi.mock('@/hooks/editor/use-editor-validation-gate', () => ({ useEditorValidationGate: (save: () => void) => ({ save, saveIgnoringWarnings: save }) }));
vi.mock('@/lib/editor/draft-storage', () => ({ loadDraft: async () => null, deleteDraft: vi.fn() }));
vi.mock('@/lib/editor-musicxml', () => ({ importEditorMusicXml: () => ({ document: {} }) }));
vi.mock('@/lib/musicxml/validator', () => ({ validateDataIntegrity: () => ({ warnings: [] }) }));

beforeEach(() => {
  vi.clearAllMocks();
  state.error = null;
  state.xml = '<score-partwise/>';
  state.review = undefined;
});

it('saves temporary review edits and returns to the canonical Import Review', async () => {
  state.review = { job_id: 'job', state: 'READY_FOR_REVIEW', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', genres: [], musicxml: { content: '<score-partwise/>', artifact_id: 'review-artifact' }, original_images: [] };
  state.update.mockImplementation((_body, callbacks) => { void callbacks.onSuccess(); });
  const hook = renderHook(() => useReviewEditorDocument({ jobId: 'job' }));
  await waitFor(() => expect(state.load).toHaveBeenCalled());
  await act(async () => { hook.result.current.save(); });
  expect(state.update).toHaveBeenCalledWith({ jobId: 'job', content: '<score-partwise/>' }, expect.anything());
  expect(state.completeSave).toHaveBeenCalledWith({ returnUrl: '/imports/job/review', beforeNavigate: state.clearDraft });
  hook.unmount();
});

it('redirects confirmed review and editor consumers to the active Score without loading XML', () => {
  state.review = { job_id: 'job', state: 'CONFIRMED', score_id: 'score', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', genres: [], original_images: [] };
  const page = renderHook(() => useReviewPageData('job'));
  const editor = renderHook(() => useReviewEditorDocument({ jobId: 'job' }));
  expect(state.replace).toHaveBeenCalledWith('/score/score');
  expect(state.load).not.toHaveBeenCalled();
  expect(page.result.current.recognizedXml).toBeNull();
  page.unmount(); editor.unmount();
});

it('projects rejected review reads as unavailable without an editable fallback', () => {
  state.error = new Error('review unavailable');
  state.xml = null;
  const page = renderHook(() => useReviewPageData('job'));
  const editor = renderHook(() => useReviewEditorDocument({ jobId: 'job' }));
  expect(page.result.current.error).toBeTruthy();
  expect(editor.result.current.finalLoadError).toBeTruthy();
  expect(state.load).not.toHaveBeenCalled();
  act(() => { page.result.current.confirmRecognition(); editor.result.current.save(); });
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  page.unmount(); editor.unmount();
});
