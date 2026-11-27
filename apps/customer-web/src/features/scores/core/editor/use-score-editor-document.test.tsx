// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useScoreEditorDocument } from './use-score-editor-document';

const state = vi.hoisted(() => ({
  score: { head_revision_id: 'revision-1', input_assets: [], capabilities: {} },
  xml: '<score-partwise version="4.0"><part-list/></score-partwise>',
  loadMusicXml: vi.fn(async () => {}),
  clearDocument: vi.fn(),
  mutate: vi.fn(),
  completeSave: vi.fn(),
  revisionQuery: vi.fn(),
  autosave: vi.fn(),
  t: (key: string) => key,
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => state.t }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@/contexts/editor-session-context', () => ({ useEditorSession: () => ({
  serializedXml: state.xml, loadMusicXml: state.loadMusicXml, clearDocument: state.clearDocument, replaceFromExternalMusicXml: vi.fn(),
}) }));
vi.mock('@/hooks/editor/use-auto-save', () => ({ useAutoSave: (...args: unknown[]) => {
  state.autosave(...args); return { clearDraft: vi.fn(), isSaving: false };
} }));
vi.mock('@/hooks/editor/use-editor-original-images', () => ({ useEditorOriginalImages: () => [] }));
vi.mock('@/hooks/editor/use-editor-save-error-toast', () => ({ useEditorSaveErrorToast: () => vi.fn() }));
vi.mock('@/hooks/editor/use-editor-save-completion', () => ({ useEditorSaveCompletion: () => state.completeSave }));
vi.mock('@/hooks/editor/use-editor-validation-gate', () => ({ useEditorValidationGate: (save: () => void) => ({ save }) }));
vi.mock('@/lib/editor/draft-storage', () => ({ loadDraft: async () => undefined, deleteDraft: vi.fn() }));
vi.mock('@/features/scores/core/queries', () => ({
useScoreDetail: () => ({ data: state.score }),
useRevisionContent: (scoreId: string, revisionId: string) => {
    state.revisionQuery(scoreId, revisionId);
    return { data: { content: state.xml } };
  },
useCreateRevision: () => ({ mutate: state.mutate }),
useGenerateScoreFingering: () => ({})
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.score = { head_revision_id: 'revision-1', input_assets: [], capabilities: {} };
});

it('keeps the loaded document baseline when the current Score head changes', async () => {
  const { result, rerender } = renderHook(() => useScoreEditorDocument({ scoreId: 'score-1' }));
  await waitFor(() => expect(state.loadMusicXml).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  state.score = { ...state.score, head_revision_id: 'revision-2' };
  rerender();
  expect(state.revisionQuery).toHaveBeenLastCalledWith('score-1', 'revision-1');
  expect(state.autosave).toHaveBeenLastCalledWith('score-1', state.xml, expect.objectContaining({ baselineRevisionId: 'revision-1' }));
  act(() => result.current.save());
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({
    scoreId: 'score-1', expected_head_revision_id: 'revision-1', content: state.xml,
  }), expect.any(Object));
  expect(state.loadMusicXml).toHaveBeenCalledTimes(1);
});


it('returns a saved Score revision to its canonical Score detail', async () => {
  state.mutate.mockImplementation((_body, handlers) => { void handlers.onSuccess({ revision_id: 'revision-2' }); });
  const hook = renderHook(() => useScoreEditorDocument({ scoreId: 'score-1' }));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  await act(async () => { hook.result.current.save(); });
  expect(state.completeSave).toHaveBeenCalledWith({ returnUrl: '/score/score-1', beforeNavigate: expect.any(Function) });
  hook.unmount();
});
