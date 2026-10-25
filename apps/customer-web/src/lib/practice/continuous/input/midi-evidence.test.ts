import { CONTINUOUS_ASSIGNMENT_WINDOW_MS } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { expect, it } from 'vitest';
import { DEFAULT_MIDI_COVERAGE_GRACE_MS } from './midi-evidence';

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

it('keeps MIDI delivery coverage grace separate from the musical assignment window', () => {
    expect(DEFAULT_MIDI_COVERAGE_GRACE_MS).toBe(250);
    expect(CONTINUOUS_ASSIGNMENT_WINDOW_MS).toBe(250);
  });
