import coreIdentity from './acoustic-core-identity.json';
import sourceIdentities from '../source/source-adapter-identities.json';

export const ACOUSTIC_MODEL = Object.freeze({
  identityName: 'practice-acoustic-robust-browser@v1',
  identitySha256: '879b0c53a77820f1e74f13f7647f952fc5bc480cc38c9b6f2c0b8c656342a2eb',
  modelSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
  modelBytes: 98689283, ortVersion: '1.20.1', provider: 'webgpu', automaticFallback: false,
  inputSamples: 29120, sampleRateHz: 16000, inputMs: 1820,
  onsetThreshold: 0.30, frameThreshold: 0.05, ownedMs: 600, futureMs: 170,
} as const);

/** Derived model geometry relationship, not an independent rate or policy. */
export const ACOUSTIC_TARGET_SAMPLES_PER_MS = ACOUSTIC_MODEL.sampleRateHz / 1000;

export type SourceRate = 44100 | 48000;
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function assertAcousticIdentity(): Promise<void> {
  const fullWindowPastMs = ACOUSTIC_MODEL.inputMs - ACOUSTIC_MODEL.ownedMs - ACOUSTIC_MODEL.futureMs;
  const hash = await sha256(new TextEncoder().encode(canonicalJson(coreIdentity)));
  if (hash !== ACOUSTIC_MODEL.identitySha256
    || coreIdentity.model.onnxSha256 !== ACOUSTIC_MODEL.modelSha256
    || coreIdentity.model.onnxBytes !== ACOUSTIC_MODEL.modelBytes
    || coreIdentity.input.modelInputSamples !== ACOUSTIC_MODEL.inputSamples
    || coreIdentity.input.sampleRateHz !== ACOUSTIC_MODEL.sampleRateHz
    || coreIdentity.input.modelInputMs !== ACOUSTIC_MODEL.inputMs
    || coreIdentity.runtime.ortWebVersion !== ACOUSTIC_MODEL.ortVersion
    || coreIdentity.runtime.provider !== ACOUSTIC_MODEL.provider
    || coreIdentity.runtime.automaticFallback !== ACOUSTIC_MODEL.automaticFallback
    || coreIdentity.decoder.default !== 'A'
    || coreIdentity.decoder.onsetThreshold !== ACOUSTIC_MODEL.onsetThreshold
    || coreIdentity.decoder.frameThreshold !== ACOUSTIC_MODEL.frameThreshold
    || coreIdentity.ownership.ownedMs !== ACOUSTIC_MODEL.ownedMs
    || coreIdentity.ownership.futureContextMs !== ACOUSTIC_MODEL.futureMs
    || coreIdentity.ownership.fullWindowPastMs !== fullWindowPastMs) fail('ACOUSTIC_IDENTITY_DRIFT');
}
export function sourceIdentity(rate: SourceRate) { return sourceIdentities[String(rate) as '44100' | '48000']; }
export function sourceRate(value: number): SourceRate {
  if (value !== 44100 && value !== 48000) fail('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
  return value;
}
const ACOUSTIC_ANALYSIS_ERROR_CODES = [
  'ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED',
  'ACOUSTIC_CAPTURE_ALREADY_ATTACHED',
  'ACOUSTIC_CAPTURE_FAILED',
  'ACOUSTIC_EVENT_BOUND_EXCEEDED',
  'ACOUSTIC_EVENT_IDENTITY_MISMATCH',
  'ACOUSTIC_FIELD_VIOLATION',
  'ACOUSTIC_IDENTITY_DRIFT',
  'ACOUSTIC_INFERENCE_FAILED',
  'ACOUSTIC_INTERNAL_FAILURE',
  'ACOUSTIC_MODEL_ASSET_UNAVAILABLE',
  'ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH',
  'ACOUSTIC_MODEL_IDENTITY_MISMATCH',
  'ACOUSTIC_MODEL_LOAD_FAILED',
  'ACOUSTIC_NONFINITE_OUTPUT',
  'ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH',
  'ACOUSTIC_PREROLL_NOT_READY',
  'ACOUSTIC_PUBLICATION_OBSERVATION_INVALID',
  'ACOUSTIC_PUBLICATION_REENTRANCY',
  'ACOUSTIC_PUBLICATION_SEQUENCE_INVALID',
  'ACOUSTIC_PUBLICATION_SINK_FAILED',
  'ACOUSTIC_PUBLICATION_SINK_MUST_BE_SYNCHRONOUS',
  'ACOUSTIC_PUBLICATION_SOURCE_MAPPING_INVALID',
  'ACOUSTIC_PUBLICATION_STREAM_FAILED',
  'ACOUSTIC_REGION_END_MISMATCH',
  'ACOUSTIC_REGION_NOT_RUNNING',
  'ACOUSTIC_RUNTIME_CLOSED',
  'ACOUSTIC_SEGMENT_END_MISMATCH',
  'ACOUSTIC_SEGMENT_NOT_RUNNING',
  'ACOUSTIC_SESSION_MISMATCH',
  'ACOUSTIC_SESSION_NOT_IDLE',
  'ACOUSTIC_SOURCE_COORDINATE_OVERFLOW',
  'ACOUSTIC_WEBGPU_UNAVAILABLE',
  'ACOUSTIC_WORKER_ALREADY_OBSERVED',
  'ACOUSTIC_WORKER_CONCURRENCY_OR_STATE',
  'ACOUSTIC_WORKER_CONCURRENCY_REJECTED',
  'ACOUSTIC_WORKER_CRASH',
  'ACOUSTIC_WORKER_DISPOSED',
  'ACOUSTIC_WORKER_INTERNAL_FAILURE',
  'ACOUSTIC_WORKER_MESSAGE_ERROR',
  'ACOUSTIC_WORKER_NOT_EMPTY',
  'ACOUSTIC_WORKER_NOT_READY',
  'ACOUSTIC_WORKER_RPC_TIMEOUT',
  'ACOUSTIC_WORKER_TERMINATED',
  'ACOUSTIC_WORKER_WINDOW_MISMATCH',
  'CAPTURE_BOUNDARY_LIMIT_EXCEEDED',
  'CAPTURE_BOUNDARY_NOT_PENDING',
  'CAPTURE_CHRONOLOGY_VIOLATION',
  'CAPTURE_CONTEXT_FRAME_GAP',
  'DUPLICATE_ACOUSTIC_OBSERVATION',
  'FIR_IDENTITY_MISMATCH',
  'INVALID_ACOUSTIC_CAPTURE_BLOCK',
  'INVALID_ACOUSTIC_DOMAIN',
  'INVALID_ACOUSTIC_PUBLICATION_TIME',
  'INVALID_ACOUSTIC_REGION_START',
  'INVALID_ACOUSTIC_SEGMENT_START',
  'INVALID_ACOUSTIC_TERMINAL',
  'INVALID_CAPTURE_BOUNDARY',
  'INVALID_CAPTURE_CONTEXT_POLICY',
  'INVALID_CAPTURE_OWNERSHIP',
  'INVALID_COVERAGE_BOUNDARY',
  'INVALID_SOURCE_SAMPLE_IDENTITY',
  'NONCHRONOLOGICAL_ACOUSTIC_SOURCE',
  'NONCHRONOLOGICAL_CAPTURE_BOUNDARY',
  'NONFINITE_CAPTURE_PCM',
  'NONMONOTONIC_ACOUSTIC_AVAILABILITY',
  'ORT_VERSION_MISMATCH',
  'REAL_ACOUSTIC_CONTEXT_UNAVAILABLE',
  'REAL_ACOUSTIC_TAIL_REQUIRED',
  'SOURCE_ADAPTER_IDENTITY_MISMATCH',
  'SOURCE_SAMPLE_RATE_NOT_QUALIFIED',
  'UNEXPECTED_WORKER_RESPONSE',
  'UNKNOWN_ACOUSTIC_PERFORMANCE_SEGMENT',
] as const;
export type AcousticAnalysisErrorCode = typeof ACOUSTIC_ANALYSIS_ERROR_CODES[number];
export function isAcousticAnalysisErrorCode(value: unknown): value is AcousticAnalysisErrorCode {
  return typeof value === 'string' && ACOUSTIC_ANALYSIS_ERROR_CODES.some(code => code === value);
}
export class AcousticAnalysisError extends Error {
  constructor(readonly code: AcousticAnalysisErrorCode, options?: ErrorOptions) { super(code, options); this.name = 'AcousticAnalysisError'; }
}
export function fail(code: AcousticAnalysisErrorCode): never { throw new AcousticAnalysisError(code); }
export function onlyFields(value: object, allowed: readonly string[]): void {
  if (!value || Object.keys(value).some(k => !allowed.includes(k))) fail('ACOUSTIC_FIELD_VIOLATION');
}
export function safeIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_SOURCE_SAMPLE_IDENTITY');
}
export function previousFloat(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) fail('INVALID_COVERAGE_BOUNDARY');
  const floats = new Float64Array([value]), bits = new BigUint64Array(floats.buffer);
  bits[0] -= BigInt(1); return floats[0];
}
