import {
  addRational,
  compareRational,
  subtractRational,
  type EventId,
  type MeasureId,
  type MusicalPosition,
  type Rational,
  type RhythmicValue,
  type StaffId,
  type VoiceId,
} from './model';

export type ActiveVoice = {
  voiceId: VoiceId;
  staffId: StaffId;
};

export type Caret = {
  kind: 'caret';
  voiceId: VoiceId;
  staffId: StaffId;
  position: MusicalPosition;
};

export type RhythmicGridResolution = {
  kind: 'rhythmicGridResolution';
  step: Rational;
};

export type InputDuration = {
  kind: 'inputDuration';
  rhythm: RhythmicValue;
};

export type InsertionAnchor =
  | {
      kind: 'caret';
      caret: Caret;
    }
  | {
      kind: 'timelineGap';
      voiceId: VoiceId;
      staffId: StaffId;
      position: MusicalPosition;
      gapStart: MusicalPosition;
      gapDuration: Rational;
    }
  | {
      kind: 'eventEdge';
      voiceId: VoiceId;
      staffId: StaffId;
      position: MusicalPosition;
      eventId: EventId;
      edge: 'before' | 'after';
    };

export type GridPosition = {
  position: MusicalPosition;
  index: number;
};

export function createActiveVoice(params: {
  voiceId: VoiceId;
  staffId: StaffId;
}): ActiveVoice {
  return {
    voiceId: params.voiceId,
    staffId: params.staffId,
  };
}

export function createCaret(params: {
  activeVoice: ActiveVoice;
  measureId: MeasureId;
  offset: Rational;
}): Caret {
  assertNonNegativeRational(params.offset, 'Caret offset');
  return {
    kind: 'caret',
    voiceId: params.activeVoice.voiceId,
    staffId: params.activeVoice.staffId,
    position: {
      measureId: params.measureId,
      offset: params.offset,
    },
  };
}

export function createRhythmicGridResolution(step: Rational): RhythmicGridResolution {
  assertPositiveRational(step, 'Rhythmic grid step');
  return {
    kind: 'rhythmicGridResolution',
    step,
  };
}

export function createInputDuration(rhythm: RhythmicValue): InputDuration {
  assertPositiveRational(rhythm.timelineDuration, 'Input duration');
  return {
    kind: 'inputDuration',
    rhythm,
  };
}

export function moveCaretByGridSteps(params: {
  caret: Caret;
  grid: RhythmicGridResolution;
  steps: number;
  measureDuration: Rational;
}): Caret {
  if (!Number.isInteger(params.steps)) {
    throw new Error('Caret grid steps must be an integer.');
  }

  const delta = {
    numerator: params.grid.step.numerator * params.steps,
    denominator: params.grid.step.denominator,
  };
  const nextOffset = addRational(params.caret.position.offset, delta);
  return {
    ...params.caret,
    position: {
      ...params.caret.position,
      offset: clampRational(nextOffset, { numerator: 0, denominator: 1 }, params.measureDuration),
    },
  };
}

export function createCaretAtNearestGridPosition(params: {
  activeVoice: ActiveVoice;
  measureId: MeasureId;
  offset: Rational;
  measureDuration: Rational;
  grid: RhythmicGridResolution;
}): { caret: Caret; gridPosition: GridPosition } {
  const gridPosition = snapOffsetToGrid({
    measureId: params.measureId,
    offset: params.offset,
    measureDuration: params.measureDuration,
    grid: params.grid,
  });

  return {
    caret: createCaret({
      activeVoice: params.activeVoice,
      measureId: params.measureId,
      offset: gridPosition.position.offset,
    }),
    gridPosition,
  };
}

export function snapOffsetToGrid(params: {
  measureId: MeasureId;
  offset: Rational;
  measureDuration: Rational;
  grid: RhythmicGridResolution;
}): GridPosition {
  assertPositiveRational(params.measureDuration, 'Measure duration');

  const clampedOffset = clampRational(
    params.offset,
    { numerator: 0, denominator: 1 },
    params.measureDuration
  );
  const positions = enumerateGridPositions({
    measureId: params.measureId,
    measureDuration: params.measureDuration,
    grid: params.grid,
  });

  let nearest = positions[0];
  let nearestDistance = absoluteRationalDistance(clampedOffset, nearest.position.offset);

  for (const position of positions.slice(1)) {
    const distance = absoluteRationalDistance(clampedOffset, position.position.offset);
    if (compareRational(distance, nearestDistance) <= 0) {
      nearest = position;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function createCaretInsertionAnchor(caret: Caret): InsertionAnchor {
  return {
    kind: 'caret',
    caret,
  };
}

export function createTimelineGapInsertionAnchor(params: {
  activeVoice: ActiveVoice;
  position: MusicalPosition;
  gapStart: MusicalPosition;
  gapDuration: Rational;
}): InsertionAnchor {
  assertPositionWithinGap(params.position, params.gapStart, params.gapDuration);
  return {
    kind: 'timelineGap',
    voiceId: params.activeVoice.voiceId,
    staffId: params.activeVoice.staffId,
    position: params.position,
    gapStart: params.gapStart,
    gapDuration: params.gapDuration,
  };
}

export function enumerateGridPositions(params: {
  measureId: MeasureId;
  measureDuration: Rational;
  grid: RhythmicGridResolution;
}): GridPosition[] {
  assertPositiveRational(params.measureDuration, 'Measure duration');

  const positions: GridPosition[] = [];
  let offset: Rational = { numerator: 0, denominator: 1 };
  let index = 0;
  while (compareRational(offset, params.measureDuration) <= 0) {
    positions.push({
      position: {
        measureId: params.measureId,
        offset,
      },
      index,
    });
    offset = addRational(offset, params.grid.step);
    index += 1;
  }

  const lastPosition = positions.at(-1);
  if (lastPosition && compareRational(lastPosition.position.offset, params.measureDuration) < 0) {
    positions.push({
      position: {
        measureId: params.measureId,
        offset: params.measureDuration,
      },
      index,
    });
  }

  return positions;
}

function assertPositionWithinGap(position: MusicalPosition, gapStart: MusicalPosition, gapDuration: Rational): void {
  if (position.measureId !== gapStart.measureId) {
    throw new Error('Insertion position must be in the same measure as the timeline gap.');
  }

  const gapEnd = addRational(gapStart.offset, gapDuration);
  if (compareRational(position.offset, gapStart.offset) < 0 || compareRational(position.offset, gapEnd) > 0) {
    throw new Error('Insertion position must be inside the timeline gap.');
  }
}

function clampRational(value: Rational, min: Rational, max: Rational): Rational {
  if (compareRational(value, min) < 0) return min;
  if (compareRational(value, max) > 0) return max;
  return value;
}

function absoluteRationalDistance(left: Rational, right: Rational): Rational {
  if (compareRational(left, right) >= 0) {
    return subtractRational(left, right);
  }
  return subtractRational(right, left);
}

function assertPositiveRational(value: Rational, label: string): void {
  if (compareRational(value, { numerator: 0, denominator: 1 }) <= 0) {
    throw new Error(`${label} must be positive.`);
  }
}

function assertNonNegativeRational(value: Rational, label: string): void {
  if (compareRational(value, { numerator: 0, denominator: 1 }) < 0) {
    throw new Error(`${label} must be non-negative.`);
  }
}
