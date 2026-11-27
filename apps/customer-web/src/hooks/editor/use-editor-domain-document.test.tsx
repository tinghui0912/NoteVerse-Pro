// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EditorSessionProvider, useEditorSession } from '@/contexts/editor-session-context';
import { useEditorDomainDocument } from './use-editor-domain-document';
import { editorXml, note } from '../../../tests/fixtures/editor';
it('reads the identical semantic document owned by the session', () => {
  const { result } = renderHook(
    () => ({ session: useEditorSession(), reader: useEditorDomainDocument() }),
    { wrapper: EditorSessionProvider },
  );
  act(() => {
    result.current.session.loadMusicXml(editorXml(note()));
  });
  expect(result.current.reader.document).toBe(result.current.session.document);
  expect(result.current.reader.gaps.length).toBe(1);
});
