import { expect, it } from 'vitest';
import { SourcePublicationSequence, sourceObservationId, sourcePublication } from './source-publication';
import { planWindow } from './window-planner';
import { ACOUSTIC_RESOURCES } from './resource-policy';
import { ACOUSTIC_MODEL as M, ACOUSTIC_TARGET_SAMPLES_PER_MS } from '../model/model-contract';
import { projectContinuousEvidence } from '../continuous/publication';

it.each([44100, 48000] as const)('%i: exclusive absolute frontier uses only source origin and owned-end geometry', rate => {
  const window = { jobIndex: 0, regionIndex: 0, windowIndex: 0, ownedStartTarget: 19200, ownedEndTarget: 28800, startSample: 2400, endSample: 31520 };
  const result = { events: [{ pitch: 'C4', midiPitch: 60, confidence: .8, onsetScore: .9, frameScore: .8, targetSample: 20000 }],
    inferenceMs: 1, decodeMs: 0, actualSessionRunCount: 1 };
  const p = sourcePublication('source', rate, 100000, window, result, 1234567);
  expect(M.sampleRateHz).toBe(16000); // Secondary model declaration characterization, not a mapping owner.
  expect(p.ownedThroughSourceSample).toBe(100000 + window.ownedEndTarget * rate / M.sampleRateHz);
  expect(p.observations[0].sourceEventSample).toBe((100000 * M.sampleRateHz + result.events[0].targetSample * rate) / M.sampleRateHz);
  expect(new SourcePublicationSequence('source', rate).accept(p)).toBeNull();
  expect(Object.isFrozen(p)).toBe(true);
  expect(Object.isFrozen(p.window)).toBe(true);
  expect(Object.isFrozen(p.observations)).toBe(true);
  expect(Object.isFrozen(p.observations[0])).toBe(true);
  expect(sourcePublication('source', rate, 100000, window, result, 9999999).observations).toEqual(p.observations);
  expect(p).not.toHaveProperty('capturedThroughSourceSample');
  expect(p).not.toHaveProperty('performanceTimeMs');
});

it.each([44100, 48000] as const)('%i: event mapping retains safe-integer numerator validation before division', rate => {
  const window = planWindow({ index: 0, sourceStart: 57600, originTarget: 19200, nextWindow: 0, queuedEndTarget: 0 }, 0)!;
  const event = { pitch: 'C4', midiPitch: 60, confidence: .8, onsetScore: .8, frameScore: .8, targetSample: 20000 };
  const result = { events: [event], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 };
  const base = Math.floor((Number.MAX_SAFE_INTEGER - event.targetSample * rate) / M.sampleRateHz);
  const numerator = base * M.sampleRateHz + event.targetSample * rate;
  expect(Number.isSafeInteger(numerator)).toBe(true);
  expect(sourcePublication('source', rate, base, window, result, 0).observations[0].sourceEventSample).toBe(numerator / M.sampleRateHz);
  expect(Number.isSafeInteger((base + 1) * M.sampleRateHz + event.targetSample * rate)).toBe(false);
  expect(() => sourcePublication('source', rate, base + 1, window, result, 0)).toThrow('ACOUSTIC_SOURCE_COORDINATE_OVERFLOW');
});

it('freezes a copied window and owns canonical identity plus duplicate rejection', () => {
  const window = { ...planWindow({ index: 0, sourceStart: 57600, originTarget: 19200, nextWindow: 0, queuedEndTarget: 0 }, 0)! };
  const event = { pitch: 'C4', midiPitch: 60, confidence: .8, onsetScore: .8, frameScore: .8, targetSample: 19200 };
  const result = { events: [event], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 };
  const p = sourcePublication('source', 48000, 0, window, result, 0);
  expect(p.observations[0].observationId).toBe('source:r0:w0:p60:f19200');
  expect(sourceObservationId('source', window, 60, 19200)).toBe(p.observations[0].observationId);
  window.windowIndex = 999; expect(p.window.windowIndex).toBe(0);
  expect(() => sourcePublication('source', 48000, 0, p.window, { ...result, events: [event, event] }, 0)).toThrow('DUPLICATE_ACOUSTIC_OBSERVATION');
});

it('rejects oversized inference output before inspecting events or producing a publication', () => {
  const window = planWindow({ index: 0, sourceStart: 57600, originTarget: 19200, nextWindow: 0, queuedEndTarget: 0 }, 0)!;
  // Sparse malformed output exercises the upstream bound; it is not a dense gesture stress test.
  const events = new Array<Parameters<typeof sourcePublication>[4]['events'][number]>(ACOUSTIC_RESOURCES.maxEventsPerWindow + 1);
  expect(() => sourcePublication('source', 48000, 0, window, { events, inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 }, 0))
    .toThrow('ACOUSTIC_EVENT_BOUND_EXCEEDED');
});

it('stream failure is terminal without retaining a replay ledger', () => {
  const sequence = new SourcePublicationSequence('source', 48000);
  const window = planWindow({ index: 0, sourceStart: 57600, originTarget: 19200, nextWindow: 0, queuedEndTarget: 0 }, 0)!;
  const p = sourcePublication('source', 48000, 0, window, { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 }, 0);
  expect(sequence.accept(p)).toBeNull(); expect(() => sequence.accept(p)).toThrow('ACOUSTIC_PUBLICATION_SEQUENCE_INVALID');
  expect(() => sequence.accept(p)).toThrow('ACOUSTIC_PUBLICATION_STREAM_FAILED');
  for (const value of Object.values(sequence)) expect(value instanceof Map || value instanceof Set || Array.isArray(value)).toBe(false);
});

function regionPublication(region: number, job: number, originTarget: number, windowIndex = 0, endTarget?: number) {
  const window = planWindow({ index: region, sourceStart: originTarget * 3, originTarget,
    nextWindow: windowIndex, queuedEndTarget: originTarget, endTarget }, job)!;
  return sourcePublication('source', 48000, 0, window,
    { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: job + 1 }, job);
}

it('accepts first published region 1 at job zero/window zero after an unobserved empty region', () => {
  const p = regionPublication(1, 0, 19200), before = structuredClone(p);
  expect(new SourcePublicationSequence('source', 48000).accept(p)).toBeNull();
  expect(p).toEqual(before);
});

it('accepts published region 0 to 2 with continuous jobs and forward source geometry', () => {
  const first = regionPublication(0, 0, 19200), next = regionPublication(2, 1, 40000);
  expect(next.ownedThroughSourceSample).toBeGreaterThan(first.ownedThroughSourceSample);
  const sequence = new SourcePublicationSequence('source', 48000); sequence.accept(first);
  expect(() => sequence.accept(next)).not.toThrow();
});

it.each(['job-gap', 'job-replay', 'region-regression', 'window-gap', 'window-replay', 'new-region-window', 'frontier-regression'] as const)(
  '%s remains an observable terminal stream violation', kind => {
    const sequence = new SourcePublicationSequence('source', 48000);
    sequence.accept(regionPublication(0, 0, 19200));
    sequence.accept(regionPublication(2, 1, 40000));
    const valid = regionPublication(2, 2, 40000, 1);
    let corrupt = valid;
    if (kind === 'job-gap') corrupt = regionPublication(2, 3, 40000, 1);
    if (kind === 'job-replay') corrupt = regionPublication(2, 1, 40000, 1);
    if (kind === 'region-regression') corrupt = regionPublication(1, 2, 60000);
    if (kind === 'window-gap') corrupt = regionPublication(2, 2, 40000, 2);
    if (kind === 'window-replay') corrupt = regionPublication(2, 2, 40000);
    if (kind === 'new-region-window') corrupt = regionPublication(3, 2, 60000, 1);
    if (kind === 'frontier-regression') corrupt = { ...valid, ownedThroughSourceSample: 100000 };
    const before = structuredClone(corrupt);
    expect(() => sequence.accept(corrupt)).toThrow('ACOUSTIC_PUBLICATION_SEQUENCE_INVALID');
    expect(corrupt).toEqual(before);
    expect(() => sequence.accept(valid)).toThrow('ACOUSTIC_PUBLICATION_STREAM_FAILED');
  });

it('accepts full then partial windows and contiguous region 1 with a physical source gap', () => {
  const sequence = new SourcePublicationSequence('source', 48000);
  const full = regionPublication(0, 0, 19200);
  const partial = regionPublication(0, 1, 19200, 1, 32000);
  const next = regionPublication(1, 2, 40000);
  expect(partial.window.ownedStartTarget).toBe(full.window.ownedEndTarget);
  expect(partial.window.ownedEndTarget).toBeLessThan(partial.window.ownedStartTarget + M.ownedMs * ACOUSTIC_TARGET_SAMPLES_PER_MS);
  expect(next.window.ownedStartTarget).toBeGreaterThan(partial.window.ownedEndTarget);
  expect(() => { sequence.accept(full); sequence.accept(partial); sequence.accept(next); }).not.toThrow();
});

it.each([44100, 48000] as const)('%i: planner and source validation share target samples/ms while Continuous projection preserves partial half-open times', rate => {
  const originTarget = 32000, durationMs = 33.25; // Enough real past for a short final full model input.
  const window = planWindow({ index: 0, sourceStart: 100000 + originTarget * rate / M.sampleRateHz, originTarget,
    nextWindow: 0, queuedEndTarget: originTarget, endTarget: originTarget + durationMs * ACOUSTIC_TARGET_SAMPLES_PER_MS }, 0)!;
  const event = (targetSample: number) => ({ pitch: 'C4', midiPitch: 60, targetSample, confidence: .8, onsetScore: .9, frameScore: .8 });
  const p = sourcePublication('source', rate, 100000, window, { events: [event(originTarget), event(window.ownedEndTarget - 1), event(window.ownedEndTarget)],
    inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 }, 1000);
  expect(new SourcePublicationSequence('source', rate).accept(p)).toBeNull();
  expect(p.observations.map(o => o.targetSample)).toEqual([originTarget, window.ownedEndTarget - 1]); // Exact half-open end excluded.
  const projected = projectContinuousEvidence(p, { index: 0, sourceStart: 100000 + originTarget * rate / M.sampleRateHz,
    originTarget, performanceStartMs: 42.5, performanceEndMs: 42.5 + durationMs }, 'session');
  expect(projected.observations.map(o => o.performanceTimeMs)).toEqual([42.5, 75.6875]);
  expect(projected.observations.map(o => o.performanceTimeMs)).toEqual(p.observations.map(o =>
    42.5 + (window.startSample - originTarget) / ACOUSTIC_TARGET_SAMPLES_PER_MS
      + (o.targetSample - window.startSample) / ACOUSTIC_TARGET_SAMPLES_PER_MS));
  expect(projected.observations.every(o => o.performanceTimeMs >= 42.5 && o.performanceTimeMs < 75.75)).toBe(true);
});

it('Continuous projection ignores the source frontier without changing its evaluation clock or observations', () => {
  const window = { jobIndex: 0, regionIndex: 0, windowIndex: 0, ownedStartTarget: 19200, ownedEndTarget: 28800, startSample: 2400, endSample: 31520 };
  const p = sourcePublication('source', 48000, 100000, window, { events: [{ pitch: 'C4', midiPitch: 60,
    confidence: .8, onsetScore: .9, frameScore: .8, targetSample: 20000 }], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: 1 }, 1000);
  const segment = { index: 0, sourceStart: 100000 + 19200 * 3, originTarget: 19200, performanceStartMs: 0 };
  expect(projectContinuousEvidence({ ...p, ownedThroughSourceSample: p.ownedThroughSourceSample + 48000 }, segment, 'session'))
    .toEqual(projectContinuousEvidence(p, segment, 'session'));
});
