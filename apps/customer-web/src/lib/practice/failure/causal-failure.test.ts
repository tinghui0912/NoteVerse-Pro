import { expect, it } from 'vitest';
import { DeviceFailure, MidiFailure, AudioContextFailure, CaptureFailure, AcousticFailure, InferenceFailure, RecordingFailure, BundleFailure, isPracticeCausalFailure } from './causal-failure';
import { AcousticAnalysisError } from '../acoustic/errors';
import { acousticBoundaryFailure } from '../acoustic/failure-boundary';

it('closed causal categories retain original diagnostic cause without interpreting its text', () => {
  const cause = new Error('NotAllowedError CAPTURE WEBGPU https://private/model');
  const facts = [new DeviceFailure('UNAVAILABLE', 'CAMERA', { cause }), new MidiFailure('ACCESS_UNAVAILABLE', { cause }),
    new AudioContextFailure('INTERRUPTED', { cause }), new CaptureFailure('PIPELINE_INVALID', { cause }),
    new AcousticFailure('MODEL_LOAD_FAILED', { cause }), new InferenceFailure('WORKER_TIMEOUT', { cause }),
    new RecordingFailure('RECORDER_INIT_FAILED', { cause }), new BundleFailure('LOAD_FAILED', { cause })];
  expect(facts.map(f => f.kind)).toEqual(['DEVICE', 'MIDI', 'AUDIO_CONTEXT', 'CAPTURE', 'ACOUSTIC', 'INFERENCE', 'RECORDING', 'BUNDLE']);
  for (const fact of facts) { expect(isPracticeCausalFailure(fact)).toBe(true); expect(fact.cause).toBe(cause); expect(acousticBoundaryFailure(fact)).toBe(fact); }
  expect(isPracticeCausalFailure(cause)).toBe(false);
});
it('source correctness and decoder/evaluation invariants remain invariant errors', () => {
  const error = new AcousticAnalysisError('ACOUSTIC_EVENT_IDENTITY_MISMATCH');
  expect(acousticBoundaryFailure(error)).toBe(error); expect(isPracticeCausalFailure(error)).toBe(false);
});
it('the compiler requires known codes at both error construction boundaries', () => {
  if (false) {
    // @ts-expect-error Unknown causal code is outside the contract.
    new InferenceFailure('UNRECOGNIZED_CODE');
    // @ts-expect-error Unknown acoustic integrity code is outside the contract.
    new AcousticAnalysisError('UNRECOGNIZED_CODE');
  }
  expect(isPracticeCausalFailure(new Error('NO_CONNECTED_INPUT'))).toBe(false);
});
