import identity from './xc4-robust-identity.json';

export const XC4 = Object.freeze({
  engineeringIdentityName: 'robust-browser-engineering-default-xc4-v1',
  engineeringIdentitySha256: '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',
  modelSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
  modelBytes: 98689283, ortVersion: '1.20.1', provider: 'webgpu', automaticFallback: false,
  inputSamples: 29120, sampleRateHz: 16000, inputMs: 1820,
  decoder: 'A', onsetThreshold: 0.30, frameThreshold: 0.05,
  ownedMs: 600, futureMs: 170, pastMs: 1050,
  sourceRateHz: 44100, up: 160, down: 441, taps: 8821,
  coefficientSha256: 'd54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620',
  coefficientBytes: 35284, realSourceLookahead: 28,
  ownership: '[ownedStartMs,ownedEndMs)', productionMicrophone: false,
} as const);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer))]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function assertXc4Identity(): Promise<void> {
  // XC4 canonical JSON is ASCII and has no integer-valued floats serialized as x.0.
  const hash = await sha256(new TextEncoder().encode(canonicalJson(identity)));
  const matches = identity.identityName === XC4.engineeringIdentityName
    && identity.model.onnxSha256 === XC4.modelSha256 && identity.model.onnxBytes === XC4.modelBytes
    && identity.runtime.ortWebVersion === XC4.ortVersion && identity.runtime.provider === XC4.provider
    && identity.runtime.automaticFallback === XC4.automaticFallback
    && identity.input.modelInputSamples === XC4.inputSamples && identity.input.sampleRateHz === XC4.sampleRateHz
    && identity.input.modelInputMs === XC4.inputMs && identity.decoder.default === XC4.decoder
    && identity.decoder.onsetThreshold === XC4.onsetThreshold && identity.decoder.frameThreshold === XC4.frameThreshold
    && identity.ownership.ownedMs === XC4.ownedMs && identity.ownership.futureContextMs === XC4.futureMs
    && identity.ownership.fullWindowPastMs === XC4.pastMs && identity.ownership.rule === XC4.ownership
    && identity.resampler.default === 'BAND_LIMITED' && identity.resampler.sourceRateHz === XC4.sourceRateHz
    && identity.resampler.targetRateHz === XC4.sampleRateHz && identity.resampler.up === XC4.up
    && identity.resampler.down === XC4.down && identity.resampler.tapCount === XC4.taps
    && identity.resampler.coefficients.sha256 === XC4.coefficientSha256
    && identity.resampler.coefficients.bytes === XC4.coefficientBytes
    && identity.resampler.conservativeReadyLookaheadSamples === XC4.realSourceLookahead;
  if (hash !== XC4.engineeringIdentitySha256 || !matches) throw new Error('XC4_ENGINEERING_IDENTITY_DRIFT');
}

export function onlyFields(value: object, allowed: readonly string[]): void {
  if (!value || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('XC4_ACOUSTIC_FIELD_VIOLATION');
}

export function requireSourceRate(rate: number, mode: 'CAPTURE' | 'ALREADY_16K_TEST_INJECTION'): void {
  if (mode === 'CAPTURE' && rate === 44100) return;
  if (mode === 'ALREADY_16K_TEST_INJECTION' && rate === 16000) return;
  throw new Error('SOURCE_SAMPLE_RATE_NOT_XC4_QUALIFIED');
}
