import { existsSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightOutput, writeArtifact, PHASE, digest } from './xc1_artifacts.mjs';
import { ROBUST_ORT_WEB_VERSION, ROBUST_ORT_PACKAGE_ROOT } from './xc1_runtime_selection.mjs';

import { executeBasicPitchBrowserExecutor, BASIC_PITCH_DECODER_EXECUTION_IDENTITY } from './xc1_basic_pitch_browser_executor.mjs';
import { executeOnlineAmtK8BrowserExecutor } from './xc1_online_amt_k8_browser_executor.mjs';
import { ROBUST_DECODER_IDENTITY } from './xc1_robust_decoder.mjs';
import { executeRobustBrowserExecutor } from './xc1_robust_browser_executor.mjs';
import {
  BASIC_PITCH_WORK,
  REPO_ROOT,
  XC1_DEFAULT_ASSET_PATHS,
  assertNoSmokeStatus,
  launchXc1Browser,
  moduleIdentity,
  resolveFrozenAcousticInput,
  sha256File,
  startXc1BrowserAssetServer,
  verifySha,
} from './xc1_browser_runtime_shared.mjs';

export const XC1_STAGE_A_REGISTRY_SCHEMA_VERSION = 1;

export const XC1_FROZEN_IDENTITIES = Object.freeze({
  'robust-browser-v1': Object.freeze({
    deploymentId: 'robust-browser-v1',
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    historicalD3DeploymentIdentitySha256: '196a9a2ceb03569f6e266c4f5973125bb8596146882079105ee94ef7e621deed',
    onnxSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
    sampleRateHz: 16000,
    inputSamples: 29120,
    ownedRegionMs: 600,
    pastContextMs: 1000,
    futureContextMs: 220,
    onsetThreshold: 0.30,
    frameThreshold: 0.05,
    executionProvider: 'webgpu',
  }),
  'online-amt-k8-browser-v1': Object.freeze({
    deploymentId: 'online-amt-k8-browser-v1',
    candidateId: 'online-amt-calibrated-v1',
    k8OnnxSha256: '818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18',
    k1FallbackOnnxSha256: '1924789c64595a5b8c1ff2f745089613b2ba6108676952c4bb6f60f28d9cd301',
    configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
    checkpointSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
    hopSamples: 512,
    hopMs: 32,
    groupHops: 8,
    groupMs: 256,
    timingCorrectionMs: -162.93750000004252,
    publishedOnsetBoost: 1,
    pseudoIntensity: 'NATIVE',
    ortWebVersion: '1.30.0',
    executionProvider: 'webgpu',
  }),
  'basic-pitch-browser-v1': Object.freeze({
    deploymentId: 'basic-pitch-browser-v1',
    candidateId: 'basic-pitch-browser-v1',
    packageName: '@spotify/basic-pitch',
    packageVersion: '1.0.1',
    packageLockSha256: '20411bed571869711745c3ad993847a67512bb59156df5e16a372cccb1c9d4e8',
    modelJsonSha256: '1ed1aaee3409ec1dc098c8b01f430c0911f6fe9412e7af8086750f9e8f302f68',
    weightsSha256: 'b142a95737a52e1e412d5f92e73d8bb80dfe8d04941acc0702f11f4524fb377c',
    tfjsVersion: '3.21.0',
    browserBackend: 'tensorflowjs-webgl',
    inputSampleRateHz: 16000,
    modelSampleRateHz: 22050,
    onsetThreshold: 0.5,
    frameThreshold: 0.3,
    minNoteLenFrames: 5,
    inferOnsets: true,
    melodiaTrick: true,
    energyTolerance: 11,
    pitchRange: [21, 108],
  }),
});

export const XC1_CANDIDATE_EXECUTOR_REGISTRY = Object.freeze({
  'robust-browser-v1': Object.freeze({
    identity: XC1_FROZEN_IDENTITIES['robust-browser-v1'],
    execute: executeRobustBrowserV1,
  }),
  'online-amt-k8-browser-v1': Object.freeze({
    identity: XC1_FROZEN_IDENTITIES['online-amt-k8-browser-v1'],
    execute: executeOnlineAmtK8BrowserV1,
  }),
  'basic-pitch-browser-v1': Object.freeze({
    identity: XC1_FROZEN_IDENTITIES['basic-pitch-browser-v1'],
    execute: executeBasicPitchBrowserV1,
  }),
});

export function resolveOfficialXc1Executor(deploymentId) {
  const entry = XC1_CANDIDATE_EXECUTOR_REGISTRY[deploymentId];
  if (!entry) throw new Error(`XC1_UNKNOWN_DEPLOYMENT:${deploymentId}`);
  return entry;
}

export async function executeOfficialXc1StageACell(request) {
  validateOfficialRequest(request);
  await preflightOutput(request.outputPath);
  const runtimeRoot = request.deploymentId === 'robust-browser-v1' ? ROBUST_ORT_PACKAGE_ROOT : 'backend/research/browser_runtime/dr3r_browser_runtime';
  const ortPackage = JSON.parse(await readFile(path.join(REPO_ROOT, runtimeRoot, 'node_modules/onnxruntime-web/package.json'), 'utf8'));
  if (ortPackage.version !== (request.deploymentId === 'robust-browser-v1' ? ROBUST_ORT_WEB_VERSION : '1.30.0')) throw new Error('XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:ort');
  const entry = resolveOfficialXc1Executor(request.deploymentId);
  return entry.execute(request);
}

function validateOfficialRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('XC1_STAGE_A_REQUEST_MUST_BE_OBJECT');
  }
  for (const forbidden of [
    'executor',
    'executorPath',
    'executorCallback',
    'modelPath',
    'graphPath',
    'thresholds',
    'decoder',
    'truthMidi',
    'expectedPitch',
    'expectedPitches',
    'expectedStrikes',
    'scoreNotes',
    'correctnessLabel',
    'mutationCategory',
  ]) {
    if (Object.prototype.hasOwnProperty.call(request, forbidden)) {
      throw new Error(`XC1_STAGE_A_FORBIDDEN_REQUEST_FIELD:${forbidden}`);
    }
  }
  if (typeof request.deploymentId !== 'string') throw new Error('XC1_STAGE_A_DEPLOYMENT_REQUIRED');
  if (typeof request.takeId !== 'string') throw new Error('XC1_STAGE_A_TAKE_REQUIRED');
  if (typeof request.stageARoot !== 'string') throw new Error('XC1_STAGE_A_ROOT_REQUIRED');
  if (typeof request.stageAManifestPath !== 'string') throw new Error('XC1_STAGE_A_MANIFEST_REQUIRED');
  if (typeof request.outputPath !== 'string') throw new Error('XC1_STAGE_A_OUTPUT_REQUIRED');
  const allowed = new Set(['deploymentId', 'candidateId', 'takeId', 'stageARoot', 'stageAManifestPath', 'outputPath',
    'browserChannel', 'headed', 'evidenceMode', 'f5Commit', 'f5FreezeSha256', 'implementationCommit',
    'candidateIdentity', 'runtimeMode', 'retainRawHops']);
  for (const key of Object.keys(request)) if (!allowed.has(key)) throw new Error(`XC1_STAGE_A_FORBIDDEN_REQUEST_FIELD:${key}`);
}

export async function executeRobustBrowserV1(request) {
  const identity = XC1_FROZEN_IDENTITIES['robust-browser-v1'];
  verifyDeploymentBinding(request, identity);
  const robustOnnxPath = XC1_DEFAULT_ASSET_PATHS.robustOnnxPath;
  const assetVerification = {
    onnxSha256: await verifySha(robustOnnxPath, identity.onnxSha256, 'robust ONNX'),
    onnxBytes: (await stat(robustOnnxPath)).size,
    historicalD3DeploymentIdentitySha256: identity.historicalD3DeploymentIdentitySha256,
    sampleRateHz: identity.sampleRateHz,
    inputSamples: identity.inputSamples,
    contextMs: {
      past: identity.pastContextMs,
      owned: identity.ownedRegionMs,
      future: identity.futureContextMs,
    },
    thresholds: {
      onset: identity.onsetThreshold,
      frame: identity.frameThreshold,
    },
  };
  return runOfficialBrowserExecutor(request, identity, {
    robustOnnxPath,
    executorExport: 'executeRobustBrowserExecutor',
    executorModulePath: path.join(path.dirname(fileURLToPath(import.meta.url)), 'xc1_robust_browser_executor.mjs'),
    decoderIdentity: ROBUST_DECODER_IDENTITY,
    assetVerification,
    executePage: executeRobustBrowserExecutor,
  });
}

export async function executeOnlineAmtK8BrowserV1(request) {
  const identity = XC1_FROZEN_IDENTITIES['online-amt-k8-browser-v1'];
  verifyDeploymentBinding(request, identity);
  const onlineAmtK8OnnxPath = XC1_DEFAULT_ASSET_PATHS.onlineAmtK8OnnxPath;
  const onlineAmtK1OnnxPath = XC1_DEFAULT_ASSET_PATHS.onlineAmtK1OnnxPath;
  const assetVerification = {
    k8OnnxSha256: await verifySha(onlineAmtK8OnnxPath, identity.k8OnnxSha256, 'Online-AMT K8 ONNX'),
    k1FallbackOnnxSha256: await verifySha(onlineAmtK1OnnxPath, identity.k1FallbackOnnxSha256, 'Online-AMT K1 fallback ONNX'),
    k8OnnxBytes: (await stat(onlineAmtK8OnnxPath)).size,
    k1FallbackOnnxBytes: (await stat(onlineAmtK1OnnxPath)).size,
    configurationSha256: identity.configurationSha256,
    checkpointSha256: await verifySha(path.join(REPO_ROOT, 'backend/data/work/online_amt/model-180000.pt'), identity.checkpointSha256, 'Online-AMT checkpoint'),
    ortWebVersion: identity.ortWebVersion,
    hopSamples: identity.hopSamples,
    groupHops: identity.groupHops,
    timingCorrectionMs: identity.timingCorrectionMs,
    publishedOnsetBoost: identity.publishedOnsetBoost,
    pseudoIntensity: identity.pseudoIntensity,
  };
  return runOfficialBrowserExecutor(request, identity, {
    onlineAmtK8OnnxPath,
    onlineAmtK1OnnxPath,
    executorExport: 'executeOnlineAmtK8BrowserExecutor',
    executorModulePath: path.join(path.dirname(fileURLToPath(import.meta.url)), 'xc1_online_amt_k8_browser_executor.mjs'),
    decoderIdentity: { publicationProjection: 'runOnlineAmtStreamingCandidateFromHopArtifact',
      authoritativeBridge: await moduleIdentity(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'), 'runOnlineAmtStreamingCandidateFromHopArtifact'),
      worker: await moduleIdentity(path.join(REPO_ROOT, 'backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs'), 'processGroup') },
    assetVerification,
    executePage: executeOnlineAmtK8BrowserExecutor,
  });
}

export async function executeBasicPitchBrowserV1(request) {
  const identity = XC1_FROZEN_IDENTITIES['basic-pitch-browser-v1'];
  verifyDeploymentBinding(request, identity);
  const basicPitchWorkDir = XC1_DEFAULT_ASSET_PATHS.basicPitchWorkDir;
  const basicPitchAssets = await verifyBasicPitchAssets(basicPitchWorkDir, identity);
  const decoder = await loadOfficialBasicPitchDecoder(basicPitchWorkDir);
  return runOfficialBrowserExecutor(request, identity, {
    basicPitchWorkDir,
    executorExport: 'executeBasicPitchBrowserExecutor',
    executorModulePath: path.join(path.dirname(fileURLToPath(import.meta.url)), 'xc1_basic_pitch_browser_executor.mjs'),
    decoderIdentity: {
      ...BASIC_PITCH_DECODER_EXECUTION_IDENTITY,
      sourceSha256: decoder.identity.sourceSha256,
    },
    assetVerification: {
      ...basicPitchAssets,
      tfjsVersion: identity.tfjsVersion,
      browserBackend: identity.browserBackend,
      officialDecoder: decoder.identity,
    },
    executePage: executeBasicPitchBrowserExecutor,
  });
}

export async function decodeBasicPitchOfficialNotesFromActivations({
  basicPitchWorkDir,
  frames,
  onsets,
}) {
  const { outputToNotesPoly, noteFramesToTime, identity } = await loadNodeCompatibleBasicPitchDecoder(basicPitchWorkDir);
  const params = XC1_FROZEN_IDENTITIES['basic-pitch-browser-v1'];
  const notes = outputToNotesPoly(
    frames,
    onsets,
    params.onsetThreshold,
    params.frameThreshold,
    params.minNoteLenFrames,
    params.inferOnsets,
    null,
    null,
    params.melodiaTrick,
    params.energyTolerance,
  );
  const timedNotes = noteFramesToTime(notes);
  return { identity, notes, timedNotes, noteFramesToTimeCalled: true };
}

async function loadNodeCompatibleBasicPitchDecoder(basicPitchWorkDir) {
  const browserIdentity = await loadOfficialBasicPitchDecoder(basicPitchWorkDir);
  const packageRoot = path.resolve(basicPitchWorkDir, 'node_modules', '@spotify', 'basic-pitch');
  const cjsDecoder = path.join(packageRoot, 'cjs', 'toMidi.js');
  const require = createRequire(path.join(packageRoot, 'package.json'));
  const mod = require(cjsDecoder);
  return {
    outputToNotesPoly: mod.outputToNotesPoly,
    noteFramesToTime: mod.noteFramesToTime,
    identity: {
      ...browserIdentity.identity,
      nodeCompatibilityImportPath: 'node_modules/@spotify/basic-pitch/cjs/toMidi.js',
      nodeCompatibilitySourceSha256: await sha256File(cjsDecoder),
    },
  };
}

async function loadOfficialBasicPitchDecoder(basicPitchWorkDir) {
  if (!basicPitchWorkDir) throw new Error('XC1_BASIC_PITCH_WORK_DIR_REQUIRED');
  const packageRoot = path.resolve(basicPitchWorkDir, 'node_modules', '@spotify', 'basic-pitch');
  const esmDecoder = path.join(packageRoot, 'esm', 'toMidi.js');
  if (!existsSync(esmDecoder)) throw new Error(`XC1_BASIC_PITCH_OFFICIAL_DECODER_MISSING:${esmDecoder}`);
  await verifySha(esmDecoder, 'c6492ceae181d24fb254a152d0853f2a60f27e78547db96258026ddcd81ef618', 'Basic Pitch ESM decoder');
  const source = await readFile(esmDecoder, 'utf8');
  if (!source.includes('function outputToNotesPoly') && !source.includes('outputToNotesPoly')) {
    throw new Error('XC1_BASIC_PITCH_OFFICIAL_DECODER_EXPORT_MISSING');
  }
  if (!source.includes('function noteFramesToTime') && !source.includes('noteFramesToTime')) {
    throw new Error('XC1_BASIC_PITCH_OFFICIAL_DECODER_EXPORT_MISSING');
  }
  return {
    outputToNotesPoly: null,
    noteFramesToTime: null,
    identity: {
      importPath: 'node_modules/@spotify/basic-pitch/esm/toMidi.js',
      outputToNotesPolyExport: true,
      noteFramesToTimeExport: true,
      sourceSha256: await sha256File(esmDecoder),
      executionContext: 'browser-esm-bundle',
    },
  };
}

async function verifyBasicPitchAssets(workDir, identity) {
  if (!workDir) throw new Error('XC1_BASIC_PITCH_WORK_DIR_REQUIRED');
  const root = path.resolve(workDir);
  const packageLockSha256 = await verifySha(path.join(root, 'package-lock.json'), identity.packageLockSha256, 'Basic Pitch package-lock');
  const modelJsonSha256 = await verifySha(path.join(root, 'node_modules', '@spotify', 'basic-pitch', 'model', 'model.json'), identity.modelJsonSha256, 'Basic Pitch model.json');
  const weightsSha256 = await verifySha(path.join(root, 'node_modules', '@spotify', 'basic-pitch', 'model', 'group1-shard1of1.bin'), identity.weightsSha256, 'Basic Pitch weights');
  const tfjsPackage = JSON.parse(await readFile(path.join(root, 'node_modules', '@tensorflow', 'tfjs', 'package.json'), 'utf8'));
  if (tfjsPackage.version !== identity.tfjsVersion) {
    throw new Error(`XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:tfjs:${tfjsPackage.version}:${identity.tfjsVersion}`);
  }
  const basicPitchPackage = JSON.parse(await readFile(path.join(root, 'node_modules', '@spotify', 'basic-pitch', 'package.json'), 'utf8'));
  if (basicPitchPackage.version !== identity.packageVersion) {
    throw new Error(`XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:basic-pitch-package:${basicPitchPackage.version}:${identity.packageVersion}`);
  }
  return {
    packageLockSha256,
    modelJsonSha256,
    weightsSha256,
    packageVersion: basicPitchPackage.version,
    tfjsVersion: tfjsPackage.version,
    modelJsonBytes: (await stat(path.join(root, 'node_modules/@spotify/basic-pitch/model/model.json'))).size,
    weightsBytes: (await stat(path.join(root, 'node_modules/@spotify/basic-pitch/model/group1-shard1of1.bin'))).size,
  };
}

function verifyDeploymentBinding(request, identity) {
  if (request.deploymentId !== identity.deploymentId) {
    throw new Error(`XC1_DEPLOYMENT_ID_MISMATCH:${request.deploymentId}:${identity.deploymentId}`);
  }
  if (request.candidateId !== undefined && request.candidateId !== identity.candidateId) {
    throw new Error(`XC1_CANDIDATE_ID_MISMATCH:${request.candidateId}:${identity.candidateId}`);
  }
}

async function writeBlockedOrSmokeReceipt(request, identity, payload) {
  const receipt = {
    schemaVersion: 1,
    stage: 'XC1_STAGE_A_EXECUTOR_BOUNDARY',
    deploymentId: identity.deploymentId,
    candidateId: identity.candidateId,
    takeId: request.takeId,
    acousticOnly: true,
    truthMidiAccessible: false,
    ...payload,
  };
  if (request.outputPath) {
    await writeFile(request.outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  return receipt;
}

async function runOfficialBrowserExecutor(request, identity, {
  robustOnnxPath = XC1_DEFAULT_ASSET_PATHS.robustOnnxPath,
  onlineAmtK8OnnxPath = XC1_DEFAULT_ASSET_PATHS.onlineAmtK8OnnxPath,
  onlineAmtK1OnnxPath = XC1_DEFAULT_ASSET_PATHS.onlineAmtK1OnnxPath,
  basicPitchWorkDir = BASIC_PITCH_WORK,
  executorModulePath,
  executorExport,
  decoderIdentity,
  assetVerification,
  executePage,
}) {
  await preflightOutput(request.outputPath);
  const deploymentContent = await deploymentContentFor(identity, assetVerification, decoderIdentity, executorModulePath);
  const xc1DeploymentIdentitySha256 = digest(deploymentContent);
  if (request.candidateIdentity && request.candidateIdentity !== xc1DeploymentIdentitySha256) throw new Error('XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:deployment');
  const acousticInput = await resolveFrozenAcousticInput({
    stageARoot: request.stageARoot,
    manifestPath: request.stageAManifestPath,
    takeId: request.takeId,
  });
  const { createJiti } = createRequire(import.meta.url)(path.join(REPO_ROOT, 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/jiti'));
  const contract = createJiti(import.meta.url)(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts'));
  const pcmBytes = await readFile(acousticInput.pcmPath);
  const acousticRequest = { pcm: new Float32Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 4),
    sampleRateHz: 16000, channelCount: 1, sourceId: acousticInput.takeId, captureSessionId: acousticInput.takeId,
    captureStartSample: 0, captureStartTimeMs: 0, acousticChunkId: acousticInput.takeId,
    ownershipStartMs: acousticInput.scoreableInterval.startMs, ownershipEndMs: acousticInput.scoreableInterval.endMs,
    contextStartMs: 0, contextEndMs: acousticInput.sampleCount / 16, modelContextMs: 1000, futureContextMs: 220,
    runtimeRequestId: `${identity.deploymentId}:${acousticInput.takeId}`, candidateId: identity.candidateId,
    deploymentId: identity.deploymentId };
  contract.validateGreenfieldAudioOnlyAcousticRequest(acousticRequest);
  const { server, url } = await startXc1BrowserAssetServer({
    robustOnnxPath,
    onlineAmtK8OnnxPath,
    onlineAmtK1OnnxPath,
    basicPitchWorkDir,
    stageARoot: request.stageARoot,
    deploymentId: identity.deploymentId,
  });
  const { browser, identity: browserIdentity } = await launchXc1Browser({
    channel: request.browserChannel ?? 'chrome',
    headed: request.headed !== false,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const startedAtUnixMs = Date.now();
    const result = await contract.executeGreenfieldAcousticCandidate(acousticRequest, validated => executePage(page, {
      acousticInput, runtimeMode: request.runtimeMode, retainRawHops: request.retainRawHops,
      deploymentId: validated.deploymentId,
    }));
    const coverageEndMs = identity.deploymentId === 'online-amt-k8-browser-v1'
      ? result.analyzedThroughPerformanceMs
      : (result.ownershipWindows ?? result.runtimeRows)?.at(-1)?.ownedEndMs;
    if (!(coverageEndMs >= acousticInput.scoreableInterval.endMs)) throw new Error('XC1_INCOMPLETE_ACOUSTIC_COVERAGE');
    const observationIds = new Set();
    for (const event of result.acousticObservations) {
      if (!Number.isInteger(event.pitch) || event.pitch < 21 || event.pitch > 108
        || !Number.isFinite(event.performanceTimeMs) || !Number.isFinite(event.confidence)
        || !event.candidateObservationId || observationIds.has(event.candidateObservationId)) throw new Error('XC1_ACOUSTIC_OBSERVATION_CONTRACT_VIOLATION');
      observationIds.add(event.candidateObservationId);
    }
    const scientificPrediction = request.evidenceMode === 'scientific_prediction';
    const registryModulePath = fileURLToPath(import.meta.url);
    const sharedModulePath = path.join(path.dirname(registryModulePath), 'xc1_browser_runtime_shared.mjs');
    const receipt = {
      schemaVersion: 2,
      phase: PHASE,
      stage: scientificPrediction ? 'XC1_STAGE_A_SCIENTIFIC_PREDICTION' : 'XC1_OFFICIAL_STAGE_A_REAL_EXECUTOR_ACCEPTANCE',
      status: scientificPrediction ? 'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE' : 'OFFICIAL_STAGE_A_REAL_EXECUTOR_PASS',
      ...(scientificPrediction ? {
        phase: PHASE,
        f5Commit: request.f5Commit,
        f5FreezeSha256: request.f5FreezeSha256,
        implementationCommit: request.implementationCommit,
        candidateIdentity: request.candidateIdentity,
      } : {}),
      deploymentId: identity.deploymentId,
      candidateId: identity.candidateId,
      takeId: request.takeId,
      acousticOnly: true,
      truthMidiAccessible: false,
      noScoreTruthInput: true,
      assetShaVerification: 'PASS',
      startedAtUnixMs,
      browser: browserIdentity,
      implementationIdentity: {
        officialRegistry: await moduleIdentity(registryModulePath, 'executeOfficialXc1StageACell'),
        realExecutor: await moduleIdentity(executorModulePath, executorExport),
        sharedBrowserRuntime: await moduleIdentity(sharedModulePath, 'startXc1BrowserAssetServer'),
        decoder: decoderIdentity,
      },
      assetIdentity: assetVerification,
      xc1DeploymentIdentitySha256,
      coverage: { scoreableInterval: acousticInput.scoreableInterval, completedThroughMs: coverageEndMs, complete: true },
      deploymentIdentityContent: deploymentContent,
      frozenAcousticInput: {
        takeId: acousticInput.takeId,
        pcmSha256: acousticInput.pcmSha256,
        byteSize: acousticInput.byteSize,
        sampleCount: acousticInput.sampleCount,
        sampleRateHz: acousticInput.sampleRateHz,
        dtype: acousticInput.dtype,
        scoreableInterval: acousticInput.scoreableInterval,
        sourceAcousticWavSha256: acousticInput.sourceAcousticWavSha256,
      },
      executorExport,
      ...result,
    };
    assertNoSmokeStatus(receipt);
    if (request.outputPath) {
      return await writeArtifact(request.outputPath, receipt);
    }
    return receipt;
  } finally {
    await browser.close();
    server.close();
  }
}

async function deploymentContentFor(identity, assetVerification, decoderIdentity, executorModulePath) {
  const runtimeRoot = identity.deploymentId === 'robust-browser-v1' ? ROBUST_ORT_PACKAGE_ROOT : 'backend/research/browser_runtime/dr3r_browser_runtime';
  const ortPackage = JSON.parse(await readFile(path.join(REPO_ROOT, runtimeRoot, 'node_modules/onnxruntime-web/package.json'), 'utf8'));
  const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
  return { ...identity, assetVerification, decoderIdentity,
    executorSha256: await sha256File(executorModulePath), sharedRuntimeSha256: await sha256File(path.join(moduleRoot, 'xc1_browser_runtime_shared.mjs')),
    semanticsSha256: await sha256File(path.join(moduleRoot, 'xc1_browser_semantics.mjs')),
    ownershipPlannerSha256: await sha256File(path.join(moduleRoot, 'xc1_robust_decoder.mjs')),
    greenfieldBoundarySha256: await sha256File(path.join(REPO_ROOT, 'apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts')),
    commonPreprocessingSourceSha256: await sha256File(path.join(REPO_ROOT, 'backend/research/xc1_scientific_bakeoff.py')),
    ortWebVersion: ortPackage.version, ortPackageLockSha256: await sha256File(path.join(REPO_ROOT, runtimeRoot, 'package-lock.json')) };
}
