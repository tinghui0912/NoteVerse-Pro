// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { EditorProvider, useEditorSession, useEditorState } from '@/contexts/editor-provider';
import { useEntityEditor } from './use-entity-editor';
import { editorXml, note } from '../../../tests/fixtures/editor';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
it('materializes an input voice on first insertion and selects the admitted event', () => {
  const { result } = renderHook(
    () => ({ session: useEditorSession(), ui: useEditorState(), editor: useEntityEditor() }),
    { wrapper: EditorProvider },
  );
  act(() => {
    result.current.session.loadMusicXml(editorXml());
  });
  act(() => {
    result.current.session.prepareVoice();
  });
  const voice = result.current.session.inputVoices[0];
  const document = result.current.session.document!;
  act(() => {
    const accepted = result.current.editor.handleAddEntity(
      {
        kind: 'caret',
        caret: {
          kind: 'caret',
          staffId: document.staves[0].id,
          voiceId: voice.id,
          position: {
            measureId: document.measures[0].id,
            offset: { numerator: 0, denominator: 1 },
          },
        },
      },
      {
        kind: 'insertExplicitRest',
        inputDuration: {
          kind: 'inputDuration',
          rhythm: {
            timelineDuration: { numerator: 2, denominator: 1 },
            notation: { base: 'half', dots: 0 },
          },
        },
      },
    );
    expect(accepted?.success).toBe(true);
  });
  expect(result.current.session.document?.voices[0]).toEqual(voice);
  expect(result.current.session.inputVoices).toEqual([]);
  expect(result.current.session.document?.events[0].kind).toBe('explicitRest');
  expect(result.current.ui.editingSelection?.domainAnchor?.kind).toBe('event');
});
it('deletes an event through its semantic identity and derives the next projection', () => {
  const { result } = renderHook(
    () => ({ session: useEditorSession(), editor: useEntityEditor() }),
    { wrapper: EditorProvider },
  );
  act(() => {
    result.current.session.loadMusicXml(editorXml(note()));
  });
  const event = result.current.session.document!.events[0];
  act(() => {
    expect(
      result.current.editor.handleDeleteEntity({ kind: 'event', eventId: event.id })?.success,
    ).toBe(true);
  });
  expect(result.current.session.document?.events).toEqual([]);
  expect(result.current.session.serializedXml).not.toContain('<note');
  expect(result.current.session.serializedXml).toContain('<forward>');
});
