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
});
