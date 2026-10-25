import type { PracticeScoreArtifactRead, PracticeScoreAttackStepRead, PracticeScoreExpectedGroupRead, PracticeScoreMeterSegmentRead, PracticeScoreTempoSegmentRead, } from '@/generated/api/types.gen';

export const PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type PracticeScoreArtifact = PracticeScoreArtifactRead;

export type ExpectedPracticeGroup = PracticeScoreExpectedGroupRead;

export type PracticeAttackStep = PracticeScoreAttackStepRead;

export type MeterSegment = PracticeScoreMeterSegmentRead;

export type TempoSegment = PracticeScoreTempoSegmentRead;

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

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function roundBeat(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
