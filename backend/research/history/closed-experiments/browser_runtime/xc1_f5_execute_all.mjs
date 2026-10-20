#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './xc1_browser_runtime_shared.mjs';
import { runMatrix } from './xc1_stage_a_matrix_runner.mjs';
import { createSeal, verifySeal } from './xc1_stage_a_sealer.mjs';
import { compareEdgeSubset } from './xc1_edge_lane.mjs';
import { runtimeReceipt } from './xc1_runtime_lane.mjs';
import { DEPLOYMENTS, PHASE, atomicJson, fileSha, preflightRunRoot } from './xc1_artifacts.mjs';

const freezePath = process.argv[2];
if (!freezePath) throw new Error('XC1_F5_FREEZE_REQUIRED');
const freeze = JSON.parse(await readFile(freezePath, 'utf8'));
const f5Commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const root = path.join(REPO_ROOT, freeze.runRoot);
await preflightRunRoot(root);
const manifestPath = path.join(REPO_ROOT, freeze.stageAManifestPath);
const base = { manifest: manifestPath, freeze: freezePath, 'f5-commit': f5Commit, 'f5-freeze-sha256': freeze.freezeSha256 };
await runMatrix({ ...base, 'output-root': path.join(root, 'primary_chrome'), channel: 'chrome' });
const sealPath = path.join(root, 'seals/primary_chrome.json');
await createSeal({ manifestPath, predictionRoot: path.join(root, 'primary_chrome/predictions'), output: sealPath,
  f5Commit, freezeSha256: freeze.freezeSha256 });
await verifySeal({ sealPath, manifestPath, f5Commit, freezeSha256: freeze.freezeSha256 });
for (const takeId of freeze.edgeSubsetTakeIds) {
  await runMatrix({ ...base, 'output-root': path.join(root, 'edge'), channel: 'msedge', 'take-id': takeId });
}
const edge = await compareEdgeSubset({ chromeRoot: path.join(root, 'primary_chrome/predictions'),
  edgeRoot: path.join(root, 'edge/predictions'), takeIds: freeze.edgeSubsetTakeIds,
  output: path.join(root, 'edge_parity.json'), f5Commit, freezeSha256: freeze.freezeSha256 });
for (const deployment of edge.fullEdgeExpansionRequired) {
  await runMatrix({ ...base, 'output-root': path.join(root, 'edge'), channel: 'msedge', 'deployment-id': deployment });
}
const runtime = { phase: PHASE, f5Commit, f5FreezeSha256: freeze.freezeSha256, candidates: {} };
for (const takeId of freeze.runtimeSubsetTakeIds) {
  await runMatrix({ ...base, 'output-root': path.join(root, 'runtime'), channel: 'chrome', 'take-id': takeId, 'runtime-mode': 'causal' });
}
for (const deployment of DEPLOYMENTS) {
  const receipts = await Promise.all(freeze.runtimeSubsetTakeIds.map(async takeId => {
    const artifact = JSON.parse(await readFile(path.join(root, 'runtime/predictions', deployment, `${takeId}.json`), 'utf8'));
    return { takeId, ...runtimeReceipt(artifact) };
  }));
  runtime.candidates[deployment] = { schedulingMode: 'causal', xc1DeploymentIdentitySha256: receipts[0].xc1DeploymentIdentitySha256,
    runtimeEligible: receipts.every(receipt => receipt.runtimeEligible), receipts };
}
const runtimePath = path.join(root, 'runtime_report.json');
await atomicJson(runtimePath, runtime);
const image = freeze.dockerScienceImageId;
const linux = file => `/workspace/${path.relative(REPO_ROOT, file).replaceAll('\\', '/')}`;
const command = ['run', '--rm', '-v', `${REPO_ROOT}:/workspace`, '-w', '/workspace', image, 'python', '-m',
  'backend.scripts.phase9g_xc1_r3d_stage_b', '--seal', linux(sealPath), '--manifest', linux(manifestPath),
  '--truth-manifest', `/workspace/${freeze.truthManifestPath}`, '--archive', `/workspace/${freeze.archivePath}`,
  '--runtime', linux(runtimePath), '--truth-reveal', linux(path.join(root, 'truth_reveal.json')),
  '--output', linux(path.join(root, 'stage_b.json')), '--f5-commit', f5Commit, '--f5-freeze-sha256', freeze.freezeSha256];
command.push('--freeze', linux(path.resolve(freezePath)));
execFileSync('docker', command, { stdio: 'inherit' });
await atomicJson(path.join(root, 'execution_receipt.json'), { phase: PHASE, f5Commit, f5FreezeSha256: freeze.freezeSha256,
  command, sealFilesystemSha256: await fileSha(sealPath), runtimeFilesystemSha256: await fileSha(runtimePath),
  stageBFilesystemSha256: await fileSha(path.join(root, 'stage_b.json')) });
console.log('XC1_F5_FULL_SEALED_EXECUTION_COMPLETE');
