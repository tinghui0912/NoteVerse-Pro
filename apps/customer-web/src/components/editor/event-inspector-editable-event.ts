import type { AccidentalValue, Duration, ParsedScoreEvent } from '@/types/score-types';

export type EditableEventDisplayKind = 'explicitRest' | 'singleNote' | 'chord';

export type EditableEvent = {
  duration: Duration;
  dotted: boolean;
  pitches: string[];
  stemDirection: 'up' | 'down' | 'none';
  fingerings: string[];
  accidentals: Array<AccidentalValue | null | undefined>;
};

export function isExplicitRestEditableEvent(event: Pick<EditableEvent, 'pitches'>): boolean {
  return event.pitches.length === 0;
}

export function isPitchedEditableEvent(event: Pick<EditableEvent, 'pitches'>): boolean {
  return event.pitches.length > 0;
}

export function getEditableEventDisplayKind(event: Pick<EditableEvent, 'pitches'>): EditableEventDisplayKind {
  if (isExplicitRestEditableEvent(event)) return 'explicitRest';
  if (event.pitches.length === 1) return 'singleNote';
  return 'chord';
}

export function getEditableEventSummaryPitch(
  event: Pick<EditableEvent, 'pitches'>,
  restLabel: string,
): string {
  return isExplicitRestEditableEvent(event) ? restLabel : event.pitches.join(' + ');
}

export function getEditableEventSummaryIcon(event: Pick<EditableEvent, 'pitches'>): string {
  const displayKind = getEditableEventDisplayKind(event);
  if (displayKind === 'explicitRest') return 'rest';
  if (displayKind === 'chord') return 'chord';
  return 'note';
}

export function createDefaultEditableEvent(): EditableEvent {
  return {
    duration: 'durationQuarter',
    dotted: false,
    pitches: [],
    stemDirection: 'none',
    fingerings: [],
    accidentals: [],
  };
}

export function toEditableEvent(entity: ParsedScoreEvent): EditableEvent {
  if (entity.type === 'chord') {
    return {
      duration: entity.duration,
      dotted: Boolean(entity.dotted),
      pitches: [...entity.pitches],
      stemDirection: entity.stemDirection ?? 'none',
      fingerings: entity.pitches.map((_, index) => entity.fingerings?.[index] ?? 'none'),
      accidentals: entity.pitches.map((_, index) => entity.accidentals?.[index]),
    };
  }

  if (entity.type === 'note') {
    return {
      duration: entity.duration,
      dotted: Boolean(entity.dotted),
      pitches: [entity.pitch],
      stemDirection: entity.stemDirection ?? 'none',
      fingerings: [entity.fingering ?? 'none'],
      accidentals: [entity.accidental],
    };
  }

  return {
    duration: entity.duration,
    dotted: Boolean(entity.dotted),
    pitches: [],
    stemDirection: 'none',
    fingerings: [],
    accidentals: [],
  };
}

export function addPitch(event: EditableEvent, pitch = 'C4'): EditableEvent {
  return {
    ...event,
    pitches: [...event.pitches, pitch],
    fingerings: [...event.fingerings, 'none'],
    accidentals: [...event.accidentals, undefined],
  };
}

export function removePitch(event: EditableEvent, pitchIndex: number): EditableEvent {
  if (event.pitches.length <= 1) {
    return event;
  }

  return {
    ...event,
    pitches: event.pitches.filter((_, index) => index !== pitchIndex),
    fingerings: event.fingerings.filter((_, index) => index !== pitchIndex),
    accidentals: event.accidentals.filter((_, index) => index !== pitchIndex),
  };
}
