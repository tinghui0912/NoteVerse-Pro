#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { materializeSyntheticStageARoot, REPO_ROOT } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, digest, PHASE, DEPLOYMENTS } from './xc1_artifacts.mjs';
import { runMatrix } from './xc1_stage_a_matrix_runner.mjs';
import { createSeal, verifySeal } from './xc1_stage_a_sealer.mjs';
import { runSyntheticRuntime } from './xc1_runtime_lane.mjs';

const root = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, 'backend/data/work/xc1_r3d_validation/production_path'));
const commit = 'NON_SMD_DRY_RUN_NOT_PROSPECTIVE';
const freezeDigest = digest({ fixtureClass: 'NON_SMD_SYNTHETIC', phase: PHASE });
const takes = [];
for (const [takeId, durationMs] of [['non-smd-exact', 4820], ['non-smd-partial', 4200]]) {
  const fixture = await materializeSyntheticStageARoot({ root: path.join(root, 'inputs', takeId), fixtureId: takeId, durationMs });
  takes.push({ ...fixture.take, canonicalPcm: { ...fixture.take.canonicalPcm,
    sourceRelativePath: path.relative(REPO_ROOT, path.join(fixture.root, 'audio/input.pcm')).replaceAll('\\', '/') } });
}
const manifest = { phase: PHASE, fixtureClass: 'NON_SMD_SYNTHETIC', truthFieldsExcluded: true, midiPathsExcluded: true, takes };
const manifestPath = path.join(root, 'manifest.json');
await atomicJson(manifestPath, manifest);
await runMatrix({ manifest: manifestPath, 'output-root': path.join(root, 'matrix'), 'f5-commit': commit,
  'f5-freeze-sha256': freezeDigest, 'synthetic-dry-run': true, 'retain-raw-hops': true });
const sealPath = path.join(root, 'seal.json');
await createSeal({ manifestPath, predictionRoot: path.join(root, 'matrix/predictions'), output: sealPath, f5Commit: commit, freezeSha256: freezeDigest });
await verifySeal({ sealPath, manifestPath, f5Commit: commit, freezeSha256: freezeDigest });
const runtime = await runSyntheticRuntime({ root: path.join(root, 'runtime') });
await atomicJson(path.join(root, 'runtime_bound.json'), { ...runtime, f5Commit: commit, f5FreezeSha256: freezeDigest });
const candidates = {};
for (const deploymentId of DEPLOYMENTS) {
  const artifacts = await Promise.all(takes.map(take => readFile(path.join(root, 'matrix/predictions', deploymentId, `${take.takeId}.json`), 'utf8').then(JSON.parse)));
  const coverage = artifacts.every(artifact => deploymentId === 'online-amt-k8-browser-v1' || (
    artifact.windowCount > 1 && artifact.sessionLoadCount === 1
    && (artifact.ownershipWindows ?? artifact.runtimeRows).at(-1).ownedEndMs === artifact.frozenAcousticInput.scoreableInterval.endMs));
  candidates[deploymentId] = { status: coverage ? 'PASS' : 'FAIL', artifacts: artifacts.map(artifact => ({
    artifactCanonicalSha256: artifact.artifactCanonicalSha256, xc1DeploymentIdentitySha256: artifact.xc1DeploymentIdentitySha256,
    implementationIdentity: artifact.implementationIdentity, sessionLoadCount: artifact.sessionLoadCount,
    actualInferenceSessionRunCount: artifact.actualInferenceSessionRunCount, windowCount: artifact.windowCount,
    totalHopCount: artifact.totalHopCount,
  })) };
}
await atomicJson(path.join(root, 'execution_gate.json'), { phase: PHASE, candidates, sealPath, commit, freezeDigest });
console.log(JSON.stringify({ root, candidates: Object.fromEntries(Object.entries(candidates).map(([key, value]) => [key, value.status])) }));
