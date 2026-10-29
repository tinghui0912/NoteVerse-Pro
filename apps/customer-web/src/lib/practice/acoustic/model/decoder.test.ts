import { expect, it } from 'vitest';
import { decodeRobustPiano, pianoMidiPitchToName } from './robust-piano-decoder';
import { ACOUSTIC_MODEL } from './model-contract';
import type { PianoRawOutputs } from './raw-output-contract';
const raw = (): PianoRawOutputs => ({ reg_onset_output: new Float32Array(183 * 88), reg_onset_shape: [1,183,88],
  frame_output: new Float32Array(183 * 88), frame_shape: [1,183,88] });
it('all88 qualified piano identities preserve shipped sharp/natural spelling through the actual decoder', () => {
  const expected = (`A0 A#0 B0 C1 C#1 D1 D#1 E1 F1 F#1 G1 G#1 A1 A#1 B1
    C2 C#2 D2 D#2 E2 F2 F#2 G2 G#2 A2 A#2 B2 C3 C#3 D3 D#3 E3 F3 F#3 G3 G#3 A3 A#3 B3
    C4 C#4 D4 D#4 E4 F4 F#4 G4 G#4 A4 A#4 B4 C5 C#5 D5 D#5 E5 F5 F#5 G5 G#5 A5 A#5 B5
    C6 C#6 D6 D#6 E6 F6 F#6 G6 G#6 A6 A#6 B6 C7 C#7 D7 D#7 E7 F7 F#7 G7 G#7 A7 A#7 B7 C8`).split(/\s+/);
  const r = raw();
  for (let index = 0; index < 88; index++) { r.reg_onset_output[2 * 88 + index] = .9; r.frame_output[2 * 88 + index] = .8; }
  const events = decodeRobustPiano(r, 3200, ACOUSTIC_MODEL);
  const midi = Array.from({ length: 88 }, (_, index) => 21 + index);
  expect(events.map(e => e.midiPitch)).toEqual(midi);
  expect(events.map(e => e.pitch)).toEqual(expected);
  const canonical = midi.map(pianoMidiPitchToName);
  expect(canonical).toEqual(expected); expect(canonical).toHaveLength(88); expect(new Set(canonical).size).toBe(88);
  expect(pianoMidiPitchToName(21)).toBe('A0'); expect(pianoMidiPitchToName(108)).toBe('C8');
  // Test-only historical grammar: exact qualified mapping already implies this deleted check.
  expect(canonical.every(pitch => /^[A-G]#?-?\d$/.test(pitch))).toBe(true);
  expect(new Set(expected).size).toBe(88); expect(expected[0]).toBe('A0'); expect(expected.at(-1)).toBe('C8');
  expect(events.every(e => e.targetSample === 3520 && e.confidence === Math.fround(.8))).toBe(true);
});
it('region dedupe, earliest equal peak, frame support, pitch and sample mapping are exact', () => {
  const r = raw();
  for (const [f,p,on,fr] of [[2,39,.5,.8],[3,39,.8,.7],[4,39,.8,.9],[6,39,.7,.01],[8,40,.9,.8]]) {
    r.reg_onset_output[f*88+p] = on; r.frame_output[f*88+p] = fr;
  }
  const events = decodeRobustPiano(r, 3200, ACOUSTIC_MODEL);
  expect(events.map(e => [e.pitch,e.midiPitch,e.targetSample])).toEqual([['C4',60,3680],['C#4',61,4480]]);
  expect(events[0].confidence).toBe(Math.fround(.7)); expect(events[0].onsetScore).toBe(Math.fround(.8));
});
it('same-frame chord ordering and rank2 descriptors preserve deterministic pitch order', () => {
  const r = raw(); for (const p of [50,39,0]) { r.reg_onset_output[10*88+p] = .9; r.frame_output[10*88+p] = .8; }
  expect(decodeRobustPiano({ ...r,reg_onset_shape:[183,88],frame_shape:[183,88] },0,ACOUSTIC_MODEL).map(e => e.midiPitch)).toEqual([21,60,71]);
});
it('nonfinite values and invalid descriptors fail closed', () => {
  const r = raw(); r.frame_output[0] = Infinity;
  expect(() => decodeRobustPiano(r,0,ACOUSTIC_MODEL)).toThrow('ACOUSTIC_NONFINITE_OUTPUT');
  expect(() => decodeRobustPiano({ ...raw(), reg_onset_shape:[2,183,88] },0,ACOUSTIC_MODEL)).toThrow('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
});
