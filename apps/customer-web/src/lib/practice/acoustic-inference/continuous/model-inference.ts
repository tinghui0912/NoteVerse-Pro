import * as ort from 'onnxruntime-web/webgpu';
import { createOpfsByteDanceModelLoader } from '../../../model-assets/bytedance-model-loader';
import { defaultByteDanceModelManifest, type ByteDanceRawOutputs } from '../bytedance-contract';
import { ByteDanceOnnxInferenceCore, loadOnnxRuntimeWeb } from '../bytedance-onnx-provider';
import { decodeByteDanceRawOutputs } from '../bytedance-decoder';
import { ACOUSTIC_MODEL as M, assertAcousticIdentity, fail, onlyFields, sha256 } from './model-contract';
import type { AcousticInferenceInput, AcousticInferencePort, AcousticInferenceResult } from './inference-types';
import { assertModelNames, checkedOutput } from './model-validation';

export function decodeAcousticOutputs(raw: ByteDanceRawOutputs, input: AcousticInferenceInput) {
  return decodeByteDanceRawOutputs(raw, {
    requestId: String(input.window.jobIndex), pcm: input.pcm, sampleRateHz: 16000, channelCount: 1,
    captureStartSampleIndex: input.window.startSample,
    captureStartTime: { domainId: 'continuous-acoustic-input', ms: input.window.inputWindowStartMs },
  }, { onsetThreshold: M.onsetThreshold, frameThreshold: M.frameThreshold });
}
export async function verifyAcousticModel(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== M.modelBytes || await sha256(bytes) !== M.modelSha256) fail('ACOUSTIC_MODEL_IDENTITY_MISMATCH');
}

/** One ONNX session. Window context is explicit; no recurrent state crosses segments. */
export class ContinuousModelInference implements AcousticInferencePort {
  private state: 'EMPTY' | 'READY' | 'FAILED' | 'DISPOSED' = 'EMPTY';
  private busy = false;
  private core: ByteDanceOnnxInferenceCore | null = null;
  private nextJob = 0;
  private loads = 0;
  private runs = 0;
  async load(modelUrl: string): Promise<unknown> {
    if (this.busy || this.state !== 'EMPTY') fail('ACOUSTIC_WORKER_NOT_EMPTY');
    this.busy = true;
    let core: ByteDanceOnnxInferenceCore | null = null;
    try {
      await assertAcousticIdentity();
      if (ort.env.versions.web !== M.ortVersion) fail('ORT_VERSION_MISMATCH');
      const base = await loadOnnxRuntimeWeb({ executionProvider: 'webgpu' });
      const owner = this;
      const runtime = { ...base, async createSession(...args: Parameters<typeof base.createSession>) {
        const session = await base.createSession(...args);
        owner.loads++;
        const descriptors = session as typeof session & { inputNames?: readonly string[]; outputNames?: readonly string[] };
        try { assertModelNames(descriptors.inputNames, descriptors.outputNames); }
        catch (error) { await session.release?.(); throw error; }
        // The exact ONNX hash binds the input shape; validate every actual output too.
        return { release: () => session.release?.(), async run(feeds: Record<string, unknown>, names: readonly string[]) {
          owner.runs++;
          const tensors = await session.run(feeds, names);
          try {
            const result: typeof tensors = {};
            for (const name of names) {
              const data = checkedOutput(tensors[name]);
              result[name] = { data, dims: [1, 183, 88] };
            }
            return result;
          } finally {
            for (const tensor of [...Object.values(tensors), ...Object.values(feeds)]) (tensor as { dispose?: () => void }).dispose?.();
          }
        } };
      } };
      const loader = createOpfsByteDanceModelLoader();
      core = new ByteDanceOnnxInferenceCore(runtime, async manifest => {
        const loaded = await loader(manifest); await verifyAcousticModel(loaded.bytes); return loaded;
      });
      const diagnostics = await core.load(defaultByteDanceModelManifest({ modelUrl, expectedByteSize: M.modelBytes, sha256: M.modelSha256 }));
      this.core = core; this.state = 'READY';
      return { ...diagnostics, acousticCoreIdentitySha256: M.identitySha256,
        ortWebVersion: ort.env.versions.web, automaticFallback: false, actualSessionLoadCount: this.loads,
        inputDescriptor: { name: 'audio', dtype: 'float32', shape: [1, 29120] },
        outputDescriptors: { reg_onset_output: [1, 183, 88], frame_output: [1, 183, 88] } };
    } catch (error) { this.state = 'FAILED'; await core?.dispose(); throw error; }
    finally { this.busy = false; }
  }
  async run(input: AcousticInferenceInput): Promise<AcousticInferenceResult> {
    onlyFields(input, ['window', 'pcm']);
    onlyFields(input.window, ['jobIndex', 'segmentIndex', 'windowIndex', 'ownedStartMs', 'ownedEndMs', 'startSample', 'endSample', 'inputWindowStartMs']);
    if (this.busy) fail('ACOUSTIC_WORKER_CONCURRENCY_REJECTED');
    if (this.state !== 'READY' || !this.core) fail('ACOUSTIC_WORKER_NOT_READY');
    const w = input.window;
    if (w.jobIndex !== this.nextJob || w.ownedEndMs <= w.ownedStartMs || w.ownedEndMs - w.ownedStartMs > M.ownedMs
      || input.pcm.length !== M.inputSamples || input.pcm.some(v => !Number.isFinite(v))
      || w.endSample - w.startSample !== M.inputSamples
      || Math.abs(w.inputWindowStartMs + M.inputMs - w.ownedEndMs - M.futureMs) > 1 / 16) fail('ACOUSTIC_WORKER_WINDOW_MISMATCH');
    this.busy = true;
    try {
      const started = performance.now();
      const raw = await this.core.infer({ requestId: String(w.jobIndex), pcm: input.pcm,
        sampleRateHz: 16000, channelCount: 1, captureStartSampleIndex: w.startSample,
        captureStartTime: { domainId: 'continuous-acoustic-input', ms: w.inputWindowStartMs } });
      const inferred = performance.now(), events = decodeAcousticOutputs(raw, input), decoded = performance.now();
      this.nextJob++;
      return { events, inferenceMs: inferred - started, decodeMs: decoded - inferred, actualSessionRunCount: this.runs };
    } catch (error) { this.state = 'FAILED'; throw error; }
    finally { this.busy = false; }
  }
  async dispose(): Promise<void> {
    if (this.busy) fail('ACOUSTIC_WORKER_CONCURRENCY_REJECTED');
    try { await this.core?.dispose(); } finally { this.core = null; this.state = 'DISPOSED'; }
  }
}
