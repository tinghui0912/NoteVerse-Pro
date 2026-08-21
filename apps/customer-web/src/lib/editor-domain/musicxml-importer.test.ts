// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { getPitchedEventDisplayKind } from './model';
import { importMusicXmlToEditorDomain } from './musicxml-importer';

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

describe('MusicXML to editor domain importer', () => {
  it('imports pitched notes and explicit rests as voice events', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="n1">
        <pitch><step>C</step><octave>4</octave></pitch>
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

    expect(result.document.parts).toMatchObject([{ name: 'Piano' }]);
    expect(result.document.events).toHaveLength(2);
    expect(result.document.events.map((event) => event.kind)).toEqual(['pitched', 'explicitRest']);
    expect(result.document.events[0]?.position.offset).toEqual({ numerator: 0, denominator: 1 });
    expect(result.document.events[1]?.position.offset).toEqual({ numerator: 1, denominator: 1 });
  });

  it('treats forward as cursor movement and derives a timeline gap instead of an event', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
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
      <note id="n2">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `));

    expect(result.document.events).toHaveLength(2);
    expect(result.document.events.map((event) => event.kind)).toEqual(['pitched', 'pitched']);
    expect(result.document.events[1]?.position.offset).toEqual({ numerator: 2, denominator: 1 });
    expect(result.gaps).toMatchObject([
      {
        kind: 'timelineGap',
        start: {
          offset: {
            numerator: 1,
            denominator: 1,
          },
        },
        duration: {
          numerator: 1,
          denominator: 1,
        },
      },
      {
        kind: 'timelineGap',
        start: {
          offset: {
            numerator: 3,
            denominator: 1,
          },
        },
        duration: {
          numerator: 1,
          denominator: 1,
        },
      },
    ]);
    expect(result.document.events.map((event) => event.kind)).not.toContain('explicitRest');
  });

  it('uses backup to place a second voice without creating an event', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
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
        <staff>1</staff>
      </note>
    `));

    expect(result.document.events).toHaveLength(2);
    expect(result.document.voices).toHaveLength(2);
    expect(result.document.events.map((event) => event.position.offset)).toEqual([
      { numerator: 0, denominator: 1 },
      { numerator: 0, denominator: 1 },
    ]);
    expect(result.document.events.map((event) => event.kind)).toEqual(['pitched', 'pitched']);
  });

  it('imports MusicXML chord encoding as one pitched event with multiple note atoms', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="c">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note id="e">
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note id="g">
        <chord/>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `));

    const event = result.document.events[0];

    expect(result.document.events).toHaveLength(1);
    expect(event?.kind).toBe('pitched');
    if (event?.kind === 'pitched') {
      expect(getPitchedEventDisplayKind(event)).toBe('chord');
      expect(event.notes.map((note) => note.pitch.step)).toEqual(['C', 'E', 'G']);
    }
  });

  it('preserves voice identity across staff changes while keeping event staff placement', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="upper">
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note id="lower">
        <pitch><step>A</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    `));

    expect(result.document.voices).toHaveLength(1);
    expect(result.document.staves).toHaveLength(2);
    expect(result.document.events[0]?.voiceId).toBe(result.document.events[1]?.voiceId);
    expect(result.document.events[0]?.staffId).not.toBe(result.document.events[1]?.staffId);
    expect(result.document.voices[0]?.homeStaffId).toBe(result.document.events[0]?.staffId);
  });

  it('imports dotted rhythm, accidentals, fingering, and source ids into the domain model', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
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
            <fingering>③</fingering>
          </technical>
        </notations>
      </note>
    `));

    const event = result.document.events[0];

    expect(event?.rhythm).toMatchObject({
      timelineDuration: {
        numerator: 3,
        denominator: 2,
      },
      notation: {
        base: 'quarter',
        dots: 1,
      },
    });
    expect(event?.source).toEqual({ musicXmlElementIds: ['ornamented'] });
    if (event?.kind === 'pitched') {
      expect(event.notes[0]).toMatchObject({
        pitch: {
          step: 'F',
          alter: 1,
          octave: 4,
        },
        accidental: 'sharp',
        fingering: '3',
        source: {
          musicXmlElementId: 'ornamented',
        },
      });
    }
  });

  it('imports explicit MusicXML stem values as event notation controls', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="stem-up">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <stem>up</stem>
        <staff>1</staff>
      </note>
      <note id="stem-down">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <stem>down</stem>
        <staff>1</staff>
      </note>
      <note id="stem-none">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <stem>none</stem>
        <staff>1</staff>
      </note>
      <note id="stem-double">
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <stem>double</stem>
        <staff>1</staff>
      </note>
    `));

    expect(result.document.notationControls).toEqual([
      { kind: 'eventNotation', eventId: result.document.events[0]?.id, stemDirection: 'up' },
      { kind: 'eventNotation', eventId: result.document.events[1]?.id, stemDirection: 'down' },
      { kind: 'eventNotation', eventId: result.document.events[2]?.id, stemDirection: 'none' },
      { kind: 'eventNotation', eventId: result.document.events[3]?.id, stemDirection: 'double' },
    ]);
  });

  it('does not create notation controls when MusicXML stem is absent', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="automatic-stem">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `));

    expect(result.document.notationControls).toEqual([]);
  });

  it('imports level-one MusicXML beam groups as domain beam relationships', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="beam-a">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <staff>1</staff>
        <beam number="1">begin</beam>
      </note>
      <note id="beam-b">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <staff>1</staff>
        <beam number="1">end</beam>
      </note>
    `));

    expect(result.document.beamRelationships).toEqual([
      {
        id: 'P1-m1-beam-1',
        eventIds: [
          result.document.events[0]?.id,
          result.document.events[1]?.id,
        ],
      },
    ]);
  });

  it('imports MusicXML ties as domain tie relationships between note atoms', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="tie-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations>
          <tied type="start" orientation="over"/>
        </notations>
      </note>
      <note id="tie-stop">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="stop"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations>
          <tied type="stop"/>
        </notations>
      </note>
    `));

    expect(result.document.tieRelationships).toEqual([
      {
        id: 'P1-m1-tie-1',
        startNoteAtomId: 'tie-start',
        stopNoteAtomId: 'tie-stop',
      },
    ]);
    const [startEvent, stopEvent] = result.document.events;
    expect(startEvent?.kind).toBe('pitched');
    expect(stopEvent?.kind).toBe('pitched');
    if (startEvent?.kind !== 'pitched' || stopEvent?.kind !== 'pitched') return;
    expect(startEvent.notes[0]?.tieOut).toBe('P1-m1-tie-1');
    expect(stopEvent.notes[0]?.tieIn).toBe('P1-m1-tie-1');
    expect(result.document.notationControls).toEqual([
      {
        kind: 'tieNotation',
        tieId: 'P1-m1-tie-1',
        placement: 'above',
      },
    ]);
  });

  it('imports MusicXML slurs as domain slur relationships between note atoms', () => {
    const result = importMusicXmlToEditorDomain(scoreXml(`
      <note id="slur-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations>
          <slur type="start" number="1" placement="below"/>
        </notations>
      </note>
      <note id="slur-stop">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations>
          <slur type="stop" number="1"/>
        </notations>
      </note>
    `));

    expect(result.document.slurRelationships).toEqual([
      {
        id: 'P1-m1-slur-1',
        startNoteAtomId: 'slur-start',
        stopNoteAtomId: 'slur-stop',
      },
    ]);
    expect(result.document.notationControls).toEqual([
      {
        kind: 'slurNotation',
        notationId: 'P1-m1-slur-1',
        placement: 'below',
      },
    ]);
  });
});
