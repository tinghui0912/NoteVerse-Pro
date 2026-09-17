import type {
  Duration,
  EntityMeta,
  ParsedScoreEvent,
} from '@/types/score-types';
import type {
  EventId,
  NoteAtom,
  NoteAtomId,
  RhythmicValue,
  StaffId,
  VoiceId,
  MeasureId,
  Pitch,
} from '@/lib/editor-domain';
import type { InspectorDraft } from '@/lib/editor-domain';
import { isExplicitRestEditableEvent, type EditableEvent } from './event-inspector-editable-event';

export function toInspectorDomainDraft(
  original: ParsedScoreEvent,
  event: EditableEvent,
): InspectorDraft {
  const metadata = toDomainMetadata(original.meta);
  const rhythm = toDomainRhythm(event.duration, event.dotted);

  if (isExplicitRestEditableEvent(event)) {
    return {
      kind: 'explicitRest',
      eventId: metadata.eventId,
      voiceId: metadata.voiceId,
      staffId: metadata.staffId,
      position: {
        measureId: metadata.measureId,
        offset: metadata.offset,
      },
      rhythm,
    };
  }

  return {
    kind: 'pitchedEvent',
    eventId: metadata.eventId,
    voiceId: metadata.voiceId,
    staffId: metadata.staffId,
    position: {
      measureId: metadata.measureId,
      offset: metadata.offset,
    },
    rhythm,
    notes: event.pitches.map((pitch, index) => toDomainNoteAtom(original, event, pitch, index)),
  };
}

export function toDomainRhythm(duration: Duration, dotted: boolean): RhythmicValue {
  const base = toDomainDurationBase(duration);
  return {
    timelineDuration: toDomainDurationRational(duration, dotted),
    notation: {
      base,
      dots: dotted ? 1 : 0,
    },
  };
}

function toDomainNoteAtom(
  original: ParsedScoreEvent,
  event: EditableEvent,
  pitch: string,
  index: number,
): NoteAtom {
  return {
    id: toNoteAtomId(original, index),
    pitch: toDomainPitch(pitch),
    accidental: event.accidentals[index] ?? undefined,
    fingering: normalizeFingering(event.fingerings[index]),
  };
}

function toDomainPitch(value: string): Pitch {
  const match = value.match(/^([A-Ga-g])([#b]{0,2})(\d)$/);
  const step = (match?.[1]?.toUpperCase() ?? 'C') as Pitch['step'];
  const suffix = match?.[2] ?? '';
  return {
    step,
    octave: Number.parseInt(match?.[3] ?? '4', 10),
    ...(suffix ? { alter: toPitchAlter(suffix) } : {}),
  };
}

function toPitchAlter(suffix: string): number {
  if (suffix === 'bb') return -2;
  if (suffix === 'b') return -1;
  if (suffix === '#') return 1;
  if (suffix === '##') return 2;
  return 0;
}

function toDomainMetadata(meta: EntityMeta | undefined) {
  return {
    eventId: (meta?.id || 'legacy-inspector-event') as EventId,
    voiceId: `legacy-voice:${meta?.xmlVoice ?? 1}` as VoiceId,
    staffId: `legacy-staff:${meta?.staveIndex ?? 0}` as StaffId,
    measureId: `legacy-measure:${meta?.measureIndex ?? 0}` as MeasureId,
    offset: {
      numerator: meta?.startTick ?? 0,
      denominator: 1,
    },
  };
}

function toNoteAtomId(original: ParsedScoreEvent, index: number): NoteAtomId {
  const sourceId = original.meta?.sourceIds?.[index];
  if (sourceId) {
    return sourceId as NoteAtomId;
  }
  return `${original.meta?.id ?? 'legacy-inspector-event'}:note:${index}` as NoteAtomId;
}

function toDomainDurationBase(duration: Duration): RhythmicValue['notation']['base'] {
  switch (duration) {
    case 'durationWhole':
      return 'whole';
    case 'durationHalf':
      return 'half';
    case 'durationQuarter':
      return 'quarter';
    case 'durationEighth':
      return 'eighth';
    case 'duration16th':
      return '16th';
    case 'duration32nd':
      return '32nd';
    default:
      return exhaustive(duration);
  }
}

function toDomainDurationRational(duration: Duration, dotted: boolean) {
  const base = (() => {
    switch (duration) {
      case 'durationWhole':
        return { numerator: 4, denominator: 1 };
      case 'durationHalf':
        return { numerator: 2, denominator: 1 };
      case 'durationQuarter':
        return { numerator: 1, denominator: 1 };
      case 'durationEighth':
        return { numerator: 1, denominator: 2 };
      case 'duration16th':
        return { numerator: 1, denominator: 4 };
      case 'duration32nd':
        return { numerator: 1, denominator: 8 };
      default:
        return exhaustive(duration);
    }
  })();

  return normalizeRational(dotted
    ? { numerator: base.numerator * 3, denominator: base.denominator * 2 }
    : base);
}

function normalizeFingering(value: string | undefined): string | undefined {
  return !value || value === 'none' ? undefined : value;
}

function exhaustive(value: never): never {
  throw new Error(`Unhandled Inspector domain adapter value: ${String(value)}`);
}

function normalizeRational(value: { numerator: number; denominator: number }) {
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
