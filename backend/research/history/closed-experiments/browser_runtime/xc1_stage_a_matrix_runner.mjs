#!/usr/bin/env node
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeOfficialXc1StageACell } from './xc1_stage_a_candidate_registry.mjs';
import { REPO_ROOT, safeResolve } from './xc1_browser_runtime_shared.mjs';
import { DEPLOYMENTS, PHASE, atomicJson, preflightRunRoot, writeArtifact, validateArtifactDigest, digest, fileSha } from './xc1_artifacts.mjs';

export function parseArgs(argv) {
  const args = {};
  const allowed = new Set(['manifest', 'output-root', 'f5-commit', 'f5-freeze-sha256', 'freeze', 'channel',
    'deployment-id', 'take-id', 'headed', 'synthetic-dry-run', 'runtime-mode', 'retain-raw-hops']);
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index].slice(2);
    if (!argv[index].startsWith('--') || !allowed.has(key)) throw new Error(`XC1_UNKNOWN_ARGUMENT:${argv[index]}`);
    const value = argv[index + 1];
    args[key] = !value || value.startsWith('--') ? true : argv[++index];
  }
  for (const key of ['manifest', 'output-root', 'f5-commit', 'f5-freeze-sha256']) if (!args[key]) throw new Error(`XC1_MISSING_ARGUMENT:${key}`);
  return args;
}

export async function verifyFreeze(args, manifest) {
  if (args['synthetic-dry-run']) {
    if (manifest.fixtureClass !== 'NON_SMD_SYNTHETIC') throw new Error('XC1_DRY_RUN_REQUIRES_NON_SMD_FIXTURE');
    return;
  }
  if (!args.freeze) throw new Error('XC1_F5_FREEZE_REQUIRED');
  const freeze = JSON.parse(await readFile(args.freeze, 'utf8'));
  const { freezeSha256, ...content } = freeze;
  if (digest(content) !== freezeSha256 || freezeSha256 !== args['f5-freeze-sha256']) throw new Error('XC1_FREEZE_DIGEST_MISMATCH');
  if (await fileSha(args.manifest) !== freeze.stageAManifestSha256) throw new Error('XC1_FROZEN_MANIFEST_DRIFT');
  for (const [file, sha] of Object.entries(freeze.sourceHashBoundary)) {
    if (await fileSha(safeResolve(REPO_ROOT, file)) !== sha) throw new Error(`XC1_FROZEN_SOURCE_DRIFT:${file}`);
  }
  for (const [file, sha] of Object.entries(freeze.assetHashBoundary)) {
    if (await fileSha(safeResolve(REPO_ROOT, file)) !== sha) throw new Error(`XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:${file}`);
  }
  const git = (...command) => execFileSync('git', command, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== args['f5-commit'] || git('status', '--porcelain')) throw new Error('XC1_REQUIRES_CLEAN_F5_CHECKOUT');
  const remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (remote !== args['f5-commit']) throw new Error('XC1_F5_NOT_REMOTE_HEAD');
}

export async function runMatrix(args) {
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
  if (!manifest.truthFieldsExcluded || !manifest.midiPathsExcluded) throw new Error('XC1_SANITIZED_MANIFEST_REQUIRED');
  await verifyFreeze(args, manifest);
  const outputRoot = path.resolve(args['output-root']);
  await preflightRunRoot(outputRoot);
  const candidates = args['deployment-id'] ? [args['deployment-id']] : DEPLOYMENTS;
  const takes = args['take-id'] ? manifest.takes.filter(take => take.takeId === args['take-id']) : manifest.takes;
  if (!takes.length || candidates.some(candidate => !DEPLOYMENTS.includes(candidate))) throw new Error('XC1_INVALID_MATRIX_SELECTION');
  const summary = { phase: PHASE, f5Commit: args['f5-commit'], f5FreezeSha256: args['f5-freeze-sha256'],
    expectedCellCount: candidates.length * takes.length, cells: [] };
  for (const deploymentId of candidates) for (const take of takes) {
    const outputPath = path.join(outputRoot, 'predictions', deploymentId, `${take.takeId}.json`);
    const exists = await stat(outputPath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    if (exists) {
      const prior = JSON.parse(await readFile(outputPath, 'utf8'));
      validateArtifactDigest(prior);
      if (prior.f5Commit !== args['f5-commit'] || prior.f5FreezeSha256 !== args['f5-freeze-sha256']
        || prior.status !== 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE') throw new Error('XC1_RESUME_IDENTITY_MISMATCH');
      summary.cells.push({ deploymentId, takeId: take.takeId, status: prior.status, resumed: true }); continue;
    }
    const cellRoot = path.join(outputRoot, 'audio_only_cells', deploymentId, take.takeId);
    await mkdir(path.join(cellRoot, 'audio'), { recursive: true });
    await copyFile(safeResolve(REPO_ROOT, take.canonicalPcm.sourceRelativePath), path.join(cellRoot, 'audio/input.pcm'));
    const cellManifestPath = path.join(cellRoot, 'manifest.json');
    const cellManifest = { fixtureClass: manifest.fixtureClass, takes: [{ takeId: take.takeId,
      sourceAcousticWavSha256: take.sourceAcousticWavSha256,
      canonicalPcm: { ...take.canonicalPcm, sourceRelativePath: undefined, relativeStageAPath: 'audio/input.pcm' },
      scoreableInterior: take.scoreableInterior }] };
    await atomicJson(cellManifestPath, cellManifest, { immutable: false });
    try {
      const receipt = await executeOfficialXc1StageACell({ deploymentId, takeId: take.takeId, stageARoot: cellRoot,
        stageAManifestPath: cellManifestPath, outputPath, browserChannel: args.channel ?? 'chrome', headed: true,
        evidenceMode: 'scientific_prediction', f5Commit: args['f5-commit'], f5FreezeSha256: args['f5-freeze-sha256'],
        implementationCommit: manifest.implementationCommit, candidateIdentity: manifest.candidateIdentities?.[deploymentId],
        runtimeMode: args['runtime-mode'] ?? 'accelerated', retainRawHops: Boolean(args['retain-raw-hops']) });
      summary.cells.push({ deploymentId, takeId: take.takeId, status: receipt.status });
      console.log(`${summary.cells.length}/${summary.expectedCellCount} ${deploymentId} ${take.takeId} COMPLETE`);
    } catch (error) {
      const failure = { phase: PHASE, stage: 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_FAILURE', status: 'XC1_STAGE_A_CELL_FAILED',
        deploymentId, takeId: take.takeId, f5Commit: args['f5-commit'], f5FreezeSha256: args['f5-freeze-sha256'],
        frozenAcousticInput: take.canonicalPcm, error: String(error.stack ?? error) };
      await writeArtifact(outputPath, failure);
      await writeArtifact(path.join(outputRoot, 'failures', `${deploymentId}__${take.takeId}.json`), failure);
      summary.cells.push({ deploymentId, takeId: take.takeId, status: failure.status });
      await atomicJson(path.join(outputRoot, 'summary/matrix.json'), summary, { immutable: false });
      throw new Error(`XC1_PRIMARY_MATRIX_FAIL_FAST:${error.stack ?? error}`);
    }
    await atomicJson(path.join(outputRoot, 'summary/matrix.json'), summary, { immutable: false });
  }
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMatrix(parseArgs(process.argv)).catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
}
