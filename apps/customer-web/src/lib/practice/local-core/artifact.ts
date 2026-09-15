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
  firstPlayableBeat: number | null;
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
  expectedNotes: ExpectedPracticeNote[];
  strikeTargets: ExpectedPracticeStrikeTarget[];
  renderNoteIds: string[];
  pitches: string[];
  measureNumbers: string[];
  staffIds: string[];
  voiceIds: string[];
  canonicalEndBeat: number;
};

export type ExpectedPracticeNote = {
  expectedNoteId: string;
  eventId: string;
  pitch: string;
  renderNoteId: string;
  measureNumbers: string[];
};

export type ExpectedPracticeStrikeTarget = {
  strikeId: string;
  pitch: string;
  expectedNotes: ExpectedPracticeNote[];
  eventIds: string[];
  renderNoteIds: string[];
  measureNumbers: string[];
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
  measureDurationBeats: number;
  countInPulses: number;
  source?: 'MUSICXML' | 'DEFAULT_4_4';
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

export type CountInContract = {
  durationBeats: number;
  pulses: number;
  numerator: number;
  denominator: number;
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

export function meterAt(artifact: PracticeScoreArtifact, beat: number): MeterSegment {
  const defaultMeter: MeterSegment = {
    startBeat: 0,
    numerator: 4,
    denominator: 4,
    measureDurationBeats: 4,
    countInPulses: 4,
    source: 'DEFAULT_4_4',
  };
  const segments = artifact.meterSegments.length > 0 ? artifact.meterSegments : [defaultMeter];
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
