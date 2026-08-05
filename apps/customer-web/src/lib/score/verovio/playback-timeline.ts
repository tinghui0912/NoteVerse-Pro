import { Midi } from '@tonejs/midi';

import { readNumericTimemapValue } from './sanitize';

export type VerovioPlaybackNote = {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  instrument: string;
};

export type VerovioVisualEvent = {
  index: number;
  time: number;
  noteIds: string[];
};

export type VerovioPlaybackTimeline = {
  sourceTempo: number;
  duration: number;
  notes: VerovioPlaybackNote[];
  visualEvents: VerovioVisualEvent[];
  instruments: string[];
};

function decodeBase64(value: string) {
  if (typeof atob !== 'function') {
    throw new Error('Base64 decoding is unavailable in this environment.');
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function normalizeInstrumentName(name: string) {
  return name.trim().toLowerCase().replaceAll(' ', '_');
}

export function createVerovioPlaybackTimeline(
  midiBase64: string,
  timemap: Array<Record<string, unknown>>
): VerovioPlaybackTimeline {
  const midi = new Midi(decodeBase64(midiBase64));
  const notes = midi.tracks
    .flatMap((track) => {
      const instrument = normalizeInstrumentName(track.instrument.name || 'acoustic_grand_piano');
      return track.notes.map((note) => ({
        midi: note.midi,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity,
        instrument,
      }));
    })
    .sort((left, right) => left.time - right.time || left.midi - right.midi);

  const visualEvents = timemap
    .map((entry) => ({
      time: (readNumericTimemapValue(entry, ['tstamp']) ?? 0) / 1000,
      noteIds: Array.isArray(entry.on)
        ? entry.on.filter((value): value is string => typeof value === 'string')
        : [],
    }))
    .filter((entry) => entry.noteIds.length > 0)
    .map((entry, index) => ({ ...entry, index }));
  const sourceTempo =
    midi.header.tempos.find((tempo) => Number.isFinite(tempo.bpm) && tempo.bpm > 0)?.bpm ??
    120;

  return {
    sourceTempo,
    duration: Math.max(
      midi.duration,
      ...notes.map((note) => note.time + note.duration),
      ...visualEvents.map((event) => event.time),
      0
    ),
    notes,
    visualEvents,
    instruments: Array.from(new Set(notes.map((note) => note.instrument))),
  };
}

export function findVisualEventAtTime(
  timeline: VerovioPlaybackTimeline,
  time: number
): VerovioVisualEvent | null {
  if (timeline.visualEvents.length === 0) {
    return null;
  }

  let low = 0;
  let high = timeline.visualEvents.length - 1;
  let match = timeline.visualEvents[0] ?? null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = timeline.visualEvents[middle];
    if (!candidate) {
      break;
    }
    if (candidate.time <= time) {
      match = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}
