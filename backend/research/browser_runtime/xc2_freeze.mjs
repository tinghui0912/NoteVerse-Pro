import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicJson, fileSha, digest } from './xc1_artifacts.mjs';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const implementationCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('CLEAN_IMPLEMENTATION_REQUIRED');
if (git('-c', 'http.sslBackend=openssl', 'ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0] !== implementationCommit) throw new Error('PUSH_IMPLEMENTATION_FIRST');
const root = 'backend/data/work/xc2_robust_product_baseline_v1';
const fullManifestPath = `${root}/full_manifest.json`, audioManifestPath = `${root}/audio_only/manifest.json`;
const manifest = JSON.parse(await readFile(fullManifestPath));
if (manifest.clips.length !== 10 || manifest.clips.filter(c => c.split === 'DEVELOPMENT').length !== 5 || manifest.clips.filter(c => c.split === 'EVALUATION').length !== 5) throw new Error('EXACT_TEN_CLIP_SPLIT_REQUIRED');
for (const clip of manifest.clips) for (const pcm of Object.values(clip.pcm)) if (await fileSha(pcm.path) !== pcm.sha256 || pcm.samples !== 448000 || pcm.samplesOverUnitMagnitude !== 0) throw new Error('PCM_IDENTITY_OR_RANGE_FAILED');
const sourceFiles = git('ls-files', 'backend/research/browser_runtime/xc2*.mjs', 'backend/research/browser_runtime/test_xc2_product.mjs',
  'backend/research/xc2_prepare.py', 'backend/research/test_xc2_prepare.py',
  'apps/customer-web/src/lib/practice/research/xc2-five-verdict-projector.ts').split('\n');
sourceFiles.push(...['xc1_artifacts.mjs', 'xc1_browser_runtime_shared.mjs', 'xc1_runtime_selection.mjs', 'xc1_browser_semantics.mjs', 'xc1_robust_decoder.mjs', 'robust_runtime_evidence_analysis.mjs'].map(p => `backend/research/browser_runtime/${p}`),
  'apps/customer-web/src/lib/practice/local-core/continuous-finalization-ledger.ts',
  'apps/customer-web/src/lib/practice/audio-analysis/continuous/performance-reconciler.ts',
  'apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts',
  'apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts',
  'backend/research/tools/bytedance_pcm_preprocessing.py');
const sourceHashBoundary = {};
for (const file of [...new Set(sourceFiles)]) sourceHashBoundary[file] = await fileSha(file);
const runtimeAssets = {};
for (const dir of ['backend/research/browser_runtime/xc1_ort120_runtime/node_modules/onnxruntime-web/dist', 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/onnxruntime-web/dist']) {
  for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isFile() && /\.(js|mjs|wasm)$/.test(entry.name)) runtimeAssets[`${dir}/${entry.name}`] = await fileSha(`${dir}/${entry.name}`);
}
const rawModel = 'backend/data/work/phase9gd1_robust_browser_onnx/robust_bytedance_fixed_1820_opset18.onnx';
if (await fileSha(rawModel) !== '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3') throw new Error('ONNX_DRIFT');
const provenanceCode = "import importlib.util as u,importlib.metadata as m,hashlib,json;from pathlib import Path;p=Path(u.find_spec('piano_transcription_inference').origin).parent;print(json.dumps({'package':'piano-transcription-inference','version':m.version('piano-transcription-inference'),'sourceFiles':{f:hashlib.sha256((p/f).read_bytes()).hexdigest() for f in ['utilities.py','piano_vad.py','config.py']}}))";
const upstreamImage = gitDocker('noteverse-bytedance-calibration:phase9ga21');
function gitDocker(tag) { return execFileSync('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim(); }
const provenance = JSON.parse(execFileSync('docker', ['run', '--rm', upstreamImage, 'python', '-c', provenanceCode], { encoding: 'utf8' }));
const pypi = await (await fetch('https://pypi.org/pypi/piano-transcription-inference/0.0.6/json')).json();
const smoke = JSON.parse(await readFile('backend/data/work/xc2_smoke/raw_final.json'));
if (smoke.runtime.actualSessionRunCount <= 0 || Object.keys(smoke.decoderFailures).length || Object.values(smoke.truthBoundaryProbe).some(status => status < 400)) throw new Error('REAL_NON_SMD_SMOKE_REQUIRED');
const protocol = { phase: 'PHASE_9G_XC2_ROBUST_PRODUCT_VERDICT_AND_LATENCY_BASELINE', startingRemoteHead: 'ad901f9f36c588191b5f1f7ff626c0b02512846a',
  implementationCommit, runRoot: root, fullManifestPath, fullManifestSha256: await fileSha(fullManifestPath), audioManifestPath, audioManifestSha256: await fileSha(audioManifestPath),
  evaluationShortlistPath: 'backend/research/reports/phase9g_xc2_evaluation_shortlist_freeze_2026-10-15.json',
  sourceHashBoundary, model: { onnxPath: rawModel, sha256: await fileSha(rawModel), bytes: (await stat(rawModel)).size,
    inputSamples: 29120, sampleRateHz: 16000, outputFrameRateHz: 100, onsetThreshold: .30, frameThreshold: .05 },
  decoderProvenance: { ...provenance, dockerImageId: upstreamImage, sourceRepository: 'https://github.com/qiuqiangkong/piano_transcription_inference',
    auditedRepositoryHead: '0226e74cbc805660e34bbd6a8fed2083890ebb88', executionVersion: 'PyPI 0.0.6 source, not an unverified claim that master and wheel are byte-identical',
    distributionArtifacts: pypi.urls.map(u => ({ filename: u.filename, sha256: u.digests.sha256, url: u.url })),
    function: 'RegressionPostProcessor.get_binarized_output_from_regression(threshold=.30, neighbour=2)',
    eventTime: 'inputWindowStartMs + (frame + float32(interpolated shift))*10ms; upstream onset-only projection; frame threshold governs duration, not onset proposal creation',
    parity: 'Executable fixture compared to installed pinned Python method: pitch/frame exact, shift abs delta<1e-6; CURRENT also compared directly against TS decodeByteDanceRawOutputs.',
    nonfiniteShiftPolicy: 'Fail that decoder variant; no approximate timing substitution.',
    hybrid: { classification: 'NEW_PROSPECTIVE_HYBRID_SAFE_EXPERIMENT', pairing: 'Same-pitch maximum cardinality/minimum timing error/stable index ties within 20ms; CURRENT timestamp and min confidence; unmatched proposals discarded.' } },
  resamplers: manifest.preprocessing, runtimeAssets, mainOrtVersion: '1.20.1', providers: ['webgpu'], ort130ControlMaximumExecutions: 1,
  geometries: { ownershipMs: [320, 400, 500, 600], futureContextMs: [120, 170, 220], fixedInputMs: 1820,
    commonIntervalMs: [1380, 27780], inputRule: 'inputWindowEnd=ownedEnd+future; inputWindowStart=inputWindowEnd-1820; final partial shifted using real samples only' },
  verdictPolicy: { assignmentAndGraceMs: 250, expectedMatching: 'Unmodified ContinuousFinalizationLedger',
    correct: 'All group slots irreversibly MATCHED; unrelated extras do not change CORRECT.',
    incomplete: 'After deadline, partial multi-pitch match with no incompatible wrong explanation.', missing: 'After deadline, zero matches and zero wrong explanations.',
    wrong: 'Incompatible residual observations matched to missing slots with global maximum-cardinality/min-total-temporal-error deterministic flow; takes precedence over incomplete/missing.',
    extra: 'Ledger residual after every legal expected/wrong claim is closed; no dual ownership.',
    wrongWindow: 'Group minimum expected time +/-250ms; event no later than group max expected time+250ms, pitch incompatible with all expected group pitches.',
    conflictFinality: 'Same-pitch ledger conflict components preserved; wrong-association overlapping-window components close before assignment. Conservative delay is measured, not bypassed.',
    naturalCompletion: 'After full common acoustic scope is covered, close naturally at its inclusive frontier; no future out-of-scope score claims.',
    latency: 'Measured acoustic publication availability drives deterministic causal replay; UI/perceptual latency not claimed.' },
  counterfactualFamilies: ['CORRECT_SINGLE', 'CORRECT_CHORD', 'MISSING_SINGLE', 'WRONG_SEMITONE', 'INCOMPLETE_CHORD', 'EXTRA_NOTE', 'SAME_PITCH_RETRIGGER', 'SUSTAINED_NO_RETRIGGER'],
  counterfactualConstruction: 'Physical positive-velocity non-drum piano MIDI21..108; zero additional alignment. <=20ms onset groups without duplicate pitch. Full interior physical expected background. First up to8 metadata/MIDI-valid anchors per family/clip from [1500,26500). Missing/incomplete absent pitch chosen lowest60..108 with no physical same pitch within250ms. Wrong semitone +1 guarded similarly. Extra removes one physical expected slot. Retrigger requires same pitch within500ms. Sustain requires >=700ms without physical same-pitch reattack. Reject oracle-ambiguous scenarios independent of candidate output. Fixed BPM120, fractional beat positions; no score following.',
  coveragePolicy: 'Target >=20 scenarios/family across all ten clips; inadequate coverage => INSUFFICIENT_PRODUCT_VERDICT_COVERAGE and inconclusive disposition.',
  developmentSelection: 'StageA safety/correctness componentwise Pareto; geometry carries only those decoder/resampler pairs. Shortlist retains current baseline plus all sustainable safety/correctness/five-class-P95 nondominated configurations. No post-hoc non-inferiority margin.',
  statistics: { unit: 'clip', draws: 5000, seed: 13371, method: 'Frozen xorshift32 paired whole-clip bootstrap; scenario-level paired differences retained, not treated as independent replicates.' },
  runtimePolicy: 'Causal independent producer, serialized model consumer; measured per-window queue and actual session.run timing; historical480ms reserve diagnostic separate from feedback latency.',
  productLatencySlo: 'PRODUCT_LATENCY_SLO_NOT_YET_FROZEN', preFreezeNonSmdSmoke: { path: 'backend/data/work/xc2_smoke/raw_final.json', sha256: await fileSha('backend/data/work/xc2_smoke/raw_final.json'), modelRuns: smoke.runtime.actualSessionRunCount, truthBoundaryProbe: smoke.truthBoundaryProbe },
  dockerScienceImageId: gitDocker('noteverse-xc1-r3d-science:local'),
  candidateEvaluationStarted: false, evaluationClipInferenceStarted: false, commercialQualificationStatus: 'NOT_PERFORMED' };
protocol.freezeSha256 = digest(protocol);
await atomicJson('backend/research/reports/phase9g_xc2_clip_source_manifest_2026-10-15.json', manifest);
await atomicJson('backend/research/reports/phase9g_xc2_protocol_freeze_2026-10-15.json', protocol);
console.log(JSON.stringify({ implementationCommit, freezeSha256: protocol.freezeSha256, clips: manifest.clips.map(c => ({ clipId: c.clipId, split: c.split })) }));
