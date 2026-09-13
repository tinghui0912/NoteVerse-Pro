import {
  isPitchedEditableEvent,
  toEditableEvent,
  type EditableEvent,
} from './event-inspector-editable-event';
import type { AccidentalValue, ParsedScoreEvent } from '@/types/score-types';
import type { Accidental, InspectorDraft, Pitch, StemDirectionOverride } from '@/lib/editor-domain';
import { toInspectorDomainDraft } from './event-inspector-domain-adapter';

export function splitPitch(pitch: string) {
  const match = pitch.match(/^([A-Ga-g])([#b]{0,2})(\d)$/);
  return {
    name: match?.[1] ?? 'C',
    accidental: match?.[2] ?? '',
    octave: match?.[3] ?? '4',
  };
}

export function updatePitchPart(
  pitch: string,
  part: 'name' | 'octave',
  value: string
) {
  const parsed = splitPitch(pitch);
  return part === 'name'
    ? `${value}${parsed.accidental}${parsed.octave}`
    : `${parsed.name}${parsed.accidental}${value}`;
}

export function accidentalPitchSuffix(accidental: AccidentalValue) {
  if (accidental === 'flat-flat') return 'bb';
  if (accidental === 'flat') return 'b';
  if (accidental === 'sharp') return '#';
  return '';
}

type InspectorStemDirectionOverride = Extract<StemDirectionOverride, 'up' | 'down'>;

export type InspectorEditState = {
  draft: InspectorDraft;
  notationOverrides: {
    /**
     * Missing means automatic engraving. The current UI only creates up/down
     * overrides; MusicXML `none`/`double` remain import/export notation work.
     */
    stemDirection?: InspectorStemDirectionOverride;
  };
};

export type FingeringOnlyPitchedEdit = {
  index: number;
  value: string;
};

export type AccidentalOnlyPitchedEdit = {
  index: number;
  pitch: Pitch;
  accidental: AccidentalValue | null;
};

export type PitchOnlyPitchedEdit = {
  index: number;
  pitch: Pitch;
};

export function createInspectorEditState(original: ParsedScoreEvent): InspectorEditState {
  return toInspectorEditStateFromEditableEvent(original, toEditableEvent(original));
}

export function toInspectorEditStateFromEditableEvent(
  original: ParsedScoreEvent,
  event: EditableEvent,
): InspectorEditState {
  return {
    draft: toInspectorDomainDraft(original, event),
    notationOverrides: {
      stemDirection: toStemDirectionOverride(event.stemDirection),
    },
  };
}

export function isRhythmOrStemOnlyPitchedEdit(current: EditableEvent, next: EditableEvent): boolean {
  if (!isPitchedEditableEvent(current) || !isPitchedEditableEvent(next)) return false;
  return arraysEqual(current.pitches, next.pitches)
    && arraysEqual(current.accidentals, next.accidentals)
    && arraysEqual(current.fingerings, next.fingerings);
}

export function getFingeringOnlyPitchedEdit(
  current: EditableEvent,
  next: EditableEvent,
): FingeringOnlyPitchedEdit | null {
  if (!isPitchedEditableEvent(current) || !isPitchedEditableEvent(next)) return null;
  if (!arraysEqual(current.pitches, next.pitches)) return null;
  if (!arraysEqual(current.accidentals, next.accidentals)) return null;
  if (current.duration !== next.duration || current.dotted !== next.dotted || current.stemDirection !== next.stemDirection) {
    return null;
  }
  if (current.fingerings.length !== next.fingerings.length) return null;

  const changedIndexes = current.fingerings
    .map((fingering, index) => fingering === next.fingerings[index] ? -1 : index)
    .filter((index) => index >= 0);

  if (changedIndexes.length !== 1) return null;
  const index = changedIndexes[0];
  return {
    index,
    value: next.fingerings[index] ?? 'none',
  };
}

export function getPitchOnlyPitchedEdit(
  current: EditableEvent,
  next: EditableEvent,
): PitchOnlyPitchedEdit | null {
  if (!isPitchedEditableEvent(current) || !isPitchedEditableEvent(next)) return null;
  if (!arraysEqual(current.accidentals, next.accidentals)) return null;
  if (!arraysEqual(current.fingerings, next.fingerings)) return null;
  if (current.duration !== next.duration || current.dotted !== next.dotted || current.stemDirection !== next.stemDirection) {
    return null;
  }
  if (current.pitches.length !== next.pitches.length) return null;

  const changedIndexes = current.pitches
    .map((pitch, index) => pitch === next.pitches[index] ? -1 : index)
    .filter((index) => index >= 0);

  if (changedIndexes.length !== 1) return null;
  const index = changedIndexes[0];
  return {
    index,
    pitch: toDomainPitchFromInspectorPitch(next.pitches[index] ?? 'C4'),
  };
}

export function getAccidentalOnlyPitchedEdit(
  current: EditableEvent,
  next: EditableEvent,
): AccidentalOnlyPitchedEdit | null {
  if (!isPitchedEditableEvent(current) || !isPitchedEditableEvent(next)) return null;
  if (!arraysEqual(current.fingerings, next.fingerings)) return null;
  if (current.duration !== next.duration || current.dotted !== next.dotted || current.stemDirection !== next.stemDirection) {
    return null;
  }
  if (current.pitches.length !== next.pitches.length || current.accidentals.length !== next.accidentals.length) {
    return null;
  }

  const changedIndexes = current.pitches
    .map((pitch, index) => (
      pitch === next.pitches[index] && current.accidentals[index] === next.accidentals[index]
        ? -1
        : index
    ))
    .filter((index) => index >= 0);

  if (changedIndexes.length !== 1) return null;
  const index = changedIndexes[0];
  if (current.pitches[index] === next.pitches[index]) return null;

  const nextAccidental = next.accidentals[index] ?? null;
  if (nextAccidental !== null && !isDomainAccidental(nextAccidental)) return null;

  return {
    index,
    pitch: toDomainPitchFromInspectorPitch(next.pitches[index] ?? 'C4'),
    accidental: nextAccidental,
  };
}

function toStemDirectionOverride(value: EditableEvent['stemDirection']): InspectorStemDirectionOverride | undefined {
  return value === 'up' || value === 'down' ? value : undefined;
}

export function toDomainPitchFromInspectorPitch(value: string): Pitch {
  const parsed = splitPitch(value);
  const alter = toPitchAlter(parsed.accidental);
  return {
    step: parsed.name.toUpperCase() as Pitch['step'],
    octave: Number.parseInt(parsed.octave, 10),
    ...(alter === 0 ? {} : { alter }),
  };
}

function toPitchAlter(suffix: string): number {
  if (suffix === 'bb') return -2;
  if (suffix === 'b') return -1;
  if (suffix === '#') return 1;
  if (suffix === '##') return 2;
  return 0;
}

function isDomainAccidental(value: AccidentalValue): value is Extract<Accidental, AccidentalValue> {
  return value === 'flat-flat' || value === 'flat' || value === 'natural' || value === 'sharp';
}

function arraysEqual<TValue>(left: readonly TValue[], right: readonly TValue[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
