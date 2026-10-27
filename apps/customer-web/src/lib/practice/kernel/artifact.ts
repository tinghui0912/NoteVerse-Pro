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
    const groupPitches = assertPhysicalPitchSet(group.pitches, 'group');
    const stepPitches = assertPhysicalPitchSet(step.attackTargets.map((target) => target.pitch), 'attack targets');
    const strikePitches = assertPhysicalPitchSet(group.strikeTargets.map((target) => target.pitch), 'strike targets');
    if (JSON.stringify(groupPitches) !== JSON.stringify(stepPitches)) {
      throw new Error(`PracticeScoreArtifact step/group attack pitch mismatch at index ${index}.`);
    }
    if (JSON.stringify(groupPitches) !== JSON.stringify(strikePitches)) {
      throw new Error(`PracticeScoreArtifact group strike target mismatch at index ${index}.`);
    }
    assertUniqueIdentities(group.expectedNotes.map(note => note.expectedNoteId), 'expected-note');
    assertExactIdentityAggregate(group.expectedNotes.map(note => note.renderNoteId), group.renderNoteIds, 'group render-note');
    const expected = new Map(group.expectedNotes.map(note => [note.expectedNoteId, note]));
    if (expected.size !== group.expectedNotes.length) throw new Error('PracticeScoreArtifact duplicate expected-note identity.');
    const owned = new Set<string>();
    for (const target of group.strikeTargets) {
      assertTargetNotation(target.pitch, target.expectedNotes, target.renderNoteIds);
      for (const note of target.expectedNotes) {
        const canonical = expected.get(note.expectedNoteId);
        if (owned.has(note.expectedNoteId) || !canonical || note.pitch !== canonical.pitch
          || note.eventId !== canonical.eventId || note.renderNoteId !== canonical.renderNoteId
          || JSON.stringify(note.measureNumbers) !== JSON.stringify(canonical.measureNumbers)) {
          throw new Error('PracticeScoreArtifact strike expected-note partition is corrupt.');
        }
        owned.add(note.expectedNoteId);
      }
    }
    if (owned.size !== expected.size) throw new Error('PracticeScoreArtifact strike expected-note partition is incomplete.');
    for (const target of step.attackTargets) assertTargetNotation(target.pitch, target.notes, target.renderNoteIds);
    const stepNotes = [...step.attackTargets.flatMap(target => target.notes), ...step.continuation];
    assertUniqueIdentities(stepNotes.map(note => note.stepNoteId), 'step-note');
    assertExactIdentityAggregate(stepNotes.map(note => note.renderNoteId), step.renderNoteIds, 'step render-note');
    if (roundBeat(group.canonicalEndBeat) < roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact group canonical end precedes onset at index ${index}.`);
    }
  });
}

function assertPhysicalPitchSet(values: string[], owner: string): string[] {
  if (!Array.isArray(values) || values.some(pitch => typeof pitch !== 'string' || !pitch)
    || new Set(values).size !== values.length) throw new Error(`PracticeScoreArtifact duplicate or invalid physical pitch in ${owner}.`);
  return [...values].sort();
}

function assertTargetNotation(pitch: string, notes: { pitch: string; renderNoteId: string }[], renderNoteIds: string[]): void {
  if (!Array.isArray(notes) || notes.length === 0 || notes.some(note => note.pitch !== pitch)) {
    throw new Error('PracticeScoreArtifact target notation pitches are corrupt.');
  }
  assertExactIdentityAggregate(notes.map(note => note.renderNoteId), renderNoteIds, 'target render-note');
}

function assertUniqueIdentities(values: string[], owner: string): void {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value)
    || new Set(values).size !== values.length) {
    throw new Error(`PracticeScoreArtifact ${owner} identities are corrupt.`);
  }
}

function assertExactIdentityAggregate(nested: string[], flat: string[], owner: string): void {
  assertUniqueIdentities(nested, owner);
  assertUniqueIdentities(flat, owner);
  if (JSON.stringify([...nested].sort()) !== JSON.stringify([...flat].sort())) {
    throw new Error(`PracticeScoreArtifact ${owner} identities are corrupt.`);
  }
}

export function roundBeat(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
