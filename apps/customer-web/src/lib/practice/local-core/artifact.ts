import type {
  PracticeScoreArtifactRead,
  PracticeScoreAttackStepRead,
  PracticeScoreExpectedGroupRead,
  PracticeScoreMeterSegmentRead,
  PracticeScoreTempoSegmentRead,
} from '@/generated/api/types.gen';

export const PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type PracticeMode = 'STEP_BY_STEP' | 'CONTINUOUS_PLAY';
export type PracticeInputSource = 'MICROPHONE' | 'MIDI';

export type PracticeScoreArtifact = PracticeScoreArtifactRead;
export type ExpectedPracticeGroup = PracticeScoreExpectedGroupRead;
export type PracticeAttackStep = PracticeScoreAttackStepRead;
export type MeterSegment = PracticeScoreMeterSegmentRead;
export type TempoSegment = PracticeScoreTempoSegmentRead;

export type PracticeScope =
  | { kind: 'FULL' }
  | {
      kind: 'RANGE';
      startGroupId: string;
      endGroupId: string;
    };

export type ResolvedPracticeScope =
  | {
      kind: 'FULL';
      startIndex: number;
      endIndex: number;
      startBeat: number;
      terminalBeat: number;
    }
  | {
      kind: 'RANGE';
      startGroupId: string;
      endGroupId: string;
      startIndex: number;
      endIndex: number;
      startBeat: number;
      terminalBeat: number;
    };

export type CountInContract = {
  durationBeats: number;
  pulses: number;
  numerator: number;
  denominator: number;
};

export function assertPracticeScoreArtifact(artifact: unknown): asserts artifact is PracticeScoreArtifact {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('PracticeScoreArtifact must be an object');
  }
  const candidate = artifact as Partial<PracticeScoreArtifact>;
  if (candidate.schemaVersion !== PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported PracticeScoreArtifact schema: ${candidate.schemaVersion}`);
  }
  if (!candidate.scoreId || !candidate.revisionId || !candidate.artifactId) {
    throw new Error('PracticeScoreArtifact requires stable score, revision, and artifact identity.');
  }
  if (!Array.isArray(candidate.scoreTempoSegments)) {
    throw new Error('PracticeScoreArtifact requires scoreTempoSegments array.');
  }
  for (let i = 0; i < candidate.scoreTempoSegments.length; i += 1) {
    const segment = candidate.scoreTempoSegments[i];
    if (!segment || typeof segment !== 'object') {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(segment.startBeat) || segment.startBeat < 0) {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid startBeat: ${segment.startBeat}.`);
    }
    if (!Number.isFinite(segment.bpm) || segment.bpm <= 0) {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid bpm: ${segment.bpm}.`);
    }
    if (i > 0 && segment.startBeat <= candidate.scoreTempoSegments[i - 1].startBeat) {
      throw new Error(
        'PracticeScoreArtifact scoreTempoSegments must be strictly sorted by startBeat ascending without duplicate start beats.'
      );
    }
  }
  if (!Array.isArray(candidate.meterSegments)) {
    throw new Error('PracticeScoreArtifact requires meterSegments array.');
  }
  for (let i = 0; i < candidate.meterSegments.length; i += 1) {
    const meter = candidate.meterSegments[i];
    if (!meter || typeof meter !== 'object') {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(meter.startBeat) || meter.startBeat < 0) {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} has invalid startBeat: ${meter.startBeat}.`);
    }
    if (!Number.isFinite(meter.numerator) || meter.numerator < 1 || !Number.isFinite(meter.denominator) || meter.denominator < 1) {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} has invalid time signature.`);
    }
  }
  if (
    !Array.isArray(candidate.practiceAttackSteps) ||
    !Array.isArray(candidate.expectedPracticeGroups) ||
    candidate.practiceAttackSteps.length !== candidate.expectedPracticeGroups.length
  ) {
    throw new Error('PracticeScoreArtifact requires 1:1 attack steps and expected groups.');
  }
  const validArtifact = candidate as PracticeScoreArtifact;
  validArtifact.practiceAttackSteps.forEach((step, index) => {
    const group = validArtifact.expectedPracticeGroups[index];
    if (roundBeat(step.onsetBeat) !== roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact step/group onset mismatch at index ${index}.`);
    }
    const groupPitches = uniqueSorted(group.pitches);
    const stepPitches = uniqueSorted(step.attackTargets.map((target) => target.pitch));
    const strikePitches = uniqueSorted(group.strikeTargets.map((target) => target.pitch));
    if (groupPitches.join('\u001f') !== stepPitches.join('\u001f')) {
      throw new Error(`PracticeScoreArtifact step/group attack pitch mismatch at index ${index}.`);
    }
    if (groupPitches.join('\u001f') !== strikePitches.join('\u001f')) {
      throw new Error(`PracticeScoreArtifact group strike target mismatch at index ${index}.`);
    }
    if (roundBeat(group.canonicalEndBeat) < roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact group canonical end precedes onset at index ${index}.`);
    }
  });
}

export function resolvePracticeScope(
  artifact: PracticeScoreArtifact,
  scope: PracticeScope
): ResolvedPracticeScope {
  assertPracticeScoreArtifact(artifact);
  if (artifact.expectedPracticeGroups.length === 0) {
    throw new Error('Practice scope requires at least one expected group.');
  }

  const isRange = scope.kind === 'RANGE';
  const startIndex = isRange ? groupIndex(artifact, scope.startGroupId) : 0;
  const endIndex = isRange
    ? groupIndex(artifact, scope.endGroupId)
    : artifact.expectedPracticeGroups.length - 1;
  if (endIndex < startIndex) {
    throw new Error('Practice scope end must not be before its start.');
  }

  const startGroup = artifact.expectedPracticeGroups[startIndex];
  const endGroup = artifact.expectedPracticeGroups[endIndex];
  if (scope.kind === 'RANGE') {
    return {
      kind: 'RANGE',
      startGroupId: scope.startGroupId,
      endGroupId: scope.endGroupId,
      startIndex,
      endIndex,
      startBeat: startGroup.onsetBeat,
      terminalBeat: entryGroupEndBeat(artifact, endGroup.groupId),
    };
  }
  return {
    kind: 'FULL',
    startIndex,
    endIndex,
    startBeat: startGroup.onsetBeat,
    terminalBeat: artifact.scoreEndBeat,
  };
}

export function resolvePracticeScopeCursorNoteIds(
  artifact: PracticeScoreArtifact,
  scope: ResolvedPracticeScope | PracticeScope
): string[] {
  assertPracticeScoreArtifact(artifact);
  const resolved = 'startIndex' in scope
    ? scope
    : resolvePracticeScope(artifact, scope);
  return Array.from(
    new Set(
      artifact.expectedPracticeGroups
        .slice(resolved.startIndex, resolved.endIndex + 1)
        .flatMap((group) => group.renderNoteIds)
        .filter(Boolean)
    )
  );
}

export function entryGroupEndBeat(artifact: PracticeScoreArtifact, groupId: string): number {
  const group = artifact.expectedPracticeGroups.find((candidate) => candidate.groupId === groupId);
  if (!group) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return roundBeat(group.canonicalEndBeat);
}

export function groupForStep(
  artifact: PracticeScoreArtifact,
  stepIndex: number
): ExpectedPracticeGroup | null {
  return artifact.expectedPracticeGroups[stepIndex] ?? null;
}

export function attackPitchesForStep(step: PracticeAttackStep): string[] {
  return step.attackTargets.map((target) => target.pitch);
}

export function continuationPitchesForStep(step: PracticeAttackStep): string[] {
  return Array.from(new Set(step.continuation.map((note) => note.pitch)));
}

function meterAt(artifact: PracticeScoreArtifact, beat: number): MeterSegment {
  const defaultMeter: MeterSegment = {
    startBeat: 0,
    numerator: 4,
    denominator: 4,
    measureDurationBeats: 4,
    countInPulses: 4,
    source: 'DEFAULT_4_4',
  };
  const segments = artifact.meterSegments && artifact.meterSegments.length > 0 ? artifact.meterSegments : [defaultMeter];
  let active = segments[0] ?? defaultMeter;
  for (const segment of segments) {
    if (segment.startBeat > beat) {
      break;
    }
    active = segment;
  }
  return active;
}

export function countInContractAt(artifact: PracticeScoreArtifact, beat: number): CountInContract {
  const meter = meterAt(artifact, beat);
  return {
    durationBeats: meter.measureDurationBeats,
    pulses: meter.countInPulses,
    numerator: meter.numerator,
    denominator: meter.denominator,
  };
}

function groupIndex(artifact: PracticeScoreArtifact, groupId: string): number {
  const index = artifact.expectedPracticeGroups.findIndex((group) => group.groupId === groupId);
  if (index < 0) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return index;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function roundBeat(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
