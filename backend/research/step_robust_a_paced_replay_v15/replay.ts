import { StepPracticeRuntime } from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import { ManualClock } from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import type { PracticeScoreArtifact } from '../../../apps/customer-web/src/lib/practice/local-core/artifact';
import { WaitingTopologyGate, GESTURE_WIDTH_MS } from '../step_waiting_topology_v3/assembly';
import type { SourceAcousticPublication } from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/source-publication';

export { StepPracticeRuntime, ManualClock, GESTURE_WIDTH_MS };
export const pitch = (n: number) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n % 12] + (Math.floor(n / 12) - 1);
export function artifact(targets: number[][]): PracticeScoreArtifact {
  return { schemaVersion: 1, scoreId: 'frozen-v6', revisionId: 'v6', artifactId: 'v15-paced-replay',
    scoreEndBeat: targets.length, scoreTempoSegments: [], meterSegments: [],
    expectedPracticeGroups: targets.map((set, i) => ({ groupId: `g${i}`, onsetBeat: i, canonicalEndBeat: i + 1,
      pitches: set.map(pitch), strikeTargets: set.map(n => ({ pitch: pitch(n) })), renderNoteIds: [] })),
    practiceAttackSteps: targets.map((set, i) => ({ stepId: `s${i}`, onsetBeat: i,
      attackTargets: set.map(n => ({ pitch: pitch(n) })), continuation: [] })) } as unknown as PracticeScoreArtifact;
}
export type Gesture = { gestureId: string; onsetMs: number; normalizedPitchSet: number[] };
export function nearest(gestures: Gesture[], ms: number) {
  const rows = gestures.map(g => ({ id: g.gestureId, distance: Math.abs(g.onsetMs - ms) }))
    .filter(r => r.distance <= 100).sort((a, b) => a.distance - b.distance);
  if (!rows.length) throw Error('NO_TRUTH_ATTRIBUTION');
  if (rows.length > 1 && rows[0].distance === rows[1].distance) throw Error('AMBIGUOUS_TRUTH_ATTRIBUTION');
  return rows[0];
}

/** Reuse only frozen H50 evidence assembly, never the historical product lifecycle. */
export function reconstruct(publications: SourceAcousticPublication[], rate: number, origin: number,
  boundary: number, end: number) {
  const gate = new WaitingTopologyGate(rate, 'evidence-only', boundary, end, 1, 0);
  gate.arm(boundary, 0);
  for (let index = 0; index < publications.length; index++) {
    const p = publications[index];
    gate.accept({ publicationId: `${p.sourceDomainId}:w${p.window.windowIndex}`,
      frontier: origin + p.window.ownedEndTarget * rate / 16000,
      capturedThrough: boundary, wallMs: 0, observations: p.observations });
    const sealed = gate.actions.find(a => a.type === 'SEAL');
    if (sealed) return { assembly: sealed.attempt!, lastPublicationIndex: index };
  }
  if (gate.actions.some(a => a.type === 'OPEN')) throw Error('H50_COVERAGE_INCOMPLETE');
  return null;
}

export type Scenario = { scenarioId: string; family: string; audioBoundCaseId: string;
  targetPitchSets: number[][]; physicalTruthGestureIds: string[]; inputEligibleAfterOriginalSourceMs: number };
export function replayCell(s: Scenario, gestures: Gesture[], job: {
  jobId: string; sourceRateHz: number; sourceOriginSample: number; publications: SourceAcousticPublication[]
}, expected: string[], epochStride: number) {
  const rate = job.sourceRateHz, id = `v15:${s.scenarioId}:${rate}`, clock = new ManualClock();
  const runtime = new StepPracticeRuntime({ artifact: artifact(s.targetPitchSets), scope: { kind: 'FULL' },
    inputSource: 'MICROPHONE', localSessionId: id, clock, metadataClock: { nowEpochMs: () => 0 } });
  if (runtime.snapshot().version.schemaVersion !== 5 || runtime.snapshot().version.runtimeVersion !== 'step-paced-attempt-v5') throw Error('NOT_V13_RUNTIME');
  const time = (ms: number) => ({ domainId: id, ms });
  runtime.setInputUnavailable(); runtime.acceptInputAfter(time(epochStride));
  const traces: any[] = [], owners = new Set<string>();
  const lead = s.inputEligibleAfterOriginalSourceMs - gestures[0].onsetMs;
  for (let i = 0; i < gestures.length; i++) {
    const g = gestures[i], boundary = Math.round((g.onsetMs + lead) * rate / 1000);
    const epoch = (i + 1) * epochStride, ready = runtime.snapshot();
    if (!runtime.canAcceptAttempt) throw Error('INTENDED_READY_EPOCH_UNAVAILABLE');
    const reconstructed = reconstruct(job.publications, rate, job.sourceOriginSample, boundary, Math.round((g.onsetMs + 100) * rate / 1000));
    if (!reconstructed) {
      traces.push({ ordinal: i, physicalTruth: g, ready, status: 'NO_ELIGIBLE_SEALED_EVENT', verdict: null });
      // No fabricated empty attempt or invented RETRY; remaining epochs need an explicit prior verdict.
      break;
    }
    const a = reconstructed.assembly, attribution = nearest(gestures, a.anchor * 1000 / rate);
    if (attribution.id !== g.gestureId) throw Error('INTENDED_GESTURE_ATTRIBUTION_MISMATCH');
    const projected = (sample: number) => epoch + (sample - boundary) * 1000 / rate;
    if (projected(a.end) >= (i + 2) * epochStride) throw Error('FIXED_EPOCH_OVERFLOW');
    const before = JSON.stringify(a.observations);
    for (const o of a.observations) {
      if (owners.has(o.observationId)) throw Error('CROSS_ATTEMPT_OBSERVATION_REUSE');
      owners.add(o.observationId);
    }
    clock.set(projected(a.anchor));
    const identity = runtime.openAttempt(time(projected(a.anchor)));
    if (!identity || !runtime.analyzeAttempt(identity)) throw Error('PRODUCT_OPEN_ANALYZE_REJECTED');
    const activeTarget = runtime.currentTarget();
    const result = runtime.completeAttempt(identity, { kind: 'EVIDENCE', observedAttackPitches: [...a.pitches],
      confidence: a.confidence, captureEndSessionTime: time(projected(a.end)) });
    if (result.kind !== 'FINALIZED') throw Error('PRODUCT_COMPLETE_REJECTED');
    const postVerdict = runtime.snapshot();
    if (postVerdict.step.attemptState !== 'POST_VERDICT' || postVerdict.step.targetGeneration !== ready.step.targetGeneration) throw Error('V13_POST_VERDICT_DIVERGENCE');
    clock.set((i + 2) * epochStride); runtime.rearm(time(clock.nowMs()));
    const rearmed = runtime.snapshot();
    if (before !== JSON.stringify(a.observations)) throw Error('OBSERVATION_MUTATED');
    traces.push({ ordinal: i, physicalTruth: g, originalEligibilityBoundarySample: boundary, syntheticReadyEpochMs: epoch,
      ready, activeTarget, identity, assembly: a, observations: a.observations.map(o => ({ ...o,
        originalSourceMs: o.sourceEventSample * 1000 / rate, syntheticSessionMs: projected(o.sourceEventSample) })),
      lastPublicationIndex: reconstructed.lastPublicationIndex, attribution,
      observedMidiPitchSet: [...new Set(a.observations.map(o => o.midiPitch))].sort((x, y) => x - y),
      verdict: result.record.verdict, productRecord: result.record, postVerdict, rearmed,
      fullPhysicalSupport: JSON.stringify([...g.normalizedPitchSet].sort((x, y) => x - y)) === JSON.stringify(s.targetPitchSets[ready.step.currentIndex]),
      advancementAtRearm: rearmed.step.currentIndex - postVerdict.step.currentIndex });
  }
  const sequence = traces.map(t => t.verdict), satisfied = JSON.stringify(sequence) === JSON.stringify(expected);
  return { scenarioId: s.scenarioId, family: s.family, audioBoundCaseId: s.audioBoundCaseId, jobId: job.jobId, sourceRateHz: rate,
    expectedSequence: expected, actualSequence: sequence, expectedBehaviorSatisfied: satisfied, traces,
    finalSnapshot: runtime.snapshot(), classification: satisfied ? 'EXPECTED_RECOGNITION_BEHAVIOR_OBSERVED'
      : s.scenarioId === 'correct_chord' ? 'ROBUST_A_CORRECT_CHORD_EXACT_SET_BLOCKED'
      : s.scenarioId === 'post_ready_repeat' ? 'ROBUST_A_POST_READY_REPEAT_EXACT_SET_BLOCKED'
      : s.scenarioId === 'match_followed_by_next_target' && sequence[0] !== 'MATCH' ? 'NEXT_TARGET_SEQUENCE_BLOCKED_BY_FIRST_ATTEMPT_RECOGNITION'
      : 'RECOGNITION_SEQUENCE_NOT_SATISFIED' };
}
