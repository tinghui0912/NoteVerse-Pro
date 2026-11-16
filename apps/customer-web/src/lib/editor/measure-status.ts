import {
  effectiveMeasureContext,
  addRational,
  compareRational,
  type ScoreDocument,
} from '@/lib/editor-domain';
export type DirtyMeasureStatus = {
  measureIndex: number;
  measureNumber: number;
  kind: 'underfill' | 'overflow';
  expectedDuration: number;
  actualDuration: number;
  deltaDuration: number;
  voices: {
    staveIndex: number;
    xmlVoice: number;
    kind: 'underfill' | 'overflow';
    expectedDuration: number;
    actualDuration: number;
    deltaDuration: number;
  }[];
};
export function buildDirtyMeasureStatuses(document: ScoreDocument | null): DirtyMeasureStatus[] {
  if (!document) return [];
  return document.measures.flatMap((measure, measureIndex) => {
    const duration = effectiveMeasureContext(document, measure.id).duration;
    if (!duration) return [];
    const expectedDuration = duration.numerator / duration.denominator;
    const voices = document.voices
      .filter((voice) => voice.partId === measure.partId)
      .flatMap((voice) => {
        const events = document.events.filter(
          (event) => event.voiceId === voice.id && event.position.measureId === measure.id,
        );
        if (!events.length) return [];
        const end = events.reduce(
          (end, event) => {
            const next = addRational(event.position.offset, event.rhythm.timelineDuration);
            return compareRational(next, end) > 0 ? next : end;
          },
          { numerator: 0, denominator: 1 },
        );
        const actualDuration = end.numerator / end.denominator;
        const deltaDuration = actualDuration - expectedDuration;
        if (!deltaDuration) return [];
        return [
          {
            staveIndex: document.staves.find((staff) => staff.id === voice.homeStaffId)!.index,
            xmlVoice: voice.number,
            kind: deltaDuration > 0 ? ('overflow' as const) : ('underfill' as const),
            expectedDuration,
            actualDuration,
            deltaDuration,
          },
        ];
      });
    if (!voices.length) return [];
    const dominant = [...voices].sort((a, b) => b.deltaDuration - a.deltaDuration)[0];
    return [{ measureIndex, measureNumber: measure.number, ...dominant, voices }];
  });
}
