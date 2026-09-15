export const PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type PracticeMode = 'STEP_BY_STEP' | 'CONTINUOUS_PLAY';
export type PracticeInputSource = 'MICROPHONE' | 'MIDI';

export type PracticeScoreArtifact = {
  schemaVersion: typeof PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION;
  scoreId: string;
  revisionId: string;
  artifactId: string;
  playableEvents: PracticeScoreEvent[];
  expectedPracticeGroups: ExpectedPracticeGroup[];
  practiceAttackSteps: PracticeAttackStep[];
  meterSegments: MeterSegment[];
  tempoSegments: TempoSegment[];
  firstPlayableBeat: number;
  scoreEndBeat: number;
};

export type PracticeScoreEvent = {
  eventId: string;
  onsetBeat: number;
  durationBeats: number;
  pitches: string[];
  renderNoteIds: string[];
  measureNumbers: string[];
  staffIds: string[];
  voiceIds: string[];
  tieTypes: string[];
  playable: boolean;
  entryCandidate: boolean;
};

export type ExpectedPracticeGroup = {
  groupId: string;
  onsetBeat: number;
  eventIds: string[];
  renderNoteIds: string[];
  pitches: string[];
  measureNumbers: string[];
  staffIds: string[];
  voiceIds: string[];
};

export type PracticeStepNote = {
  stepNoteId: string;
  eventId: string;
  pitch: string;
  renderNoteId: string;
  measureNumbers: string[];
  staffIds: string[];
  voiceIds: string[];
};

export type PracticeAttackTarget = {
  attackId: string;
  pitch: string;
  notes: PracticeStepNote[];
  eventIds: string[];
  renderNoteIds: string[];
  measureNumbers: string[];
};

export type PracticeAttackStep = {
  stepId: string;
  onsetBeat: number;
  eventIds: string[];
  attackTargets: PracticeAttackTarget[];
  continuation: PracticeStepNote[];
  renderNoteIds: string[];
  measureNumbers: string[];
  staffIds: string[];
  voiceIds: string[];
};

export type MeterSegment = {
  startBeat: number;
  numerator: number;
  denominator: number;
};

export type TempoSegment = {
  startBeat: number;
  bpm: number;
};

export type PracticeScope = {
  startGroupId?: string;
  endGroupId?: string;
};

export type ResolvedPracticeScope = {
  startIndex: number;
  endIndex: number;
  startBeat: number;
  terminalBeat: number;
  startGroupId?: string;
  endGroupId?: string;
};

export function assertPracticeScoreArtifact(artifact: PracticeScoreArtifact): void {
  if (artifact.schemaVersion !== PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported PracticeScoreArtifact schema: ${artifact.schemaVersion}`);
  }
  if (!artifact.scoreId || !artifact.revisionId || !artifact.artifactId) {
    throw new Error('PracticeScoreArtifact requires stable score, revision, and artifact identity.');
  }
  if (artifact.practiceAttackSteps.length !== artifact.expectedPracticeGroups.length) {
    throw new Error('PracticeScoreArtifact requires 1:1 attack steps and expected groups.');
  }
  artifact.practiceAttackSteps.forEach((step, index) => {
    const group = artifact.expectedPracticeGroups[index];
    if (roundBeat(step.onsetBeat) !== roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact step/group onset mismatch at index ${index}.`);
    }
    const groupPitches = uniqueSorted(group.pitches);
    const stepPitches = uniqueSorted(step.attackTargets.map((target) => target.pitch));
    if (groupPitches.join('\u001f') !== stepPitches.join('\u001f')) {
      throw new Error(`PracticeScoreArtifact step/group attack pitch mismatch at index ${index}.`);
    }
  });
}

export function resolvePracticeScope(
  artifact: PracticeScoreArtifact,
  scope: PracticeScope = {}
): ResolvedPracticeScope {
  assertPracticeScoreArtifact(artifact);
  if (artifact.expectedPracticeGroups.length === 0) {
    throw new Error('Practice scope requires at least one expected group.');
  }

  const startIndex = scope.startGroupId
    ? groupIndex(artifact, scope.startGroupId)
    : 0;
  const endIndex = scope.endGroupId
    ? groupIndex(artifact, scope.endGroupId)
    : artifact.expectedPracticeGroups.length - 1;
  if (endIndex < startIndex) {
    throw new Error('Practice scope end must not be before its start.');
  }

  const startGroup = artifact.expectedPracticeGroups[startIndex];
  const endGroup = artifact.expectedPracticeGroups[endIndex];
  return {
    startIndex,
    endIndex,
    startBeat: startGroup.onsetBeat,
    terminalBeat: scope.endGroupId
      ? entryGroupEndBeat(artifact, endGroup.groupId)
      : artifact.scoreEndBeat,
    startGroupId: scope.startGroupId,
    endGroupId: scope.endGroupId,
  };
}

export function entryGroupEndBeat(artifact: PracticeScoreArtifact, groupId: string): number {
  const group = artifact.expectedPracticeGroups.find((candidate) => candidate.groupId === groupId);
  if (!group) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  const eventsById = new Map(artifact.playableEvents.map((event) => [event.eventId, event]));
  const endBeat = Math.max(
    ...group.eventIds.map((eventId) => {
      const event = eventsById.get(eventId);
      return event ? event.onsetBeat + event.durationBeats : group.onsetBeat;
    })
  );
  return roundBeat(endBeat);
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
