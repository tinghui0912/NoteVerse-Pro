// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { applyInspectorEdit } from './inspector-drafts';
import { addNoteAtom } from './commands';
import type { EventId, RhythmicValue } from './model';
import { getPitchedEventDisplayKind } from './model';
import { exportEditorDomainToMusicXml } from './musicxml-exporter';
import { importMusicXmlToEditorDomain } from './musicxml-importer';
import { createAppendedNoteAtomIdentity } from './note-atom-identity';

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
        <staves>2</staves>
      </attributes>
      ${measureContent}
    </measure>
  </part>
</score-partwise>`;
}

function eventSignature(result: ReturnType<typeof importMusicXmlToEditorDomain>) {
  return result.document.events.map((event) => {
    if (event.kind === 'explicitRest') {
      return {
        kind: event.kind,
        voiceId: String(event.voiceId),
        staffId: String(event.staffId),
        offset: event.position.offset,
        duration: event.rhythm.timelineDuration,
        notation: event.rhythm.notation,
      };
    }

    return {
      kind: event.kind,
      displayKind: getPitchedEventDisplayKind(event),
      voiceId: String(event.voiceId),
      staffId: String(event.staffId),
      offset: event.position.offset,
      duration: event.rhythm.timelineDuration,
      notation: event.rhythm.notation,
      pitches: event.notes.map((note) => ({
        step: note.pitch.step,
        alter: note.pitch.alter,
        octave: note.pitch.octave,
        accidental: note.accidental,
        fingering: note.fingering,
      })),
    };
  });
}

function gapSignature(result: ReturnType<typeof importMusicXmlToEditorDomain>) {
  return result.gaps.map((gap) => ({
    kind: gap.kind,
    voiceId: String(gap.voiceId),
    staffId: String(gap.staffId),
    start: gap.start.offset,
    duration: gap.duration,
  }));
}

function roundTrip(xml: string) {
  const imported = importMusicXmlToEditorDomain(xml);
  const exportedXml = exportEditorDomainToMusicXml(imported.document);
  const reimported = importMusicXmlToEditorDomain(exportedXml);

  return {
    imported,
    exportedXml,
    reimported,
  };
}

const half: RhythmicValue = {
  timelineDuration: { numerator: 2, denominator: 1 },
  notation: { base: 'half', dots: 0 },
};

describe('MusicXML editor-domain round trip invariants', () => {
  it('keeps note, chord, explicit rest, and gap semantics stable', () => {
    const { imported, exportedXml, reimported } = roundTrip(scoreXml(`
      <note id="n1">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <forward id="f1">
        <duration>4</duration>
        <voice>1</voice>
        <staff>1</staff>
      </forward>
      <note id="c1">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note id="g1">
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note id="r1">
        <rest/>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `));

    expect(eventSignature(reimported)).toEqual(eventSignature(imported));
    expect(gapSignature(reimported)).toEqual(gapSignature(imported));
    expect(exportedXml).toContain('<forward>');
    expect(reimported.document.events.map((event) => event.kind)).toEqual([
      'pitched',
      'pitched',
      'explicitRest',
    ]);
  });

  it('keeps backup as a serialization detail for multiple voices', () => {
    const { imported, exportedXml, reimported } = roundTrip(scoreXml(`
      <note id="v1n1">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>4</duration>
      </backup>
      <note id="v2n1">
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    `));

    expect(eventSignature(reimported)).toEqual(eventSignature(imported));
    expect(exportedXml).toContain('<backup>');
    expect(reimported.document.events).toHaveLength(2);
    expect(reimported.document.events.map((event) => event.position.offset)).toEqual([
      { numerator: 0, denominator: 1 },
      { numerator: 0, denominator: 1 },
    ]);
  });

  it('preserves notation fields that are part of current domain scope', () => {
    const { imported, reimported } = roundTrip(scoreXml(`
      <note id="ornamented">
        <pitch><step>F</step><alter>1</alter><octave>4</octave></pitch>
        <duration>6</duration>
        <voice>1</voice>
        <type>quarter</type>
        <dot/>
        <accidental>sharp</accidental>
        <staff>1</staff>
        <notations>
          <technical>
            <fingering>3</fingering>
          </technical>
        </notations>
      </note>
    `));

    expect(eventSignature(reimported)).toEqual(eventSignature(imported));
    expect(eventSignature(reimported)[0]).toMatchObject({
      notation: {
        base: 'quarter',
        dots: 1,
      },
      pitches: [
        {
          step: 'F',
          alter: 1,
          octave: 4,
          accidental: 'sharp',
          fingering: '3',
        },
      ],
    });
  });

  it('keeps Inspector domain edits stable through export and re-import', () => {
    const imported = importMusicXmlToEditorDomain(scoreXml(`
      <note id="editable-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `));
    const event = imported.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (!event || event.kind !== 'pitched') return;

    const edited = applyInspectorEdit(
      imported.document,
      {
        kind: 'pitchedEvent',
        eventId: event.id,
        rhythm: half,
      },
      { stemDirection: 'down' },
    );

    expect(edited.success).toBe(true);
    if (!edited.success) return;

    const exportedXml = exportEditorDomainToMusicXml(edited.document);
    const reimported = importMusicXmlToEditorDomain(exportedXml);

    expect(exportedXml).toContain('<type>half</type>');
    expect(exportedXml).toContain('<stem>down</stem>');
    expect(reimported.document.events).toHaveLength(1);
    expect(reimported.document.events[0]).toMatchObject({
      id: event.id,
      kind: 'pitched',
      rhythm: half,
    });
    expect(reimported.document.notationControls).toEqual([
      {
        kind: 'eventNotation',
        eventId: event.id as EventId,
        stemDirection: 'down',
      },
    ]);
  });

  it('keeps an appended chord member identity through export and re-import', () => {
    const imported = importMusicXmlToEditorDomain(scoreXml(`
      <note id="editable-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `));
    const event = imported.document.events[0];
    expect(event?.kind).toBe('pitched');
    if (!event || event.kind !== 'pitched') return;

    const identity = createAppendedNoteAtomIdentity(imported.document, event);
    const appended = addNoteAtom({
      document: imported.document,
      eventId: event.id,
      note: {
        id: identity.noteAtomId,
        pitch: { step: 'E', octave: 4 },
        source: { musicXmlElementId: identity.musicXmlElementId },
      },
    });

    expect(appended.success).toBe(true);
    if (!appended.success) return;

    const exportedXml = exportEditorDomainToMusicXml(appended.document);
    const reimported = importMusicXmlToEditorDomain(exportedXml);
    const reimportedEvent = reimported.document.events[0];

    expect(exportedXml).toContain('<note id="editable-note-chord-2">');
    expect(reimportedEvent).toMatchObject({ kind: 'pitched' });
    if (!reimportedEvent || reimportedEvent.kind !== 'pitched') return;
    expect(reimportedEvent.notes.map((note) => note.id)).toEqual([
      'editable-note',
      'editable-note-chord-2',
    ]);
    expect(reimportedEvent.notes.map((note) => note.source?.musicXmlElementId)).toEqual([
      'editable-note',
      'editable-note-chord-2',
    ]);
  });
});
