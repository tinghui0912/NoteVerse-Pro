#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEPLOYMENTS, PHASE, fileSha, writeArtifact, validateArtifactDigest } from './xc1_artifacts.mjs';
import { REPO_ROOT, safeResolve } from './xc1_browser_runtime_shared.mjs';

export function validatePrediction(artifact, { candidate, take, f5Commit, freezeSha256, allowFailure = false }) {
  validateArtifactDigest(artifact);
  if (artifact.f5Commit !== f5Commit) throw new Error('XC1_SEAL_F5_COMMIT_MISMATCH');
  if (artifact.f5FreezeSha256 !== freezeSha256) throw new Error('XC1_SEAL_FREEZE_DIGEST_MISMATCH');
  if (artifact.deploymentId !== candidate || artifact.takeId !== take.takeId) throw new Error('XC1_SEAL_CELL_IDENTITY_MISMATCH');
  if (allowFailure && artifact.stage === 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_FAILURE' && artifact.status === 'XC1_STAGE_A_CELL_FAILED') return false;
  if (artifact.stage !== 'XC1_STAGE_A_SCIENTIFIC_PREDICTION' || artifact.status !== 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE') {
    throw new Error('XC1_SEAL_REJECTS_ACCEPTANCE_OR_FAILED_ARTIFACT');
  }
  const pcm = artifact.frozenAcousticInput;
  if (pcm?.pcmSha256 !== take.canonicalPcm.sha256 || pcm.byteSize !== take.canonicalPcm.byteSize
    || pcm.sampleCount !== take.canonicalPcm.sampleCount || pcm.sampleRateHz !== 16000
    || pcm.dtype !== 'float32-le-raw' || pcm.sourceAcousticWavSha256 !== take.sourceAcousticWavSha256
    || JSON.stringify(pcm.scoreableInterval) !== JSON.stringify(take.scoreableInterior)) throw new Error('XC1_SEAL_PCM_IDENTITY_MISMATCH');
  if (!(artifact.actualInferenceSessionRunCount > 0) || !Array.isArray(artifact.acousticObservations)) throw new Error('XC1_SEAL_INFERENCE_REQUIRED');
  return true;
}

export async function createSeal({ manifestPath, predictionRoot, output, f5Commit, freezeSha256 }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const cells = [];
  let successful = true;
  for (const candidate of DEPLOYMENTS) {
    const files = (await readdir(path.join(predictionRoot, candidate))).filter(file => file.endsWith('.json')).sort();
    const expectedFiles = manifest.takes.map(take => `${take.takeId}.json`).sort();
    if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) throw new Error('XC1_SEAL_MISSING_OR_DUPLICATE_CELL');
    for (const take of manifest.takes) {
      const file = path.join(predictionRoot, candidate, `${take.takeId}.json`);
      const artifact = JSON.parse(await readFile(file, 'utf8'));
      successful = validatePrediction(artifact, { candidate, take, f5Commit, freezeSha256, allowFailure: true }) && successful;
      cells.push({ candidateId: candidate, takeId: take.takeId, status: artifact.status,
        artifactPath: path.relative(REPO_ROOT, file).replaceAll('\\', '/'), artifactSha256: await fileSha(file),
        artifactCanonicalSha256: artifact.artifactCanonicalSha256 });
    }
  }
  return writeArtifact(output, { phase: PHASE, artifact: 'xc1_stage_a_primary_chrome_seal_manifest',
    f5Commit, f5FreezeSha256: freezeSha256, manifestSha256: await fileSha(manifestPath),
    expectedCellCount: DEPLOYMENTS.length * manifest.takes.length, complete: true, scoreable: successful, cells });
}

export async function verifySeal({ sealPath, manifestPath, f5Commit, freezeSha256 }) {
  const seal = JSON.parse(await readFile(sealPath, 'utf8'));
  validateArtifactDigest(seal);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (seal.f5Commit !== f5Commit || seal.f5FreezeSha256 !== freezeSha256 || !seal.complete || !seal.scoreable
    || seal.manifestSha256 !== await fileSha(manifestPath)) throw new Error('XC1_STAGE_B_INVALID_SEAL');
  const expected = new Map(DEPLOYMENTS.flatMap(candidate => manifest.takes.map(take => [`${candidate}\0${take.takeId}`, { candidate, take }])));
  for (const row of seal.cells) {
    const key = `${row.candidateId}\0${row.takeId}`;
    const cell = expected.get(key);
    if (!cell) throw new Error('XC1_SEAL_DUPLICATE_OR_UNKNOWN_CELL');
    expected.delete(key);
    const file = safeResolve(REPO_ROOT, row.artifactPath);
    if (await fileSha(file) !== row.artifactSha256) throw new Error('XC1_INVALID_EVALUATION_PREDICTION_CHANGED_AFTER_TRUTH_REVEAL');
    validatePrediction(JSON.parse(await readFile(file, 'utf8')), { ...cell, f5Commit, freezeSha256 });
  }
  if (expected.size) throw new Error('XC1_SEAL_MISSING_CELL');
  return { seal, filesystemSha256: await fileSha(sealPath) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].slice(2)] = process.argv[index + 1];
  const options = { manifestPath: args.manifest, predictionRoot: args['prediction-root'], output: args.output,
    sealPath: args.seal, f5Commit: args['f5-commit'], freezeSha256: args['f5-freeze-sha256'] };
  (args.seal ? verifySeal(options) : createSeal(options)).then(value => console.log(JSON.stringify({ complete: true,
    digest: value.artifactCanonicalSha256 ?? value.seal.artifactCanonicalSha256 })))
    .catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
}
