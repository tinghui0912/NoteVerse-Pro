import {
  addRational,
  compareRational,
  subtractRational,
  type MeasureId,
  type MusicalPosition,
  type Rational,
  type StaffId,
  type VoiceId,
} from './model';
import {
  enumerateGridPositions,
  type GridPosition,
  type RhythmicGridResolution,
} from './rhythmic-input';

export type RenderedRhythmicAnchor = {
  position: MusicalPosition;
  x: number;
};

export type RhythmicLayoutPoint = {
  gridPosition: GridPosition;
  x: number;
};

export type RhythmicLayoutMap = {
  kind: 'rhythmicLayoutMap';
  measureId: MeasureId;
  staffId: StaffId;
  voiceId: VoiceId;
  measureDuration: Rational;
  grid: RhythmicGridResolution;
  xLeft: number;
  xRight: number;
  points: RhythmicLayoutPoint[];
};

export function createRhythmicLayoutMap(params: {
  measureId: MeasureId;
  staffId: StaffId;
  voiceId: VoiceId;
  measureDuration: Rational;
  grid: RhythmicGridResolution;
  xLeft: number;
  xRight: number;
  anchors?: RenderedRhythmicAnchor[];
}): RhythmicLayoutMap {
  assertPositiveRational(params.measureDuration, 'Measure duration');
  assertFiniteX(params.xLeft, 'Layout left x');
  assertFiniteX(params.xRight, 'Layout right x');
  if (params.xRight <= params.xLeft) {
    throw new Error('Layout right x must be greater than left x.');
  }

  const anchors = normalizeAnchors({
    measureId: params.measureId,
    measureDuration: params.measureDuration,
    xLeft: params.xLeft,
    xRight: params.xRight,
    anchors: params.anchors ?? [],
  });
  const points = enumerateGridPositions({
    measureId: params.measureId,
    measureDuration: params.measureDuration,
    grid: params.grid,
  }).map((gridPosition) => ({
    gridPosition,
    x: interpolateXForOffset(gridPosition.position.offset, anchors),
  }));

  return {
    kind: 'rhythmicLayoutMap',
    measureId: params.measureId,
    staffId: params.staffId,
    voiceId: params.voiceId,
    measureDuration: params.measureDuration,
    grid: params.grid,
    xLeft: params.xLeft,
    xRight: params.xRight,
    points,
  };
}

export function resolveNearestLayoutPoint(params: {
  layoutMap: RhythmicLayoutMap;
  clientX: number;
}): RhythmicLayoutPoint {
  assertFiniteX(params.clientX, 'Client x');

  const clampedX = Math.min(
    params.layoutMap.xRight,
    Math.max(params.layoutMap.xLeft, params.clientX)
  );
  let nearest = params.layoutMap.points[0];
  let nearestDistance = Math.abs(clampedX - nearest.x);

  for (const point of params.layoutMap.points.slice(1)) {
    const distance = Math.abs(clampedX - point.x);
    if (distance <= nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function getLayoutPointAtPosition(
  layoutMap: RhythmicLayoutMap,
  position: MusicalPosition
): RhythmicLayoutPoint | null {
  if (position.measureId !== layoutMap.measureId) return null;

  return layoutMap.points.find((point) => (
    compareRational(point.gridPosition.position.offset, position.offset) === 0
  )) ?? null;
}

function normalizeAnchors(params: {
  measureId: MeasureId;
  measureDuration: Rational;
  xLeft: number;
  xRight: number;
  anchors: RenderedRhythmicAnchor[];
}): RenderedRhythmicAnchor[] {
  const anchorsByOffset = new Map<string, RenderedRhythmicAnchor>();
  setAnchor(anchorsByOffset, {
    position: {
      measureId: params.measureId,
      offset: { numerator: 0, denominator: 1 },
    },
    x: params.xLeft,
  });
  setAnchor(anchorsByOffset, {
    position: {
      measureId: params.measureId,
      offset: params.measureDuration,
    },
    x: params.xRight,
  });

  params.anchors.forEach((anchor) => {
    validateAnchor(anchor, params.measureId, params.measureDuration);
    setAnchor(anchorsByOffset, anchor);
  });

  return Array.from(anchorsByOffset.values())
    .sort((left, right) => compareRational(left.position.offset, right.position.offset));
}

function setAnchor(anchorsByOffset: Map<string, RenderedRhythmicAnchor>, anchor: RenderedRhythmicAnchor): void {
  assertFiniteX(anchor.x, 'Anchor x');
  anchorsByOffset.set(rationalKey(anchor.position.offset), anchor);
}

function validateAnchor(anchor: RenderedRhythmicAnchor, measureId: MeasureId, measureDuration: Rational): void {
  if (anchor.position.measureId !== measureId) {
    throw new Error('Rhythmic layout anchors must belong to the layout measure.');
  }
  if (
    compareRational(anchor.position.offset, { numerator: 0, denominator: 1 }) < 0
    || compareRational(anchor.position.offset, measureDuration) > 0
  ) {
    throw new Error('Rhythmic layout anchors must be inside the measure.');
  }
}

function interpolateXForOffset(offset: Rational, anchors: RenderedRhythmicAnchor[]): number {
  const exactAnchor = anchors.find((anchor) => compareRational(anchor.position.offset, offset) === 0);
  if (exactAnchor) return exactAnchor.x;

  const rightIndex = anchors.findIndex((anchor) => compareRational(anchor.position.offset, offset) > 0);
  const right = anchors[rightIndex];
  const left = anchors[rightIndex - 1];
  const segmentDuration = subtractRational(right.position.offset, left.position.offset);
  const offsetWithinSegment = subtractRational(offset, left.position.offset);
  const ratio = rationalToNumber(offsetWithinSegment) / rationalToNumber(segmentDuration);
  return left.x + (right.x - left.x) * ratio;
}

function rationalToNumber(value: Rational): number {
  return value.numerator / value.denominator;
}

function rationalKey(value: Rational): string {
  const normalized = addRational(value, { numerator: 0, denominator: 1 });
  return `${normalized.numerator}/${normalized.denominator}`;
}

function assertPositiveRational(value: Rational, label: string): void {
  if (compareRational(value, { numerator: 0, denominator: 1 }) <= 0) {
    throw new Error(`${label} must be positive.`);
  }
}

function assertFiniteX(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
}
