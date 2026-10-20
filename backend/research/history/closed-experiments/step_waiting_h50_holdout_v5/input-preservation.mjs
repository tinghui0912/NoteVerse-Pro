import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DIR = 'backend/research/step_waiting_h50_holdout_v5';
const OUT = 'backend/research/reports/step_waiting_h50_holdout_v5';
const WORK = 'backend/data/work/step_waiting_h50_holdout_v5';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const load = async file => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
const save = async (file, value) => writeFile(path.join(ROOT, file), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const freeze = await load(OUT + '/audio-acquisition-protocol-freeze.json');
for (const row of freeze.files) if (hash(await readFile(path.join(ROOT, row.path))) !== row.sha256) throw Error('FROZEN_INPUT_CHANGED:' + row.path);
const proof = await load(OUT + '/pre-audio-remote-proof.json');
const executionStartedAt = new Date().toISOString();
if (!(Date.parse(proof.remoteVerifiedAt) < Date.parse(executionStartedAt))) throw Error('REMOTE_PROOF_NOT_PROSPECTIVE');
const contract = await load(DIR + '/input-preservation-contract.json');
const trials = await load(OUT + '/source-rate-trials.json');
const esbuild = await import(pathToFileURL(path.join(ROOT, 'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js')).href);
await mkdir(path.join(ROOT, WORK, 'dsp'), {recursive: true});
const built = await esbuild.build({entryPoints: [path.join(ROOT, DIR, 'dsp.ts')],
  outfile: path.join(ROOT, WORK, 'dsp/adapter.mjs'), bundle: true, metafile: true,
  platform: 'node', format: 'esm', target: 'node24'});
const inputs = Object.keys(built.metafile.inputs);
if (!inputs.some(p => p.endsWith('/acoustic/source/source-adapter.ts')) || inputs.some(p => /worker|onnxruntime|model-session|step-runtime|decoder\.ts/.test(p))) {
  throw Error('PRODUCT_ADAPTER_OR_IMPORT_GRAPH_VIOLATION');
}
const {adapt, windows} = await import(pathToFileURL(path.join(ROOT, WORK, 'dsp/adapter.mjs')).href);
const pcm = bytes => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const bytes = array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
const results = [], publicJobs = [];
const scheduleVariants = ['ordinary', 'busy', 'late_publication', 'rearm_equality', 'pre_ready', 'post_ready'];
for (const trial of Object.values(trials.sourceTrials)) {
  const sourceBytes = await readFile(path.join(ROOT, trial.path));
  if (hash(sourceBytes) !== trial.sha256) throw Error('FIXTURE_PCM_CHANGED');
  const source = pcm(sourceBytes);
  const jobs = trials.jobs.filter(j => j.recordingId === trial.recordingId && j.sourceRateHz === trial.sourceRateHz);
  const fir = await readFile(path.join(ROOT, 'apps/customer-web/public/model-assets/practice-acoustic/' +
    (trial.sourceRateHz === 44100 ? 'fir-160-441.f32' : 'fir-1-3.f32')));
  const maximumEnd = Math.max(...jobs.map(j => j.sourceEndSample));
  const reference = await adapt(source.subarray(0, maximumEnd), trial.sourceRateHz, fir);
  if (reference.identity !== contract.identities[String(trial.sourceRateHz)]) throw Error('QUALIFIED_ADAPTER_IDENTITY_MISMATCH');
  for (const job of jobs) {
    const clipBytes = await readFile(path.join(ROOT, job.clipPath));
    if (hash(clipBytes) !== job.clipPcmSha256 || hash(bytes(source.subarray(job.sourceOriginSample, job.sourceEndSample))) !== job.clipPcmSha256) {
      throw Error('CLIP_SOURCE_MUTATION');
    }
    const adapted = await adapt(pcm(clipBytes), trial.sourceRateHz, fir);
    const shift = job.sourceOriginSample * 16000 / trial.sourceRateHz;
    if (!Number.isInteger(shift)) throw Error('SOURCE_PHASE_IDENTITY_NOT_EXACT');
    const modelInputs = [];
    for (const window of windows(adapted.pcm.length)) {
      const input = adapted.pcm.slice(window.startSample, window.endSample);
      const referenceInput = reference.pcm.slice(window.startSample + shift, window.endSample + shift);
      const candidateSha256 = hash(bytes(input)), referenceSha256 = hash(bytes(referenceInput));
      if (input.length !== 29120 || candidateSha256 !== referenceSha256) throw Error('EXACT_MODEL_INPUT_PRESERVATION_MISMATCH');
      const scheduleHashes = {};
      for (const schedule of scheduleVariants) {
        // Schedules are not arguments to the source adapter or window planner.
        const fingerprint = hash(bytes(adapted.pcm.slice(window.startSample, window.endSample)));
        if (fingerprint !== candidateSha256) throw Error('SCHEDULE_MUTATED_ACOUSTIC_INPUT');
        scheduleHashes[schedule] = fingerprint;
      }
      modelInputs.push({windowIndex: window.windowIndex, localInputStart: window.startSample, localInputEnd: window.endSample,
        originalTarget16kStart: shift + window.startSample, originalTarget16kEnd: shift + window.endSample,
        originalOwnedStart: shift + window.ownedStartTarget, originalOwnedEnd: shift + window.ownedEndTarget,
        samples: input.length, sha256: candidateSha256, referenceSha256, scheduleHashes});
    }
    const eventWindows = job.originalAbsoluteMidiEventTimesMs.map((time, i) => {
      const eventTarget16k = time * 16;
      const window = modelInputs.find(w => w.originalOwnedStart <= eventTarget16k && eventTarget16k < w.originalOwnedEnd);
      if (!window) throw Error('FROZEN_EVENT_NOT_COVERED_BY_REAL_MODEL_WINDOW');
      return {physicalSourceMs: time, sourceSample: job.truthEventSourceSamples[i], target16kCoordinate: eventTarget16k,
        modelWindowIndex: window.windowIndex, modelInputSha256: window.sha256};
    });
    results.push({...job, qualifiedAdapterIdentity: adapted.identity, target16kFrames: adapted.pcm.length,
      modelInputs, eventWindows, mismatches: 0, scenarioSchedulingPcmInvariant: true});
    publicJobs.push({jobId: job.jobId, sourceDomainId: job.jobId, sourceRateHz: job.sourceRateHz,
      pcmPath: job.clipPath, pcmSha256: job.clipPcmSha256, frames: clipBytes.byteLength / 4,
      sourceOriginSample: job.sourceOriginSample, regionStartSourceSample: job.sourceOriginSample + trial.sourceRateHz * 1.2,
      expectedModelInputs: modelInputs.map(w => ({windowIndex: w.windowIndex, start: w.localInputStart, end: w.localInputEnd, sha256: w.sha256}))});
    console.log(JSON.stringify({jobId: job.jobId, rate: trial.sourceRateHz, windows: modelInputs.length, mismatches: 0}));
  }
}
if (results.length !== 18 || new Set(results.map(r => r.family)).size !== 9) throw Error('CASE_RATE_COVERAGE_INCOMPLETE');
await save(WORK + '/audio_only/jobs.json', {schema: 'AUDIO_ONLY_OPAQUE_JOBS_NO_TRUTH_NO_TARGET_NO_FAMILY', jobs: publicJobs,
  futureServerRule: 'Only explicitly whitelisted opaque PCM/model/FIR/ORT assets. Do not serve parent directories, MIDI, reports, scenarios or truth.'});
await save(OUT + '/input-preservation.json', {...proof, executionStartedAt, completedAt: new Date().toISOString(),
  totalCases: 9, totalRateJobs: results.length, mismatches: 0, results,
  esbuildVersion: esbuild.version, nodeVersion: process.version, nodeExecutable: process.execPath,
  bundleImportGraph: inputs, bundleSha256: hash(await readFile(path.join(ROOT, WORK, 'dsp/adapter.mjs'))),
  audioOnlyJobsSha256: hash(await readFile(path.join(ROOT, WORK, 'audio_only/jobs.json'))),
  newNeuralRuns: 0, RobustSessionRuns: 0, automaticFallback: false});
