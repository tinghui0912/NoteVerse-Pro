import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  ACOUSTIC_RUNTIME_CONTRACT as runtime,
  ACOUSTIC_ANALYSIS_IDENTITY as identity,
} from './generated/runtime-contract';
import { assertAcousticRuntimeIdentity, canonicalJson } from './identity';
import type declaredEvidence from '../../../../../../contracts/practice/acoustic/evidence-attestation.json';
import {
  sourceRate,
  sourceAdapterContract,
} from './source/source-adapter-contract';

const root = path.resolve('../..');
const evidence: typeof declaredEvidence = JSON.parse(
  readFileSync(
    path.join(root, 'contracts/practice/acoustic/evidence-attestation.json'),
    'utf8',
  ),
);
const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const normalized = (raw: Buffer) =>
  Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

it('binds the canonical runtime and selected evidence through a deterministic composite identity', async () => {
  const contract = JSON.parse(
    readFileSync(
      path.join(root, 'contracts/practice/acoustic/runtime-contract.json'),
      'utf8',
    ),
  );
  expect(runtime).toEqual(contract);
  expect(digest(canonicalJson(contract))).toBe(identity.runtimeContractSha256);
  expect(digest(canonicalJson(evidence))).toBe(
    identity.evidenceAttestationSha256,
  );
  expect(
    digest(
      canonicalJson({
        runtimeContractSha256: identity.runtimeContractSha256,
        evidenceAttestationSha256: identity.evidenceAttestationSha256,
      }),
    ),
  ).toBe(identity.analysisIdentitySha256);
  await expect(assertAcousticRuntimeIdentity()).resolves.toBeUndefined();
  expect(Object.isFrozen(runtime.input.shape)).toBe(true);
  expect(Object.isFrozen(identity)).toBe(true);
  expect(identity.identityName).toBe(
    `${runtime.model.assetId}@${runtime.model.assetVersion}`,
  );
});

it('requires the installed package declaration to match the configured ORT version', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(pkg.dependencies[runtime.runtime.packageName]).toBe(
    runtime.runtime.packageVersion,
  );
});

it.each(Object.entries(evidence.sourceFiles))(
  '%s attests current normalized implementation bytes',
  (_role, entry) => {
    const bytes = normalized(readFileSync(path.join(root, entry.path)));
    expect(bytes.length).toBe(entry.byteSize);
    expect(digest(bytes)).toBe(entry.sha256);
  },
);

it.each(evidence.coefficientAssets)(
  '$sourceRateHz attests exact raw FIR bytes and the rate-specific composition',
  ({ sourceRateHz }) => {
    const contract = sourceAdapterContract(sourceRate(sourceRateHz));
    const bytes = readFileSync(path.join(root, contract.coefficientAsset.path));
    expect(bytes.length).toBe(contract.coefficientAsset.byteSize);
    expect(digest(bytes)).toBe(contract.coefficientAsset.sha256);
    const { identitySha256, ...facts } = contract;
    expect(digest(canonicalJson(facts))).toBe(identitySha256);
    expect(contract.analysisIdentitySha256).toBe(
      identity.analysisIdentitySha256,
    );
    expect(contract.sourceRateHz * contract.up).toBe(
      runtime.input.sampleRateHz * contract.down,
    );
    expect(contract.tapCount).toBe(
      bytes.length / Float32Array.BYTES_PER_ELEMENT,
    );
  },
);

it('normalizes only CRLF in source evidence, preserving BOM, spaces and standalone CR', () => {
  expect(normalized(Buffer.from('\ufeffsource  \r\nend\r'))).toEqual(
    Buffer.from('\ufeffsource  \nend\r'),
  );
  const binary = Buffer.from([13, 10, 0, 255]);
  expect(digest(binary)).not.toBe(digest(normalized(binary)));
});
