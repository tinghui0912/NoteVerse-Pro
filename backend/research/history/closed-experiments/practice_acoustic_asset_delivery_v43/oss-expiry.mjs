const HOST = 'noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com';
const PATH = '/models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx';
export const OSS4_FIELDS = ['x-oss-signature-version', 'x-oss-date', 'x-oss-expires', 'x-oss-credential', 'x-oss-signature'];
const demand = (condition, code) => { if (!condition) throw Error(code); };
const iso = ms => Number.isFinite(ms) ? new Date(ms).toISOString() : null;
export function signedMetadata(downloadUrl, descriptorExpiry) {
  const url = new URL(downloadUrl), query = url.searchParams;
  const stamp = query.get('x-oss-date'), duration = query.get('x-oss-expires');
  return { https: url.protocol === 'https:', hostname: url.hostname, pathname: url.pathname,
    signatureVersion: query.get('x-oss-signature-version') === 'OSS4-HMAC-SHA256' ? 'OSS4-HMAC-SHA256' : null,
    oss4FieldPresence: Object.fromEntries(OSS4_FIELDS.map(name => [name, query.has(name)])),
    awsSigningAbsent: ![...query.keys()].some(name => name.toLowerCase().startsWith('x-amz-')),
    xOssDate: /^[0-9]{8}T[0-9]{6}Z$/.test(stamp ?? '') ? stamp : null,
    xOssExpires: /^[0-9]{1,6}$/.test(duration ?? '') ? duration : null,
    descriptorExpiry: iso(Date.parse(descriptorExpiry)) };
}
export function expiryObservation(metadata, receivedAtMs) {
  const stamp = metadata.xOssDate;
  const dateMs = typeof stamp === 'string' && /^[0-9]{8}T[0-9]{6}Z$/.test(stamp)
    ? Date.parse(stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + 'T' + stamp.slice(9, 11) + ':' + stamp.slice(11, 13) + ':' + stamp.slice(13, 15) + 'Z') : NaN;
  const duration = typeof metadata.xOssExpires === 'string' && /^[0-9]+$/.test(metadata.xOssExpires) ? Number(metadata.xOssExpires) : NaN;
  const effective = dateMs + duration * 1000, descriptor = Date.parse(metadata.descriptorExpiry);
  return { descriptorExpiry: iso(descriptor), xOssDate: metadata.xOssDate, xOssExpires: metadata.xOssExpires,
    signingDateMs: Number.isFinite(dateMs) ? dateMs : null, effectiveSignedExpiry: iso(effective),
    effectiveSignedExpiryMs: Number.isFinite(effective) ? effective : null,
    descriptorExpiryMs: Number.isFinite(descriptor) ? descriptor : null,
    deltaMs: Number.isFinite(descriptor - effective) ? descriptor - effective : null, receivedAtMs };
}
export function validateSignedMetadata(metadata, receivedAtMs) {
  demand(metadata.https === true, 'OSS_HTTPS_REQUIRED');
  demand(metadata.hostname === HOST, 'OSS_AUTHORITY_UNEXPECTED'); demand(metadata.pathname === PATH, 'OSS_OBJECT_UNEXPECTED');
  demand(OSS4_FIELDS.every(name => metadata.oss4FieldPresence[name] === true), 'OSS4_FIELDS_MISSING');
  demand(metadata.signatureVersion === 'OSS4-HMAC-SHA256', 'OSS4_VERSION_REQUIRED'); demand(metadata.awsSigningAbsent === true, 'AWS_SIGNING_FORBIDDEN');
  const observation = expiryObservation(metadata, receivedAtMs);
  demand(observation.signingDateMs !== null && new Date(observation.signingDateMs).toISOString().replace(/[-:]/g, '').replace('.000', '') === metadata.xOssDate, 'OSS_DATE_INVALID');
  const ttl = Number(metadata.xOssExpires);
  demand(typeof metadata.xOssExpires === 'string' && /^[0-9]+$/.test(metadata.xOssExpires) && Number.isInteger(ttl) && ttl > 0 && ttl <= 604800, 'OSS_TTL_INVALID');
  demand(observation.effectiveSignedExpiryMs > receivedAtMs, 'OSS_EFFECTIVE_EXPIRY_NOT_FUTURE');
  demand(observation.descriptorExpiryMs !== null && observation.descriptorExpiryMs > receivedAtMs, 'OSS_DESCRIPTOR_EXPIRY_NOT_FUTURE');
  demand(observation.deltaMs >= 0 && observation.deltaMs < 2000, 'OSS_EXPIRY_RELATION_OUTSIDE_PROVEN_ENVELOPE');
  return observation;
}
