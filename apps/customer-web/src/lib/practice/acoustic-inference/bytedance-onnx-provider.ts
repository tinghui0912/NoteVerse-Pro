import {
  BYTEDANCE_INPUT_DESCRIPTOR,
  BYTEDANCE_OUTPUT_DESCRIPTORS,
  type ByteDanceModelManifest,
  type ByteDancePcmInferenceRequest,
  type ByteDanceRawOutputs,
  validateByteDanceModelManifest,
} from './bytedance-contract';
import { prepareByteDanceInput } from './bytedance-preprocess';

type OrtTensorLike = {
  data: Float32Array | number[] | readonly number[];
  dims: readonly number[];
};

export type ByteDanceOnnxSession = {
  run(
    feeds: Record<string, unknown>,
    outputNames: readonly string[]
  ): Promise<Record<string, OrtTensorLike>>;
  release?(): Promise<void> | void;
};

export type ByteDanceOnnxRuntime = {
  createSession(manifest: ByteDanceModelManifest): Promise<ByteDanceOnnxSession>;
};

type OrtRuntimeModule = {
  InferenceSession: {
    create(
      modelUrl: string,
      options: {
        executionProviders: readonly string[];
        graphOptimizationLevel: 'disabled' | 'basic' | 'extended' | 'all';
      }
    ): Promise<ByteDanceOnnxSession>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
};

export async function loadOnnxRuntimeWeb(): Promise<ByteDanceOnnxRuntime> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    throw new Error('WebGPU is unavailable; ByteDance browser inference cannot initialize.');
  }
  const importer = Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<OrtRuntimeModule>;
  const ort = await importer('onnxruntime-web');
  return {
    async createSession(manifest) {
      validateByteDanceModelManifest(manifest);
      return ort.InferenceSession.create(manifest.modelUrl, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'disabled',
      });
    },
  };
}

export class ByteDanceOnnxInferenceCore {
  private session: ByteDanceOnnxSession | null = null;
  private manifest: ByteDanceModelManifest | null = null;

  constructor(private readonly runtime: ByteDanceOnnxRuntime) {}

  async load(manifest: ByteDanceModelManifest): Promise<void> {
    validateByteDanceModelManifest(manifest);
    this.session = await this.runtime.createSession(manifest);
    this.manifest = manifest;
  }

  async infer(request: ByteDancePcmInferenceRequest): Promise<ByteDanceRawOutputs> {
    if (!this.session || !this.manifest) {
      throw new Error('ByteDance ONNX session is not ready.');
    }
    const prepared = prepareByteDanceInput(request);
    const outputs = await this.session.run(
      {
        [BYTEDANCE_INPUT_DESCRIPTOR.name]: prepared.feeds.audio,
      },
      [
        BYTEDANCE_OUTPUT_DESCRIPTORS.regOnset.name,
        BYTEDANCE_OUTPUT_DESCRIPTORS.frame.name,
      ]
    );
    return {
      reg_onset_output: tensorData(outputs[BYTEDANCE_OUTPUT_DESCRIPTORS.regOnset.name]),
      reg_onset_shape: tensorDims(outputs[BYTEDANCE_OUTPUT_DESCRIPTORS.regOnset.name]),
      frame_output: tensorData(outputs[BYTEDANCE_OUTPUT_DESCRIPTORS.frame.name]),
      frame_shape: tensorDims(outputs[BYTEDANCE_OUTPUT_DESCRIPTORS.frame.name]),
    };
  }

  async dispose(): Promise<void> {
    await this.session?.release?.();
    this.session = null;
    this.manifest = null;
  }
}

function tensorData(tensor: OrtTensorLike | undefined): Float32Array {
  if (!tensor) {
    throw new Error('ByteDance ONNX output tensor is missing.');
  }
  if (tensor.data instanceof Float32Array) {
    return tensor.data;
  }
  return Float32Array.from(tensor.data);
}

function tensorDims(tensor: OrtTensorLike | undefined): readonly number[] {
  if (!tensor) {
    throw new Error('ByteDance ONNX output tensor is missing.');
  }
  return tensor.dims;
}
