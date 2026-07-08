import type { AccidentalValue, Chord, Duration, EntityLocation, Note, Rest, ScoreEntity } from '@/types/score-types';

export type EditableEventKind = 'rest' | 'note' | 'chord';

export type EditableEvent = {
  duration: Duration;
  dotted: boolean;
  pitches: string[];
  stemDirection: 'up' | 'down' | 'none';
  fingerings: string[];
  accidentals: Array<AccidentalValue | null | undefined>;
};

export function getEditableEventKind(event: Pick<EditableEvent, 'pitches'>): EditableEventKind {
  if (event.pitches.length === 0) return 'rest';
  if (event.pitches.length === 1) return 'note';
  return 'chord';
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

export function toEditableEvent(entity: ScoreEntity): EditableEvent {
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

export function toScoreEntity(event: EditableEvent, location?: EntityLocation): Note | Chord | Rest {
  const meta = location
    ? {
        id: '',
        measureIndex: location.measureIndex,
        staveIndex: location.staveIndex,
        xmlVoice: location.xmlVoice,
        entityIndex: location.entityIndex,
        startTick: 0,
      }
    : undefined;

  if (event.pitches.length === 0) {
    return {
      type: 'rest',
      duration: event.duration,
      dotted: event.dotted,
      meta,
    };
  }

  if (event.pitches.length === 1) {
    return {
      type: 'note',
      pitch: event.pitches[0],
      duration: event.duration,
      dotted: event.dotted,
      stemDirection: event.stemDirection,
      fingering: event.fingerings[0] ?? 'none',
      accidental: event.accidentals[0],
      meta,
    };
  }

  return {
    type: 'chord',
    pitches: [...event.pitches],
    duration: event.duration,
    dotted: event.dotted,
    stemDirection: event.stemDirection,
    fingerings: event.pitches.map((_, index) => event.fingerings[index] ?? 'none'),
    accidentals: event.pitches.map((_, index) => event.accidentals[index]),
    meta,
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
  return {
    ...event,
    pitches: event.pitches.filter((_, index) => index !== pitchIndex),
    fingerings: event.fingerings.filter((_, index) => index !== pitchIndex),
    accidentals: event.accidentals.filter((_, index) => index !== pitchIndex),
  };
}
