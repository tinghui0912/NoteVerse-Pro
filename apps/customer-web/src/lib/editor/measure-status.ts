import type { ScoreData, ParsedScoreEvent } from '@/types/score-types';
import { getEntityDurationTicks, getMeasureDurationTicks } from './measure-timeline';
import { parseVoiceNumber } from './tracks';

export type DirtyMeasureKind = 'underfill' | 'overflow';

export type DirtyMeasureVoiceStatus = {
  measureIndex: number;
  measureNumber: number;
  staveIndex: number;
  xmlVoice: number;
  expectedTicks: number;
  actualTicks: number;
  deltaTicks: number;
  kind: DirtyMeasureKind;
};

export type DirtyMeasureStatus = {
  measureIndex: number;
  measureNumber: number;
  kind: DirtyMeasureKind;
  expectedTicks: number;
  actualTicks: number;
  deltaTicks: number;
  voices: DirtyMeasureVoiceStatus[];
};

function getVoiceDurationTicks(events: ParsedScoreEvent[], divisions: number): number {
  return events.reduce((totalTicks, entity) => totalTicks + getEntityDurationTicks(entity, divisions), 0);
}

export function buildDirtyMeasureStatuses(scoreData: ScoreData | null, divisions: number): DirtyMeasureStatus[] {
  if (!scoreData) return [];

  const expectedTicks = getMeasureDurationTicks(scoreData.timeSignature, divisions);
  const statuses: DirtyMeasureStatus[] = [];

  scoreData.measures.forEach((measure, measureIndex) => {
    const voiceStatuses: DirtyMeasureVoiceStatus[] = [];

    measure.staves.forEach((stave, staveIndex) => {
      stave.voices.forEach((voice) => {
        if (voice.events.length === 0) return;

        const actualTicks = getVoiceDurationTicks(voice.events, divisions);
        if (actualTicks === expectedTicks) return;

        const deltaTicks = actualTicks - expectedTicks;
        voiceStatuses.push({
          measureIndex,
          measureNumber: measure.number || measureIndex + 1,
          staveIndex,
          xmlVoice: parseVoiceNumber(voice.name),
          expectedTicks,
          actualTicks,
          deltaTicks,
          kind: deltaTicks > 0 ? 'overflow' : 'underfill',
        });
      });
    });

    if (voiceStatuses.length === 0) return;

    const overflow = voiceStatuses.filter((status) => status.kind === 'overflow');
    const candidates = overflow.length > 0 ? overflow : voiceStatuses;
    const dominantStatus = candidates.reduce((dominant, status) => (
      Math.abs(status.deltaTicks) > Math.abs(dominant.deltaTicks) ? status : dominant
    ), candidates[0]);

    statuses.push({
      measureIndex,
      measureNumber: measure.number || measureIndex + 1,
      kind: dominantStatus.kind,
      expectedTicks,
      actualTicks: dominantStatus.actualTicks,
      deltaTicks: dominantStatus.deltaTicks,
      voices: voiceStatuses,
    });
  });

  return statuses;
}
