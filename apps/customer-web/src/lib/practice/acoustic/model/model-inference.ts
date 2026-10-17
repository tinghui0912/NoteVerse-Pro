import * as ort from 'onnxruntime-web/webgpu';
import { createVerifiedModelAssetLoader } from '../../../model-assets/verified-model-asset-loader';
import { type ByteDanceRawOutputs } from '../../acoustic-inference/bytedance-contract';
import { decodeByteDanceRawOutputs } from '../../acoustic-inference/bytedance-decoder';
import { ACOUSTIC_MODEL as M, assertAcousticIdentity, fail, onlyFields, sha256 } from './model-contract';
import type { AcousticInferenceInput, AcousticInferencePort, AcousticInferenceResult } from '../runtime/inference-types';
import { assertModelNames, assertWindowGeometry, checkedOutput } from './model-validation';
import { practiceAcousticModelManifest } from './acoustic-model-manifest';

export function decodeAcousticOutputs(raw: ByteDanceRawOutputs, input: AcousticInferenceInput) {
  return decodeByteDanceRawOutputs(raw, {
    requestId: String(input.window.jobIndex), pcm: input.pcm, sampleRateHz: 16000, channelCount: 1,
    captureStartSampleIndex: input.window.startSample,
    captureStartTime: { domainId: 'acoustic-source-input', ms: input.window.startSample / 16 },
  }, { onsetThreshold: M.onsetThreshold, frameThreshold: M.frameThreshold }).map(event => Object.freeze({
    pitch: event.pitch, midiPitch: event.midiPitch, targetSample: event.onsetTime.sampleIndex!,
    confidence: event.confidence, onsetScore: event.onsetScore, frameScore: event.frameScore }));
}
export async function verifyAcousticModel(bytes: Uint8Array): Promise<void> {
  if (bytes.byteLength !== M.modelBytes || await sha256(bytes) !== M.modelSha256) fail('ACOUSTIC_MODEL_IDENTITY_MISMATCH');
}
function outputData(tensor: ort.Tensor | undefined): Float32Array {
  if (!tensor || tensor.type !== 'float32' || !(tensor.data instanceof Float32Array)) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  return checkedOutput({ dims: tensor.dims, data: tensor.data });
}

/** One ONNX session. Window context is explicit; no recurrent state crosses segments. */
export class AcousticModelSession implements AcousticInferencePort {
  private state: 'EMPTY' | 'READY' | 'FAILED' | 'DISPOSED' = 'EMPTY';
  private busy = false;
  private session: ort.InferenceSession | null = null;
  private nextJob = 0;
  private loads = 0;
  private runs = 0;
  async load(modelUrl: string): Promise<unknown> {
    if (this.busy || this.state !== 'EMPTY') fail('ACOUSTIC_WORKER_NOT_EMPTY');
    this.busy = true;
    let session: ort.InferenceSession | null = null;
    try {
      await assertAcousticIdentity();
      if (ort.env.versions.web !== M.ortVersion) fail('ORT_VERSION_MISMATCH');
      if (typeof navigator === 'undefined' || !navigator.gpu) fail('ACOUSTIC_WEBGPU_UNAVAILABLE');
      const manifest = practiceAcousticModelManifest(modelUrl), started = performance.now();
      const loaded = await createVerifiedModelAssetLoader()(manifest.asset);
      await verifyAcousticModel(loaded.bytes);
      const verifiedAt = performance.now();
      session = await ort.InferenceSession.create(loaded.bytes, { executionProviders: [manifest.provider], graphOptimizationLevel: 'disabled' });
      this.loads++; assertModelNames(session.inputNames, session.outputNames);
      this.session = session; this.state = 'READY';
      return { ...loaded.diagnostics, assetId: manifest.asset.assetId, assetVersion: manifest.asset.assetVersion,
        modelByteSize: loaded.bytes.length, modelSha256: manifest.asset.sha256, executionProvider: manifest.provider,
        modelFetchAndVerifyMs: verifiedAt - started, sessionCreateMs: performance.now() - verifiedAt,
        acousticCoreIdentitySha256: M.identitySha256,
        ortWebVersion: ort.env.versions.web, automaticFallback: false, actualSessionLoadCount: this.loads,
        inputDescriptor: { name: 'audio', dtype: 'float32', shape: [1, 29120] },
        outputDescriptors: { reg_onset_output: [1, 183, 88], frame_output: [1, 183, 88] } };
    } catch (error) { this.state = 'FAILED'; await session?.release(); throw error; }
    finally { this.busy = false; }
  }
  async run(input: AcousticInferenceInput): Promise<AcousticInferenceResult> {
    onlyFields(input, ['window', 'pcm']);
    onlyFields(input.window, ['jobIndex', 'regionIndex', 'windowIndex', 'ownedStartTarget', 'ownedEndTarget', 'startSample', 'endSample']);
    if (this.busy) fail('ACOUSTIC_WORKER_CONCURRENCY_REJECTED');
    if (this.state !== 'READY' || !this.session) fail('ACOUSTIC_WORKER_NOT_READY');
    const w = input.window;
    assertWindowGeometry(w);
    if (w.jobIndex !== this.nextJob || !(input.pcm instanceof Float32Array) || input.pcm.length !== M.inputSamples
      || input.pcm.some(v => !Number.isFinite(v))) fail('ACOUSTIC_WORKER_WINDOW_MISMATCH');
    this.busy = true;
    try {
      const started = performance.now();
      const audio = new ort.Tensor('float32', input.pcm, [1, 29120]);
      let tensors: ort.InferenceSession.OnnxValueMapType | undefined;
      let raw: ByteDanceRawOutputs;
      try {
        this.runs++;
        tensors = await this.session.run({ audio }, ['reg_onset_output', 'frame_output']);
        raw = { reg_onset_output: outputData(tensors.reg_onset_output), reg_onset_shape: [1, 183, 88],
          frame_output: outputData(tensors.frame_output), frame_shape: [1, 183, 88] };
      } finally { audio.dispose(); for (const tensor of Object.values(tensors ?? {})) tensor.dispose(); }
      const inferred = performance.now(), events = decodeAcousticOutputs(raw, input), decoded = performance.now();
      this.nextJob++;
      return { events, inferenceMs: inferred - started, decodeMs: decoded - inferred, actualSessionRunCount: this.runs };
    } catch (error) { this.state = 'FAILED'; throw error; }
    finally { this.busy = false; }
  }
  async dispose(): Promise<void> {
    if (this.busy) fail('ACOUSTIC_WORKER_CONCURRENCY_REJECTED');
    try { await this.session?.release(); } finally { this.session = null; this.state = 'DISPOSED'; }
  }
}
