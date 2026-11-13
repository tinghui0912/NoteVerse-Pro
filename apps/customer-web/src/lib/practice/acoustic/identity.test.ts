import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  ACOUSTIC_RUNTIME_CONTRACT as runtime,
  ACOUSTIC_ANALYSIS_IDENTITY as identity,
} from './generated/runtime-contract';
import { assertAcousticRuntimeIdentity, canonicalJson } from './identity';
import {
  sourceRate,
  sourceAdapterContract,
} from './source/source-adapter-contract';

const root = path.resolve('../..');
const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

it('identifies the full canonical configured runtime independently of object key order', async () => {
  const contract = JSON.parse(
    readFileSync(
      path.join(root, 'contracts/practice/acoustic/runtime-contract.json'),
      'utf8',
    ),
  );
  expect(runtime).toEqual(contract);
  expect(Object.keys(identity).sort()).toEqual([
    'analysisIdentitySha256',
    'identityName',
  ]);
  expect(digest(canonicalJson(contract))).toBe(identity.analysisIdentitySha256);
  expect(
    digest(
      canonicalJson(Object.fromEntries(Object.entries(contract).reverse())),
    ),
  ).toBe(identity.analysisIdentitySha256);
  await expect(assertAcousticRuntimeIdentity()).resolves.toBeUndefined();
  expect(Object.isFrozen(runtime.input.shape)).toBe(true);
  expect(Object.isFrozen(identity)).toBe(true);
  expect(identity.identityName).toBe(
    `${runtime.model.assetId}@${runtime.model.assetVersion}`,
  );
  const changed = {
    ...runtime,
    decoder: { ...runtime.decoder, onsetThreshold: 0.31 },
  };
  expect(digest(canonicalJson(changed))).not.toBe(
    identity.analysisIdentitySha256,
  );
});

it('rejects runtime self-integrity mismatch', async () => {
  const hash = vi
    .spyOn(crypto.subtle, 'digest')
    .mockResolvedValueOnce(new ArrayBuffer(32));
  try {
    await expect(assertAcousticRuntimeIdentity()).rejects.toThrow(
      'ACOUSTIC_IDENTITY_DRIFT',
    );
  } finally {
    hash.mockRestore();
  }
});

it('requires the installed package declaration to match the configured ORT version', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(pkg.dependencies[runtime.runtime.packageName]).toBe(
    runtime.runtime.packageVersion,
  );
});

it.each(Object.keys(runtime.sourceAdapters))(
  '%s binds exact FIR bytes and adapter-local geometry',
  (rate) => {
    const contract = sourceAdapterContract(sourceRate(Number(rate)));
    const bytes = readFileSync(path.join(root, contract.coefficientAsset.path));
    expect(bytes.length).toBe(contract.coefficientAsset.byteSize);
    expect(digest(bytes)).toBe(contract.coefficientAsset.sha256);
    const { identitySha256, ...facts } = contract;
    expect(Object.keys(facts).sort()).toEqual([
      'coefficientAsset',
      'coefficientUrl',
      'down',
      'firstFullyRealOutputIndex',
      'realSourceLookaheadSamples',
      'sourceRateHz',
      'tapCount',
      'targetRateHz',
      'up',
    ]);
    expect(digest(canonicalJson(facts))).toBe(identitySha256);
    expect(contract.sourceRateHz * contract.up).toBe(
      contract.targetRateHz * contract.down,
    );
    expect(contract.tapCount).toBe(
      bytes.length / Float32Array.BYTES_PER_ELEMENT,
    );
  },
);
