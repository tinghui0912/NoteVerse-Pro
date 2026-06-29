// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { ScoreData } from '@/types/score-types';
import { parseXml } from '@/lib/musicxml/core';
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
});
