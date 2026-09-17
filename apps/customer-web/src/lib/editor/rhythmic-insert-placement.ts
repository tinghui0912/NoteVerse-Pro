import type { AddLocation, ParsedScoreEvent, ScoreData } from '@/types/score-types';
import {
  addRational,
  compareRational,
  createActiveVoice,
  createCaret,
  createCaretInsertionAnchor,
  createRhythmicGridResolution,
  createRhythmicLayoutMap,
  createTimelineGapInsertionAnchor,
  type Caret,
  type InputDuration,
  type InsertionAnchor,
  type MeasureId,
  type MusicalPosition,
  type Rational,
  type RenderedRhythmicAnchor,
  type RhythmicLayoutPoint,
  type RhythmicGridResolution,
  type ScoreDocument,
  type TimelineGap,
} from '@/lib/editor-domain';
import { parseTimeSignature } from './measure-timeline';
import { getEditorTrackId, parseVoiceNumber } from './tracks';
import { getMeasureHorizontalBounds } from './verovio-geometry';

export type RhythmicInsertTarget = {
  staveIndex: number;
  xmlVoice: number;
};

export type RhythmicInsertPlacement = {
  location: AddLocation;
  left: number;
  gridLines: number[];
  caret: Caret;
  insertionAnchor: InsertionAnchor;
  position: MusicalPosition;
};

const VEROVIO_EVENT_CONTAINER_SELECTOR = [
  '[data-class="chord"]',
  '[data-class="note"]',
  '[data-class="rest"]',
  '[data-class="mRest"]',
].join(', ');

export function resolveRhythmicInsertPlacement(params: {
  domainDocument: ScoreDocument | null;
  timelineGaps: TimelineGap[];
  scoreData: ScoreData | null;
  measureElement: Element;
  measureIndex: number;
  target: RhythmicInsertTarget;
  clientX: number;
  divisions: number;
  inputDuration?: InputDuration;
  timeSignature?: string | null;
  grid?: RhythmicGridResolution;
  visibleTrackIdSet: Set<string>;
}): RhythmicInsertPlacement | null {
  const measure = params.domainDocument?.measures[params.measureIndex];
  const staff = params.domainDocument?.staves.find((candidate) => candidate.index === params.target.staveIndex);
  const voice = staff
    ? params.domainDocument?.voices.find((candidate) => (
      candidate.partId === staff.partId
      && String(candidate.id).endsWith(`:voice-${params.target.xmlVoice}`)
    ))
    : null;
  if (!measure || !staff || !voice) return null;

  const measureDuration = getMeasureDuration(params.timeSignature);
  const grid = params.grid ?? createRhythmicGridResolution(getBeatDuration(params.timeSignature));
  const measureRect = getMeasureHorizontalBounds(params.measureElement);
  const layoutMap = createRhythmicLayoutMap({
    measureId: measure.id,
    staffId: staff.id,
    voiceId: voice.id,
    measureDuration,
    grid,
    xLeft: measureRect.left,
    xRight: measureRect.right,
    anchors: getRenderedRhythmicAnchors({
      scoreData: params.scoreData,
      measureElement: params.measureElement,
      measureId: measure.id,
      measureIndex: params.measureIndex,
      target: params.target,
      divisions: params.divisions,
      visibleTrackIdSet: params.visibleTrackIdSet,
    }),
  });
  const candidatePoints = getInsertableLayoutPoints({
    points: layoutMap.points,
    measureDuration,
    inputDuration: params.inputDuration,
  });
  if (candidatePoints.length === 0) return null;
  const layoutPoint = resolveNearestInsertableLayoutPoint({
    points: candidatePoints,
    xLeft: measureRect.left,
    xRight: measureRect.right,
    clientX: params.clientX,
  });
  const activeVoice = createActiveVoice({
    staffId: staff.id,
    voiceId: voice.id,
  });
  const caret = createCaret({
    activeVoice,
    measureId: measure.id,
    offset: layoutPoint.gridPosition.position.offset,
  });
  const containingGap = findContainingTimelineGap({
    gaps: params.timelineGaps,
    voiceId: voice.id,
    staffId: staff.id,
    position: caret.position,
  });
  const insertionAnchor = containingGap
    ? createTimelineGapInsertionAnchor({
      activeVoice,
      position: caret.position,
      gapStart: containingGap.start,
      gapDuration: containingGap.duration,
    })
    : createCaretInsertionAnchor(caret);

  return {
    location: {
      measureIndex: params.measureIndex,
      staveIndex: params.target.staveIndex,
      xmlVoice: params.target.xmlVoice,
      tick: rationalToTicks(layoutPoint.gridPosition.position.offset, params.divisions),
    },
    left: layoutPoint.x,
    gridLines: candidatePoints.map((point) => point.x),
    caret,
    insertionAnchor,
    position: layoutPoint.gridPosition.position,
  };
}

function getInsertableLayoutPoints(params: {
  points: RhythmicLayoutPoint[];
  measureDuration: Rational;
  inputDuration: InputDuration | undefined;
}): RhythmicLayoutPoint[] {
  const inputDuration = params.inputDuration;
  if (!inputDuration) return params.points;

  return params.points.filter((point) => (
    compareRational(
      addRational(point.gridPosition.position.offset, inputDuration.rhythm.timelineDuration),
      params.measureDuration
    ) <= 0
  ));
}

function resolveNearestInsertableLayoutPoint(params: {
  points: RhythmicLayoutPoint[];
  xLeft: number;
  xRight: number;
  clientX: number;
}): RhythmicLayoutPoint {
  const clampedX = Math.min(params.xRight, Math.max(params.xLeft, params.clientX));
  let nearest = params.points[0];
  let nearestDistance = Math.abs(clampedX - nearest.x);

  for (const point of params.points.slice(1)) {
    const distance = Math.abs(clampedX - point.x);
    if (distance <= nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function findContainingTimelineGap(params: {
  gaps: TimelineGap[];
  voiceId: TimelineGap['voiceId'];
  staffId: TimelineGap['staffId'];
  position: MusicalPosition;
}): TimelineGap | null {
  return params.gaps.find((gap) => (
    gap.voiceId === params.voiceId
    && gap.staffId === params.staffId
    && gap.start.measureId === params.position.measureId
    && compareRational(params.position.offset, gap.start.offset) >= 0
    && compareRational(params.position.offset, addRational(gap.start.offset, gap.duration)) <= 0
  )) ?? null;
}

function getRenderedRhythmicAnchors(params: {
  scoreData: ScoreData | null;
  measureElement: Element;
  measureId: MeasureId;
  measureIndex: number;
  target: RhythmicInsertTarget;
  divisions: number;
  visibleTrackIdSet: Set<string>;
}): RenderedRhythmicAnchor[] {
  const voiceNumbers = getAnchorVoiceNumbers({
    scoreData: params.scoreData,
    measureIndex: params.measureIndex,
    staveIndex: params.target.staveIndex,
    xmlVoice: params.target.xmlVoice,
    visibleTrackIdSet: params.visibleTrackIdSet,
  });
  if (voiceNumbers.size === 0) return [];

  const anchors: RenderedRhythmicAnchor[] = [];
  const stave = params.scoreData?.measures[params.measureIndex]?.staves[params.target.staveIndex];
  stave?.voices.forEach((voice) => {
    if (!voiceNumbers.has(parseVoiceNumber(voice.name))) return;

    voice.events.forEach((event) => {
      if (!event.meta) return;
      const x = getEntityElementCenterX(params.measureElement, event);
      if (x === null) return;

      anchors.push({
        position: {
          measureId: params.measureId,
          offset: ticksToRational(event.meta.startTick ?? 0, params.divisions),
        },
        x,
      });

    });
  });

  return anchors;
}

function getAnchorVoiceNumbers(params: {
  scoreData: ScoreData | null;
  measureIndex: number;
  staveIndex: number;
  xmlVoice: number;
  visibleTrackIdSet: Set<string>;
}): Set<number> {
  const stave = params.scoreData?.measures[params.measureIndex]?.staves[params.staveIndex];
  const targetVoice = stave?.voices.find((voice) => parseVoiceNumber(voice.name) === params.xmlVoice);
  if (targetVoice && targetVoice.events.length > 0) return new Set([params.xmlVoice]);

  return new Set((stave?.voices ?? [])
    .filter((voice) => voice.events.length > 0)
    .map((voice) => parseVoiceNumber(voice.name))
    .filter((xmlVoice) => params.visibleTrackIdSet.has(getEditorTrackId(params.staveIndex, xmlVoice))));
}

function getEntityElementCenterX(measureElement: Element, event: ParsedScoreEvent): number | null {
  const ids = new Set(event.meta?.sourceIds?.length ? event.meta.sourceIds : event.meta?.id ? [event.meta.id] : []);
  if (ids.size === 0) return null;

  const element = Array.from(measureElement.querySelectorAll('[data-id], [id]')).find((candidate) => {
    const id = candidate.getAttribute('data-id') || candidate.getAttribute('id');
    return Boolean(id && ids.has(id));
  });
  if (!element) return null;

  const renderedElement = element.closest(VEROVIO_EVENT_CONTAINER_SELECTOR) ?? element;
  const notehead = element.matches('[data-class="note"]')
    ? element.querySelector(':scope > [data-class="notehead"]')
    : renderedElement.querySelector('[data-class="notehead"]');
  const rect = (notehead ?? renderedElement).getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;

  return rect.left + rect.width / 2;
}

function getMeasureDuration(timeSignature: string | undefined | null): Rational {
  const { beats, beatType } = parseTimeSignature(timeSignature);
  return normalizeRational({
    numerator: beats * 4,
    denominator: beatType,
  });
}

function getBeatDuration(timeSignature: string | undefined | null): Rational {
  const { beatType } = parseTimeSignature(timeSignature);
  return normalizeRational({
    numerator: 4,
    denominator: beatType,
  });
}

function ticksToRational(ticks: number, divisions: number): Rational {
  return normalizeRational({
    numerator: ticks,
    denominator: divisions,
  });
}

function rationalToTicks(value: Rational, divisions: number): number {
  return Math.round((value.numerator / value.denominator) * divisions);
}

function normalizeRational(value: Rational): Rational {
  if (value.denominator <= 0) {
    throw new Error('Rational denominator must be positive.');
  }
  if (value.numerator === 0) return { numerator: 0, denominator: 1 };

  const divisor = greatestCommonDivisor(Math.abs(value.numerator), value.denominator);
  return {
    numerator: value.numerator / divisor,
    denominator: value.denominator / divisor,
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}
