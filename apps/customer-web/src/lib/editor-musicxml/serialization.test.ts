// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { importEditorMusicXml } from './import';
import { serializeEditorMusicXml } from './serialize';
import { EditorMusicXmlSerializationError, UnsupportedEditorMusicXmlError } from './source';
import {
  addNoteAtom,
  addSlurRelationship,
  addTieRelationship,
  deleteSlurRelationship,
  deleteTieRelationship,
  deleteVoiceEvent,
  insertExplicitRest,
  insertPitchedEvent,
  removeNoteAtom,
  setEventStemDirectionOverride,
  updateBeamRelationshipAtEvent,
  updateNoteAtom,
  updatePitchedEvent,
  type CommandResult,
} from '../editor-domain/commands';
import type { EventId, NoteAtomId, ScoreDocument } from '../editor-domain/model';

const sourceXml = `<score-partwise version="4.0">
<work><work-title>夜曲 — Source title</work-title></work><movement-title>Subtitle</movement-title>
<identification><creator type="composer">Composer</creator><creator type="lyricist">Lyricist</creator><rights>© Rights retained</rights></identification>
<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling><page-layout><page-height>1600</page-height><page-width>1200</page-width></page-layout></defaults>
<credit page="1"><credit-type>title</credit-type><credit-words font-size="20">Visible title</credit-words></credit>
<credit page="1"><credit-type>subtitle</credit-type><credit-words font-style="italic">Visible subtitle</credit-words></credit>
<part-list><score-part id="P1"><part-name>Piano</part-name><score-instrument id="I1"><instrument-name>Piano</instrument-name></score-instrument></score-part></part-list>
<part id="P1"><measure number="1" width="400"><print new-system="yes"><system-layout><system-distance>120</system-distance></system-layout></print>
<attributes><divisions>12</divisions><key><fifths>-2</fifths><mode>minor</mode></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<direction placement="above"><direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>88</per-minute></metronome></direction-type><sound tempo="88"/></direction>
<direction><direction-type><dynamics default-y="-40"><mf/></dynamics></direction-type></direction>
<note id="n1" default-x="70"><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>quarter</type><staff>1</staff><notations><articulations><staccato/></articulations></notations><lyric number="1"><syllabic>single</syllabic><text>Keep lyric</text></lyric></note>
<direction placement="above"><direction-type><words font-style="italic">dolce</words></direction-type><offset>0</offset></direction>
<note id="n2"><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff><beam number="1" color="#123456">begin</beam></note>
<note id="n3"><pitch><step>D</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff><beam number="1">end</beam></note>
<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="start"/><repeat direction="backward" times="2"/></barline>
</measure><measure number="2"><note id="n4"><pitch><step>E</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>12</duration></backup><note id="bass"><pitch><step>G</step><octave>3</octave></pitch><duration>12</duration><voice>2</voice><type>quarter</type><staff>2</staff></note></measure></part></score-partwise>`;

function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}
// Compare every element, attribute and significant text; only lexical XML formatting is ignored.
function canonical(xml: string) {
  function visit(node: Element): unknown {
    return [
      node.namespaceURI,
      node.tagName,
      Array.from(node.attributes)
        .map((attribute) => [attribute.name, attribute.value])
        .sort(([a], [b]) => a.localeCompare(b)),
      Array.from(node.childNodes).flatMap((child): unknown[] =>
        child.nodeType === 1
          ? [visit(child as Element)]
          : (child.nodeType === 3 || child.nodeType === 4) && child.textContent?.trim()
            ? [child.textContent]
            : [],
      ),
    ];
  }
  return visit(parse(xml).documentElement);
}
function accepted(result: CommandResult): ScoreDocument {
  if (!result.success) throw new Error(result.error);
  return result.document;
}
function event(document: ScoreDocument, id: string) {
  return document.events.find(
    (item) => item.kind === 'pitched' && item.notes.some((atom) => atom.id === id),
  )!;
}
function opaque(xml: string) {
  const document = parse(xml);
  return Array.from(
    document.querySelectorAll(
      'work, movement-title, identification, credit, defaults, attributes, direction, lyric, print, barline',
    ),
  ).map((node) => canonical(new XMLSerializer().serializeToString(node)));
}

it('preserves every source node and attribute in a no-op round trip deterministically', () => {
  const imported = importEditorMusicXml(sourceXml);
  const result = serializeEditorMusicXml(imported);
  expect(canonical(result)).toEqual(canonical(sourceXml));
  expect(serializeEditorMusicXml(imported)).toBe(result);
  expect(Object.keys(imported.source)).toEqual([]);
});

it('changes pitch, accidental, fingering and stem while preserving all unrelated modeled and opaque source', () => {
  const imported = importEditorMusicXml(sourceXml);
  const target = event(imported.document, 'n4');
  let document = accepted(
    updateNoteAtom({
      document: imported.document,
      eventId: target.id,
      noteAtomId: 'n4' as NoteAtomId,
      patch: { pitch: { step: 'F', alter: 1, octave: 5 }, accidental: 'sharp', fingering: '2' },
    }),
  );
  document = accepted(
    setEventStemDirectionOverride({ document, eventId: target.id, stemDirection: 'down' }),
  );
  const result = serializeEditorMusicXml({ document, source: imported.source });
  const expected = sourceXml.replace(
    '<note id="n4"><pitch><step>E</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>',
    '<note id="n4"><pitch><step>F</step><alter>1</alter><octave>5</octave></pitch><duration>12</duration><voice>1</voice><type>quarter</type><accidental>sharp</accidental><stem>down</stem><staff>1</staff><notations><technical><fingering>2</fingering></technical></notations></note>',
  );
  expect(canonical(result)).toEqual(canonical(expected));
  const reimported = importEditorMusicXml(result).document;
  expect(event(reimported, 'n4')).toMatchObject({
    notes: [{ pitch: { step: 'F', alter: 1, octave: 5 }, accidental: 'sharp', fingering: '2' }],
  });
  expect(importEditorMusicXml(sourceXml).document).toEqual(imported.document);
});

it('preserves inheritance and source data while rhythm changes keep other events at their domain positions', () => {
  const imported = importEditorMusicXml(sourceXml);
  const target = event(imported.document, 'n2');
  const document = accepted(
    updatePitchedEvent({
      document: imported.document,
      eventId: target.id,
      patch: {
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 4 },
          notation: { base: '16th', dots: 0 },
        },
      },
    }),
  );
  const xml = serializeEditorMusicXml({ document, source: imported.source });
  const reimported = importEditorMusicXml(xml).document;
  expect(event(reimported, 'n2').rhythm).toEqual(
    document.events.find((item) => item.id === target.id)!.rhythm,
  );
  for (const id of ['n1', 'n3', 'n4', 'bass']) {
    expect(event(reimported, id).position).toEqual(event(imported.document, id).position);
    expect(event(reimported, id).rhythm).toEqual(event(imported.document, id).rhythm);
  }
  expect(opaque(xml)).toEqual(opaque(sourceXml));
  expect(parse(xml).querySelector('measure[number="2"] > attributes')).toBeNull();
});

it('serializes chord membership, explicit rests and event insert/delete without erasing source data', () => {
  const imported = importEditorMusicXml(sourceXml);
  const target = event(imported.document, 'n4');
  let document = accepted(
    addNoteAtom({
      document: imported.document,
      eventId: target.id,
      note: { id: 'chord-new' as NoteAtomId, pitch: { step: 'G', octave: 4 } },
    }),
  );
  let xml = serializeEditorMusicXml({ document, source: imported.source });
  expect(event(importEditorMusicXml(xml).document, 'n4')).toMatchObject({
    notes: [{ id: 'n4' }, { id: 'chord-new' }],
  });
  document = accepted(
    removeNoteAtom({ document, eventId: target.id, noteAtomId: 'chord-new' as NoteAtomId }),
  );
  const placement = {
    measureId: target.position.measureId,
    offset: { numerator: 1, denominator: 1 },
  };
  document = accepted(
    insertExplicitRest(document, {
      id: 'rest-new' as EventId,
      voiceId: target.voiceId,
      staffId: target.staffId,
      position: placement,
      rhythm: {
        timelineDuration: { numerator: 1, denominator: 1 },
        notation: { base: 'quarter', dots: 0 },
      },
    }),
  );
  document = accepted(
    insertPitchedEvent(document, {
      id: 'event-new' as EventId,
      voiceId: target.voiceId,
      staffId: target.staffId,
      position: { ...placement, offset: { numerator: 2, denominator: 1 } },
      rhythm: target.rhythm,
      notes: [{ id: 'pitch-new' as NoteAtomId, pitch: { step: 'A', octave: 4 } }],
    }),
  );
  document = accepted(deleteVoiceEvent({ document, eventId: event(document, 'n3').id }));
  xml = serializeEditorMusicXml({ document, source: imported.source });
  const reimported = importEditorMusicXml(xml).document;
  expect(reimported.events.some((item) => item.kind === 'explicitRest')).toBe(true);
  expect(event(reimported, 'pitch-new').position.offset).toEqual({ numerator: 2, denominator: 1 });
  expect(event(reimported, 'n3')).toBeUndefined();
  expect(opaque(xml)).toEqual(opaque(sourceXml));
});

it('serializes tie, slur and beam command intent while retaining unrelated source notations', () => {
  const imported = importEditorMusicXml(sourceXml);
  let document = accepted(
    addTieRelationship({
      document: imported.document,
      startNoteAtomId: 'n1' as NoteAtomId,
      stopNoteAtomId: 'n2' as NoteAtomId,
    }),
  );
  document = accepted(
    addSlurRelationship({
      document,
      startNoteAtomId: 'n2' as NoteAtomId,
      stopNoteAtomId: 'n4' as NoteAtomId,
    }),
  );
  document = accepted(
    updateBeamRelationshipAtEvent({
      document,
      eventId: event(document, 'n2').id,
      action: 'break-right',
    }),
  );
  let xml = serializeEditorMusicXml({ document, source: imported.source });
  let reimported = importEditorMusicXml(xml).document;
  expect(reimported.tieRelationships).toHaveLength(1);
  expect(reimported.slurRelationships).toHaveLength(1);
  expect(reimported.beamRelationships).toHaveLength(0);
  expect(opaque(xml)).toEqual(opaque(sourceXml));
  document = accepted(deleteTieRelationship({ document, tieId: document.tieRelationships[0].id }));
  document = accepted(
    deleteSlurRelationship({ document, notationId: document.slurRelationships[0].id }),
  );
  xml = serializeEditorMusicXml({ document, source: imported.source });
  reimported = importEditorMusicXml(xml).document;
  expect(reimported.tieRelationships).toHaveLength(0);
  expect(reimported.slurRelationships).toHaveLength(0);
});

it('preserves an absent optional meter and infers an omitted type only from exact duration context', () => {
  const xml = sourceXml
    .replace('<time><beats>3</beats><beat-type>4</beat-type></time>', '')
    .replaceAll('<type>quarter</type>', '');
  const imported = importEditorMusicXml(xml);
  expect(canonical(serializeEditorMusicXml(imported))).toEqual(canonical(xml));
});

it.each([
  sourceXml.replace('<divisions>12</divisions>', ''),
  sourceXml.replace('<octave>4</octave>', ''),
  sourceXml.replace('<beats>3</beats>', '<beats>3+2</beats>'),
  sourceXml.replace('<type>eighth</type>', '<type>breve</type>'),
  sourceXml.replace('<duration>6</duration>', '<duration>5</duration>'),
  sourceXml.replace('<duration>12</duration>', '<grace/><duration>12</duration>'),
])('rejects input without an exact supported musical interpretation', (xml) => {
  expect(() => importEditorMusicXml(xml)).toThrow(UnsupportedEditorMusicXmlError);
});

it('rejects rhythms that cannot be represented in source divisions instead of rounding', () => {
  const imported = importEditorMusicXml(sourceXml);
  const target = event(imported.document, 'n4');
  const document = accepted(
    updatePitchedEvent({
      document: imported.document,
      eventId: target.id,
      patch: {
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 8 },
          notation: { base: '32nd', dots: 0 },
        },
      },
    }),
  );
  expect(() => serializeEditorMusicXml({ document, source: imported.source })).toThrow(
    EditorMusicXmlSerializationError,
  );
});

it('preserves source relationship formatting and attributes during unrelated pitch edits', () => {
  const xml = sourceXml
    .replace(
      '<voice>1</voice><type>quarter</type>',
      '<tie type="start" time-only="1"/><voice>1</voice><type>quarter</type>',
    )
    .replace(
      '<notations><articulations>',
      '<notations><tied type="start" orientation="under" color="#112233"/><slur type="start" number="7" placement="above" bezier-x="12"/><articulations>',
    )
    .replace(
      '<duration>6</duration><voice>1</voice>',
      '<duration>6</duration><tie type="stop"/><voice>1</voice>',
    )
    .replace(
      '<beam number="1" color="#123456">begin</beam>',
      '<beam number="1" color="#123456">begin</beam><notations><tied type="stop"/><slur type="stop" number="7" bezier-y="4"/></notations>',
    );
  const imported = importEditorMusicXml(xml);
  expect(canonical(serializeEditorMusicXml(imported))).toEqual(canonical(xml));
  const document = accepted(
    updateNoteAtom({
      document: imported.document,
      eventId: event(imported.document, 'n4').id,
      noteAtomId: 'n4' as NoteAtomId,
      patch: { pitch: { step: 'F', octave: 4 } },
    }),
  );
  const expected = xml.replace(
    '<pitch><step>E</step><octave>4</octave></pitch>',
    '<pitch><step>F</step><octave>4</octave></pitch>',
  );
  expect(canonical(serializeEditorMusicXml({ document, source: imported.source }))).toEqual(
    canonical(expected),
  );
});

it('rejects an edit that changes source part topology explicitly', () => {
  const imported = importEditorMusicXml(sourceXml);
  const document = { ...imported.document, parts: [] };
  expect(() => serializeEditorMusicXml({ document, source: imported.source })).toThrow(
    EditorMusicXmlSerializationError,
  );
});

it('rejects a pitch edit that leaves a tie without matching musical endpoints', () => {
  const imported = importEditorMusicXml(sourceXml);
  let document = accepted(
    addTieRelationship({
      document: imported.document,
      startNoteAtomId: 'n1' as NoteAtomId,
      stopNoteAtomId: 'n2' as NoteAtomId,
    }),
  );
  document = accepted(
    updateNoteAtom({
      document,
      eventId: event(document, 'n2').id,
      noteAtomId: 'n2' as NoteAtomId,
      patch: { pitch: { step: 'D', octave: 4 } },
    }),
  );
  expect(() => serializeEditorMusicXml({ document, source: imported.source })).toThrow(
    EditorMusicXmlSerializationError,
  );
  expect(canonical(serializeEditorMusicXml(imported))).toEqual(canonical(sourceXml));
});
