// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { parseXml } from '@/lib/musicxml/core';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import { createAddModeInputDurationFromDuration } from './add-mode-command';
import { applyAddModeDomainInsert } from './add-mode-domain-insert';
import type { InsertionAnchor } from '@/lib/editor-domain';

const firstStaffRestId = 'add-rest-P1-measure-1-P1-staff-1-P1-voice-1-o1';
const firstStaffNoteId = 'add-note-P1-measure-1-P1-staff-1-P1-voice-1-o1-note-1';
const secondStaffRestId = 'add-rest-P1-measure-1-P1-staff-2-P1-voice-2-o0';

function scoreXml(measureContent: string, staves = 1) {
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
        <staves>${staves}</staves>
      </attributes>
      ${measureContent}
    </measure>
  </part>
</score-partwise>`;
}

function noteSignature(xml: string) {
  const xmlDoc = parseXml(xml);
  return Array.from(xmlDoc.querySelectorAll('part > measure > note')).map((note) => ({
    id: note.getAttribute('id'),
    kind: note.querySelector(':scope > rest') ? 'rest' : 'note',
    pitch: note.querySelector(':scope > pitch > step')?.textContent
      ? `${note.querySelector(':scope > pitch > step')?.textContent}${note.querySelector(':scope > pitch > octave')?.textContent}`
      : undefined,
    duration: note.querySelector(':scope > duration')?.textContent,
    voice: note.querySelector(':scope > voice')?.textContent,
    type: note.querySelector(':scope > type')?.textContent,
    staff: note.querySelector(':scope > staff')?.textContent,
  }));
}

describe('applyAddModeDomainInsert', () => {
  it('inserts an explicit rest after an existing event through the domain exporter', () => {
    const currentXml = scoreXml(`
      <note id="existing-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `);
    const scoreData = new MusicXMLParser(currentXml).parse();

    const result = applyAddModeDomainInsert({
      currentXml,
      scoreData,
      getExpectedVoices: () => undefined,
      insertionAnchor: caretAnchor({
        staffId: 'P1:staff-1',
        voiceId: 'P1:voice-1',
        offset: { numerator: 1, denominator: 1 },
      }),
      command: {
        kind: 'insertExplicitRest',
        inputDuration: createAddModeInputDurationFromDuration('durationHalf'),
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(noteSignature(result.newXml)).toEqual([
      {
        id: 'existing-note',
        kind: 'note',
        pitch: 'C4',
        duration: '4',
        voice: '1',
        type: 'quarter',
        staff: '1',
      },
      {
        id: firstStaffRestId,
        kind: 'rest',
        pitch: undefined,
        duration: '8',
        voice: '1',
        type: 'half',
        staff: '1',
      },
    ]);
    expect(result.newScoreData.measures[0]?.staves[0]?.voices[0]?.events.at(-1)).toMatchObject({
      type: 'rest',
      duration: 'durationHalf',
      meta: {
        id: firstStaffRestId,
        startTick: 4,
        xmlVoice: 1,
      },
    });
  });

  it('inserts into the selected second staff and second voice', () => {
    const currentXml = scoreXml(`
      <note id="treble-v1">
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
    `, 2);
    const scoreData = new MusicXMLParser(currentXml).parse();

    const result = applyAddModeDomainInsert({
      currentXml,
      scoreData,
      getExpectedVoices: () => new Map([
        [0, new Map([
          [0, [1]],
          [1, [2]],
        ])],
      ]),
      insertionAnchor: caretAnchor({
        staffId: 'P1:staff-2',
        voiceId: 'P1:voice-2',
        offset: { numerator: 0, denominator: 1 },
      }),
      command: {
        kind: 'insertExplicitRest',
        inputDuration: createAddModeInputDurationFromDuration('durationQuarter'),
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(noteSignature(result.newXml)).toEqual([
      {
        id: 'treble-v1',
        kind: 'note',
        pitch: 'C5',
        duration: '4',
        voice: '1',
        type: 'quarter',
        staff: '1',
      },
      {
        id: secondStaffRestId,
        kind: 'rest',
        pitch: undefined,
        duration: '4',
        voice: '2',
        type: 'quarter',
        staff: '2',
      },
    ]);
    expect(result.newXml).toContain('<backup>');
    expect(result.newScoreData.measures[0]?.staves[1]?.voices[0]?.events[0]).toMatchObject({
      type: 'rest',
      duration: 'durationQuarter',
      meta: {
        id: secondStaffRestId,
        startTick: 0,
        xmlVoice: 2,
        staveIndex: 1,
      },
    });
  });

  it('inserts a pitched event through the domain exporter', () => {
    const currentXml = scoreXml(``);
    const scoreData = new MusicXMLParser(currentXml).parse();

    const result = applyAddModeDomainInsert({
      currentXml,
      scoreData,
      getExpectedVoices: () => undefined,
      insertionAnchor: caretAnchor({
        staffId: 'P1:staff-1',
        voiceId: 'P1:voice-1',
        offset: { numerator: 1, denominator: 1 },
      }),
      command: {
        kind: 'insertPitchedEvent',
        inputDuration: createAddModeInputDurationFromDuration('durationQuarter'),
        pitch: {
          step: 'C',
          octave: 4,
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.insertedEntityId).toBe(firstStaffNoteId);
    expect(noteSignature(result.newXml)).toEqual([
      {
        id: firstStaffNoteId,
        kind: 'note',
        pitch: 'C4',
        duration: '4',
        voice: '1',
        type: 'quarter',
        staff: '1',
      },
    ]);
    expect(result.newScoreData.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'note',
      pitch: 'C4',
      duration: 'durationQuarter',
      meta: {
        id: firstStaffNoteId,
        startTick: 4,
        xmlVoice: 1,
      },
    });
  });
});

function caretAnchor(params: {
  staffId: string;
  voiceId: string;
  offset: { numerator: number; denominator: number };
}): InsertionAnchor {
  return {
    kind: 'caret',
    caret: {
      kind: 'caret',
      staffId: params.staffId as never,
      voiceId: params.voiceId as never,
      position: {
        measureId: 'P1:measure-1' as never,
        offset: params.offset,
      },
    },
  };
}
