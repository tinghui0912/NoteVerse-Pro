// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { EditorStateProvider, useEditorState } from '@/contexts/editor-state-context';
import { HistoryProvider, useHistory } from '@/contexts/editor-history-context';
import { ScoreDataProvider, useScoreData } from '@/contexts/score-data-context';
import { parseXml } from '@/lib/musicxml/core';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import { createAddModeInputDurationFromDuration } from './entity-editor/add-mode-command';
import { useEntityEditor } from './use-entity-editor';

const emptyScoreXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>1</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
    </measure>
  </part>
</score-partwise>`;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ editor: { actions: { addNote: 'Add Note', deleteNote: 'Delete Note' } } }}>
      <ScoreDataProvider>
        <HistoryProvider>
          <EditorStateProvider>{children}</EditorStateProvider>
        </HistoryProvider>
      </ScoreDataProvider>
    </NextIntlClientProvider>
  );
}

describe('useEntityEditor add mode', () => {
  it('writes the selected non-quarter explicit rest duration to MusicXML', () => {
    const parsedScore = new MusicXMLParser(emptyScoreXml).parse();
    const halfRestDuration = createAddModeInputDurationFromDuration('durationHalf');

    const { result } = renderHook(() => ({
      editor: useEntityEditor(),
      editorState: useEditorState(),
      history: useHistory(),
      scoreData: useScoreData(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(emptyScoreXml);
      result.current.scoreData.setScoreData(parsedScore);
      result.current.history.initialize(emptyScoreXml);
      result.current.editorState.setAddModeInputDuration(halfRestDuration);
    });

    act(() => {
      result.current.editor.handleAddEntity({
        kind: 'caret',
        caret: {
          kind: 'caret',
          staffId: 'P1:staff-1' as never,
          voiceId: 'P1:voice-1' as never,
          position: {
            measureId: 'P1:measure-1' as never,
            offset: { numerator: 0, denominator: 1 },
          },
        },
      }, {
        kind: 'insertExplicitRest',
        inputDuration: result.current.editorState.addModeInputDuration,
      });
    });

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = parseXml(nextXml);
    const insertedNote = xmlDoc.querySelector('measure[number="1"] note');

    expect(insertedNote?.querySelector('rest')).not.toBeNull();
    expect(insertedNote?.querySelector('duration')?.textContent).toBe('8');
    expect(insertedNote?.querySelector('type')?.textContent).toBe('half');
    expect(insertedNote?.querySelector('voice')?.textContent).toBe('1');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'rest',
      duration: 'durationHalf',
    });
  });

  it('deletes an event through the domain anchor command path', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      <note id="delete-me">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const parsedScore = new MusicXMLParser(xml).parse();
    const selectedMeta = parsedScore.measures[0]?.staves[0]?.voices[0]?.events[0]?.meta;
    expect(selectedMeta).toBeDefined();
    if (!selectedMeta) return;

    const { result } = renderHook(() => ({
      editor: useEntityEditor(),
      editorState: useEditorState(),
      history: useHistory(),
      scoreData: useScoreData(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsedScore);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: { kind: 'event', eventId: 'P1-m1-e4' as never },
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    act(() => {
      result.current.editor.handleDeleteEntity({ kind: 'event', eventId: 'P1-m1-e4' as never });
    });

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = parseXml(nextXml);
    expect(xmlDoc.querySelector('note[id="delete-me"]')).toBeNull();
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.editingSelection).toBeNull();
    expect(result.current.editorState.inspectorOpen).toBe(false);
  });
});
