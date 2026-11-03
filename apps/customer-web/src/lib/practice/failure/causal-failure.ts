/** Stable adapter facts. Product consequences belong to the consuming mode. */
class CausalFailure<K extends string, C extends string> extends Error {
  constructor(readonly kind: K, readonly code: C, options?: ErrorOptions) { super(code, options); }
}
export type DeviceFailureCode = 'PERMISSION_DENIED' | 'NOT_FOUND' | 'BUSY' | 'UNAVAILABLE' | 'SOURCE_LOST';
export class DeviceFailure extends CausalFailure<'DEVICE', DeviceFailureCode> {
  constructor(code: DeviceFailureCode, readonly resource: 'MICROPHONE' | 'CAMERA', options?: ErrorOptions) { super('DEVICE', code, options); }
}
export type MidiFailureCode = 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'NO_CONNECTED_INPUT' | 'ACCESS_UNAVAILABLE';
export class MidiFailure extends CausalFailure<'MIDI', MidiFailureCode> {
  constructor(code: MidiFailureCode, options?: ErrorOptions) { super('MIDI', code, options); }
}
export type AudioContextFailureCode = 'UNAVAILABLE' | 'INTERRUPTED' | 'CLOSED' | 'RESUME_FAILED';
export class AudioContextFailure extends CausalFailure<'AUDIO_CONTEXT', AudioContextFailureCode> {
  constructor(code: AudioContextFailureCode, options?: ErrorOptions) { super('AUDIO_CONTEXT', code, options); }
}
export type CaptureFailureCode = 'CONNECTION_FAILED' | 'PIPELINE_INVALID' | 'WORKLET_CRASH' | 'MESSAGE_ERROR' | 'READINESS_TIMEOUT' | 'SOURCE_MAPPING_INVALID' | 'CLEANUP_FAILED';
export class CaptureFailure extends CausalFailure<'CAPTURE', CaptureFailureCode> {
  constructor(code: CaptureFailureCode, options?: ErrorOptions) { super('CAPTURE', code, options); }
}
export type AcousticFailureCode = 'SOURCE_RATE_UNSUPPORTED' | 'MODEL_ASSET_UNAVAILABLE' | 'MODEL_IDENTITY_INVALID' | 'WEBGPU_UNAVAILABLE' | 'MODEL_LOAD_FAILED' | 'ENVIRONMENT_NOT_READY';
export class AcousticFailure extends CausalFailure<'ACOUSTIC', AcousticFailureCode> {
  constructor(code: AcousticFailureCode, options?: ErrorOptions) { super('ACOUSTIC', code, options); }
}
export type InferenceFailureCode = 'WORKER_CRASH' | 'WORKER_TIMEOUT' | 'PROTOCOL_INVALID' | 'BACKPRESSURE_EXCEEDED' | 'RUNTIME_FAILED';
export class InferenceFailure extends CausalFailure<'INFERENCE', InferenceFailureCode> {
  constructor(code: InferenceFailureCode, options?: ErrorOptions) { super('INFERENCE', code, options); }
}
export type RecordingFailureCode = 'RECORDING_PERMISSION_DENIED' | 'RECORDING_AUDIO_UNAVAILABLE' | 'RECORDING_VIDEO_UNAVAILABLE'
  | 'RECORDING_STORAGE_UNAVAILABLE' | 'RECORDING_STORAGE_FAILED'
  | 'MEDIA_RECORDER_UNSUPPORTED' | 'VIDEO_RECORDER_UNSUPPORTED' | 'RECORDER_INIT_FAILED' | 'RECORDING_PREPARATION_CANCELLED'
  | 'RECORDING_DISCARDED' | 'RECORDING_DECISION_REQUIRED' | 'RECORDING_TRACKS_UNAVAILABLE' | 'RECORDING_PROBE_TIMEOUT' | 'RECORDING_PROBE_FAILED';
export class RecordingFailure extends CausalFailure<'RECORDING', RecordingFailureCode> {
  constructor(code: RecordingFailureCode, options?: ErrorOptions) { super('RECORDING', code, options); }
}
export class SourceFailure extends CausalFailure<'SOURCE', 'INVALID_SCORE' | 'LOAD_FAILED'> {
  constructor(code: 'INVALID_SCORE' | 'LOAD_FAILED', options?: ErrorOptions) { super('SOURCE', code, options); }
}
export type PracticeCausalFailure = DeviceFailure | MidiFailure | AudioContextFailure | CaptureFailure | AcousticFailure | InferenceFailure | RecordingFailure | SourceFailure;
export function isPracticeCausalFailure(value: unknown): value is PracticeCausalFailure { return value instanceof CausalFailure; }
