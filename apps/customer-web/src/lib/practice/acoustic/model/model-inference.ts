import { ACOUSTIC_ANALYSIS_IDENTITY } from '../generated/runtime-contract';
import * as ort from 'onnxruntime-web/webgpu';
import { createVerifiedModelAssetLoader } from '../../../model-assets/verified-model-asset-loader';
import type { PianoRawOutputs } from './raw-output-contract';
import { decodeRobustPiano } from './robust-piano-decoder';
import { ACOUSTIC_RUNTIME_CONTRACT as M } from '../generated/runtime-contract';
import { AcousticAnalysisError, fail } from '../errors';
import { assertAcousticIdentity, sha256 } from '../identity';
import { onlyFields } from '../validation';
import type { AcousticInferenceInput, AcousticInferenceResult } from '../runtime/inference-types';
import type { ModelAssetProgressCallback } from '../../../model-assets/types';
import { assertModelNames, assertWindowGeometry, checkedOutput } from './model-validation';
import { acousticModelAsset } from './model-asset';

export function decodeAcousticOutputs(raw: PianoRawOutputs, input: AcousticInferenceInput) {
  return decodeRobustPiano(raw, input.window.startSample);
}
export async function verifyAcousticModel(bytes: Uint8Array): Promise<void> {
  if(bytes.byteLength !== M.model.byteSize || await sha256(bytes) !== M.model.sha256) fail('ACOUSTIC_MODEL_IDENTITY_MISMATCH');
}
function outputData(tensor: ort.Tensor | undefined): Float32Array {
  if(!tensor || tensor.type !== M.outputs[0].dtype || !(tensor.data instanceof Float32Array)) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  return checkedOutput({ dims: tensor.dims, data: tensor.data });
}

/** One ONNX session. Window context is explicit; no recurrent state crosses segments. */
export class AcousticModelSession {
  private state: 'EMPTY' | 'READY' | 'FAILED' | 'DISPOSED' = 'EMPTY';
  private busy = false;
  private session: ort.InferenceSession | null = null;
  private nextJob = 0;
  private loads = 0;
  private runs = 0;
  private activeSession: string | null = null;
  async load(modelUrl: string, progress?: ModelAssetProgressCallback): Promise<unknown> {
    if (this.busy || this.state !== 'EMPTY') fail('ACOUSTIC_WORKER_NOT_EMPTY');
    this.busy = true;
    let session: ort.InferenceSession | null = null;
    try {
      await assertAcousticIdentity();
      if(ort.env.versions.web !== M.runtime.packageVersion) fail('ORT_VERSION_MISMATCH');
      if (typeof navigator === 'undefined' || !navigator.gpu) fail('ACOUSTIC_WEBGPU_UNAVAILABLE');
      const asset = acousticModelAsset(modelUrl), started = performance.now();
      const loaded = await createVerifiedModelAssetLoader()(asset, progress).catch(cause => {
        throw new AcousticAnalysisError('ACOUSTIC_MODEL_ASSET_UNAVAILABLE', { cause });
      });
      await verifyAcousticModel(loaded.bytes);
      const verifiedAt = performance.now();
      session = await ort.InferenceSession.create(loaded.bytes, { executionProviders: [M.runtime.executionProvider], graphOptimizationLevel: M.runtime.graphOptimizationLevel }).catch(cause => {
        throw new AcousticAnalysisError('ACOUSTIC_MODEL_LOAD_FAILED', { cause });
      });
      this.loads++; assertModelNames(session.inputNames, session.outputNames);
      this.session = session; this.state = 'READY';
      return {
        ...loaded.diagnostics, assetId: asset.assetId, assetVersion: asset.assetVersion,
        modelByteSize: loaded.bytes.length, modelSha256: asset.sha256, executionProvider: M.runtime.executionProvider,
        modelFetchAndVerifyMs: verifiedAt - started, sessionCreateMs: performance.now() - verifiedAt,
        analysisIdentitySha256: ACOUSTIC_ANALYSIS_IDENTITY.analysisIdentitySha256,
        ortWebVersion: ort.env.versions.web, automaticFallback: M.runtime.automaticFallback, actualSessionLoadCount: this.loads,
        inputDescriptor: M.input,
        outputDescriptors: Object.fromEntries(M.outputs.map(output => [output.name, output.shape]))
      };
    } catch (error) { this.state = 'FAILED'; await session?.release(); throw error; }
    finally { this.busy = false; }
  }
  beginSession(sessionId: string): void {
    if (this.busy || this.state !== 'READY' || this.activeSession !== null || !sessionId) fail('ACOUSTIC_SESSION_NOT_IDLE');
    this.activeSession = sessionId; this.nextJob = 0; this.runs = 0;
  }
  endSession(sessionId: string): void {
    if (this.busy || !sessionId || this.activeSession !== sessionId) fail('ACOUSTIC_SESSION_MISMATCH');
    this.activeSession = null; this.nextJob = 0; this.runs = 0;
  }
  async run(sessionId: string, input: AcousticInferenceInput): Promise<AcousticInferenceResult> {
    onlyFields(input, ['window', 'pcm']);
    onlyFields(input.window, ['jobIndex', 'regionIndex', 'windowIndex', 'ownedStartTarget', 'ownedEndTarget', 'startSample', 'endSample']);
    if (this.busy) fail('ACOUSTIC_WORKER_CONCURRENCY_REJECTED');
    if (this.state !== 'READY' || !this.session) fail('ACOUSTIC_WORKER_NOT_READY');
    if (!sessionId || this.activeSession !== sessionId) fail('ACOUSTIC_SESSION_MISMATCH');
    const w = input.window;
    assertWindowGeometry(w);
    if(w.jobIndex !== this.nextJob || !(input.pcm instanceof Float32Array) || input.pcm.length !== M.input.shape[1]
      || input.pcm.some(v => !Number.isFinite(v))) fail('ACOUSTIC_WORKER_WINDOW_MISMATCH');
    this.busy = true;
    try {
      const started = performance.now();
      const audio = new ort.Tensor(M.input.dtype, input.pcm, [...M.input.shape]);
      let tensors: ort.InferenceSession.OnnxValueMapType | undefined;
      let raw: PianoRawOutputs;
      try {
        this.runs++;
        tensors = await this.session.run({ [M.input.name]: audio }, M.outputs.map(output => output.name)).catch(cause => {
          throw new AcousticAnalysisError('ACOUSTIC_INFERENCE_FAILED', { cause });
        });
        raw = {
          onset: outputData(tensors[M.outputs[0].name]), onsetShape: M.outputs[0].shape,
          frame: outputData(tensors[M.outputs[1].name]), frameShape: M.outputs[1].shape
        };
      } finally { audio.dispose(); for (const tensor of Object.values(tensors ?? {})) tensor.dispose(); }
      const inferred = performance.now(), events = decodeAcousticOutputs(raw, input), decoded = performance.now();
      this.nextJob++;
      return { events, inferenceMs: inferred - started, decodeMs: decoded - inferred, actualSessionRunCount: this.runs };
    } catch (error) { this.state = 'FAILED'; throw error; }
    finally { this.busy = false; }
  }
  async dispose(): Promise<void> {
    if (this.busy) fail('ACOUSTIC_WORKER_CONCURRENCY_REJECTED');
    try { await this.session?.release(); } finally { this.session = null; this.activeSession = null; this.state = 'DISPOSED'; }
  }
}
