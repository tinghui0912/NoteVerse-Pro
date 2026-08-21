import type { ParsedScoreEvent } from '@/types/score-types';
import { DURATION_MAP } from '@/lib/musicxml/core';

export function getEntityDurationTicks(entity: ParsedScoreEvent, divisions: number): number {
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
