// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { ScoreData } from '@/types/score-types';
import { parseXml } from '@/lib/musicxml/core';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import { insertEntity } from './insert-entity';

const emptyTwoStaffScore: ScoreData = {
  measures: [
    {
      number: 1,
      staves: [
        {
          clef: 'treble',
          name: 'trebleClef',
          voices: [{ name: 'voiceLabel 1', notes: [] }],
        },
        {
          clef: 'bass',
          name: 'bassClef',
          voices: [{ name: 'voiceLabel 1', notes: [] }],
        },
      ],
    },
  ],
};

const baseXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>2</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
        <clef number="2">
          <sign>F</sign>
          <line>4</line>
        </clef>
      </attributes>
    </measure>
  </part>
</score-partwise>`;

const mixedStaffVoiceXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <staves>2</staves>
        <clef number="1">
          <sign>G</sign>
          <line>2</line>
        </clef>
        <clef number="2">
          <sign>F</sign>
          <line>4</line>
        </clef>
      </attributes>
      <note id="treble-v1-a">
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note id="treble-v1-b">
        <pitch>
          <step>D</step>
          <octave>5</octave>
        </pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>2</duration>
      </backup>
      <note id="bass-v2-a">
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>1</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note id="bass-v2-b">
        <pitch>
          <step>D</step>
          <octave>3</octave>
        </pitch>
        <duration>1</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

const chordTimelineXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <staves>2</staves>
      </attributes>
      <note id="treble-chord-root">
        <pitch>
          <step>C</step>
          <octave>5</octave>
        </pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <note id="treble-chord-member">
        <chord/>
        <pitch>
          <step>E</step>
          <octave>5</octave>
        </pitch>
        <duration>1</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
      </note>
      <backup>
        <duration>1</duration>
      </backup>
      <note id="bass-v2">
        <pitch>
          <step>C</step>
          <octave>3</octave>
        </pitch>
        <duration>1</duration>
        <voice>2</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

describe('insertEntity', () => {
  it('inserts empty-pitch events as valid MusicXML rests in the target staff and voice', () => {
    const result = insertEntity({
      updatedEntity: {
        type: 'rest',
        duration: 'durationQuarter',
      },
      location: {
        measureIndex: 0,
        staveIndex: 1,
        xmlVoice: 1,
        tick: 0,
      },
      currentXml: baseXml,
      scoreData: emptyTwoStaffScore,
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    expect(result.newXml).not.toContain('common.rest');
    expect(result.newXml).not.toContain('common.voice');

    const xmlDoc = parseXml(result.newXml ?? '');
    const note = xmlDoc.querySelector('measure[number="1"] note');

    expect(note?.querySelector('rest')).not.toBeNull();
    expect(note?.querySelector('voice')?.textContent).toBe('1');
    expect(note?.querySelector('staff')?.textContent).toBe('2');
  });

  it('keeps existing treble voice 1 notes separate when inserting an empty treble voice 2 rest', () => {
    const scoreData = new MusicXMLParser(mixedStaffVoiceXml).parse();

    const result = insertEntity({
      updatedEntity: {
        type: 'rest',
        duration: 'durationQuarter',
      },
      location: {
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 2,
        tick: 0,
      },
      currentXml: mixedStaffVoiceXml,
      scoreData,
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const xmlDoc = parseXml(result.newXml ?? '');
    const trebleVoiceTwoRest = Array.from(xmlDoc.querySelectorAll('measure[number="1"] note')).find((note) => (
      note.querySelector('rest')
      && note.querySelector('voice')?.textContent === '2'
      && note.querySelector('staff')?.textContent === '1'
    ));

    expect(trebleVoiceTwoRest).toBeDefined();
    expect(Array.from(xmlDoc.querySelectorAll('measure[number="1"] backup'))).toHaveLength(2);

    const parsed = result.newScoreData;
    const treble = parsed?.measures[0]?.staves[0];
    const bass = parsed?.measures[0]?.staves[1];
    const trebleVoiceOne = treble?.voices.find((voice) => voice.name === 'voiceLabel 1');
    const trebleVoiceTwo = treble?.voices.find((voice) => voice.name === 'voiceLabel 2');
    const bassVoiceTwo = bass?.voices.find((voice) => voice.name === 'voiceLabel 2');

    expect(trebleVoiceOne?.notes.map((entity) => entity.meta?.xmlVoice)).toEqual([1, 1]);
    expect(trebleVoiceTwo?.notes).toHaveLength(1);
    expect(trebleVoiceTwo?.notes[0]?.type).toBe('rest');
    expect(trebleVoiceTwo?.notes[0]?.meta?.staveIndex).toBe(0);
    expect(bassVoiceTwo?.notes.map((entity) => entity.meta?.staveIndex)).toEqual([1, 1]);
  });

  it('does not count chord members when backing up before inserting into an empty voice', () => {
    const scoreData = new MusicXMLParser(chordTimelineXml).parse();

    const result = insertEntity({
      updatedEntity: {
        type: 'rest',
        duration: 'durationQuarter',
      },
      location: {
        measureIndex: 0,
        staveIndex: 0,
        xmlVoice: 2,
        tick: 0,
      },
      currentXml: chordTimelineXml,
      scoreData,
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const xmlDoc = parseXml(result.newXml ?? '');
    const backupDurations = Array.from(xmlDoc.querySelectorAll('measure[number="1"] backup duration'))
      .map((duration) => duration.textContent);

    expect(backupDurations).toEqual(['1', '1']);
  });
});
