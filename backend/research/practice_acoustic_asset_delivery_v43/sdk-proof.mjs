import assert from 'node:assert/strict';
import { captureProcess, requireProcessSuccess } from './process-result.mjs';
import { DIR } from './discovery.mjs';
import { validateSignedMetadata } from './oss-expiry.mjs';

const helper = 'research/practice_acoustic_asset_delivery_v43/sdk-expiry.py';
export function sdkCommand(mode, service = 'quality') {
  assert.ok(['identity', 'characterize'].includes(mode));
  assert.ok(service === 'quality' || (service === 'api' && mode === 'identity'));
  const argv = ['compose', '-f', 'docker-compose.backend-dev.yml', ...(service === 'quality'
    ? ['run', '--rm', '--no-deps', '--pull', 'never', 'quality'] : ['exec', '-T', 'api']), 'python', helper, mode];
  const bytes = requireProcessSuccess(captureProcess('docker', argv, { timeout: 30000 }), 'PINNED_OSS_SDK_' + mode.toUpperCase());
  return JSON.parse(bytes.toString());
}
export function verifySdkEnvironment(expected) {
  const quality = sdkCommand('identity'), runtime = sdkCommand('identity', 'api');
  for (const [name, current] of Object.entries({ quality, runtime })) {
    assert.equal(current.version, expected[name].version, 'PINNED_OSS_VERSION_DRIFT');
    assert.equal(current.packageTreeSha256, expected[name].packageTreeSha256, 'PINNED_OSS_SOURCE_DRIFT');
    assert.deepEqual(current.criticalSources, expected[name].criticalSources);
    assert.ok(Object.values(current.facts).every(Boolean));
  }
  return { quality, runtime };
}
export function characterizeSdk() {
  try {
    const result = sdkCommand('characterize'), runtime = sdkCommand('identity', 'api');
    assert.equal(result.identity.version, '1.4.0'); assert.equal(runtime.version, '1.4.0');
    assert.equal(runtime.packageTreeSha256, result.identity.packageTreeSha256);
    assert.equal(result.networkAttempts, 0); assert.equal(result.syntheticCredentialsOnly, true); assert.equal(result.clockRestored, true);
    assert.ok(result.minimumDeltaMs >= 0 && result.maximumDeltaMs < 2000);
    for (const sample of result.samples) {
      const metadata = { ...sample, receivedAtMs: Date.parse(sample.generationTime) };
      const parsed = validateSignedMetadata(metadata, metadata.receivedAtMs);
      // ECMAScript Date is millisecond precision; Python's source timestamps retain microseconds.
      assert.equal(parsed.deltaMs, Math.floor(sample.deltaMs));
    }
    const ordered = [...result.samples].sort((a, b) => a.deltaMs - b.deltaMs);
    return { result: 'LOCAL_PASS_NOT_CI_HERMETIC_NOT_DELIVERY_EVIDENCE',
      identity: { quality: result.identity, runtime }, networkAttempts: 0, syntheticCredentialsOnly: true, clockRestored: true,
      sampleCount: result.sampleCount, minimumDeltaMs: result.minimumDeltaMs, maximumDeltaMs: result.maximumDeltaMs,
      allSamplesAcceptedByExactBrowserExpiryParser: true, proof: result.proof, clockModules: result.clockModules,
      representativeSamples: [ordered[0], ordered.find(s => s.deltaMs > 1000), ordered.at(-1)],
      integrationScope: 'Exact sanitized temporal and structural fields parsed from real offline SDK URLs; signatures and credential query values never exported',
      characterizationHelper: DIR + '/sdk-expiry.py' };
  } catch (error) { throw Object.assign(error, { safeCode: 'OSS_EXPIRY_CONTRACT_UNRESOLVED' }); }
}
