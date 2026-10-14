#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { REPO_ROOT } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, digest, PHASE, fileSha } from './xc1_artifacts.mjs';
import { verifySeal } from './xc1_stage_a_sealer.mjs';

const relativeRoot = process.argv[2] ?? 'backend/data/work/xc1_r3d_validation/dry_run_final';
const root = path.join(REPO_ROOT, relativeRoot);
const commit = 'NON_SMD_DRY_RUN_NOT_PROSPECTIVE';
const freezeDigest = digest({ fixtureClass: 'NON_SMD_SYNTHETIC', phase: PHASE });
const receipts = [];
function command(executable, argv) {
  const start = Date.now();
  const stdout = execFileSync(executable, argv, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  receipts.push({ executable, argv, exitCode: 0, elapsedMs: Date.now() - start, stdout });
  console.log(stdout);
}
command(process.execPath, ['backend/research/browser_runtime/xc1_r3d_validation.mjs', root]);
const sealPath = path.join(root, 'seal.json'), manifestPath = path.join(root, 'manifest.json');
const verifyOptions = { sealPath, manifestPath, f5Commit: commit, freezeSha256: freezeDigest };
await verifySeal(verifyOptions);
const prediction = path.join(root, 'matrix/predictions/robust-browser-v1/non-smd-exact.json');
const original = await readFile(prediction);
try {
  await writeFile(prediction, Buffer.concat([original, Buffer.from(' ')]));
  await assert.rejects(() => verifySeal(verifyOptions), /PREDICTION_CHANGED/);
} finally { await writeFile(prediction, original); }
await verifySeal(verifyOptions);
const image = execFileSync('docker', ['image', 'inspect', 'noteverse-xc1-r3d-science:local', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
const mount = `${REPO_ROOT}:/workspace`, linuxRoot = `/workspace/${relativeRoot.replaceAll('\\', '/')}`;
const docker = argv => command('docker', ['run', '--rm', '-v', mount, '-w', '/workspace', image, 'python', '-m', ...argv]);
docker(['backend.scripts.phase9g_xc1_r3d_synthetic_truth', '--root', linuxRoot]);
docker(['backend.scripts.phase9g_xc1_r3d_stage_b', '--seal', `${linuxRoot}/seal.json`, '--manifest', `${linuxRoot}/manifest.json`,
  '--truth-manifest', `${linuxRoot}/truth_manifest.json`, '--archive', `${linuxRoot}/synthetic_truth.zip`,
  '--runtime', `${linuxRoot}/runtime_bound.json`, '--truth-reveal', `${linuxRoot}/truth_reveal.json`,
  '--output', `${linuxRoot}/stage_b.json`, '--f5-commit', commit, '--f5-freeze-sha256', freezeDigest]);
const stageB = JSON.parse(await readFile(path.join(root, 'stage_b.json'), 'utf8'));
assert.equal(stageB.primary50ms.length, 6);
assert.ok(Object.values(stageB.pairedBootstrap).every(row => row.draws === 5000 && row.seed === 13371));
await atomicJson(path.join(root, 'complete_dry_run_report.json'), { phase: PHASE,
  status: 'R3D_PRODUCTION_PATH_COMPLETE_DRY_RUN_PASS', dockerImageId: image, receipts,
  sealMutationDetection: 'PASS', sealFilesystemSha256: await fileSha(sealPath),
  scoresFilesystemSha256: await fileSha(path.join(root, 'stage_b.json')), truthReveal: stageB.truthReveal,
  primaryMetricRows: stageB.primary50ms.length, pairedBootstrap: stageB.pairedBootstrap,
  scientificDryRunDisposition: stageB.scientificFrontRunnerDecision });
console.log('R3D_PRODUCTION_PATH_COMPLETE_DRY_RUN_PASS');
