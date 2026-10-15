import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicJson, fileSha, digest, validateArtifactDigest } from './xc1_artifacts.mjs';
import { REPO_ROOT } from './xc1_browser_runtime_shared.mjs';
import { describe } from './robust_runtime_evidence_analysis.mjs';
import { classifyBacklog } from './xc1_browser_semantics.mjs';
import { evaluateProductVariant, compactProduct, pareto, pairedClipBootstrap, validateCounterfactuals } from './xc2_product_metrics.mjs';

const [command, freezePath, shortlistPath] = process.argv.slice(2);
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const freeze = await read(freezePath);
const { freezeSha256, ...content } = freeze;
if (digest(content) !== freezeSha256) throw new Error('XC2_PROTOCOL_DRIFT');
for (const [file, sha] of Object.entries(freeze.sourceHashBoundary)) if (await fileSha(file) !== sha) throw new Error(`XC2_SOURCE_DRIFT:${file}`);
const root = freeze.runRoot, manifest = await read(freeze.audioManifestPath);
const exists = file => stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const idFor = (resampler, decoder, ownedMs, futureMs) => `${resampler}_${decoder}_${ownedMs}_${futureMs}`;
const state = [];

async function rawStream(clip, resampler, ownedMs, futureMs, decoders, ort = '1.20.1') {
  const output = path.join(root, 'raw', `${clip.split}_${resampler}_${ownedMs}_${futureMs}_${ort}`, `${clip.clipId}.json`);
  if (!await exists(output)) {
    const argv = ['backend/research/browser_runtime/xc2_raw_cli.mjs', '--freeze', freezePath, '--clip-id', clip.clipId,
      '--resampler', resampler, '--owned-ms', String(ownedMs), '--future-ms', String(futureMs), '--ort', ort,
      '--decoders', decoders.join(','), '--output', output];
    console.log('INFERENCE', clip.split, clip.clipId, resampler, ownedMs, futureMs, ort, decoders.join(','));
    try { execFileSync(process.execPath, ['--max-old-space-size=16384', ...argv], { cwd: REPO_ROOT, stdio: 'inherit' }); }
    catch (error) { await atomicJson(path.join(root, `execution_failure_${Date.now()}.json`), { command: [process.execPath, ...argv], exitStatus: error.status, error: String(error) }); throw error; }
  }
  const raw = await read(output); validateArtifactDigest(raw);
  if (raw.clipId !== clip.clipId || raw.pcmSha256 !== clip.pcm[resampler].sha256 || decoders.some(id => !raw.publications[id])) throw new Error('XC2_RAW_IDENTITY_DRIFT');
  return { raw, path: output, sha256: await fileSha(output) };
}

async function permission(split, artifacts) {
  for (const item of artifacts) {
    if (await fileSha(item.path) !== item.sha256) throw new Error('XC2_RAW_SEAL_CHANGED');
    const raw = await read(item.path); validateArtifactDigest(raw);
    for (const row of raw.rawWindows) if (await fileSha(row.onsetPath) !== row.onsetSha256 || await fileSha(row.framePath) !== row.frameSha256) throw new Error('XC2_RAW_TENSOR_CHANGED');
  }
  const output = path.join(root, `${split.toLowerCase()}_truth_permission.json`);
  if (!await exists(output)) await atomicJson(output, { status: 'ACOUSTIC_PREDICTIONS_SEALED', split,
    protocolFreezeSha256: freezeSha256, sealedAt: new Date().toISOString(), rawArtifacts: artifacts.map(({ path, sha256 }) => ({ path, sha256 })) });
}

async function truthFor(split, artifacts) {
  await permission(split, artifacts);
  const target = path.join(root, `${split.toLowerCase()}_benchmark.json`);
  if (await exists(target)) return read(target);
  const input = path.join(root, `${split.toLowerCase()}_truth.json`);
  if (!await exists(input)) execFileSync('docker', ['run', '--rm', '-v', `${REPO_ROOT}:/workspace`, '-w', '/workspace', freeze.dockerScienceImageId,
    'python', '-m', 'backend.research.xc2_prepare', 'truth', '--output', `/workspace/${root.replaceAll('\\', '/')}`, '--split', split], { stdio: 'inherit' });
  const validated = validateCounterfactuals(await read(input));
  await atomicJson(target, validated); return validated;
}

async function evaluate(streams, truth, resampler, decoder, ownedMs, futureMs, stage) {
  const id = idFor(resampler, decoder, ownedMs, futureMs), output = path.join(root, 'metrics', stage, id + '.json');
  const candidate = await exists(output) ? await read(output) : evaluateProductVariant(streams.map(row => row.raw), truth, decoder, id);
  if (!await exists(output)) await atomicJson(output, candidate);
  const { audit: _audit, ...retained } = candidate;
  return { ...retained, resampler, ownedMs, futureMs, metricsPath: output, metricsSha256: await fileSha(output) };
}

if (command === 'development') {
  const clips = manifest.clips.filter(clip => clip.split === 'DEVELOPMENT');
  const linear = [];
  for (const clip of clips) linear.push(await rawStream(clip, 'LINEAR', 600, 220, ['A', 'B', 'C']));
  const truth = await truthFor('DEVELOPMENT', linear);
  const baseline = await evaluate(linear, truth, 'LINEAR', 'A', 600, 220, 'baseline');
  await atomicJson(path.join(root, 'current_baseline_development.json'), compactProduct(baseline));
  // Exactly one fresh ORT 1.30 control. Never expand the parameter grid to it.
  const controlPath = path.join(root, 'ort130_control.json');
  if (!await exists(controlPath)) {
    const control = await rawStream(clips[0], 'LINEAR', 600, 220, ['A'], '1.30.0');
    const rows = control.raw.runtime.runtimeRows.filter(row => !row.shiftedFinalWindow), p95 = describe(rows.map(row => row.processingMs)).p95;
    const backlog = classifyBacklog(rows, 600);
    await atomicJson(controlPath, { artifactPath: control.path, artifactSha256: control.sha256, p95, backlog,
      status: p95 > 600 || !backlog.noSustainedBacklog ? 'ORT_WEB_1_30_RUNTIME_INELIGIBLE_FOR_THIS_ROBUST_EXPORT_ON_THIS_MACHINE' : 'CONTROL_NO_REPEAT_OF_REGRESSION_MAIN_FROZEN_120_UNCHANGED', executionCount: 1 });
  }
  const stageA = [];
  for (const resampler of ['LINEAR', 'BAND_LIMITED']) {
    const streams = resampler === 'LINEAR' ? linear : [];
    if (resampler !== 'LINEAR') for (const clip of clips) streams.push(await rawStream(clip, resampler, 600, 220, ['A', 'B', 'C']));
    for (const decoder of ['A', 'B', 'C']) stageA.push(await evaluate(streams, truth, resampler, decoder, 600, 220, 'stage_a'));
  }
  const carried = pareto(stageA);
  if (!carried.length) throw new Error('XC2_NO_SAFETY_QUALIFYING_DEVELOPMENT_VARIANT');
  await atomicJson(path.join(root, 'stage_a_screening.json'), { candidates: stageA.map(compactProduct), carriedIds: carried.map(c => c.id),
    rule: 'Componentwise safety/correctness Pareto only; no non-inferiority margin or speed-only selection.' });
  const all = [];
  for (const resampler of [...new Set(carried.map(c => c.resampler))]) {
    const decoders = carried.filter(c => c.resampler === resampler).map(c => c.decoder);
    for (const ownedMs of [320, 400, 500, 600]) for (const futureMs of [120, 170, 220]) {
      const streams = [];
      for (const clip of clips) streams.push(await rawStream(clip, resampler, ownedMs, futureMs, decoders));
      for (const decoder of decoders) {
        const candidate = await evaluate(streams, truth, resampler, decoder, ownedMs, futureMs, 'geometry');
        all.push(candidate); console.log('GEOMETRY_SCORED', candidate.id, candidate.status);
      }
    }
  }
  const frontier = pareto(all.filter(c => c.runtimeSustainable), true);
  const shortlist = [...new Map([baseline, ...frontier].map(c => [c.id, c])).values()];
  const freezeShortlist = { phase: freeze.phase, protocolFreezeSha256: freezeSha256,
    createdBeforeEvaluationInference: true, evaluationInferenceStarted: false,
    developmentSources: { truthPath: path.join(root, 'development_benchmark.json'), truthSha256: await fileSha(path.join(root, 'development_benchmark.json')) },
    stageASelected: carried.map(c => c.id), frontierIds: frontier.map(c => c.id),
    candidates: shortlist.map(c => ({ id: c.id, decoder: c.decoder, resampler: c.resampler, ownedMs: c.ownedMs, futureMs: c.futureMs,
      developmentMetricsPath: c.metricsPath, developmentMetricsSha256: c.metricsSha256 })),
    rationale: 'Current baseline retained as comparator plus all runtime-sustainable safety/correctness/verdict-latency nondominated DEVELOPMENT configurations. No scalar safety margin.' };
  freezeShortlist.shortlistSha256 = digest(freezeShortlist);
  await atomicJson(path.join(root, 'development_geometry_summary.json'), { candidates: all.map(compactProduct), paretoIds: frontier.map(c => c.id) });
  await atomicJson(path.join(root, 'evaluation_shortlist.json'), freezeShortlist);
  console.log('DEVELOPMENT_COMPLETE_SHORTLIST_REQUIRES_REMOTE_FREEZE', shortlist.length);
} else if (command === 'evaluation') {
  const shortlist = await read(shortlistPath), { shortlistSha256, ...selection } = shortlist;
  if (digest(selection) !== shortlistSha256 || shortlist.protocolFreezeSha256 !== freezeSha256) throw new Error('XC2_SHORTLIST_DRIFT');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const remote = execFileSync('git', ['-c', 'http.sslBackend=openssl', 'ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary'], { encoding: 'utf8' }).split(/\s/)[0];
  if (head !== remote || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('XC2_EVALUATION_REQUIRES_CLEAN_REMOTE_SHORTLIST_COMMIT');
  const clips = manifest.clips.filter(clip => clip.split === 'EVALUATION'), groups = new Map(), artifacts = [];
  for (const c of shortlist.candidates) {
    const key = `${c.resampler}_${c.ownedMs}_${c.futureMs}`;
    if (!groups.has(key)) groups.set(key, { ...c, decoders: [] });
    groups.get(key).decoders.push(c.decoder);
  }
  const byConfig = new Map();
  for (const [key, config] of groups) {
    const streams = [];
    for (const clip of clips) streams.push(await rawStream(clip, config.resampler, config.ownedMs, config.futureMs, config.decoders));
    artifacts.push(...streams); byConfig.set(key, streams);
  }
  const truth = await truthFor('EVALUATION', artifacts), candidates = [];
  for (const c of shortlist.candidates) candidates.push(await evaluate(byConfig.get(`${c.resampler}_${c.ownedMs}_${c.futureMs}`), truth,
    c.resampler, c.decoder, c.ownedMs, c.futureMs, 'evaluation'));
  const frontier = pareto(candidates.filter(c => c.runtimeSustainable), true), coverage = {};
  const dev = await read(path.join(root, 'development_benchmark.json'));
  for (const clip of [...dev.clips, ...truth.clips]) for (const scenario of clip.scenarios) coverage[scenario.family] = (coverage[scenario.family] ?? 0) + 1;
  const sufficient = freeze.counterfactualFamilies.every(f => (coverage[f] ?? 0) >= 20);
  const disposition = !sufficient ? 'ROBUST_PRODUCT_BASELINE_EVALUATION_INCONCLUSIVE' : !frontier.length ? 'ROBUST_PRODUCT_BASELINE_SAFETY_NOT_QUALIFIED'
    : frontier.length === 1 ? 'ROBUST_PRODUCT_BASELINE_CLEAR_PARETO_FRONT_RUNNER' : 'ROBUST_PRODUCT_BASELINE_MULTIPLE_PARETO_CANDIDATES';
  const comparisons = [];
  for (let i = 0; i < candidates.length; i += 1) for (let j = i + 1; j < candidates.length; j += 1) {
    if (candidates[i].status === 'PRODUCT_VERDICT_EVALUATION_COMPLETE' && candidates[j].status === 'PRODUCT_VERDICT_EVALUATION_COMPLETE') comparisons.push(pairedClipBootstrap(candidates[i], candidates[j]));
  }
  await atomicJson(path.join(root, 'evaluation_result.json'), { phase: freeze.phase, protocolFreezeSha256: freezeSha256,
    evaluationShortlistCommit: head, shortlistSha256, disposition, familyCoverage: coverage,
    coverageStatus: sufficient ? 'MINIMUM_20_PER_FAMILY_PRESENT' : 'INSUFFICIENT_PRODUCT_VERDICT_COVERAGE',
    candidates: candidates.map(compactProduct), paretoIds: frontier.map(c => c.id), pairedClipBootstrap: comparisons,
    evaluationRawSealPath: path.join(root, 'evaluation_truth_permission.json'),
    commercialQualificationStatus: 'NOT_PERFORMED', productionMicrophone: false,
    latencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN', noProductionQualification: true });
  console.log('EVALUATION_COMPLETE', disposition, frontier.map(c => c.id));
} else throw new Error('XC2_COMMAND_REQUIRED');
