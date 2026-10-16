import * as ort from 'onnxruntime-web/webgpu';
import { createOpfsByteDanceModelLoader } from '../../model-assets/bytedance-model-loader';
import { defaultByteDanceModelManifest, type AcousticNoteEvent, type ByteDancePcmInferenceRequest,
  type ByteDanceRawOutputs } from './bytedance-contract';
import { ByteDanceOnnxInferenceCore, loadOnnxRuntimeWeb } from './bytedance-onnx-provider';
import { decodeByteDanceRawOutputs } from './bytedance-decoder';
import { XC4, assertXc4Identity, onlyFields, sha256 } from './xc4-robust-runtime-contract';
import type { Xc4Window } from './xc4-robust-window-planner';

export type Xc4WorkerInput = { window: Xc4Window; pcm: Float32Array };
export type Xc4WorkerResult = { events: AcousticNoteEvent[]; inferenceMs: number; decodeMs: number; actualSessionRunCount?: number };
export type Xc4InferencePort = { run(input: Xc4WorkerInput): Promise<Xc4WorkerResult>; dispose(): Promise<void> };

export function decodeXc4(raw: ByteDanceRawOutputs, input: Xc4WorkerInput): AcousticNoteEvent[] {
  const request: ByteDancePcmInferenceRequest = { requestId: String(input.window.windowIndex), pcm: input.pcm,
    sampleRateHz: 16000, channelCount: 1, captureStartSampleIndex: input.window.startSample,
    captureStartTime: { domainId: 'xc4-acoustic-performance', ms: input.window.inputWindowStartMs } };
  return decodeByteDanceRawOutputs(raw, request, { onsetThreshold: XC4.onsetThreshold, frameThreshold: XC4.frameThreshold });
}

export async function verifyXc4Model(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== XC4.modelBytes || await sha256(bytes) !== XC4.modelSha256) throw new Error('XC4_MODEL_IDENTITY_DRIFT');
}

export class Xc4WorkerAdapter implements Xc4InferencePort {
  private busy = false;
  private core: ByteDanceOnnxInferenceCore | null = null;
  private nextWindow = 0;
  private lastOwnedEndMs = 0;
  private terminal = false;
  private sessionRunCount = 0;
  private sessionLoadCount = 0;

  async load(modelUrl: string): Promise<unknown> {
    if (this.busy || this.core) throw new Error('XC4_WORKER_BUSY_OR_LOADED');
    this.busy = true;
    let core: ByteDanceOnnxInferenceCore | null = null;
    try {
      await assertXc4Identity();
      if (ort.env.versions.web !== XC4.ortVersion) throw new Error('XC4_ORT_VERSION_DRIFT');
      const base = await loadOnnxRuntimeWeb({ executionProvider: 'webgpu' });
      const owner = this;
      const runtime = { ...base, async createSession(...args: Parameters<typeof base.createSession>) {
        const session = await base.createSession(...args);
        owner.sessionLoadCount++;
        const descriptors = session as typeof session & { inputNames?: readonly string[]; outputNames?: readonly string[] };
        if (descriptors.inputNames?.join() !== 'audio'
          || descriptors.outputNames?.join() !== 'reg_onset_output,frame_output') {
          await session.release?.(); throw new Error('XC4_MODEL_DESCRIPTOR_DRIFT');
        }
        return { release: () => session.release?.(), async run(feeds: Record<string, unknown>, names: readonly string[]) {
          owner.sessionRunCount++;
          const tensors = await session.run(feeds, names);
          try {
            const result: typeof tensors = {};
            for (const name of names) {
              const t = tensors[name];
              if (!t || t.dims.join() !== '1,183,88' || t.data.length !== 183 * 88) throw new Error('XC4_OUTPUT_DESCRIPTOR_DRIFT');
              const data = Float32Array.from(t.data);
              if (data.some(v => !Number.isFinite(v))) throw new Error('XC4_NONFINITE_OUTPUT');
              result[name] = { data, dims: [1, 183, 88] };
            }
            return result;
          } finally {
            for (const t of [...Object.values(tensors), ...Object.values(feeds)]) (t as { dispose?: () => void }).dispose?.();
          }
        } };
      } };
      const loader = createOpfsByteDanceModelLoader();
      core = new ByteDanceOnnxInferenceCore(runtime, async manifest => {
        const loaded = await loader(manifest); await verifyXc4Model(loaded.bytes); return loaded;
      });
      // Only the historical validated asset/session primitives are reused, not its worker decoder or anchor planner.
      const diagnostics = await core.load(defaultByteDanceModelManifest({ modelUrl,
        expectedByteSize: XC4.modelBytes, sha256: XC4.modelSha256 }));
      this.core = core; this.nextWindow = 0; this.lastOwnedEndMs = 0; this.terminal = false;
      return { ...diagnostics, ortWebVersion: ort.env.versions.web, automaticFallback: false,
        actualSessionLoadCount: this.sessionLoadCount,
        inputDescriptor: { name: 'audio', dtype: 'float32', shape: [1, 29120] },
        outputDescriptors: { reg_onset_output: [1, 183, 88], frame_output: [1, 183, 88] } };
    } catch (error) { await core?.dispose(); throw error; }
    finally { this.busy = false; }
  }

  async run(input: Xc4WorkerInput): Promise<Xc4WorkerResult> {
    onlyFields(input, ['window', 'pcm']);
    onlyFields(input.window, ['windowIndex', 'ownedStartMs', 'ownedEndMs', 'startSample', 'endSample', 'inputWindowStartMs']);
    if (this.busy) throw new Error('XC4_WORKER_CONCURRENCY_REJECTED');
    if (!this.core || this.terminal) throw new Error('XC4_WORKER_NOT_READY');
    if (input.window.windowIndex !== this.nextWindow || input.window.ownedStartMs !== this.lastOwnedEndMs
      || input.window.ownedEndMs <= input.window.ownedStartMs || input.window.ownedEndMs - input.window.ownedStartMs > 600
      || input.pcm.length !== 29120 || input.pcm.some(v => !Number.isFinite(v))
      || input.window.endSample - input.window.startSample !== 29120
      || Math.abs(input.window.inputWindowStartMs + 1820 - input.window.ownedEndMs - 170) > 1 / 16) {
      throw new Error('XC4_WORKER_WINDOW_DRIFT');
    }
    this.busy = true;
    try {
      const started = performance.now();
      const raw = await this.core.infer({ requestId: String(this.nextWindow), pcm: input.pcm,
        sampleRateHz: 16000, channelCount: 1, captureStartSampleIndex: input.window.startSample,
        captureStartTime: { domainId: 'xc4-acoustic-performance', ms: input.window.inputWindowStartMs } });
      const inferred = performance.now(), events = decodeXc4(raw, input), decoded = performance.now();
      this.nextWindow++; this.lastOwnedEndMs = input.window.ownedEndMs;
      this.terminal = input.window.ownedEndMs - input.window.ownedStartMs < 600;
      return { events, inferenceMs: inferred - started, decodeMs: decoded - inferred, actualSessionRunCount: this.sessionRunCount };
    } finally { this.busy = false; }
  }

  async dispose(): Promise<void> {
    if (this.busy) throw new Error('XC4_WORKER_CONCURRENCY_REJECTED');
    this.busy = true;
    try { await this.core?.dispose(); this.core = null; this.nextWindow = 0; this.lastOwnedEndMs = 0; }
    finally { this.busy = false; }
  }
}
