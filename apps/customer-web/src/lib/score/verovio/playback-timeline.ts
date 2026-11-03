import { Midi } from '@tonejs/midi';

import { performanceQuarter, projectPerformanceTempos, type PerformanceTempoEvent, type VerovioPerformanceTiming } from './tempo-projection';

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
  tempoEvents: PerformanceTempoEvent[];
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
  renderer: VerovioPerformanceTiming
): VerovioPlaybackTimeline {
  const midi = new Midi(decodeBase64(midiBase64));
  const tempoEvents = projectPerformanceTempos(renderer);
  midi.header.tempos = tempoEvents.map(({ quarter, bpm }) => ({ ticks: Math.round(quarter * midi.header.ppq), bpm }));
  for (let index = 1; index < midi.header.tempos.length; index++) {
    const previous = midi.header.tempos[index - 1], current = midi.header.tempos[index];
    if (previous.ticks === current.ticks && previous.bpm !== current.bpm) {
      throw new Error('Conflicting projected MIDI tempos.');
    }
  }
  // ToneJS note.time/duration are derived only after the conductor is authoritative.
  midi.header.update();
  const seconds = renderer.timemap.map(entry => midi.header.ticksToSeconds(performanceQuarter(entry) * midi.header.ppq));
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

  const visualEvents = renderer.timemap
    .map((entry, index) => ({
      time: seconds[index],
      noteIds: Array.isArray(entry.on)
        ? entry.on.filter((value): value is string => typeof value === 'string')
          // Occurrences keep performance time but target the written SVG identity.
          .map(identity => renderer.expansionMap[identity]?.[0] ?? identity)
        : [],
    }))
    .filter((entry) => entry.noteIds.length > 0)
    .map((entry, index) => ({ ...entry, index }));
  const sourceTempo = midi.header.tempos[0].bpm;

  return {
    sourceTempo,
    tempoEvents,
    duration: Math.max(
      midi.duration,
      ...seconds,
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
