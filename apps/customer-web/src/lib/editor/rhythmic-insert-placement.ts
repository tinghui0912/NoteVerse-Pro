import {
  addRational,
  compareRational,
  createActiveVoice,
  createCaret,
  createCaretInsertionAnchor,
  createRhythmicGridResolution,
  createRhythmicLayoutMap,
  createTimelineGapInsertionAnchor,
  effectiveMeasureContext,
  getVoiceEventMusicXmlElementIds,
  type Caret,
  type InputDuration,
  type InsertionAnchor,
  type MusicalPosition,
  type Rational,
  type RhythmicLayoutPoint,
  type RhythmicGridResolution,
  type ScoreDocument,
  type TimelineGap,
  type Voice,
  type VoiceId,
  type VoiceEvent,
} from '@/lib/editor-domain';
import { getMeasureHorizontalBounds } from './verovio-geometry';
export type AddLocation = { measureIndex: number; staveIndex: number; position: MusicalPosition };
export type RhythmicInsertTarget = { staveIndex: number; voiceId: VoiceId | undefined };
export type RhythmicInsertPlacement = {
  location: AddLocation;
  left: number;
  gridLines: number[];
  caret: Caret;
  insertionAnchor: InsertionAnchor;
  position: MusicalPosition;
};
const VEROVIO_EVENT_CONTAINER_SELECTOR =
  '[data-class="chord"], [data-class="note"], [data-class="rest"], [data-class="mRest"]';
export function resolveRhythmicInsertPlacement(params: {
  domainDocument: ScoreDocument | null;
  inputVoices?: Voice[];
  timelineGaps: TimelineGap[];
  measureElement: Element;
  measureIndex: number;
  target: RhythmicInsertTarget;
  clientX: number;
  inputDuration?: InputDuration;
  grid?: RhythmicGridResolution;
  visibleTrackIdSet: Set<string>;
}): RhythmicInsertPlacement | null {
  const document = params.domainDocument;
  if (!document) return null;
  const voice = [...document.voices, ...(params.inputVoices ?? [])].find(
    (voice) => voice.id === params.target.voiceId,
  );
  if (!voice) return null;
  const staff = document.staves[params.target.staveIndex];
  if (staff?.partId !== voice.partId) return null;
  const measure = document.measures.filter((measure) => measure.partId === voice.partId)[
    params.measureIndex
  ];
  if (!staff || !measure) return null;
  const context = effectiveMeasureContext(document, measure.id, staff.id);
  if (!context.meter || !context.duration) return null;
  const grid =
    params.grid ??
    createRhythmicGridResolution({ numerator: 4, denominator: context.meter.beatType });
  const bounds = getMeasureHorizontalBounds(params.measureElement);
  const events = document.events.filter(
    (event) => event.position.measureId === measure.id && event.staffId === staff.id,
  );
  const targetEvents = events.filter((event) => event.voiceId === voice.id);
  const visibleEvents = targetEvents.length
    ? targetEvents
    : events.filter((event) => params.visibleTrackIdSet.has(event.voiceId));
  const anchors = visibleEvents.flatMap((event) => {
    const x = getEntityElementCenterX(params.measureElement, event);
    return x === null ? [] : [{ position: event.position, x }];
  });
  const map = createRhythmicLayoutMap({
    measureId: measure.id,
    staffId: staff.id,
    voiceId: voice.id,
    measureDuration: context.duration,
    grid,
    xLeft: bounds.left,
    xRight: bounds.right,
    anchors,
  });
  const points = getInsertableLayoutPoints({
    points: map.points,
    measureDuration: context.duration,
    inputDuration: params.inputDuration,
  });
  if (!points.length) return null;
  const point = resolveNearestInsertableLayoutPoint({
    points,
    xLeft: bounds.left,
    xRight: bounds.right,
    clientX: params.clientX,
  });
  const activeVoice = createActiveVoice({ staffId: staff.id, voiceId: voice.id });
  const caret = createCaret({
    activeVoice,
    measureId: measure.id,
    offset: point.gridPosition.position.offset,
  });
  const gap = findContainingTimelineGap({
    gaps: params.timelineGaps,
    staffId: staff.id,
    voiceId: voice.id,
    position: caret.position,
  });
  return {
    location: {
      measureIndex: params.measureIndex,
      staveIndex: params.target.staveIndex,
      position: caret.position,
    },
    left: point.x,
    gridLines: points.map((point) => point.x),
    caret,
    position: caret.position,
    insertionAnchor: gap
      ? createTimelineGapInsertionAnchor({
          activeVoice,
          position: caret.position,
          gapStart: gap.start,
          gapDuration: gap.duration,
        })
      : createCaretInsertionAnchor(caret),
  };
}
function getInsertableLayoutPoints(params: {
  points: RhythmicLayoutPoint[];
  measureDuration: Rational;
  inputDuration: InputDuration | undefined;
}): RhythmicLayoutPoint[] {
  const inputDuration = params.inputDuration;
  if (!inputDuration) return params.points;

  return params.points.filter(
    (point) =>
      compareRational(
        addRational(point.gridPosition.position.offset, inputDuration.rhythm.timelineDuration),
        params.measureDuration,
      ) <= 0,
  );
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
  return (
    params.gaps.find(
      (gap) =>
        gap.voiceId === params.voiceId &&
        gap.staffId === params.staffId &&
        gap.start.measureId === params.position.measureId &&
        compareRational(params.position.offset, gap.start.offset) >= 0 &&
        compareRational(params.position.offset, addRational(gap.start.offset, gap.duration)) <= 0,
    ) ?? null
  );
}

function getEntityElementCenterX(measureElement: Element, event: VoiceEvent): number | null {
  const ids = new Set(getVoiceEventMusicXmlElementIds(event));
  if (ids.size === 0) return null;

  const element = Array.from(measureElement.querySelectorAll('[data-id], [id]')).find(
    (candidate) => {
      const id = candidate.getAttribute('data-id') || candidate.getAttribute('id');
      return Boolean(id && ids.has(id));
    },
  );
  if (!element) return null;

  const renderedElement = element.closest(VEROVIO_EVENT_CONTAINER_SELECTOR) ?? element;
  const notehead = element.matches('[data-class="note"]')
    ? element.querySelector(':scope > [data-class="notehead"]')
    : renderedElement.querySelector('[data-class="notehead"]');
  const rect = (notehead ?? renderedElement).getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;

  return rect.left + rect.width / 2;
}
