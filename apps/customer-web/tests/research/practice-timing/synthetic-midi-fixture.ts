import midiPackage from '@tonejs/midi';

/** Five generated note starts, not a composition or an external dataset. */
export function syntheticMidiFixture(withTempo = true): Uint8Array {
  const midi = new midiPackage.Midi();
  if (withTempo) {
    midi.header.tempos = [{ ticks: 0, bpm: 120 }, { ticks: 960, bpm: 60 }];
    midi.header.update();
  }
  const track = midi.addTrack();
  for (const [pitch, ticks] of [[60, 0], [62, 240], [60, 480], [60, 960], [64, 1440]]) {
    track.addNote({ midi: pitch, ticks, durationTicks: 120, velocity: 0.8 });
  }
  return midi.toArray();
}
