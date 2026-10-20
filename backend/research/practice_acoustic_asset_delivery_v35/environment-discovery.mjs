import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'backend/research/reports/practice_acoustic_asset_delivery_v35');
const START = '3d36e39cb9857d8b170f18a1d0cee9744296fa7f';
const branch = 'codex/customer-web-delivery-boundary';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, shell: false, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const present = value => typeof value === 'string' && value.trim().length > 0;
const usable = value => present(value) && !/^(?:test(?:[-_].*)?|example(?:[-_].*)?|your[-_].*|change[-_]?me|placeholder|minioadmin|dev(?:elopment)?[-_].*)$/i.test(value.trim());
const opaque = env => ({
  ossCredentialPairPresent: usable(env.OSS_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID) && usable(env.OSS_ACCESS_KEY_SECRET ?? env.S3_SECRET_ACCESS_KEY),
  credentialPairNonempty: present(env.OSS_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID) && present(env.OSS_ACCESS_KEY_SECRET ?? env.S3_SECRET_ACCESS_KEY),
  modelBucketConfigured: present(env.ALIYUN_OSS_MODEL_BUCKET), modelRegionConfigured: present(env.ALIYUN_OSS_MODEL_REGION),
  authCookieContractConfigured: present(env.AUTH_COOKIE_NAME) && present(env.REFRESH_COOKIE_NAME),
  databaseConfigurationPresent: Object.keys(env).some(k => /^(?:DATABASE_URL|ASYNC_DATABASE_URL|POSTGRES_SERVER|DB_HOST)$/.test(k) && present(env[k])),
  legitimateTestLoginSupplied: present(env.V35_TEST_LOGIN_EMAIL) && present(env.V35_TEST_LOGIN_PASSWORD),
  existingBrowserSessionPathSupplied: present(env.V35_AUTH_STORAGE_STATE),
  backendOriginSupplied: present(env.V35_BACKEND_ORIGIN), customerWebOriginSupplied: present(env.V35_CUSTOMER_WEB_ORIGIN)
});

// No subprocess receives configuration values. No backend import, request, signing or model access.
const inventory = git('ls-tree', '-r', '--name-only', START).split('\n').filter(Boolean);
const required = [
  'apps/customer-web/src/lib/api/practice-acoustic-model-asset.ts',
  'apps/customer-web/src/lib/practice/step/step-microphone-platform.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts',
  'apps/customer-web/src/lib/practice/acoustic/model/worker-client.ts',
  'apps/customer-web/src/lib/model-assets/model-asset-store.ts',
  'apps/customer-web/src/lib/model-assets/verified-model-asset-loader.ts',
  'backend/app/modules/model_assets/router.py', 'backend/app/modules/model_assets/service.py',
  'backend/app/modules/model_assets/schemas.py', 'backend/app/core/settings/model_asset_delivery.py',
  'backend/tests/test_practice_acoustic_model_asset.py', 'backend/tests/test_model_assets.py'
];
const missing = required.filter(p => !inventory.includes(p));
if (git('rev-parse', 'HEAD') !== START || git('rev-parse', 'origin/' + branch) !== START || missing.length) throw Error('V35_START_OR_REQUIRED_SOURCE_INVENTORY_FAILURE');
const observations = [{ source: 'INHERITED_PROCESS_ENVIRONMENT', facts: opaque(process.env) }];
// These configuration filenames were discovered by directory enumeration, not guessed.
for (const filename of ['backend/.env.docker', 'backend/.env.docker.control-plane', 'backend/.env.docker.worker']) {
  const parsed = parseEnv(await readFile(path.join(ROOT, filename), 'utf8'));
  observations.push({ source: filename, facts: opaque({ ...parsed, ...process.env }), valuesNeverPersisted: true });
}
const credentialAvailability = observations.some(o => o.facts.ossCredentialPairPresent);
const accountAvailability = observations.some(o => o.facts.legitimateTestLoginSupplied || o.facts.existingBrowserSessionPathSupplied);
const originAvailability = observations.some(o => o.facts.backendOriginSupplied && o.facts.customerWebOriginSupplied);
const ready = credentialAvailability && accountAvailability && originAvailability;
const report = { startingHead: START, observedAt: new Date().toISOString(), requiredPaths: required, requiredPathsMissing: missing,
  sourceInventoryValidatedBeforeReads: true, observations,
  availability: { realOssCredentialPairAvailable: credentialAvailability, suppliedLegitimateAuthMaterialAvailable: accountAvailability,
    explicitlyIdentifiedBackendAndWebOriginsAvailable: originAvailability },
  conclusion: ready ? 'AVAILABILITY_ONLY_NOT_EXECUTION_AUTHORIZATION' : 'REQUIRED_REAL_DELIVERY_ENVIRONMENT_NOT_ESTABLISHED',
  disposition: ready ? null : 'PRACTICE_ACOUSTIC_V35_MODEL_ASSET_DELIVERY_EXECUTION_INTEGRITY_BLOCKED',
  productionDefectEstablished: false,
  counts: { accessRequests: 0, signedUrlsCreated: 0, ossModelGets: 0, browserLaunches: 0, modelSessions: 0, inferenceRuns: 0 },
  noSecretsPersisted: true, noEnvironmentFilesModified: true, noRepairOrRetryIfBlocked: true };
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'environment-availability.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
if (!ready) process.exitCode = 1;
