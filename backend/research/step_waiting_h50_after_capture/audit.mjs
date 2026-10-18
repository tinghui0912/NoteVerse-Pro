import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const directory = 'backend/research/step_waiting_h50_after_capture';
const output = path.join(ROOT, 'backend/data/work/step_waiting_h50_after_capture/preflight');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async file => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
const contract = await json(directory + '/contract.json');
const jobsFile = 'backend/data/work/step_waiting_topology_v3/corpus-v4/audio_only/jobs.json';
const truthFile = 'backend/data/work/step_waiting_topology_v3/corpus-v4/truth.json';
const jobs = (await json(jobsFile)).jobs, truth = (await json(truthFile)).cases;
const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await mkdir(output, {recursive: true});
await esbuild.build({entryPoints: [path.join(ROOT, directory, 'input-preservation.ts')], outfile: path.join(output, 'dsp.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24'});
const {adapted, containingWindow, phaseWindow, realWindow} = await import(pathToFileURL(path.join(output, 'dsp.mjs')).href);
const executionStartedAt = new Date().toISOString(), results = [];
for (const job of jobs) {
  const physical = truth.find(t => t.id === job.id);
  if (physical.intendedTime === null) continue;
  const bytes = await readFile(path.join(ROOT, job.path));
  if (hash(bytes) !== job.sha256 || bytes.length !== job.bytes) throw Error('FIXED_PCM_IDENTITY_CHANGED:' + job.path);
  const pcm = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const firPath = `apps/customer-web/public/model-assets/practice-acoustic/${job.rate === 44100 ? 'fir-160-441' : 'fir-1-3'}.f32`;
  const coefficients = await readFile(path.join(ROOT, firPath));
  const target = await adapted(pcm, job.rate, coefficients);
  const eventSource = Math.round(physical.intendedTime * job.rate) - job.sourceOriginSample;
  const eventTarget = eventSource * 16000 / job.rate;
  const frozenBounds = containingWindow((job.regionStartSourceSample - job.sourceOriginSample) * 16000 / job.rate, eventTarget);
  const referenceSha256 = hash(new Uint8Array(realWindow(target, frozenBounds).buffer));
  const phases = [];
  const prefixSamples = job.rate * 6;
  const warmed = new Float32Array(prefixSamples + pcm.length);
  warmed.set(pcm, prefixSamples);
  const warmedTarget = await adapted(warmed, job.rate, coefficients);
  const shiftTarget = prefixSamples * 16000 / job.rate;
  for (const phase of contract.phases) {
    const bounds = phaseWindow(eventTarget, phase);
    const phaseReferenceSha256 = hash(new Uint8Array(realWindow(target, bounds).buffer));
    const shifted = {start: bounds.start + shiftTarget, end: bounds.end + shiftTarget};
    const candidateSha256 = hash(new Uint8Array(realWindow(warmedTarget, shifted).buffer));
    phases.push({phase: phase.id, eventOffsetMs: phase.eventOffsetMs, bounds, sha256: candidateSha256,
      phaseReferenceSha256, prefixSamples, shiftTarget,
      sameFrozenModelInput: candidateSha256 === phaseReferenceSha256,
      inputStartDeltaTargetSamples: bounds.start - frozenBounds.start});
  }
  results.push({id: job.id, sourceRateHz: job.rate, recordingId: physical.source.recordingId,
    pcm: {path: job.path, sha256: job.sha256, bytes: job.bytes}, originalAudioSha256: physical.source.audioSha256,
    midiSha256: physical.source.midiSha256, eventSource, eventTarget, frozenBounds, referenceSha256, phases});
}
const changedProduction = execFileSync('git', ['diff', '--name-only', contract.startingHead, '--', 'apps/customer-web/src', 'apps/customer-web/public', 'backend/app'], {cwd: ROOT, encoding: 'utf8'}).trim();
if (changedProduction) throw Error('PRODUCT_SOURCE_CHANGED:' + changedProduction);
const receipt = {phase: contract.phase, startingHead: contract.startingHead, executionStartedAt, completedAt: new Date().toISOString(),
  executionKind: 'PRE_FREEZE_DSP_ONLY_FEASIBILITY_AUDIT_NOT_QUALIFICATION',
  contractSha256: hash(await readFile(path.join(ROOT, directory, 'contract.json'))),
  jobsManifestSha256: hash(await readFile(path.join(ROOT, jobsFile))), truthManifestSha256: hash(await readFile(path.join(ROOT, truthFile))),
  cases: truth.length, rateJobs: jobs.length, positiveRateJobs: results.length,
  results, actualNeuralRuns: 0, productionDiff: changedProduction,
  inputMismatches: results.flatMap(r => r.phases.filter(p => !p.sameFrozenModelInput).map(p => ({id:r.id, rate:r.sourceRateHz, ...p}))),
  qualificationStarted: false, acousticOutputOpened: false};
await writeFile(path.join(output, 'input-preservation.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({cases: receipt.cases, positiveRateJobs: results.length, inputMismatches: receipt.inputMismatches.length,
  firstMismatch: receipt.inputMismatches[0], neuralRuns: 0, receipt: path.relative(ROOT, path.join(output, 'input-preservation.json'))}));
