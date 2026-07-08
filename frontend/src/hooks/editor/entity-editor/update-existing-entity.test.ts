// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { updateExistingEntity } from './update-existing-entity';
import type { ScoreData } from '@/types/score-types';

const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note xml:id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff><beam number="1">begin</beam></note></measure></part></score-partwise>`;

const scoreData: ScoreData = {
  timeSignature: '4/4',
  measures: [{
    number: 1,
    staves: [{
      clef: 'treble',
      name: 'trebleClef',
      voices: [{
        name: 'voiceLabel 1',
        notes: [{
          type: 'note',
          pitch: 'C4',
          duration: 'durationEighth',
          meta: { id: 'n1', measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 },
        }],
      }],
    }],
  }],
};

describe('updateExistingEntity beam trigger', () => {
  it('preserves imported beam XML for a pitch-only update', () => {
    const result = updateExistingEntity({
      currentXml: xml,
      scoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: { type: 'note', pitch: 'D4', duration: 'durationEighth' },
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('pitch > step')?.textContent).toBe('D');
    expect(updated.querySelector('beam')?.textContent).toBe('begin');
  });

  it('rebuilds stale beam XML after a duration update', () => {
    const result = updateExistingEntity({
      currentXml: xml,
      scoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: { type: 'note', pitch: 'C4', duration: 'durationQuarter' },
      getExpectedVoices: () => undefined,
    });

    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('beam')).toBeNull();
  });

  it('updates sounding duration and keeps beams on chord roots after adding a dot', () => {
    const chordXml = xml.replace(
      '</note>',
      '</note><note xml:id="n2"><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note><note xml:id="n3"><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>',
    );
    const result = updateExistingEntity({
      currentXml: chordXml,
      scoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: {
        type: 'chord',
        pitches: ['C4', 'E4'],
        fingerings: [],
        duration: 'durationEighth',
        dotted: true,
      },
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    const notes = Array.from(updated.querySelectorAll('note'));
    expect(notes[0].querySelector(':scope > duration')?.textContent).toBe('3');
    expect(notes[1].querySelector(':scope > duration')?.textContent).toBe('3');
    expect(notes[1].querySelector(':scope > beam')).toBeNull();
  });
});
