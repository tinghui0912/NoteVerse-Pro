import * as ortWebGpu from 'onnxruntime-web/webgpu';

import {
  BYTEDANCE_INPUT_DESCRIPTOR,
  BYTEDANCE_OUTPUT_DESCRIPTORS,
  type ByteDanceLoadDiagnostics,
  type ByteDanceModelManifest,
  type ByteDancePcmInferenceRequest,
  type ByteDanceRawOutputs,
  validateByteDanceModelManifest,
} from './bytedance-contract';
import { createOpfsByteDanceModelLoader } from '../../model-assets/bytedance-model-loader';
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
  createTensor(type: 'float32', data: Float32Array, dims: readonly number[]): unknown;
  createSession(manifest: ByteDanceModelManifest, modelBytes: Uint8Array): Promise<ByteDanceOnnxSession>;
};

type OrtRuntimeModule = {
  InferenceSession: {
    create(
      modelBytes: Uint8Array,
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
  const ort = ortWebGpu as unknown as OrtRuntimeModule;
  return {
    createTensor(type, data, dims) {
      return new ort.Tensor(type, data, dims);
    },
    async createSession(manifest, modelBytes) {
      validateByteDanceModelManifest(manifest);
      return ort.InferenceSession.create(modelBytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'disabled',
      });
    },
  };
}

export type ByteDanceModelLoaderResult = {
  bytes: Uint8Array;
  source?: 'opfs-cache' | 'network';
  downloadMs?: number;
  cacheReadMs?: number;
  verificationMs?: number;
  persistentStorageGranted?: boolean | null;
};

export type ByteDanceModelLoader = (
  manifest: ByteDanceModelManifest
) => Promise<ByteDanceModelLoaderResult>;

export class ByteDanceOnnxInferenceCore {
  private session: ByteDanceOnnxSession | null = null;
  private manifest: ByteDanceModelManifest | null = null;
  private readonly modelLoader: ByteDanceModelLoader;

  constructor(
    private readonly runtime: ByteDanceOnnxRuntime,
    modelLoader?: ByteDanceModelLoader
  ) {
    this.modelLoader = modelLoader ?? createOpfsByteDanceModelLoader();
  }

  async load(manifest: ByteDanceModelManifest): Promise<ByteDanceLoadDiagnostics> {
    validateByteDanceModelManifest(manifest);
    const loadStartedAt = nowMs();
    await this.dispose();
    const modelLoadStartedAt = nowMs();
    const loaded = await this.modelLoader(manifest);
    const modelLoadedAt = nowMs();
    const modelBytes = loaded.bytes;
    this.session = await this.runtime.createSession(manifest, modelBytes);
    const sessionCreatedAt = nowMs();
    this.manifest = manifest;
    return {
      modelFetchAndVerifyMs: modelLoadedAt - modelLoadStartedAt,
      sessionCreateMs: sessionCreatedAt - modelLoadedAt,
      totalLoadMs: sessionCreatedAt - loadStartedAt,
      modelByteSize: modelBytes.byteLength,
      modelSha256: manifest.sha256,
      source: loaded.source,
      downloadMs: loaded.downloadMs,
      cacheReadMs: loaded.cacheReadMs,
      verificationMs: loaded.verificationMs,
      persistentStorageGranted: loaded.persistentStorageGranted,
    };
  }

  async infer(request: ByteDancePcmInferenceRequest): Promise<ByteDanceRawOutputs> {
    if (!this.session || !this.manifest) {
      throw new Error('ByteDance ONNX session is not ready.');
    }
    const prepared = prepareByteDanceInput(request);
    const audio = this.runtime.createTensor('float32', prepared.feeds.audio, prepared.shape);
    const outputs = await this.session.run(
      {
        [BYTEDANCE_INPUT_DESCRIPTOR.name]: audio,
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

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
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
