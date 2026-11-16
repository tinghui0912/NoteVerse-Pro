import {
  deriveTimelineGaps,
  type Clef,
  type KeySignature,
  type MeasureId,
  type Meter,
  type PartId,
  type Rational,
  type ScoreDocument,
  type StaffId,
} from './model';

export function effectiveMeasureContext(
  document: ScoreDocument,
  measureId: MeasureId,
  staffId?: StaffId,
) {
  const target = document.measures.find((measure) => measure.id === measureId);
  if (!target) throw new Error('Unknown measure.');
  let meter: Meter | null = null;
  let key: KeySignature | null = null;
  let clef: Clef | null = null;
  for (const measure of document.measures.filter((measure) => measure.partId === target.partId)) {
    if (measure.attributes.meter !== undefined) meter = measure.attributes.meter;
    if (measure.attributes.key !== undefined) key = measure.attributes.key;
    const change = measure.attributes.clefs?.find((context) => context.staffId === staffId);
    if (change) clef = change.clef;
    if (measure.id === target.id) break;
  }
  return { meter, key, clef, duration: meter ? meterDuration(meter) : null };
}
function meterDuration(meter: Meter): Rational {
  return { numerator: meter.beats * 4, denominator: meter.beatType };
}
export function documentTimelineGaps(document: ScoreDocument) {
  return document.measures.flatMap((measure) => {
    const duration = effectiveMeasureContext(document, measure.id).duration;
    if (!duration) return [];
    return document.voices
      .filter((voice) => voice.partId === measure.partId)
      .flatMap((voice) =>
        deriveTimelineGaps({
          events: document.events,
          measureId: measure.id,
          staffId: voice.homeStaffId,
          voiceId: voice.id,
          measureDuration: duration,
        }),
      );
  });
}
export function initialMeasure(document: ScoreDocument, partId: PartId = document.parts[0]?.id) {
  const measure = document.measures.find((measure) => measure.partId === partId);
  if (!measure) throw new Error('No measure is available for this edit.');
  return measure;
}
