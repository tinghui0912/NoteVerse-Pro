import type { ScoreEntity } from '@/types/score-types';
import { DURATION_MAP } from '@/lib/musicxml/core';

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
