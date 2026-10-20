import fixture from '../../../apps/customer-web/src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '../../../apps/customer-web/src/lib/practice/local-core/artifact';
import { StepPracticeRuntime } from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import type { StepAttemptIdentity } from '../../../apps/customer-web/src/lib/practice/local-core/step-attempt';
import { ManualClock } from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import { DecodedGestureAssembler, type DecodedGesture, type DecodedPublication } from './acoustic-gestures';

export type Scenario = Readonly<{ name: string; targets: readonly (readonly number[])[]; holdPublications?: number; lateReplay?: boolean }>;
const pitch = (midi: number) => `${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
export function scenarioArtifact(targets: readonly (readonly number[])[]): PracticeScoreArtifact {
  const base = structuredClone(fixture) as PracticeScoreArtifact;
  const g = base.expectedPracticeGroups[0], s = base.practiceAttackSteps[0];
  const expectedPracticeGroups = targets.map((notes, index) => {
    const pitches = [...new Set(notes.map(pitch))].sort(), groupId = `group:${index}`;
    return { ...g, groupId, onsetBeat: index, canonicalEndBeat: index + 1, pitches,
      expectedNotes: pitches.map(p => ({ ...g.expectedNotes[0], pitch: p, expectedNoteId: `${groupId}:${p}` })),
      strikeTargets: pitches.map(p => ({ ...g.strikeTargets[0], pitch: p, strikeId: `${groupId}:${p}` })) };
  });
  const practiceAttackSteps = expectedPracticeGroups.map((group, index) => ({ ...s, stepId: `step:${index}`, onsetBeat: index,
    continuation: [], attackTargets: group.pitches.map(p => ({ ...s.attackTargets[0], pitch: p, attackId: `${index}:${p}`,
      notes: s.attackTargets[0].notes.map(n => ({ ...n, pitch: p })) })) }));
  return { ...base, artifactId: 'step-decoded-qualification', scoreEndBeat: targets.length,
    expectedPracticeGroups, practiceAttackSteps };
}

export function replayScenario(id: string, scenario: Scenario, publications: readonly DecodedPublication[], startMs: number) {
  const session = `${id}:${scenario.name}`, clock = new ManualClock(startMs), assembler = new DecodedGestureAssembler();
  const runtime = new StepPracticeRuntime({ artifact: scenarioArtifact(scenario.targets), scope: { kind: 'FULL' }, clock,
    localSessionId: session, inputSource: 'MICROPHONE', metadataClock: { nowEpochMs: () => 0 } });
  let frontier = startMs, ignoredGestures = 0;
  let busy: { identity: StepAttemptIdentity; gesture: DecodedGesture; lockMs: number; remaining: number; lateOrigin: boolean } | null = null;
  const outcomes: { attemptId: string; verdict: string; targetPitches: readonly string[]; observationIds: string[];
    eventMs: number; evidenceAvailabilityMs: number; lockMs: number; verdictMs: number; captureEndMs: number;
    rearmWatermarkMs: number; rearmed: boolean; generation: number; lateReceipt: boolean; observedPitches: readonly string[] }[] = [];
  const receipts: { publicationId: string; frontierMs: number; availabilityMs: number; late: boolean; busy: boolean; opened: number }[] = [];
  const complete = (pending: NonNullable<typeof busy>, availabilityMs: number) => {
    const result = runtime.completeAttempt(pending.identity, { kind: 'EVIDENCE',
      confidence: Math.min(...pending.gesture.observations.map(o => o.confidence)),
      observedAttackPitches: pending.gesture.observations.map(o => o.pitch),
      captureEndSessionTime: { domainId: session, ms: pending.gesture.captureEndMs } });
    if (result.kind !== 'FINALIZED') throw new Error('REPLAY_STALE_ATTEMPT');
    const index = Number(pending.identity.stepId.split(':')[1]);
    outcomes.push({ attemptId: pending.identity.attemptId, verdict: result.record.verdict,
      targetPitches: scenario.targets[index].map(pitch).sort(), observationIds: pending.gesture.observations.map(o => o.observationId),
      eventMs: pending.gesture.eventMs, evidenceAvailabilityMs: Math.max(...pending.gesture.observations.map(o => o.availabilityMs)), lockMs: pending.lockMs,
      verdictMs: availabilityMs, captureEndMs: pending.gesture.captureEndMs, rearmWatermarkMs: frontier,
      generation: pending.identity.activationGeneration, lateReceipt: pending.lateOrigin,
      rearmed: !runtime.isCompleted, observedPitches: result.record.observedAttackPitches });
    if (!runtime.isCompleted) runtime.rearm({ domainId: session, ms: frontier });
  };
  const sequence = publications.map(p => ({ publication: p, late: false }));
  if (scenario.lateReplay && publications.length >= 3) sequence.splice(3, 0, {
    publication: { ...publications[0], availabilityMs: publications[2].availabilityMs }, late: true });
  for (const { publication, late } of sequence) {
    clock.set(publication.availabilityMs); frontier = Math.max(frontier, publication.frontierMs);
    const gestures = assembler.push(publication);
    const receipt = { publicationId: publication.publicationId, frontierMs: frontier,
      availabilityMs: publication.availabilityMs, late, busy: busy !== null, opened: 0 };
    receipts.push(receipt);
    if (busy) {
      ignoredGestures += gestures.length; busy.remaining--;
      if (busy.remaining <= 0) { complete(busy, publication.availabilityMs); busy = null; }
      continue;
    }
    for (let index = 0; index < gestures.length; index++) {
      const gesture = gestures[index];
      const identity = runtime.openAttempt({ domainId: session, ms: gesture.eventMs });
      if (!identity) { ignoredGestures++; continue; }
      receipt.opened++;
      if (!runtime.analyzeAttempt(identity)) throw new Error('REPLAY_ANALYSIS_NOT_STARTED');
      const pending = { identity, gesture, lockMs: publication.availabilityMs, remaining: scenario.holdPublications ?? 0, lateOrigin: late };
      if (pending.remaining) busy = pending; else complete(pending, publication.availabilityMs);
      ignoredGestures += gestures.length - index - 1;
      break;
    }
    if (receipt.opened > 1) throw new Error('REPLAY_MULTIPLE_ATTEMPTS_PER_PUBLICATION');
  }
  if (busy) throw new Error('REPLAY_UNDRAINED_ATTEMPT');
  runtime.end();
  return { id, scenario, outcomes, receipts, ignoredGestures, snapshot: runtime.snapshot() };
}
