import assert from 'node:assert/strict';
import { validateSignedMetadata } from './oss-expiry.mjs';

export function auditCell(cell, network, contract) {
  assert.equal(cell.result, 'RECEIPTS_READY_FOR_INDEPENDENT_AUDIT', 'EXECUTION_DID_NOT_COMPLETE');
  const events = cell.events;
  events.forEach((event, index) => { assert.equal(event.order, index + 1); assert.equal(event.cell, cell.name); });
  const select = kind => events.filter(event => event.kind === kind);
  const only = kind => { const rows = select(kind); assert.equal(rows.length, 1, 'EXACTLY_ONE_' + kind); return rows[0]; };
  const accesses = network.filter(r => r.classification === 'MODEL_ACCESS_DESCRIPTOR_API');
  assert.equal(accesses.length, 1); assert.equal(accesses[0].status, 200);
  const response = only('ACCESS_RESPONSE'); assert.equal(response.status, 200);
  assert.equal(response.success, true); assert.equal(response.credentials, 'include');
  const descriptor = only('PRODUCTION_DESCRIPTOR_ACCEPTED');
  for (const [key, value] of Object.entries(contract.model)) assert.equal(descriptor[key], value, 'DESCRIPTOR_' + key);
  assert.equal(descriptor.signedAccess.https, true);
  assert.equal(descriptor.signedAccess.hostname, contract.expectedOssHost);
  assert.equal(descriptor.signedAccess.pathname, '/' + contract.objectKey);
  assert.equal(descriptor.signedAccess.signatureVersion, 'OSS4-HMAC-SHA256');
  assert.equal(descriptor.signedAccess.awsSigningAbsent, true);
  assert.ok(Object.values(descriptor.signedAccess.oss4FieldPresence).every(Boolean));
  const expiry = only('SIGNED_EXPIRY_OBSERVED');
  const independentlyValidatedExpiry = validateSignedMetadata(descriptor.signedAccess, expiry.receivedAtMs);
  for (const key of ['deltaMs', 'effectiveSignedExpiryMs', 'descriptorExpiryMs']) assert.equal(expiry[key], independentlyValidatedExpiry[key]);
  const gpu = only('GPU'); assert.equal(gpu.fallback, false); assert.ok(gpu.vendor || gpu.description);
  const ready = only('SESSION_READY'), diagnostics = ready.diagnostics;
  assert.equal(diagnostics.byteSize, contract.model.expectedByteSize); assert.equal(diagnostics.sha256, contract.model.sha256);
  assert.equal(diagnostics.modelSha256, contract.model.sha256); assert.equal(diagnostics.modelByteSize, contract.model.expectedByteSize);
  assert.equal(diagnostics.actualSessionLoadCount, 1); assert.equal(diagnostics.ortWebVersion, '1.20.1');
  assert.equal(diagnostics.executionProvider, 'webgpu'); assert.equal(diagnostics.automaticFallback, false);
  assert.deepEqual(diagnostics.inputDescriptor, { name: 'audio', dtype: 'float32', shape: [1, 29120] });
  assert.deepEqual(diagnostics.outputDescriptors, { reg_onset_output: [1, 183, 88], frame_output: [1, 183, 88] });
  const opfs = only('FINAL_OPFS_CHECK');
  assert.equal(opfs.byteSize, contract.model.expectedByteSize); assert.equal(opfs.sha256, contract.model.sha256);
  for (const [key, value] of Object.entries(contract.model).filter(([key]) => key !== 'mediaType')) assert.equal(opfs.marker[key], value);
  assert.ok(Number.isFinite(Date.parse(opfs.marker.verifiedAt)));
  const payloads = network.filter(r => r.classification === 'OSS_MODEL_PAYLOAD_GET');
  const beforeReady = events.filter(e => e.order < ready.order);
  const writes = beforeReady.filter(e => e.kind === 'WRITE' && e.path.endsWith('/model.bin'));
  const readbacks = beforeReady.filter(e => e.kind === 'OPFS_BYTES_READ' && e.path.endsWith('/model.bin'));
  const hashes = beforeReady.filter(e => e.kind === 'SHA256_VERIFIED_BYTES');
  assert.ok(readbacks.some(e => e.byteSize === contract.model.expectedByteSize));
  assert.ok(hashes.length >= 2 && hashes.every(e => e.sha256 === contract.model.sha256));
  const cold = cell.name === contract.cells[0];
  if (cold) {
    assert.equal(only('CELL_BEGIN').exactTargetEntryAbsent, true);
    assert.equal(diagnostics.source, 'network'); assert.equal(payloads.length, 1);
    assert.equal(payloads[0].method, 'GET');
    assert.ok(payloads[0].status >= 200 && payloads[0].status < 300);
    assert.equal(writes.reduce((sum, e) => sum + e.byteSize, 0), contract.model.expectedByteSize);
    const closes = beforeReady.filter(e => e.kind === 'WRITE_CLOSE' && e.path.endsWith('/model.bin'));
    const markers = beforeReady.filter(e => e.kind === 'WRITE_OPEN' && e.path.endsWith('/verified.json'));
    assert.equal(closes.length, 1); assert.equal(markers.length, 1);
    assert.ok(closes[0].order < readbacks[0].order && readbacks[0].order < hashes[0].order && hashes[0].order < markers[0].order);
    const markerWrites = beforeReady.filter(e => e.kind === 'WRITE' && e.path.endsWith('/verified.json'));
    assert.equal(markerWrites.length, 1);
    for (const [key, value] of Object.entries(contract.model).filter(([key]) => key !== 'mediaType')) assert.equal(markerWrites[0].marker[key], value);
    assert.ok(Number.isFinite(Date.parse(markerWrites[0].marker.verifiedAt)));
    assert.ok(beforeReady.some(e => e.kind === 'WRITE_CLOSE' && e.path.endsWith('/verified.json') && e.order > markerWrites[0].order));
  } else {
    assert.equal(only('CELL_BEGIN').verifiedEntryPreserved, true); assert.equal(diagnostics.source, 'opfs-cache');
    assert.equal(payloads.length, 0); assert.equal(writes.length, 0);
    assert.equal(beforeReady.filter(e => e.kind === 'WRITE_OPEN').length, 0);
  }
  assert.equal(only('SESSION_DISPOSED').order, events.at(-1).order);
  assert.equal(cell.inferenceRuns, 0); assert.equal(network.filter(r => r.classification === 'UNKNOWN').length, 0);
  return { name: cell.name, result: 'PASS', independentlyRecomputed: true,
    authenticatedDescriptorRequests: accesses.length, modelPayloadGets: payloads.length,
    browserStreamedModelBytes: cold ? writes.reduce((n, e) => n + e.byteSize, 0) : 0,
    opfsBytes: opfs.byteSize, sha256: opfs.sha256, cacheSource: diagnostics.source,
    sequentialActivationVerified: cold, freshSessionLoads: 1, inferenceRuns: 0,
    hardwareWebGpu: true, provider: diagnostics.executionProvider, unknownNetwork: 0 };
}

export function auditCampaign(raw, contract) {
  assert.equal(raw.unauthenticatedWitness.status, 401); assert.equal(raw.unauthenticatedWitness.isolated, true);
  assert.equal(raw.authenticated.authenticated, true);
  assert.ok(raw.network.some(row => row.pathname === '/api/v1/auth/login' && row.method === 'POST' && row.status === 200), 'REAL_LOGIN_200_REQUIRED');
  assert.ok(raw.network.some(row => row.pathname === '/api/v1/me/profile' && row.method === 'GET' && row.status === 200), 'AUTHENTICATED_PROFILE_200_REQUIRED');
  assert.equal(raw.pageErrors, 0); assert.equal(raw.unknownNetwork, 0);
  assert.equal(raw.cells.length, 2); assert.equal(raw.browserLaunches, 1);
  const cells = raw.cells.map((cell, index) => {
    assert.equal(cell.name, contract.cells[index]);
    return auditCell(cell, raw.network.filter(n => n.cell === cell.name), contract);
  });
  return { result: 'PASS', cells, authenticatedAccessRequests: cells.reduce((n, c) => n + c.authenticatedDescriptorRequests, 0),
    successfulModelPayloadDownloads: cells.reduce((n, c) => n + c.modelPayloadGets, 0), inferenceRuns: 0 };
}
