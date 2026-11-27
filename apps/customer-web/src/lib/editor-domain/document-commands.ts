import { deleteVoiceEvent, type CommandResult } from './commands';
import { effectiveMeasureContext } from './context';
import {
  addRational,
  compareRational,
  type BeamId,
  type DocumentMetadata,
  type EventId,
  type KeySignature,
  type MeasureId,
  type Meter,
  type ScoreDocument,
  type VoiceId,
} from './model';

export function updateScoreMetadata(
  document: ScoreDocument,
  patch: Partial<DocumentMetadata>,
): CommandResult {
  const tempo = patch.tempoNotation;
  if (
    tempo &&
    (!Number.isFinite(tempo.perMinute) ||
      tempo.perMinute <= 0 ||
      !Number.isInteger(tempo.dots) ||
      tempo.dots < 0)
  )
    return { success: false, error: 'Invalid tempo notation.' };
  const normalized = { ...patch };
  for (const field of ['notationTitle', 'subtitle', 'composer', 'lyricist', 'copyright'] as const)
    if (field in normalized) normalized[field] = normalized[field]?.trim() || null;
  if (
    tempo &&
    !['whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th'].includes(tempo.beatUnit)
  )
    return { success: false, error: 'Unsupported tempo beat unit.' };
  return {
    success: true,
    document: { ...document, metadata: { ...document.metadata, ...normalized } },
  };
}
export function updateInitialKeySignature(
  document: ScoreDocument,
  measureId: MeasureId,
  key: KeySignature,
): CommandResult {
  if (!Number.isInteger(key.fifths) || Math.abs(key.fifths) > 7)
    return { success: false, error: 'Unsupported key signature.' };
  key = { ...effectiveMeasureContext(document, measureId).key, ...key };
  return {
    success: true,
    document: {
      ...document,
      measures: document.measures.map((measure) =>
        measure.id === measureId
          ? { ...measure, attributes: { ...measure.attributes, key } }
          : measure,
      ),
    },
  };
}
export function updateMeter(
  document: ScoreDocument,
  measureId: MeasureId,
  meter: Meter,
): CommandResult {
  if (
    !Number.isSafeInteger(meter.beats) ||
    meter.beats <= 0 ||
    ![1, 2, 4, 8, 16, 32, 64].includes(meter.beatType)
  )
    return { success: false, error: 'Unsupported meter.' };
  const next = {
    ...document,
    measures: document.measures.map((measure) =>
      measure.id === measureId
        ? { ...measure, attributes: { ...measure.attributes, meter } }
        : measure,
    ),
  };
  const selected = document.measures.find((measure) => measure.id === measureId);
  if (!selected) return { success: false, error: 'Unknown measure.' };
  const affected = new Set<MeasureId>();
  let active = false;
  for (const measure of document.measures.filter((measure) => measure.partId === selected.partId)) {
    if (measure.id === measureId) active = true;
    else if (active && measure.attributes.meter !== undefined) break;
    if (active) affected.add(measure.id);
  }
  return { success: true, document: rebuildAutomaticBeams(next, affected) };
}
export function deleteVoice(document: ScoreDocument, voiceId: VoiceId): CommandResult {
  let next = document;
  for (const event of document.events.filter((event) => event.voiceId === voiceId)) {
    const result = deleteVoiceEvent({ document: next, eventId: event.id });
    if (!result.success) return result;
    next = result.document;
  }
  return {
    success: true,
    document: { ...next, voices: next.voices.filter((voice) => voice.id !== voiceId) },
  };
}
function rebuildAutomaticBeams(
  document: ScoreDocument,
  affected: ReadonlySet<MeasureId>,
): ScoreDocument {
  const groups: { id: BeamId; eventIds: [EventId, EventId, ...EventId[]] }[] = [];
  for (const measure of document.measures.filter((measure) => affected.has(measure.id))) {
    const { meter } = effectiveMeasureContext(document, measure.id);
    if (!meter) continue;
    const beatLength =
      ((meter.beatType === 8 && meter.beats % 3 === 0 ? 3 : 1) * 4) / meter.beatType;
    for (const voice of document.voices.filter((voice) => voice.partId === measure.partId)) {
      let run: typeof document.events = [];
      let group = -1;
      const flush = () => {
        if (run.length >= 2)
          groups.push({
            id: `beam:${run[0].id}:${run.at(-1)!.id}` as BeamId,
            eventIds: run.map((event) => event.id) as [EventId, EventId, ...EventId[]],
          });
        run = [];
      };
      for (const event of document.events
        .filter((event) => event.voiceId === voice.id && event.position.measureId === measure.id)
        .sort((a, b) => compareRational(a.position.offset, b.position.offset))) {
        const position = event.position.offset.numerator / event.position.offset.denominator;
        const nextGroup = Math.floor(position / beatLength);
        const end = addRational(event.position.offset, event.rhythm.timelineDuration);
        const beamable =
          event.kind === 'pitched' &&
          ['eighth', '16th', '32nd', '64th'].includes(event.rhythm.notation.base) &&
          end.numerator / end.denominator <= (nextGroup + 1) * beatLength;
        const previous = run.at(-1);
        if (
          !beamable ||
          nextGroup !== group ||
          (previous &&
            compareRational(
              addRational(previous.position.offset, previous.rhythm.timelineDuration),
              event.position.offset,
            ) !== 0)
        )
          flush();
        if (beamable) {
          run.push(event);
          group = nextGroup;
        }
      }
      flush();
    }
  }
  const eventIds = new Set(
    document.events
      .filter((event) => affected.has(event.position.measureId))
      .map((event) => event.id),
  );
  return {
    ...document,
    beamRelationships: [
      ...document.beamRelationships.filter((beam) => !beam.eventIds.some((id) => eventIds.has(id))),
      ...groups,
    ],
  };
}
