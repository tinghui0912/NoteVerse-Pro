import { apiClient } from '../../../apps/customer-web/src/lib/api-client.ts';
import { getPracticeAcousticModelAccess } from '../../../apps/customer-web/src/lib/api/practice-acoustic-model-asset.ts';
import { AcousticModelSession } from '../../../apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts';

const SHA = '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3';
const SIZE = 98689283;
const ROOT = 'noteverse-model-assets/v1/practice-acoustic-robust-browser/' + SHA;
const endpoint = '/api/v1/model-assets/practice-acoustic-robust-browser-v1/access';
let events = [], currentCell = null, ordinal = 0, active = false, cellsRun = 0;
const emit = (kind, detail = {}) => events.push({ order: ++ordinal, cell: currentCell, kind, ...detail });
const demand = (condition, code) => { if (!condition) throw Error(code); };
const labels = new WeakMap(), streams = new WeakMap(), fileLabels = new WeakMap();
const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
const target = value => typeof value === 'string' && value.startsWith('noteverse-model-assets/');

function installObservation() {
  const directory = FileSystemDirectoryHandle.prototype;
  const getDirectoryHandle = directory.getDirectoryHandle;
  directory.getDirectoryHandle = async function (...args) {
    const result = await Reflect.apply(getDirectoryHandle, this, args);
    const parent = labels.get(this);
    const label = parent ? parent + '/' + args[0] : args[0] === 'noteverse-model-assets' ? args[0] : null;
    if (label) { labels.set(result, label); if (active) emit('DIRECTORY', { path: label, create: args[1]?.create === true }); }
    return result;
  };
  const getFileHandle = directory.getFileHandle;
  directory.getFileHandle = async function (...args) {
    const result = await Reflect.apply(getFileHandle, this, args), parent = labels.get(this);
    if (parent) { const label = parent + '/' + args[0]; labels.set(result, label);
      if (active) emit('FILE_HANDLE', { path: label, create: args[1]?.create === true }); }
    return result;
  };
  const removeEntry = directory.removeEntry;
  directory.removeEntry = async function (...args) {
    const result = await Reflect.apply(removeEntry, this, args);
    if (active && labels.has(this)) emit('REMOVE', { path: labels.get(this) + '/' + args[0] });
    return result;
  };
  const getFile = FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile = async function (...args) {
    const result = await Reflect.apply(getFile, this, args), label = labels.get(this);
    if (target(label)) { fileLabels.set(result, label); if (active) emit('FILE_READ', { path: label, byteSize: result.size }); }
    return result;
  };
  const arrayBuffer = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = async function (...args) {
    const result = await Reflect.apply(arrayBuffer, this, args), label = fileLabels.get(this);
    if (active && target(label)) emit('OPFS_BYTES_READ', { path: label, byteSize: result.byteLength });
    return result;
  };
  const createWritable = FileSystemFileHandle.prototype.createWritable;
  FileSystemFileHandle.prototype.createWritable = async function (...args) {
    const result = await Reflect.apply(createWritable, this, args), label = labels.get(this);
    if (target(label)) { streams.set(result, label); if (active) emit('WRITE_OPEN', { path: label }); }
    return result;
  };
  const write = FileSystemWritableFileStream.prototype.write;
  FileSystemWritableFileStream.prototype.write = async function (...args) {
    const result = await Reflect.apply(write, this, args), label = streams.get(this);
    if (active && target(label)) {
      let detail = {};
      if (label.endsWith('/verified.json') && typeof args[0] === 'string') {
        const marker = JSON.parse(args[0]);
        detail = { marker: { schemaVersion: marker.schemaVersion, assetId: marker.assetId, assetVersion: marker.assetVersion,
          expectedByteSize: marker.expectedByteSize, sha256: marker.sha256, verifiedAt: marker.verifiedAt } };
      } else detail = { byteSize: args[0]?.byteLength ?? 0 };
      emit('WRITE', { path: label, ...detail });
    }
    return result;
  };
  const close = FileSystemWritableFileStream.prototype.close;
  FileSystemWritableFileStream.prototype.close = async function (...args) {
    const result = await Reflect.apply(close, this, args), label = streams.get(this);
    if (active && target(label)) emit('WRITE_CLOSE', { path: label });
    return result;
  };
  const digest = SubtleCrypto.prototype.digest;
  SubtleCrypto.prototype.digest = async function (...args) {
    const result = await Reflect.apply(digest, this, args);
    if (active && args[1]?.byteLength === SIZE) emit('SHA256_VERIFIED_BYTES', { byteSize: SIZE, sha256: hex(result) });
    return result;
  };
  const nativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.origin);
    const response = await Reflect.apply(nativeFetch, this, args);
    if (active && url.origin === location.origin && url.pathname === endpoint) {
      const body = await response.clone().json();
      emit('ACCESS_RESPONSE', { status: response.status, credentials: args[1]?.credentials,
        success: body.success === true, pathname: url.pathname });
    }
    return response;
  };
}
async function entryDirectory(create = false) {
  let directory = await navigator.storage.getDirectory();
  for (const name of ROOT.split('/')) directory = await directory.getDirectoryHandle(name, { create });
  return directory;
}
async function clearOnlyTarget() {
  let directory = await navigator.storage.getDirectory();
  try {
    for (const name of ROOT.split('/').slice(0, -1)) directory = await directory.getDirectoryHandle(name);
    await directory.removeEntry(SHA, { recursive: true });
  } catch (error) { if (error.name !== 'NotFoundError') throw error; }
  let absent = false;
  try { await entryDirectory(); } catch (error) { if (error.name === 'NotFoundError') absent = true; else throw error; }
  demand(absent, 'COLD_CACHE_NOT_ABSENT'); return { exactTargetEntryAbsent: true, unrelatedStorageCleared: false };
}
function sanitizeAccess(access) {
  const url = new URL(access.downloadUrl), query = url.searchParams;
  const required = ['x-oss-signature-version', 'x-oss-date', 'x-oss-expires', 'x-oss-credential', 'x-oss-signature'];
  demand(url.protocol === 'https:', 'OSS_HTTPS_REQUIRED');
  demand(url.hostname === 'noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com', 'OSS_AUTHORITY_UNEXPECTED');
  demand(url.pathname === '/models/continuous/robust-browser-v1/' + SHA + '/model.onnx', 'OSS_OBJECT_UNEXPECTED');
  demand(required.every(name => query.has(name)), 'OSS4_FIELDS_MISSING');
  demand(query.get('x-oss-signature-version') === 'OSS4-HMAC-SHA256', 'OSS4_VERSION_REQUIRED');
  demand(![...query.keys()].some(name => name.toLowerCase().startsWith('x-amz-')), 'AWS_SIGNING_FORBIDDEN');
  const ttl = Number(query.get('x-oss-expires')), stamp = query.get('x-oss-date');
  demand(/^[0-9]{8}T[0-9]{6}Z$/.test(stamp), 'OSS_DATE_INVALID');
  const issued = Date.parse(stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + 'T' +
    stamp.slice(9, 11) + ':' + stamp.slice(11, 13) + ':' + stamp.slice(13, 15) + 'Z');
  const expires = Date.parse(access.downloadUrlExpiresAt);
  demand(Number.isInteger(ttl) && ttl > 0 && ttl <= 3600, 'OSS_TTL_INVALID');
  demand(expires > Date.now() && Math.abs(expires - (issued + ttl * 1000)) < 1000, 'OSS_EXPIRY_MISMATCH');
  return { schemaVersion: access.schemaVersion, assetId: access.assetId, assetVersion: access.assetVersion,
    expectedByteSize: access.expectedByteSize, sha256: access.sha256, mediaType: access.mediaType,
    signedAccess: { https: true, hostname: url.hostname, pathname: url.pathname,
      oss4FieldPresence: Object.fromEntries(required.map(name => [name, true])), signatureVersion: 'OSS4-HMAC-SHA256',
      awsSigningAbsent: true, expiresAt: access.downloadUrlExpiresAt, ttlSeconds: ttl } };
}
installObservation();
window.v40 = Object.freeze({
  async login(identity, credential) {
    const result = await apiClient.postForm('/auth/login', { username: identity, password: credential });
    demand(result.success === true, 'REAL_LOGIN_REJECTED');
    const profile = await apiClient.get('/me/profile', undefined, { suppressAuthRedirect: true });
    demand(profile.success === true, 'REAL_PRINCIPAL_UNAVAILABLE');
    return { authenticated: true, mechanism: 'UNCHANGED_API_CLIENT_REAL_CUSTOMER_LOGIN' };
  },
  async runCell(name) {
    demand(!active && cellsRun < 2, 'NO_RETRY');
    demand(name === ['authenticated-cold-network-delivery', 'authenticated-warm-opfs-cache'][cellsRun], 'CELL_ORDER');
    currentCell = name; events = []; ordinal = 0; cellsRun++;
    const initialState = cellsRun === 1 ? await clearOnlyTarget() : { verifiedEntryPreserved: true };
    active = true; emit('CELL_BEGIN', initialState);
    const session = new AcousticModelSession();
    try {
      const access = await getPracticeAcousticModelAccess();
      const descriptor = sanitizeAccess(access); emit('PRODUCTION_DESCRIPTOR_ACCEPTED', descriptor);
      const adapter = await navigator.gpu.requestAdapter(); demand(adapter && !adapter.isFallbackAdapter, 'HARDWARE_WEBGPU_REQUIRED');
      const adapterInfo = adapter.info ?? await adapter.requestAdapterInfo();
      emit('GPU', { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture,
        device: adapterInfo.device, description: adapterInfo.description, fallback: adapter.isFallbackAdapter === true });
      const diagnostics = await session.load(access.downloadUrl); emit('SESSION_READY', { diagnostics });
      const directory = await entryDirectory();
      const model = await (await directory.getFileHandle('model.bin')).getFile();
      const bytes = await model.arrayBuffer();
      const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
      const marker = JSON.parse(await (await (await directory.getFileHandle('verified.json')).getFile()).text());
      emit('FINAL_OPFS_CHECK', { byteSize: bytes.byteLength, sha256, marker });
      await session.dispose(); emit('SESSION_DISPOSED');
      active = false;
      return { name, result: 'RECEIPTS_READY_FOR_INDEPENDENT_AUDIT', events, inferenceRuns: 0 };
    } catch (error) {
      try { await session.dispose(); emit('SESSION_DISPOSED_AFTER_FAILURE'); } catch { emit('SESSION_DISPOSAL_FAILED'); }
      active = false;
      return { name, result: 'CELL_EXECUTION_BLOCKED', events, errorClass: error.name,
        safeCode: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UNSAFE_DETAIL_OMITTED', inferenceRuns: 0 };
    }
  }
});
