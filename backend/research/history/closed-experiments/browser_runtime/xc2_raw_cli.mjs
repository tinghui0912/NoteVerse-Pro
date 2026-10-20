import { readFile } from 'node:fs/promises';
import { executeXc2Raw } from './xc2_raw_browser.mjs';
import { fileSha, digest } from './xc1_artifacts.mjs';
import { atomicJson } from './xc1_artifacts.mjs';
import { execFileSync } from 'node:child_process';
const args = {};
const allowed = new Set(['freeze', 'clip-id', 'resampler', 'owned-ms', 'future-ms', 'ort', 'decoders', 'output']);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].slice(2); if (!allowed.has(key)) throw new Error('XC2_UNKNOWN_EXECUTION_ARGUMENT');
  args[key] = process.argv[i + 1];
}
const freeze = JSON.parse(await readFile(args.freeze, 'utf8'));
const { freezeSha256, ...content } = freeze;
if (digest(content) !== freezeSha256) throw new Error('XC2_FREEZE_DIGEST');
for (const [file, sha] of Object.entries(freeze.sourceHashBoundary)) if (await fileSha(file) !== sha) throw new Error(`XC2_FROZEN_SOURCE_DRIFT:${file}`);
if (await fileSha(freeze.audioManifestPath) !== freeze.audioManifestSha256) throw new Error('XC2_AUDIO_MANIFEST_DRIFT');
const manifest = JSON.parse(await readFile(freeze.audioManifestPath, 'utf8'));
const clip = manifest.clips.find(row => row.clipId === args['clip-id']);
if (!clip || !['LINEAR', 'BAND_LIMITED'].includes(args.resampler)
  || ![320, 400, 500, 600].includes(Number(args['owned-ms'])) || ![120, 170, 220].includes(Number(args['future-ms']))) throw new Error('XC2_UNKNOWN_FROZEN_CONFIGURATION');
if ((args.decoders ?? 'A,B,C').split(',').some(id => !['A', 'B', 'C'].includes(id))) throw new Error('XC2_UNKNOWN_FROZEN_DECODER');
const runtimePrefix = args.ort === '1.30.0' ? 'backend/research/browser_runtime/dr3r_browser_runtime/' : 'backend/research/browser_runtime/xc1_ort120_runtime/';
for (const [file, sha] of Object.entries(freeze.runtimeAssets).filter(([file]) => file.startsWith(runtimePrefix))) if (await fileSha(file) !== sha) throw new Error('XC2_ORT_ASSET_DRIFT');
if (clip.split === 'EVALUATION') {
  const shortlist = JSON.parse(await readFile(freeze.evaluationShortlistPath, 'utf8'));
  const { shortlistSha256, ...selection } = shortlist;
  if (digest(selection) !== shortlistSha256 || shortlist.protocolFreezeSha256 !== freezeSha256) throw new Error('XC2_SHORTLIST_REQUIRED');
  const permitted = shortlist.candidates.filter(c => c.resampler === args.resampler && c.ownedMs === Number(args['owned-ms']) && c.futureMs === Number(args['future-ms'])).map(c => c.decoder);
  if ((args.decoders ?? '').split(',').some(id => !permitted.includes(id))) throw new Error('XC2_NON_SHORTLIST_EVALUATION_FORBIDDEN');
  execFileSync('git', ['ls-files', '--error-unmatch', freeze.evaluationShortlistPath], { stdio: 'pipe' });
}
if (args.ort === '1.30.0') {
  if (clip.clipId !== manifest.clips.find(c => c.split === 'DEVELOPMENT').clipId || args.resampler !== 'LINEAR'
    || args['owned-ms'] !== '600' || args['future-ms'] !== '220' || args.decoders !== 'A') throw new Error('XC2_ORT130_CONTROL_ONLY');
  await atomicJson(`${freeze.runRoot}/ort130_execution_reservation.json`, { clipId: clip.clipId, output: args.output, maximumExecutions: 1 });
}
const result = await executeXc2Raw({ clip, resampler: args.resampler, ownedMs: Number(args['owned-ms']), futureMs: Number(args['future-ms']),
  ortVersion: args.ort ?? '1.20.1', decoders: (args.decoders ?? 'A,B,C').split(','), output: args.output });
console.log(JSON.stringify({ status: result.status, clipId: clip.clipId, actualSessionRunCount: result.runtime.actualSessionRunCount }));
