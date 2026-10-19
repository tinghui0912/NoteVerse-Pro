import { StepPracticeRuntime } from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import { ManualClock } from '../../../apps/customer-web/src/lib/practice/local-core/timebase';
import type { PracticeScoreArtifact } from '../../../apps/customer-web/src/lib/practice/local-core/artifact';
export { WaitingTopologyGate, GESTURE_WIDTH_MS } from '../step_waiting_topology_v3/assembly';
export const pitch = (n: number) => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n % 12] + (Math.floor(n / 12) - 1);
export function runtime(targets: number[][], domainId: string) {
  const artifact = { schemaVersion: 1, scoreId: 'frozen-v6', revisionId: 'v6', artifactId: 'v23-geometry-target-view',
    scoreEndBeat: targets.length, scoreTempoSegments: [], meterSegments: [],
    expectedPracticeGroups: targets.map((set, i) => ({ groupId: `g${i}`, onsetBeat: i, canonicalEndBeat: i + 1,
      pitches: set.map(pitch), strikeTargets: set.map(n => ({ pitch: pitch(n) })), renderNoteIds: [] })),
    practiceAttackSteps: targets.map((set, i) => ({ stepId: `s${i}`, onsetBeat: i,
      attackTargets: set.map(n => ({ pitch: pitch(n) })), continuation: [] })) } as unknown as PracticeScoreArtifact;
  const clock = new ManualClock(), owner = new StepPracticeRuntime({ artifact, scope: { kind: 'FULL' },
    inputSource: 'MICROPHONE', localSessionId: domainId, clock, metadataClock: { nowEpochMs: () => 0 } });
  return { owner, clock, time: (ms: number) => ({ domainId, ms }) };
}
