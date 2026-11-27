import { writeMidi, type MidiEvent } from 'midi-file';
import { expect, it } from 'vitest';
import { readWrittenRealization } from './written-realization';

const program = (channel = 0, programNumber = 0, deltaTime = 0): MidiEvent => ({
  deltaTime,
  channel,
  type: 'programChange',
  programNumber,
});
const on: MidiEvent = {
  deltaTime: 0,
  channel: 0,
  type: 'noteOn',
  noteNumber: 60,
  velocity: 90,
};
const off: MidiEvent = {
  deltaTime: 120,
  channel: 0,
  type: 'noteOff',
  noteNumber: 60,
  velocity: 0,
};
function read(events: MidiEvent[], additional: MidiEvent[][] = []) {
  const tracks = [events, ...additional].map((track) => [
    ...track,
    { deltaTime: 0, type: 'endOfTrack', meta: true } as const,
  ]);
  const bytes = writeMidi({
    header: { format: 1, numTracks: tracks.length, ticksPerBeat: 120 },
    tracks,
  });
  return readWrittenRealization(btoa(String.fromCharCode(...bytes)), []);
}

it('accepts static origin program, velocity and balanced note lifecycle', () => {
  const result = read([program(), program(), on, off]);
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0]).toMatchObject({
    midi: 60,
    velocity: 90 / 127,
    instrument: 'acoustic_grand_piano',
  });
  expect(read([on, off]).notes[0].instrument).toBe('acoustic_grand_piano');
});

it('retains independent instruments in separate renderer tracks sharing channel numbers', () => {
  const result = read([program(), on, off], [[program(0, 40), on, off]]);
  expect(
    result.notes.map((n) => [n.sourceTrackIdentity, n.instrument])
  ).toEqual([
    [0, 'acoustic_grand_piano'],
    [1, 'violin'],
  ]);
});

it('retains a known percussion identity and rejects a patch without a note-level instrument name', () => {
  const drums = [
    { ...on, channel: 9 },
    { ...off, channel: 9 },
  ];
  expect(read([program(9, 0), ...drums]).notes[0].instrument).toBe(
    'standard_kit'
  );
  expect(() => read([program(9, 127), ...drums])).toThrow(
    'unsupported_score_preview_instrument_identity'
  );
});

it.each(
  [
    [program(), program(0, 40), on, off],
    [program(), on, off, program(0, 40)],
    [on, program(), off],
  ].map((events) => [events] as const)
)('rejects changing or conflicting program state', (events) => {
  expect(() => read(events)).toThrow(
    'unsupported_score_preview_instrument_change'
  );
});

it('rejects multiple channel/program identities in one raw music track', () => {
  expect(() => read([program(), program(1, 40), on, off])).toThrow(
    'unsupported_score_preview_midi_track'
  );
  expect(() =>
    read([on, off, { ...on, channel: 1 }, { ...off, channel: 1 }])
  ).toThrow('unsupported_score_preview_midi_track');
});

it.each<MidiEvent>([
  { deltaTime: 0, channel: 0, type: 'pitchBend', value: 0 },
  { deltaTime: 0, channel: 0, type: 'pitchBend', value: 2048 },
  { deltaTime: 0, channel: 0, type: 'channelAftertouch', amount: 64 },
  {
    deltaTime: 0,
    channel: 0,
    type: 'noteAftertouch',
    noteNumber: 60,
    amount: 64,
  },
  ...[0, 7, 10, 11, 64, 120, 121, 123].map((controllerType) => ({
    deltaTime: 0,
    channel: 0,
    type: 'controller' as const,
    controllerType,
    value: 64,
  })),
  { deltaTime: 0, type: 'sysEx', data: [0x7e, 0x7f, 0x09, 0x01, 0xf7] },
  { deltaTime: 0, type: 'sequencerSpecific', meta: true, data: [1, 2] },
])('rejects unexpressed audible MIDI state: $type', (state) => {
  expect(() => read([program(), state, on, off])).toThrow(
    'unsupported_score_preview_midi_state'
  );
});

it.each(
  [[off], [on], [on, on, off], [on, { ...off, deltaTime: 0 }]].map(
    (events) => [events] as const
  )
)('rejects an unrepresentable note lifecycle', (events) => {
  expect(() => read(events)).toThrow(
    'unsupported_score_preview_midi_note_lifecycle'
  );
});
