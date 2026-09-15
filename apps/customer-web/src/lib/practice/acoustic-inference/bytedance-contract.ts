import type { SessionTime } from '../local-core';

export const BYTEDANCE_NOTE_MODEL_ID = 'bytedance-piano-transcription-note-model';
export const BYTEDANCE_NOTE_MODEL_VERSION = 'CRNN_note_F1_0.9677_pedal_F1_0.9186';
export const BYTEDANCE_PREPROCESSING_VERSION = 'fixed-anchor-16k-mono-v1';
export const BYTEDANCE_DECODER_VERSION = 'temporally-bound-reg-onset-frame-v1';
export const ONNX_RUNTIME_WEB_VERSION = '1.30.0';

export const BYTEDANCE_INPUT_DESCRIPTOR = {
  name: 'audio',
  dtype: 'float32',
  shape: [1, 29120],
} as const;

export const BYTEDANCE_OUTPUT_DESCRIPTORS = {
  regOnset: {
    name: 'reg_onset_output',
    dtype: 'float32',
    rank: 3,
    pitchCount: 88,
  },
  frame: {
    name: 'frame_output',
    dtype: 'float32',
    rank: 3,
    pitchCount: 88,
  },
} as const;

export const BYTEDANCE_INFERENCE_CONTRACT = {
  sampleRateHz: 16_000,
  channels: 1,
  targetAnchorMs: 1600,
  lookbackMs: 1000,
  futureMs: 220,
  onsetThreshold: 0.2,
  frameThreshold: 0.2,
  outputFrameRateHz: 100,
} as const;

export type ByteDanceExecutionBackend = 'webgpu';

export type ByteDanceModelManifest = {
  schemaVersion: 1;
  modelId: typeof BYTEDANCE_NOTE_MODEL_ID;
  modelVersion: typeof BYTEDANCE_NOTE_MODEL_VERSION;
  modelUrl: string;
  expectedByteSize: number;
  sha256: string;
  requiredExecutionBackend: ByteDanceExecutionBackend;
  onnxRuntimeWebVersion: typeof ONNX_RUNTIME_WEB_VERSION;
  sampleRateHz: typeof BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz;
  input: typeof BYTEDANCE_INPUT_DESCRIPTOR;
  outputs: typeof BYTEDANCE_OUTPUT_DESCRIPTORS;
  preprocessingVersion: typeof BYTEDANCE_PREPROCESSING_VERSION;
  decoderVersion: typeof BYTEDANCE_DECODER_VERSION;
};

export type ByteDancePcmInferenceRequest = {
  requestId: string;
  pcm: Float32Array;
  sampleRateHz: number;
  channelCount: 1;
  captureStartSampleIndex: number;
  captureStartTime: SessionTime;
  inferenceRequestedAtMs?: number;
};

export type ByteDanceRawOutputs = {
  reg_onset_output: Float32Array;
  reg_onset_shape: readonly number[];
  frame_output: Float32Array;
  frame_shape: readonly number[];
};

export type AcousticNoteEvent = {
  pitch: string;
  midiPitch: number;
  onsetTime: SessionTime;
  confidence: number;
  onsetScore: number;
  frameScore: number;
  source: 'ACOUSTIC';
  inferenceCompletedAtMs?: number;
};

export type ByteDanceInferenceResult = {
  requestId: string;
  events: AcousticNoteEvent[];
  inferenceCompletedAtMs?: number;
};

export function defaultByteDanceModelManifest(input: {
  modelUrl: string;
  expectedByteSize: number;
  sha256: string;
}): ByteDanceModelManifest {
  return {
    schemaVersion: 1,
    modelId: BYTEDANCE_NOTE_MODEL_ID,
    modelVersion: BYTEDANCE_NOTE_MODEL_VERSION,
    modelUrl: input.modelUrl,
    expectedByteSize: input.expectedByteSize,
    sha256: input.sha256,
    requiredExecutionBackend: 'webgpu',
    onnxRuntimeWebVersion: ONNX_RUNTIME_WEB_VERSION,
    sampleRateHz: BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz,
    input: BYTEDANCE_INPUT_DESCRIPTOR,
    outputs: BYTEDANCE_OUTPUT_DESCRIPTORS,
    preprocessingVersion: BYTEDANCE_PREPROCESSING_VERSION,
    decoderVersion: BYTEDANCE_DECODER_VERSION,
  };
}

export function validateByteDanceModelManifest(manifest: ByteDanceModelManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error('Unsupported ByteDance model manifest schema version.');
  }
  if (manifest.modelId !== BYTEDANCE_NOTE_MODEL_ID
    || manifest.modelVersion !== BYTEDANCE_NOTE_MODEL_VERSION) {
    throw new Error('Unexpected ByteDance model identity.');
  }
  if (manifest.requiredExecutionBackend !== 'webgpu') {
    throw new Error('ByteDance browser verifier requires the WebGPU execution backend.');
  }
  if (manifest.onnxRuntimeWebVersion !== ONNX_RUNTIME_WEB_VERSION) {
    throw new Error('Unexpected ONNX Runtime Web version.');
  }
  if (manifest.sampleRateHz !== BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz) {
    throw new Error('Unexpected ByteDance model sample rate.');
  }
  if (manifest.input.name !== BYTEDANCE_INPUT_DESCRIPTOR.name
    || manifest.input.dtype !== BYTEDANCE_INPUT_DESCRIPTOR.dtype
    || manifest.input.shape.join('x') !== BYTEDANCE_INPUT_DESCRIPTOR.shape.join('x')) {
    throw new Error('Unexpected ByteDance input tensor descriptor.');
  }
  if (manifest.outputs.regOnset.name !== BYTEDANCE_OUTPUT_DESCRIPTORS.regOnset.name
    || manifest.outputs.frame.name !== BYTEDANCE_OUTPUT_DESCRIPTORS.frame.name) {
    throw new Error('Unexpected ByteDance output tensor descriptor names.');
  }
  if (!manifest.modelUrl || manifest.expectedByteSize <= 0 || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    throw new Error('ByteDance model manifest must include URL, byte size, and SHA256.');
  }
}
