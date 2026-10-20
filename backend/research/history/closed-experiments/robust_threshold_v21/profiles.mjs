export const onset = Object.freeze([0.15, 0.20, 0.25, 0.30, 0.35]);
export const frame = Object.freeze([0.05, 0.10, 0.15, 0.20]);
export const MODEL = '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3';
export const CONTROL = 'ROBUST_A_O030_F005';
const digits = v => String(Math.round(v * 100)).padStart(3, '0');
export const profiles = Object.freeze(onset.flatMap((o, oi) => frame.map((f, fi) => Object.freeze({
  profileId: `ROBUST_A_O${digits(o)}_F${digits(f)}`, onsetThreshold: o, frameThreshold: f,
  modelSha256: MODEL, decoder: 'PRODUCTION_DECODER_A', geometry: { ownedMs: 600, pastMs: 1050, futureMs: 170 },
  gridStepDistance: Math.abs(oi - 3) + fi,
  readoutIdentity: `robust-a-o${digits(o)}-f${digits(f)}-v21-exposed-development`,
  status: o === 0.30 && f === 0.05 ? 'CURRENT_CONTROL_NOT_NEW_CANDIDATE' : 'EXPOSED_DEVELOPMENT_ONLY'
}))));
