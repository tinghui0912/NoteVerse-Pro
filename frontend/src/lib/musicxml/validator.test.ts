// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { validateDataIntegrity } from './validator';
import type { ScoreData } from '@/types/score-types';

const xml = `<?xml version="1.0"?><score-partwise><part-list/><part><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes></measure></part></score-partwise>`;
const translate = (key: string) => key;

describe('validateDataIntegrity', () => {
  it('returns structured, locatable duration issues from the shared timeline calculation', () => {
    const scoreData: ScoreData = {
      timeSignature: '4/4',
      measures: [{
        number: 1,
        staves: [{
          clef: 'treble',
          name: 'trebleClef',
          voices: [{
            name: 'voiceLabel 1',
            notes: [{ type: 'note', pitch: 'C4', duration: 'durationQuarter' }],
          }],
        }],
      }],
    };

    const result = validateDataIntegrity(scoreData, xml, translate);

    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: 'measure.duration_underfill',
      severity: 'warning',
      measureIndex: 0,
      staffIndex: 0,
      voice: 1,
      details: { expectedTicks: 4, actualTicks: 1, deltaTicks: -3 },
    });
  });

  it('returns structured beam closure and level warnings', () => {
    const beamXml = `<?xml version="1.0"?><score-partwise><part-list/><part><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note xml:id="n1"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><staff>1</staff><beam number="2">begin</beam></note></measure></part></score-partwise>`;
    const scoreData: ScoreData = {
      timeSignature: '4/4',
      measures: [{ number: 1, staves: [{ clef: 'treble', name: 'trebleClef', voices: [] }] }],
    };

    const result = validateDataIntegrity(scoreData, beamXml, translate);

    expect(result.warnings.map((issue) => issue.code)).toEqual([
      'beam.level_gap',
      'beam.unpaired_begin',
    ]);
    expect(result.warnings[0]).toMatchObject({ measureIndex: 0, staffIndex: 0, voice: 1, entityIds: ['n1'] });
    expect(result.warnings[1].message).toBe('common.measure1 editor.trebleClef common.voice1: validation.unpairedBeam (C4)');
  });

  it('formats tie and slur warnings with measure, staff, and voice first', () => {
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
              duration: 'durationWhole',
              articulation: ['tie', 'slur'],
              meta: { id: 'n1', measureIndex: 0, staveIndex: 0, xmlVoice: 1, entityIndex: 0, startTick: 0 },
            }],
          }],
        }],
      }],
      connections: {
        noteConnections: new Map([['n1', { ties: [], slurs: [], beams: [] }]]),
        entityInfoMap: new Map([['n1', { pitch: 'C4', measureNumber: 1, staveLabel: 'trebleClef', voiceNumber: 1, position: 1 }]]),
      },
    };

    const result = validateDataIntegrity(scoreData, xml, translate);

    expect(result.warnings.map((issue) => issue.message)).toEqual([
      'common.measure1 editor.trebleClef common.voice1: validation.unpairedTie (C4)',
      'common.measure1 editor.trebleClef common.voice1: validation.unpairedSlur (C4)',
    ]);
  });

  it('includes all chord pitches in an unpaired beam warning', () => {
    const beamXml = `<?xml version="1.0"?><score-partwise><part-list/><part><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note xml:id="n1"><pitch><step>D</step><octave>2</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff><beam>begin</beam></note><note xml:id="n2"><chord/><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice><type>eighth</type><staff>2</staff></note></measure></part></score-partwise>`;
    const scoreData: ScoreData = {
      timeSignature: '4/4',
      measures: [{ number: 1, staves: [{ clef: 'treble', name: 'trebleClef', voices: [] }] }],
    };

    const result = validateDataIntegrity(scoreData, beamXml, translate);

    expect(result.warnings.find((issue) => issue.code === 'beam.unpaired_begin')?.message).toBe(
      'common.measure1 editor.bassClef common.voice2: validation.unpairedBeam (D2+D3)',
    );
  });
});
