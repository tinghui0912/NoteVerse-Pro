import { expect, it } from 'vitest';
import { ContinuousMidiEvidence } from './continuous-midi-evidence';

it('keeps adjacent NOTE_ON facts as independent observations with their captured times', () => {
  const evidence = new ContinuousMidiEvidence('continuous-midi');
  evidence.observe('C4', 100, 1);
  evidence.observe('E4', 112, 1);
  const publication = evidence.cover(120, 140)!;
  expect(publication.observations.map(o => [o.pitch, o.performanceTimeMs])).toEqual([
    ['C4', 100], ['E4', 112],
  ]);
  expect(new Set(publication.observations.map(o => o.observationId)).size).toBe(2);
});
