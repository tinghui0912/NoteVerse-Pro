import type { ScoreData, ScoreEntity } from '@/types/score-types';
import { DURATION_MAP } from '@/lib/musicxml/core';

export type TimelineEntityRef = {
  entityId: string;
  staffIndex: number;
  xmlVoice: number;
  entityIndex: number;
};

export type MeasureTimelineAnchor = {
  tick: number;
  refs: TimelineEntityRef[];
};

export type MeasureTimeline = {
  measureIndex: number;
  staffIndex: number;
  anchors: MeasureTimelineAnchor[];
};

export type BuildMeasureTimelineOptions = {
  scoreData: ScoreData | null;
  measureIndex: number;
  staffIndex: number;
  xmlVoices?: number[];
  divisions?: number;
  includeEventEnds?: boolean;
};

export function getEntityDurationTicks(entity: ScoreEntity, divisions: number): number {
  const base = DURATION_MAP[entity.duration] ?? DURATION_MAP.durationQuarter;
  return base * divisions * (entity.dotted ? 1.5 : 1);
}

export function parseTimeSignature(timeSignature?: string | null): { beats: number; beatType: number } {
  const [beatsText, beatTypeText] = (timeSignature || '4/4').split('/');
  const beats = Number.parseInt(beatsText || '4', 10);
  const beatType = Number.parseInt(beatTypeText || '4', 10);

  return {
    beats: Number.isFinite(beats) && beats > 0 ? beats : 4,
    beatType: Number.isFinite(beatType) && beatType > 0 ? beatType : 4,
  };
}

export function getMeasureDurationTicks(timeSignature: string | undefined | null, divisions: number): number {
  const { beats, beatType } = parseTimeSignature(timeSignature);
  return Math.max(1, Math.round(divisions * beats * (4 / beatType)));
}

export function getBeatDurationTicks(timeSignature: string | undefined | null, divisions: number): number {
  const { beatType } = parseTimeSignature(timeSignature);
  return Math.max(1, Math.round(divisions * (4 / beatType)));
}

export function snapMeasureXToGridTick(params: {
  clientX: number;
  measureLeft: number;
  measureWidth: number;
  timeSignature?: string | null;
  divisions: number;
}): { tick: number; ratio: number } {
  const measureDuration = getMeasureDurationTicks(params.timeSignature, params.divisions);
  const beatDuration = getBeatDurationTicks(params.timeSignature, params.divisions);
  const width = Math.max(1, params.measureWidth);
  const rawRatio = (params.clientX - params.measureLeft) / width;
  const clampedRatio = Math.min(1, Math.max(0, rawRatio));
  const rawTick = clampedRatio * measureDuration;
  const snappedTick = Math.min(
    measureDuration,
    Math.max(0, Math.round(rawTick / beatDuration) * beatDuration)
  );

  return {
    tick: snappedTick,
    ratio: measureDuration > 0 ? snappedTick / measureDuration : 0,
  };
}

function addAnchor(
  anchors: Map<number, MeasureTimelineAnchor>,
  tick: number,
  ref?: TimelineEntityRef
): void {
  const normalizedTick = Math.max(0, tick);
  const existing = anchors.get(normalizedTick);

  if (existing) {
    if (ref) existing.refs.push(ref);
    return;
  }

  anchors.set(normalizedTick, {
    tick: normalizedTick,
    refs: ref ? [ref] : [],
  });
}

export function buildMeasureTimeline(options: BuildMeasureTimelineOptions): MeasureTimeline {
  const {
    scoreData,
    measureIndex,
    staffIndex,
    xmlVoices,
    divisions = 1,
    includeEventEnds = true,
  } = options;

  const anchors = new Map<number, MeasureTimelineAnchor>();
  addAnchor(anchors, 0);

  const stave = scoreData?.measures[measureIndex]?.staves[staffIndex];
  if (!stave) {
    return { measureIndex, staffIndex, anchors: Array.from(anchors.values()) };
  }

  const voiceFilter = xmlVoices ? new Set(xmlVoices) : null;

  stave.voices.forEach((voice) => {
    voice.notes.forEach((entity, entityIndex) => {
      const meta = entity.meta;
      if (!meta) return;
      if (voiceFilter && !voiceFilter.has(meta.xmlVoice)) return;

      const ref: TimelineEntityRef = {
        entityId: meta.id,
        staffIndex: meta.staveIndex,
        xmlVoice: meta.xmlVoice,
        entityIndex,
      };

      addAnchor(anchors, meta.startTick, ref);

      if (includeEventEnds) {
        addAnchor(anchors, meta.startTick + getEntityDurationTicks(entity, divisions));
      }
    });
  });

  return {
    measureIndex,
    staffIndex,
    anchors: Array.from(anchors.values()).sort((left, right) => left.tick - right.tick),
  };
}

export function findNearestTimelineAnchor(
  timeline: MeasureTimeline,
  tick: number
): MeasureTimelineAnchor {
  let nearest = timeline.anchors[0] ?? { tick: 0, refs: [] };
  let nearestDistance = Math.abs(nearest.tick - tick);

  for (const anchor of timeline.anchors) {
    const distance = Math.abs(anchor.tick - tick);
    if (distance < nearestDistance) {
      nearest = anchor;
      nearestDistance = distance;
    }
  }

  return nearest;
}
