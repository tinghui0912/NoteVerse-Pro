import coreIdentity from './acoustic-core-identity.json';
import sourceIdentities from '../source/source-adapter-identities.json';

export const ACOUSTIC_MODEL = Object.freeze({
  identityName: 'practice-acoustic-robust-browser@v1',
  identitySha256: '7afc54d0231a12eb89cbac174b74f1bd4989c77fda8b8c22b916762888a2fb73',
  modelSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
  modelBytes: 98689283, ortVersion: '1.20.1', provider: 'webgpu', automaticFallback: false,
  inputSamples: 29120, sampleRateHz: 16000, inputMs: 1820,
  onsetThreshold: 0.30, frameThreshold: 0.05, ownedMs: 600, futureMs: 170, pastMs: 1050,
} as const);

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
    || coreIdentity.ownership.fullWindowPastMs !== ACOUSTIC_MODEL.pastMs) fail('ACOUSTIC_IDENTITY_DRIFT');
}
export function sourceIdentity(rate: SourceRate) { return sourceIdentities[String(rate) as '44100' | '48000']; }
export function sourceRate(value: number): SourceRate {
  if (value !== 44100 && value !== 48000) fail('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
  return value;
}
export class AcousticAnalysisError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) { super(code, options); this.name = 'AcousticAnalysisError'; }
}
export function fail(code: string): never { throw new AcousticAnalysisError(code); }
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
