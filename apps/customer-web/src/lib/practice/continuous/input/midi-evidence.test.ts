import { CONTINUOUS_ASSIGNMENT_WINDOW_MS } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { ContinuousMidiEvidence } from '@/lib/practice/continuous/input/midi-evidence';
import { expect, it } from 'vitest';
import { DEFAULT_MIDI_COVERAGE_GRACE_MS } from './midi-evidence';

it('keeps adjacent NOTE_ON facts as independent observations with their captured times', () => {
  const evidence = new ContinuousMidiEvidence('continuous-midi');
  evidence.observe('C4', 100, 1, 100);
  evidence.observe('E4', 112, 1, 112);
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

it('plans inclusive attack maturity, merges coincident needs and never duplicates a materialized frontier', () => {
  const evidence = new ContinuousMidiEvidence('deadline');
  expect(evidence.nextDeadline(null)).toBeNull();
  evidence.observe('C4', 100, 1, 100);
  evidence.observe('E4', 100, 1, 120);
  expect(evidence.nextDeadline(100)).toEqual({ analyzedThroughPerformanceMs: 100, duePerformanceTimeMs: 350 });
  expect(evidence.nextDeadline(50)).toEqual({ analyzedThroughPerformanceMs: 50, duePerformanceTimeMs: 300 });
  const p = evidence.cover(100, 350)!;
  expect(p.observations).toHaveLength(2);
  expect(p.publicationId).toBe('deadline:midi-publication:0');
  expect(evidence.nextDeadline(100)).toBeNull();
  expect(evidence.cover(100, 900)).toBeNull();
  expect(evidence.complete(1000, 1000)?.publicationId).toBe('deadline:midi-publication:1');
});

it.each([349, 350, 351])('delivery at %i has a grace-defined outcome without needing a prior coverage read', delivery => {
  const evidence = new ContinuousMidiEvidence('delivery');
  if (delivery < 350) {
    expect(() => evidence.observe('C4', 100, 1, delivery)).not.toThrow();
    expect(evidence.nextDeadline(null)?.duePerformanceTimeMs).toBe(350);
  } else {
    expect(() => evidence.observe('C4', 100, 1, delivery)).toThrow('MIDI_EVIDENCE_AFTER_COVERAGE');
    expect(evidence.nextDeadline(null)).toBeNull();
    evidence.observe('D4', delivery, 1, delivery);
    expect(evidence.complete(delivery, delivery)?.observations[0].observationId).toBe('delivery:midi:0');
  }
});


it('keeps all 4,096 pending physical attacks; the next fails before push and the failure is terminal', () => {
  const evidence = new ContinuousMidiEvidence('budget');
  for (let i = 0; i < 4096; i++) evidence.observe('C4', 100, 1, 100);
  expect(evidence.pendingObservationCount).toBe(4096);
  let failure: unknown;
  try { evidence.observe('C4', 100, 1, 100); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: 'CONTINUOUS_EVALUATION_RESOURCE_LIMIT_EXCEEDED' });
  expect(evidence.pendingObservationCount).toBe(4096);
  expect(() => evidence.cover(100, 350)).toThrow(failure as Error);
  expect(() => evidence.nextDeadline(null)).toThrow(failure as Error);
  expect(() => evidence.observe('D4', 200, 1, 200)).toThrow(failure as Error);
  expect(evidence.pendingObservationCount).toBe(4096);
  const healthy = new ContinuousMidiEvidence('healthy');
  for (let i = 0; i < 4096; i++) healthy.observe('C4', 100, 1, 100);
  const publication = healthy.cover(100, 350)!;
  expect(publication.observations).toHaveLength(4096); expect(healthy.pendingObservationCount).toBe(0);
  expect(new Set(publication.observations.map(o => o.observationId)).size).toBe(4096);
});
