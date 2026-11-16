// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { it, expect } from 'vitest';
import { EditorProvider, useEditorSession } from '@/contexts/editor-provider';
import { useEditorTracks } from './use-editor-tracks';
import { editorXml, note } from '../../../tests/fixtures/editor';
import { updateScoreMetadata } from '@/lib/editor-domain';
it('retains hidden voice presentation when semantic metadata changes', () => {
  const { result } = renderHook(
    () => ({ session: useEditorSession(), tracks: useEditorTracks() }),
    { wrapper: EditorProvider },
  );
  act(() => {
    result.current.session.loadMusicXml(editorXml(note('a', 'C', 1) + note('b', 'D', 2)));
  });
  const hidden = result.current.tracks.tracks[1].id;
  act(() => {
    result.current.tracks.toggleTrackVisibility(hidden);
  });
  expect(result.current.tracks.visibleTrackIdSet.has(hidden)).toBe(false);
  act(() => {
    result.current.session.applyCommand(
      (document) => updateScoreMetadata(document, { notationTitle: 'Edited' }),
      'title',
    );
  });
  expect(result.current.tracks.visibleTrackIdSet.has(hidden)).toBe(false);
});
