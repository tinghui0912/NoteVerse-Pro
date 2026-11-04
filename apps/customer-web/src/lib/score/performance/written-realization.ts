import { Midi } from '@tonejs/midi';
import { parseMidi } from 'midi-file';
import { Rational, safeInteger, ZERO } from './rational';

export type WrittenPlaybackNote = Readonly<{
  identity: string;
  sourceTrackIdentity: number;
  writtenStart: Rational;
  writtenEnd: Rational;
  midi: number;
  velocity: number;
  instrument: string;
}>;

export type WrittenVisualOnset = Readonly<{
  position: Rational;
  noteIds: readonly string[];
}>;

function binaryRational(bits: bigint): Rational {
  const exponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponent ? fraction + (1n << 52n) : fraction;
  const power = exponent ? exponent - 1075 : -1074;
  return power < 0
    ? new Rational(mantissa, 1n << BigInt(-power))
    : new Rational(mantissa << BigInt(power));
}

/** Decode a renderer double only if its IEEE rounding interval names one MIDI-grid point. */
export function decodeWrittenQstamp(value: unknown, ppq: number): Rational {
  safeInteger(ppq, 1);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Invalid written Timemap qstamp.');
  if (value === 0) return ZERO;
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, value);
  const bits = buffer.getBigUint64(0);
  const middle = binaryRational(bits);
  const lower = binaryRational(bits - 1n)
    .add(middle)
    .divide(new Rational(2n))
    .multiply(new Rational(BigInt(ppq)));
  const upper = binaryRational(bits + 1n)
    .add(middle)
    .divide(new Rational(2n))
    .multiply(new Rational(BigInt(ppq)));
  const even = (bits & 1n) === 0n;
  let first = (lower.numerator + lower.denominator - 1n) / lower.denominator;
  let last = upper.numerator / upper.denominator;
  if (!even && first * lower.denominator === lower.numerator) first++;
  if (!even && last * upper.denominator === upper.numerator) last--;
  if (first !== last)
    throw new Error(
      'Written Timemap qstamp is not uniquely representable on the MIDI grid.'
    );
  return new Rational(first, BigInt(ppq));
}

export function readWrittenRealization(
  midiBase64: string,
  timemap: readonly Record<string, unknown>[]
) {
  const bytes = Uint8Array.from(atob(midiBase64), (character) =>
    character.charCodeAt(0)
  );
  // This is a layout capability check, not a channel-state interpreter. Per-note
  // instruments cannot express program state that changes across navigation.
  for (const track of parseMidi(bytes).tracks) {
    let ticks = 0;
    const originPrograms = new Map<number, number>();
    for (const event of track) {
      ticks = safeInteger(ticks + safeInteger(event.deltaTime));
      if (event.type !== 'programChange') continue;
      const previous = originPrograms.get(event.channel);
      if (
        ticks !== 0 ||
        (previous !== undefined && previous !== event.programNumber)
      ) {
        throw new Error('Unsupported written MIDI instrument change.');
      }
      originPrograms.set(event.channel, event.programNumber);
    }
  }
  const midi = new Midi(bytes);
  const ppq = safeInteger(midi.header.ppq, 1);
  const notes: WrittenPlaybackNote[] = midi.tracks.flatMap(
    (track, trackIndex) => {
      const instrument = track.instrument.name
        .trim()
        .toLowerCase()
        .replaceAll(' ', '_');
      if (!instrument)
        throw new Error('Missing written MIDI instrument identity.');
      return track.notes.map((note, noteIndex) => {
        const start = Rational.ticks(note.ticks, ppq);
        const duration = Rational.ticks(
          safeInteger(note.durationTicks, 1),
          ppq
        );
        safeInteger(note.midi);
        if (
          note.midi > 127 ||
          !Number.isFinite(note.velocity) ||
          note.velocity <= 0 ||
          note.velocity > 1
        )
          throw new Error('Invalid written MIDI note.');
        return Object.freeze({
          identity: `${trackIndex}:${noteIndex}`,
          sourceTrackIdentity: trackIndex,
          writtenStart: start,
          writtenEnd: start.add(duration),
          midi: note.midi,
          velocity: note.velocity,
          instrument,
        });
      });
    }
  );
  const visualOnsets: WrittenVisualOnset[] = timemap.flatMap((entry) => {
    if (entry.on === undefined) return [];
    if (
      !Array.isArray(entry.on) ||
      entry.on.some((id) => typeof id !== 'string' || !id)
    )
      throw new Error('Invalid written visual note IDs.');
    if (!entry.on.length) return [];
    return [
      Object.freeze({
        position: decodeWrittenQstamp(entry.qstamp, ppq),
        noteIds: Object.freeze([...new Set<string>(entry.on)]),
      }),
    ];
  });
  return Object.freeze({
    notes: Object.freeze(notes),
    visualOnsets: Object.freeze(visualOnsets),
  });
}
