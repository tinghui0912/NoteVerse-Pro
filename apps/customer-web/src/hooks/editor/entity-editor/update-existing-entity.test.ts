// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { updateExistingEntity } from './update-existing-entity';
import type { ScoreData } from '@/types/score-types';

const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff><beam number="1">begin</beam></note></measure></part></score-partwise>`;

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

  it('converts a measure rest into an explicitly notated rest when its duration changes', () => {
    const measureRestXml = xml.replace(
      '<pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type>',
      '<rest measure="yes"/><duration>16</duration><voice>1</voice>',
    ).replace('<beam number="1">begin</beam>', '');
    const result = updateExistingEntity({
      currentXml: measureRestXml,
      scoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: { type: 'rest', duration: 'durationHalf' },
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('rest')?.hasAttribute('measure')).toBe(false);
    expect(updated.querySelector('note > duration')?.textContent).toBe('8');
    expect(updated.querySelector('note > type')?.textContent).toBe('half');
  });

  it('creates a notated type when a measure rest is converted into a pitched note', () => {
    const measureRestXml = xml.replace(
      '<pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type>',
      '<rest measure="yes"/><duration>16</duration><voice>1</voice>',
    ).replace('<beam number="1">begin</beam>', '');
    const result = updateExistingEntity({
      currentXml: measureRestXml,
      scoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: { type: 'note', pitch: 'C4', duration: 'durationHalf' },
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('note > rest')).toBeNull();
    expect(updated.querySelector('note > pitch > step')?.textContent).toBe('C');
    expect(updated.querySelector('note > duration')?.textContent).toBe('8');
    expect(updated.querySelector('note > type')?.textContent).toBe('half');
  });

  it('updates a blank forward duration without converting it to a rest', () => {
    const forwardXml = xml.replace(
      '<note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff><beam number="1">begin</beam></note>',
      '<forward id="f1"><duration>4</duration><voice>1</voice><staff>1</staff></forward>',
    );
    const forwardScoreData: ScoreData = {
      ...scoreData,
      measures: [{
        ...scoreData.measures[0],
        staves: [{
          ...scoreData.measures[0].staves[0],
          voices: [{
            name: 'voiceLabel 1',
            notes: [{
              type: 'blank',
              duration: 'durationQuarter',
              meta: { id: 'f1', measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 },
            }],
          }],
        }],
      }],
    };

    const result = updateExistingEntity({
      currentXml: forwardXml,
      scoreData: forwardScoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: { type: 'blank', duration: 'durationHalf' },
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('forward > duration')?.textContent).toBe('8');
    expect(updated.querySelector('note')).toBeNull();
    expect(result.newScoreData?.measures[0]?.staves[0]?.voices[0]?.notes[0]?.type).toBe('blank');
  });

  it('converts a blank forward into a pitched note when a pitch is added', () => {
    const forwardXml = xml.replace(
      '<note id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff><beam number="1">begin</beam></note>',
      '<forward id="f1"><duration>4</duration><voice>1</voice><staff>1</staff></forward>',
    );
    const forwardScoreData: ScoreData = {
      ...scoreData,
      measures: [{
        ...scoreData.measures[0],
        staves: [{
          ...scoreData.measures[0].staves[0],
          voices: [{
            name: 'voiceLabel 1',
            notes: [{
              type: 'blank',
              duration: 'durationQuarter',
              meta: { id: 'f1', measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 },
            }],
          }],
        }],
      }],
    };

    const result = updateExistingEntity({
      currentXml: forwardXml,
      scoreData: forwardScoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: { type: 'note', pitch: 'E4', duration: 'durationQuarter' },
      getExpectedVoices: () => undefined,
    });

    expect(result.success).toBe(true);
    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('forward')).toBeNull();
    expect(updated.querySelector('note')?.getAttribute('id')).toBe('f1');
    expect(updated.querySelector('note > pitch > step')?.textContent).toBe('E');
    expect(updated.querySelector('note > duration')?.textContent).toBe('4');
    expect(updated.querySelector('note > voice')?.textContent).toBe('1');
    expect(updated.querySelector('note > staff')?.textContent).toBe('1');
    expect(result.newScoreData?.measures[0]?.staves[0]?.voices[0]?.notes[0]?.type).toBe('note');
  });

  it('writes matching pitch alteration and notated accidental', () => {
    const result = updateExistingEntity({
      currentXml: xml,
      scoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: {
        type: 'note',
        pitch: 'Dbb4',
        accidental: 'flat-flat',
        duration: 'durationEighth',
      },
      getExpectedVoices: () => undefined,
    });

    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('pitch > step')?.textContent).toBe('D');
    expect(updated.querySelector('pitch > alter')?.textContent).toBe('-2');
    expect(updated.querySelector('note > accidental')?.textContent).toBe('flat-flat');
  });

  it('removes both the alteration and accidental when a symbol is toggled off', () => {
    const alteredXml = xml.replace(
      '<pitch><step>C</step><octave>4</octave></pitch>',
      '<pitch><step>C</step><alter>1</alter><octave>4</octave></pitch>',
    ).replace('<type>eighth</type>', '<type>eighth</type><accidental>sharp</accidental>');
    const result = updateExistingEntity({
      currentXml: alteredXml,
      scoreData,
      editingEntityLocation: { measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0 },
      updatedEntity: {
        type: 'note',
        pitch: 'C4',
        accidental: null,
        duration: 'durationEighth',
      },
      getExpectedVoices: () => undefined,
    });

    const updated = new DOMParser().parseFromString(result.newXml!, 'application/xml');
    expect(updated.querySelector('pitch > alter')).toBeNull();
    expect(updated.querySelector('note > accidental')).toBeNull();
  });

  it('updates sounding duration and keeps beams on chord roots after adding a dot', () => {
    const chordXml = xml.replace(
      '</note>',
      '</note><note id="n2"><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note><note id="n3"><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>',
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
