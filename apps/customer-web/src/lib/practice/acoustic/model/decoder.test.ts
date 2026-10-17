import { expect, it } from 'vitest';
import { decodeRobustPiano } from './robust-piano-decoder';
import { ACOUSTIC_MODEL } from './model-contract';
import type { PianoRawOutputs } from './raw-output-contract';
const raw = (): PianoRawOutputs => ({ reg_onset_output: new Float32Array(183 * 88), reg_onset_shape: [1,183,88],
  frame_output: new Float32Array(183 * 88), frame_shape: [1,183,88] });
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
