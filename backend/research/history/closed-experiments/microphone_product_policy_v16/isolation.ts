import { StepPracticeRuntime } from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import { ManualClock } from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import type { PracticeScoreArtifact } from '../../../apps/customer-web/src/lib/practice/local-core/artifact';

/** Synthetic domain-only fixture; no acoustic input, decoder, or microphone acquisition. */
export function sameTargetHarness() {
  const pitches = ['C4'], targets = [0, 1];
  const artifact = { schemaVersion: 1, scoreId: 'v16-unit', revisionId: 'v16-unit', artifactId: 'same-target-unit',
    scoreEndBeat: 2, scoreTempoSegments: [], meterSegments: [],
    expectedPracticeGroups: targets.map(i => ({ groupId: `g${i}`, onsetBeat: i, canonicalEndBeat: i + 1,
      pitches, strikeTargets: [{ pitch: 'C4' }], renderNoteIds: [] })),
    practiceAttackSteps: targets.map(i => ({ stepId: `s${i}`, onsetBeat: i, attackTargets: [{ pitch: 'C4' }], continuation: [] })) } as unknown as PracticeScoreArtifact;
  const domainId = 'v16-isolation-unit', clock = new ManualClock();
  const runtime = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' }, inputSource: 'MICROPHONE',
    localSessionId: domainId, clock, metadataClock: { nowEpochMs: () => 0 } });
  return { runtime, clock, time: (ms: number) => ({ domainId, ms }) };
}
