// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { EditorStateProvider, useEditorState } from '@/contexts/editor-state-context';
import { ScoreDataProvider, useScoreData } from '@/contexts/score-data-context';
import {
  useEditingDomainEvent,
  useEditingDomainInspectorViewModel,
} from './use-editing-domain-event';

function scoreXml(measureContent: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
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
      ${measureContent}
    </measure>
  </part>
</score-partwise>`;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ScoreDataProvider>
      <EditorStateProvider>{children}</EditorStateProvider>
    </ScoreDataProvider>
  );
}

describe('useEditingDomainEvent', () => {
  it('does not resolve a legacy-only edited entity to a domain event', () => {
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      editingDomain: useEditingDomainEvent(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(scoreXml(`
        <note id="note-root">
          <pitch><step>C</step><octave>4</octave></pitch>
          <duration>4</duration>
          <voice>1</voice>
          <type>quarter</type>
        </note>
        <note id="note-member">
          <chord/>
          <pitch><step>E</step><octave>4</octave></pitch>
          <duration>4</duration>
          <voice>1</voice>
          <type>quarter</type>
        </note>
      `));
      result.current.editorState.openEditingSelection({
        domainCompanion: null,
      });
    });

    expect(result.current.editingDomain.error).toBeNull();
    expect(result.current.editingDomain.event).toBeNull();
  });

  it('derives a domain Inspector view model for the current domain event anchor', () => {
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      domainInspector: useEditingDomainInspectorViewModel(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(scoreXml(`
        <note id="rest-1">
          <rest/>
          <duration>4</duration>
          <voice>1</voice>
          <type>quarter</type>
        </note>
      `));
      result.current.editorState.openEditingSelection({
        domainAnchor: { kind: 'event', eventId: 'P1-m1-e4' as never },
        domainCompanion: null,
      });
    });

    expect(result.current.domainInspector.viewModel).toMatchObject({
      kind: 'explicitRest',
      eventId: 'P1-m1-e4',
    });
    expect(result.current.domainInspector.viewModelSource).toBe('domainAnchor');
  });

  it('uses the owning event view model when a note atom is selected', () => {
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      domainInspector: useEditingDomainInspectorViewModel(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(scoreXml(`
        <note id="note-root">
          <pitch><step>C</step><octave>4</octave></pitch>
          <duration>4</duration>
          <voice>1</voice>
          <type>quarter</type>
        </note>
        <note id="note-member">
          <chord/>
          <pitch><step>E</step><octave>4</octave></pitch>
          <duration>4</duration>
          <voice>1</voice>
          <type>quarter</type>
        </note>
      `));
      result.current.editorState.openEditingSelection({
        domainAnchor: {
          kind: 'noteAtom',
          eventId: 'P1-m1-e4' as never,
          noteAtomId: 'note-member' as never,
        },
        domainCompanion: null,
      });
    });

    expect(result.current.domainInspector.viewModel).toMatchObject({
      kind: 'pitchedEvent',
      eventId: 'P1-m1-e4',
      notes: [
        { noteAtomId: 'note-root' },
        { noteAtomId: 'note-member' },
      ],
    });
    expect(result.current.domainInspector.viewModelSource).toBe('domainAnchor');
  });

  it('does not use a stale select/edit companion when its anchor is absent from the current document', () => {
    const { result } = renderHook(() => ({
      editorState: useEditorState(),
      domainInspector: useEditingDomainInspectorViewModel(),
    }), { wrapper });

    act(() => {
      result.current.editorState.openEditingSelection({
        domainCompanion: {
          domainAnchor: { kind: 'event', eventId: 'event-from-selection' as never },
          inspectorViewModel: {
            kind: 'explicitRest',
            eventId: 'event-from-selection' as never,
            voiceId: 'P1:voice-2' as never,
            staffId: 'P1:staff-1' as never,
            position: { measureId: 'P1:measure-3' as never, offset: { numerator: 0, denominator: 1 } },
            rhythm: {
              timelineDuration: { numerator: 1, denominator: 1 },
              notation: { base: 'quarter', dots: 0 },
            },
          },
        },
      });
    });

    expect(result.current.domainInspector.viewModel).toBeNull();
    expect(result.current.domainInspector.viewModelSource).toBe('unavailable');
  });
});
