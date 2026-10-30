import { isPracticePianoKey, type PracticePianoKey } from './piano-key';

export class PracticeScoreContractError extends Error {
  readonly code = 'practice_score_invalid';
}

export const PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 2 as const;
export type PracticeScoreEvent = {
  eventId: string; onsetBeat: number; durationBeats: number; pianoKeys: PracticePianoKey[];
  renderNoteIds: string[]; measureNumbers: string[]; staffIds: string[]; voiceIds: string[];
  tieTypes: string[]; playable: boolean; entryCandidate: boolean;
};
export type ExpectedPracticeNote = {
  expectedNoteId: string; eventId: string; pianoKey: PracticePianoKey; renderNoteId: string; measureNumbers: string[];
};
export type ExpectedPracticeStrike = {
  strikeId: string; pianoKey: PracticePianoKey; expectedNotes: ExpectedPracticeNote[];
  eventIds: string[]; renderNoteIds: string[]; measureNumbers: string[];
};
export type ExpectedPracticeGroup = {
  groupId: string; onsetBeat: number; canonicalEndBeat: number; eventIds: string[];
  expectedNotes: ExpectedPracticeNote[]; strikeTargets: ExpectedPracticeStrike[]; pianoKeys: PracticePianoKey[];
  renderNoteIds: string[]; measureNumbers: string[]; staffIds: string[]; voiceIds: string[];
};
export type PracticeStepNote = {
  stepNoteId: string; eventId: string; pianoKey: PracticePianoKey; renderNoteId: string;
  measureNumbers: string[]; staffIds: string[]; voiceIds: string[];
};
export type PracticeAttackTarget = {
  attackId: string; pianoKey: PracticePianoKey; notes: PracticeStepNote[];
  eventIds: string[]; renderNoteIds: string[]; measureNumbers: string[];
};
export type PracticeAttackStep = {
  stepId: string; onsetBeat: number; attackTargets: PracticeAttackTarget[]; continuation: PracticeStepNote[];
  eventIds: string[]; renderNoteIds: string[]; measureNumbers: string[]; staffIds: string[]; voiceIds: string[];
};
export type MeterSegment = {
  startBeat: number; numerator: number; denominator: number; measureDurationBeats: number; countInPulses: number;
  source: 'MUSICXML' | 'DEFAULT_4_4';
};
export type TempoSegment = { startBeat: number; bpm: number };
export type PracticeScoreArtifact = {
  schemaVersion: typeof PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION;
  scoreId: string; revisionId: string; artifactId: string; playableEvents: PracticeScoreEvent[];
  expectedPracticeGroups: ExpectedPracticeGroup[]; practiceAttackSteps: PracticeAttackStep[];
  meterSegments: MeterSegment[]; scoreTempoSegments: TempoSegment[]; firstPlayableBeat: number | null; scoreEndBeat: number;
};

/** One untrusted transport boundary; no conversion, coercion or legacy reader. */
export function parsePracticeScoreArtifact(value: unknown): PracticeScoreArtifact {
  assertPracticeScoreArtifact(value);
  return value;
}

export function assertPracticeScoreArtifact(artifact: unknown): asserts artifact is PracticeScoreArtifact {
  if (!artifact || typeof artifact !== 'object') {
    throw new PracticeScoreContractError('PracticeScoreArtifact must be an object');
  }
  const candidate = artifact as Partial<PracticeScoreArtifact>;
  if (candidate.schemaVersion !== PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION) {
    throw new PracticeScoreContractError(`Unsupported PracticeScoreArtifact schema: ${candidate.schemaVersion}`);
  }
  if ([candidate.scoreId, candidate.revisionId, candidate.artifactId].some(id => typeof id !== 'string' || !id)) {
    throw new PracticeScoreContractError('PracticeScoreArtifact requires stable score, revision, and artifact identity.');
  }
  if (!Array.isArray(candidate.scoreTempoSegments)) {
    throw new PracticeScoreContractError('PracticeScoreArtifact requires scoreTempoSegments array.');
  }
  for (let i = 0; i < candidate.scoreTempoSegments.length; i += 1) {
    const segment = candidate.scoreTempoSegments[i];
    if (!segment || typeof segment !== 'object') {
      throw new PracticeScoreContractError(`PracticeScoreArtifact scoreTempoSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(segment.startBeat) || segment.startBeat < 0) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid startBeat: ${segment.startBeat}.`);
    }
    if (!Number.isFinite(segment.bpm) || segment.bpm <= 0) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid bpm: ${segment.bpm}.`);
    }
    if (i > 0 && segment.startBeat <= candidate.scoreTempoSegments[i - 1].startBeat) {
      throw new PracticeScoreContractError(
        'PracticeScoreArtifact scoreTempoSegments must be strictly sorted by startBeat ascending without duplicate start beats.'
      );
    }
  }
  if (!Array.isArray(candidate.meterSegments)) {
    throw new PracticeScoreContractError('PracticeScoreArtifact requires meterSegments array.');
  }
  for (let i = 0; i < candidate.meterSegments.length; i += 1) {
    const meter = candidate.meterSegments[i];
    if (!meter || typeof meter !== 'object') {
      throw new PracticeScoreContractError(`PracticeScoreArtifact meterSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(meter.startBeat) || meter.startBeat < 0) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact meterSegment at index ${i} has invalid startBeat: ${meter.startBeat}.`);
    }
    if (!Number.isFinite(meter.numerator) || meter.numerator < 1 || !Number.isFinite(meter.denominator) || meter.denominator < 1) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact meterSegment at index ${i} has invalid time signature.`);
    }
  }
  if (
    !Array.isArray(candidate.practiceAttackSteps) ||
    !Array.isArray(candidate.expectedPracticeGroups) ||
    candidate.practiceAttackSteps.length === 0 ||
    candidate.practiceAttackSteps.length !== candidate.expectedPracticeGroups.length
  ) {
    throw new PracticeScoreContractError('PracticeScoreArtifact requires 1:1 attack steps and expected groups.');
  }
  const validArtifact = candidate as PracticeScoreArtifact;
  if (!Array.isArray(validArtifact.playableEvents) || validArtifact.playableEvents.length === 0) throw new PracticeScoreContractError('PracticeScoreArtifact has no playable events.');
  assertUniqueIdentities(validArtifact.playableEvents.map(event => event.eventId), 'event');
  assertUniqueIdentities(validArtifact.playableEvents.flatMap(event => event.renderNoteIds), 'revision render-note');
  const events = new Map(validArtifact.playableEvents.map(event => [event.eventId, event]));
  for (const event of validArtifact.playableEvents) {
    if (!Array.isArray(event.pianoKeys) || event.pianoKeys.length === 0
      || event.pianoKeys.length !== event.renderNoteIds.length || event.pianoKeys.some(key => !isPracticePianoKey(key))) {
      throw new PracticeScoreContractError('PracticeScoreArtifact invalid event piano keys.');
    }
    assertUniqueIdentities(event.renderNoteIds, 'event render-note');
  }
  const assertNoteOwner = (note: { eventId: string; renderNoteId: string; pianoKey: PracticePianoKey }) => {
    const event = events.get(note.eventId);
    const index = event?.renderNoteIds.indexOf(note.renderNoteId) ?? -1;
    if (!isPracticePianoKey(note.pianoKey) || index < 0 || event?.pianoKeys[index] !== note.pianoKey) {
      throw new PracticeScoreContractError('PracticeScoreArtifact note event/render ownership is corrupt.');
    }
  };
  validArtifact.practiceAttackSteps.forEach((step, index) => {
    const group = validArtifact.expectedPracticeGroups[index];
    if (roundBeat(step.onsetBeat) !== roundBeat(group.onsetBeat)) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact step/group onset mismatch at index ${index}.`);
    }
    const groupPitches = assertPhysicalKeySet(group.pianoKeys, 'group');
    const stepPitches = assertPhysicalKeySet(step.attackTargets.map((target) => target.pianoKey), 'attack targets');
    const strikePitches = assertPhysicalKeySet(group.strikeTargets.map((target) => target.pianoKey), 'strike targets');
    if (JSON.stringify(groupPitches) !== JSON.stringify(stepPitches)) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact step/group attack pianoKey mismatch at index ${index}.`);
    }
    if (JSON.stringify(groupPitches) !== JSON.stringify(strikePitches)) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact group strike target mismatch at index ${index}.`);
    }
    group.expectedNotes.forEach(assertNoteOwner);
    assertEventAggregate(group.expectedNotes, group.eventIds);
    assertUniqueIdentities(group.expectedNotes.map(note => note.expectedNoteId), 'expected-note');
    assertExactIdentityAggregate(group.expectedNotes.map(note => note.renderNoteId), group.renderNoteIds, 'group render-note');
    const expected = new Map(group.expectedNotes.map(note => [note.expectedNoteId, note]));
    if (expected.size !== group.expectedNotes.length) throw new PracticeScoreContractError('PracticeScoreArtifact duplicate expected-note identity.');
    const owned = new Set<string>();
    for (const target of group.strikeTargets) {
      assertTargetNotation(target.pianoKey, target.expectedNotes, target.renderNoteIds);
      assertEventAggregate(target.expectedNotes, target.eventIds);
      for (const note of target.expectedNotes) {
        const canonical = expected.get(note.expectedNoteId);
        if (owned.has(note.expectedNoteId) || !canonical || note.pianoKey !== canonical.pianoKey
          || note.eventId !== canonical.eventId || note.renderNoteId !== canonical.renderNoteId
          || JSON.stringify(note.measureNumbers) !== JSON.stringify(canonical.measureNumbers)) {
          throw new PracticeScoreContractError('PracticeScoreArtifact strike expected-note partition is corrupt.');
        }
        owned.add(note.expectedNoteId);
      }
    }
    if (owned.size !== expected.size) throw new PracticeScoreContractError('PracticeScoreArtifact strike expected-note partition is incomplete.');
    for (const target of step.attackTargets) {
      assertTargetNotation(target.pianoKey, target.notes, target.renderNoteIds);
      assertEventAggregate(target.notes, target.eventIds);
    }
    const stepNotes = [...step.attackTargets.flatMap(target => target.notes), ...step.continuation];
    stepNotes.forEach(assertNoteOwner);
    assertEventAggregate(stepNotes, step.eventIds);
    assertUniqueIdentities(stepNotes.map(note => note.stepNoteId), 'step-note');
    assertExactIdentityAggregate(stepNotes.map(note => note.renderNoteId), step.renderNoteIds, 'step render-note');
    if (roundBeat(group.canonicalEndBeat) < roundBeat(group.onsetBeat)) {
      throw new PracticeScoreContractError(`PracticeScoreArtifact group canonical end precedes onset at index ${index}.`);
    }
  });
}

function assertPhysicalKeySet(values: PracticePianoKey[], owner: string): PracticePianoKey[] {
  if (!Array.isArray(values) || values.length === 0 || values.some(pianoKey => !isPracticePianoKey(pianoKey))
    || new Set(values).size !== values.length) throw new PracticeScoreContractError(`PracticeScoreArtifact duplicate or invalid physical pianoKey in ${owner}.`);
  return [...values].sort((a, b) => a - b);
}

function assertTargetNotation(pianoKey: PracticePianoKey, notes: { pianoKey: PracticePianoKey; renderNoteId: string }[], renderNoteIds: string[]): void {
  if (!Array.isArray(notes) || notes.length === 0 || notes.some(note => note.pianoKey !== pianoKey)) {
    throw new PracticeScoreContractError('PracticeScoreArtifact target notation pianoKeys are corrupt.');
  }
  assertExactIdentityAggregate(notes.map(note => note.renderNoteId), renderNoteIds, 'target render-note');
}

function assertEventAggregate(notes: { eventId: string }[], eventIds: string[]): void {
  assertExactIdentityAggregate([...new Set(notes.map(note => note.eventId))], eventIds, 'event');
}

function assertUniqueIdentities(values: string[], owner: string): void {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value)
    || new Set(values).size !== values.length) {
    throw new PracticeScoreContractError(`PracticeScoreArtifact ${owner} identities are corrupt.`);
  }
}

function assertExactIdentityAggregate(nested: string[], flat: string[], owner: string): void {
  assertUniqueIdentities(nested, owner);
  assertUniqueIdentities(flat, owner);
  if (JSON.stringify([...nested].sort()) !== JSON.stringify([...flat].sort())) {
    throw new PracticeScoreContractError(`PracticeScoreArtifact ${owner} identities are corrupt.`);
  }
}

export function roundBeat(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
