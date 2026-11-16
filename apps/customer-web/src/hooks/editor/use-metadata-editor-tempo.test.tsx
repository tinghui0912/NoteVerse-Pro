// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EditorSessionProvider, useEditorSession } from '@/contexts/editor-session-context';
import { useMetadataEditor } from './use-metadata-editor';
import { editorXml, note } from '../../../tests/fixtures/editor';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
it('edits the domain notation title and its visible title credit', () => {
  const { result } = renderHook(
    () => ({ session: useEditorSession(), editor: useMetadataEditor() }),
    { wrapper: EditorSessionProvider },
  );
  act(() => {
    result.current.session.loadMusicXml(editorXml(note()));
  });
  act(() => {
    result.current.editor.updateNotationTitle('New notation');
  });
  expect(result.current.session.document?.metadata.notationTitle).toBe('New notation');
  const xml = new DOMParser().parseFromString(
    result.current.session.serializedXml!,
    'application/xml',
  );
  expect(xml.querySelector('work-title')?.textContent).toBe('New notation');
  expect(
    Array.from(xml.querySelectorAll('credit'))
      .find((credit) => credit.querySelector('credit-type')?.textContent === 'title')
      ?.querySelector('credit-words')?.textContent,
  ).toBe('New notation');
});
it.each([true, false])('records literal tempo notation with visibility %s', (visible) => {
  const { result } = renderHook(
    () => ({ session: useEditorSession(), editor: useMetadataEditor() }),
    { wrapper: EditorSessionProvider },
  );
  act(() => {
    result.current.session.loadMusicXml(editorXml('<sound tempo="120"/>' + note()));
  });
  act(() => {
    result.current.editor.updateTempo('60', { beatUnit: 'half', dots: 1, showMark: visible });
  });
  expect(result.current.session.document?.metadata.tempoNotation).toEqual({
    perMinute: 60,
    beatUnit: 'half',
    dots: 1,
    visible,
  });
  expect(result.current.session.serializedXml).not.toContain('sound tempo=');
});
