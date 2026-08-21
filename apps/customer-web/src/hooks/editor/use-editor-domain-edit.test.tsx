// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { HistoryProvider, useHistory } from '@/contexts/editor-history-context';
import { ScoreDataProvider, useScoreData } from '@/contexts/score-data-context';
import type { EventId, RhythmicValue } from '@/lib/editor-domain';
import { importMusicXmlToEditorDomain } from '@/lib/editor-domain';
import {
  applyEditorDomainEditToXml,
  type EditorDomainEditResult,
  useEditorDomainEdit,
} from './use-editor-domain-edit';

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

const half: RhythmicValue = {
  timelineDuration: { numerator: 2, denominator: 1 },
  notation: { base: 'half', dots: 0 },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ editor: { actions: { editNote: 'Edit Note' } } }}>
      <ScoreDataProvider>
        <HistoryProvider>{children}</HistoryProvider>
      </ScoreDataProvider>
    </NextIntlClientProvider>
  );
}

describe('applyEditorDomainEditToXml', () => {
  it('applies an Inspector domain edit and returns exported MusicXML', () => {
    const xml = scoreXml(`
      <note id="editable-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);

    const imported = importMusicXmlToEditorDomain(xml);
    const event = imported.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (!event || event.kind !== 'pitched') return;

    const result = applyEditorDomainEditToXml({
      xml,
      draft: {
        kind: 'pitchedEvent',
        eventId: event.id,
        rhythm: half,
      },
      notationOverrides: { stemDirection: 'up' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.xml).toContain('<type>half</type>');
    expect(result.xml).toContain('<stem>up</stem>');
    expect(result.refreshedSelection).toBeNull();

    const reimported = importMusicXmlToEditorDomain(result.xml);
    expect(reimported.document.events[0]).toMatchObject({
      id: event.id,
      kind: 'pitched',
      rhythm: half,
    });
    expect(reimported.document.notationControls).toEqual([
      {
        kind: 'eventNotation',
        eventId: event.id,
        stemDirection: 'up',
      },
    ]);
  });

  it('applies explicit-rest Inspector domain edits and returns exported MusicXML', () => {
    const xml = scoreXml(`
      <note id="editable-rest">
        <rest/>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);

    const imported = importMusicXmlToEditorDomain(xml);
    const event = imported.document.events[0];
    expect(event?.kind).toBe('explicitRest');
    if (!event || event.kind !== 'explicitRest') return;

    const result = applyEditorDomainEditToXml({
      xml,
      draft: {
        kind: 'explicitRest',
        eventId: event.id,
        rhythm: half,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.xml).toContain('<rest/>');
    expect(result.xml).toContain('<type>half</type>');
    expect(result.xml).toContain('<duration>8</duration>');
    expect(result.refreshedSelection).toBeNull();

    const reimported = importMusicXmlToEditorDomain(result.xml);
    expect(reimported.document.events[0]).toMatchObject({
      id: event.id,
      kind: 'explicitRest',
      rhythm: half,
    });
  });

  it('returns domain command errors without exporting partial XML', () => {
    const result = applyEditorDomainEditToXml({
      xml: scoreXml(''),
      draft: {
        kind: 'pitchedEvent',
        eventId: 'missing-event' as EventId,
        rhythm: half,
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'Event does not exist.',
    });
  });

  it('returns import errors for invalid MusicXML', () => {
    const result = applyEditorDomainEditToXml({
      xml: '<score-partwise>',
      draft: {
        kind: 'pitchedEvent',
        eventId: 'event-1' as EventId,
        rhythm: half,
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'Failed to parse MusicXML.',
    });
  });

  it('retargets note-atom drafts from legacy MusicXML source ids before exporting XML', () => {
    const xml = scoreXml(`
      <note id="chord-root">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="chord-member">
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const imported = importMusicXmlToEditorDomain(xml);
    const event = imported.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (!event || event.kind !== 'pitched') return;

    const result = applyEditorDomainEditToXml({
      xml,
      draft: {
        kind: 'noteAtom',
        eventId: 'legacy-event-id' as EventId,
        noteAtomId: 'legacy-note-id' as never,
        fingering: '4',
      },
      retargetNoteAtomSourceId: 'chord-member',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const reimported = importMusicXmlToEditorDomain(result.xml);
    const reimportedEvent = reimported.document.events[0];
    expect(reimportedEvent?.kind).toBe('pitched');
    if (reimportedEvent?.kind !== 'pitched') return;
    expect(reimportedEvent.notes.map((note) => ({
      sourceId: note.source?.musicXmlElementId,
      fingering: note.fingering,
    }))).toEqual([
      { sourceId: 'chord-root', fingering: undefined },
      { sourceId: 'chord-member', fingering: '4' },
    ]);
  });

  it('retargets note-atom accidental set and clear patches from legacy MusicXML source ids', () => {
    const xml = scoreXml(`
      <note id="chord-root">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="chord-member">
        <chord/>
        <pitch><step>E</step><alter>1</alter><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <accidental>sharp</accidental>
      </note>
    `);

    const setFlat = applyEditorDomainEditToXml({
      xml,
      draft: {
        kind: 'noteAtom',
        eventId: 'legacy-event-id' as EventId,
        noteAtomId: 'legacy-note-id' as never,
        accidental: 'flat',
      },
      retargetNoteAtomSourceId: 'chord-member',
    });

    expect(setFlat.success).toBe(true);
    if (!setFlat.success) return;
    expect(setFlat.xml).toContain('<accidental>flat</accidental>');

    const clear = applyEditorDomainEditToXml({
      xml: setFlat.xml,
      draft: {
        kind: 'noteAtom',
        eventId: 'legacy-event-id' as EventId,
        noteAtomId: 'legacy-note-id' as never,
        accidental: null,
      },
      retargetNoteAtomSourceId: 'chord-member',
    });

    expect(clear.success).toBe(true);
    if (!clear.success) return;
    const reimported = importMusicXmlToEditorDomain(clear.xml);
    const event = reimported.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes[1]).toMatchObject({
      source: { musicXmlElementId: 'chord-member' },
      pitch: { step: 'E', alter: 1, octave: 4 },
    });
    expect(event.notes[1]?.accidental).toBeUndefined();
  });

  it('retargets combined note-atom pitch and accidental patches from legacy MusicXML source ids', () => {
    const xml = scoreXml(`
      <note id="editable-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);

    const setSharp = applyEditorDomainEditToXml({
      xml,
      draft: {
        kind: 'noteAtom',
        eventId: 'legacy-event-id' as EventId,
        noteAtomId: 'legacy-note-id' as never,
        pitch: { step: 'C', octave: 4, alter: 1 },
        accidental: 'sharp',
      },
      retargetNoteAtomSourceId: 'editable-note',
    });

    expect(setSharp.success).toBe(true);
    if (!setSharp.success) return;
    expect(setSharp.xml).toContain('<alter>1</alter>');
    expect(setSharp.xml).toContain('<accidental>sharp</accidental>');

    const clear = applyEditorDomainEditToXml({
      xml: setSharp.xml,
      draft: {
        kind: 'noteAtom',
        eventId: 'legacy-event-id' as EventId,
        noteAtomId: 'legacy-note-id' as never,
        pitch: { step: 'C', octave: 4 },
        accidental: null,
      },
      retargetNoteAtomSourceId: 'editable-note',
    });

    expect(clear.success).toBe(true);
    if (!clear.success) return;
    expect(clear.xml).not.toContain('<alter>');
    expect(clear.xml).not.toContain('<accidental>');

    const reimported = importMusicXmlToEditorDomain(clear.xml);
    const event = reimported.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (event?.kind !== 'pitched') return;
    expect(event.notes[0]).toMatchObject({
      pitch: { step: 'C', octave: 4 },
      source: { musicXmlElementId: 'editable-note' },
    });
    expect(event.notes[0]?.accidental).toBeUndefined();
  });
});

describe('useEditorDomainEdit', () => {
  it('updates current XML, history, and legacy ScoreData after a domain Inspector edit', () => {
    const xml = scoreXml(`
      <note id="editable-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const event = importMusicXmlToEditorDomain(xml).document.events[0];
    expect(event?.kind).toBe('pitched');
    if (!event || event.kind !== 'pitched') return;

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      history: useHistory(),
      scoreData: useScoreData(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.applyDomainInspectorEdit({
        draft: {
          kind: 'pitchedEvent',
          eventId: event.id,
          rhythm: half,
        },
        notationOverrides: { stemDirection: 'down' },
        reselectSourceIds: ['editable-note'],
      });
    });

    const editResult = editResultRef.current as EditorDomainEditResult;
    expect(editResult.success).toBe(true);
    if (!editResult.success) return;
    expect(result.current.scoreData.currentXml).toBe(editResult.xml);
    expect(result.current.scoreData.currentXmlRef.current).toBe(editResult.xml);
    expect(result.current.history.getCurrentXml()).toBe(editResult.xml);
    expect(editResult.refreshedSelection).toMatchObject({
      entity: {
        type: 'note',
        duration: 'durationHalf',
        stemDirection: 'down',
      },
      meta: {
        sourceIds: ['editable-note'],
      },
    });
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'note',
      duration: 'durationHalf',
      stemDirection: 'down',
    });
  });

  it('returns a clear error when no current MusicXML is loaded', () => {
    const { result } = renderHook(() => useEditorDomainEdit(), { wrapper });

    let editResult: EditorDomainEditResult | null = null;
    act(() => {
      editResult = result.current.applyDomainInspectorEdit({
        draft: {
          kind: 'pitchedEvent',
          eventId: 'missing-event' as EventId,
          rhythm: half,
        },
      });
    });

    expect(editResult).toEqual({
      success: false,
      error: 'No current MusicXML document is loaded.',
    });
  });

  it('retargets a note-atom edit through the hook and refreshes the chord selection by source ids', () => {
    const xml = scoreXml(`
      <note id="chord-root">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="chord-member">
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.applyDomainInspectorEdit({
        draft: {
          kind: 'noteAtom',
          eventId: 'legacy-event-id' as EventId,
          noteAtomId: 'legacy-note-id' as never,
          fingering: '5',
        },
        retargetNoteAtomSourceId: 'chord-member',
        reselectSourceIds: ['chord-root', 'chord-member'],
      });
    });

    const editResult = editResultRef.current as EditorDomainEditResult;
    expect(editResult.success).toBe(true);
    if (!editResult.success) return;
    expect(editResult.refreshedSelection).toMatchObject({
      entity: {
        type: 'chord',
        fingerings: ['none', '5'],
      },
      meta: {
        sourceIds: ['chord-root', 'chord-member'],
      },
    });
  });

  it('sets and clears beam-run stem direction through domain notation controls', () => {
    const xml = scoreXml(`
      <note id="beam-a">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">begin</beam>
      </note>
      <note id="beam-b">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">end</beam>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.applyDomainStemDirectionToSourceIds({
        sourceIds: ['beam-a', 'beam-b'],
        stemDirection: 'down',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const withStem = new DOMParser().parseFromString(result.current.scoreData.currentXml ?? '', 'application/xml');
    expect(Array.from(withStem.querySelectorAll('note > beam')).map((beam) => beam.textContent)).toEqual(['begin', 'end']);
    expect(Array.from(withStem.querySelectorAll('note > stem')).map((stem) => stem.textContent)).toEqual(['down', 'down']);

    act(() => {
      editResultRef.current = result.current.domainEdit.applyDomainStemDirectionToSourceIds({
        sourceIds: ['beam-a', 'beam-b'],
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const withoutStem = new DOMParser().parseFromString(result.current.scoreData.currentXml ?? '', 'application/xml');
    expect(Array.from(withoutStem.querySelectorAll('note > beam')).map((beam) => beam.textContent)).toEqual(['begin', 'end']);
    expect(withoutStem.querySelectorAll('note > stem')).toHaveLength(0);
  });

  it('updates beam relationships by MusicXML source id through domain commands', () => {
    const xml = scoreXml(`
      <note id="beam-a">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">begin</beam>
      </note>
      <note id="beam-b">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">continue</beam>
      </note>
      <note id="beam-c">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">continue</beam>
      </note>
      <note id="beam-d">
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">end</beam>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.applyDomainBeamRelationshipEditBySourceId({
        sourceId: 'beam-b',
        action: 'break-right',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(Array.from(xmlDoc.querySelectorAll('note > beam')).map((beam) => beam.textContent)).toEqual([
      'begin',
      'end',
      'begin',
      'end',
    ]);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('deletes tie relationships by MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="tie-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <notations><tied type="start"/></notations>
      </note>
      <note id="tie-stop">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="stop"/>
        <voice>1</voice>
        <type>quarter</type>
        <notations><tied type="stop"/></notations>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.deleteDomainTieRelationshipBySourceIds({
        sourceId: 'tie-start',
        partnerSourceId: 'tie-stop',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelectorAll('note > tie')).toHaveLength(0);
    expect(xmlDoc.querySelectorAll('note > notations > tied')).toHaveLength(0);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('deletes all tie relationships touching selected MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="tie-a">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <notations><tied type="start"/></notations>
      </note>
      <note id="tie-b">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="stop"/>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <notations>
          <tied type="stop"/>
          <tied type="start"/>
        </notations>
      </note>
      <note id="tie-c">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="stop"/>
        <voice>1</voice>
        <type>quarter</type>
        <notations><tied type="stop"/></notations>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.deleteDomainTieRelationshipsForSourceIds({
        sourceIds: ['tie-b'],
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelectorAll('note > tie')).toHaveLength(0);
    expect(xmlDoc.querySelectorAll('note > notations > tied')).toHaveLength(0);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('adds tie relationships by MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="tie-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="tie-stop">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.addDomainTieRelationshipsBySourceIds({
        startSourceIds: ['tie-stop'],
        endSourceIds: ['tie-start'],
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelector('note[id="tie-start"] > tie[type="start"]')).not.toBeNull();
    expect(xmlDoc.querySelector('note[id="tie-stop"] > tie[type="stop"]')).not.toBeNull();
    expect(xmlDoc.querySelector('note[id="tie-start"] > notations > tied[type="start"]')).not.toBeNull();
    expect(xmlDoc.querySelector('note[id="tie-stop"] > notations > tied[type="stop"]')).not.toBeNull();
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('sets and clears tie placement by MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="tie-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <notations><tied type="start"/></notations>
      </note>
      <note id="tie-stop">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="stop"/>
        <voice>1</voice>
        <type>quarter</type>
        <notations><tied type="stop"/></notations>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.setDomainTiePlacementBySourceIds({
        sourceId: 'tie-start',
        partnerSourceId: 'tie-stop',
        placement: 'above',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const withPlacement = new DOMParser().parseFromString(result.current.scoreData.currentXml ?? '', 'application/xml');
    expect(withPlacement.querySelector('note > notations > tied[type="start"]')?.getAttribute('orientation')).toBe('over');

    act(() => {
      editResultRef.current = result.current.domainEdit.setDomainTiePlacementBySourceIds({
        sourceId: 'tie-start',
        partnerSourceId: 'tie-stop',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const withoutPlacement = new DOMParser().parseFromString(result.current.scoreData.currentXml ?? '', 'application/xml');
    expect(withoutPlacement.querySelector('note > notations > tied[type="start"]')?.hasAttribute('orientation')).toBe(false);
  });

  it('deletes slur relationships by MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="slur-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note id="slur-stop">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.deleteDomainSlurRelationshipBySourceIds({
        sourceId: 'slur-start',
        partnerSourceId: 'slur-stop',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelectorAll('note > notations > slur')).toHaveLength(0);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('deletes all slur relationships touching selected MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="slur-a">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note id="slur-b">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations>
          <slur type="stop" number="1"/>
          <slur type="start" number="2"/>
        </notations>
      </note>
      <note id="slur-c">
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><slur type="stop" number="2"/></notations>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.deleteDomainSlurRelationshipsForSourceIds({
        sourceIds: ['slur-b'],
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelectorAll('note > notations > slur')).toHaveLength(0);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('adds slur relationships by MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="slur-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="slur-stop">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.addDomainSlurRelationshipsBySourceIds({
        startSourceIds: ['slur-stop'],
        endSourceIds: ['slur-start'],
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelector('note[id="slur-start"] > notations > slur[type="start"]')).not.toBeNull();
    expect(xmlDoc.querySelector('note[id="slur-stop"] > notations > slur[type="stop"]')).not.toBeNull();
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('sets and clears slur placement by MusicXML source ids through domain commands', () => {
    const xml = scoreXml(`
      <note id="slur-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note id="slur-stop">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);

    const { result } = renderHook(() => ({
      domainEdit: useEditorDomainEdit(),
      scoreData: useScoreData(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.history.initialize(xml);
    });

    const editResultRef: { current: EditorDomainEditResult | null } = { current: null };
    act(() => {
      editResultRef.current = result.current.domainEdit.setDomainSlurPlacementBySourceIds({
        sourceId: 'slur-start',
        partnerSourceId: 'slur-stop',
        placement: 'above',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const withPlacement = new DOMParser().parseFromString(result.current.scoreData.currentXml ?? '', 'application/xml');
    expect(withPlacement.querySelector('note > notations > slur[type="start"]')?.getAttribute('placement')).toBe('above');

    act(() => {
      editResultRef.current = result.current.domainEdit.setDomainSlurPlacementBySourceIds({
        sourceId: 'slur-start',
        partnerSourceId: 'slur-stop',
      });
    });

    expect(editResultRef.current?.success).toBe(true);
    const withoutPlacement = new DOMParser().parseFromString(result.current.scoreData.currentXml ?? '', 'application/xml');
    expect(withoutPlacement.querySelector('note > notations > slur[type="start"]')?.hasAttribute('placement')).toBe(false);
  });
});
