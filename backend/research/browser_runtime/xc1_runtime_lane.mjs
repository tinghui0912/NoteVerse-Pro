#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { executeOfficialXc1StageACell } from './xc1_stage_a_candidate_registry.mjs';
import { materializeSyntheticStageARoot } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, PHASE, DEPLOYMENTS } from './xc1_artifacts.mjs';
import { distribution, classifyBacklog } from './xc1_browser_semantics.mjs';

export function runtimeReceipt(artifact) {
  const online = artifact.deploymentId === 'online-amt-k8-browser-v1';
  const rows = online ? artifact.groupRows.map(row => ({ ...row, processingMs: row.groupedProcessingDurationMs,
    receiveTimestamp: row.workerReceiveTimestamp, processingStartTimestamp: row.workerProcessingStartTimestamp,
    outstandingDepth: row.pageOutstandingDepth, scheduledReadyTimestamp: row.scheduledGroupReadyTimestamp,
    pureOrtMs: row.ortSessionRunDurationMs })) : artifact.runtimeRows.map(row => ({ ...row, pureOrtMs: row.ortSessionRunDurationMs }));
  const steady = online ? rows.filter(row => row.k === 8 && row.hopCountInMessage === 8) : rows.filter(row => !row.shiftedFinalWindow);
  const residual = online ? rows.filter(row => row.k === 1) : rows.filter(row => row.shiftedFinalWindow);
  const cadenceMs = online ? 256 : 600;
  const processing = distribution(steady.map(row => row.processingMs));
  const backlog = classifyBacklog(steady, cadenceMs);
  const age = online ? steady.flatMap(row => row.internalHops.map(hop => hop.captureToPublicationAgeMs))
    : steady.map(row => row.captureToPublicationAgeMs);
  const threshold = online ? 204.8 : 480;
  const oldestAge = online ? steady.map(row => row.internalHops[0]?.captureToPublicationAgeMs)
    : steady.map(row => row.publicationFinishTimestamp - row.scheduledReadyTimestamp + row.inputWindowEndMs - row.ownedStartMs);
  return { candidateId: artifact.deploymentId, xc1DeploymentIdentitySha256: artifact.xc1DeploymentIdentitySha256,
    schedulingMode: artifact.schedulingMode, modelLoadMs: artifact.modelLoadMs ?? artifact.modelLoadAndWarmupMs,
    warmup: artifact.warmup ?? { count: artifact.warmupCount },
    firstTimedProcessingMs: rows[0]?.processingMs, warmProcessingMs: processing,
    pureOrtMs: artifact.deploymentId === 'basic-pitch-browser-v1' ? null : distribution(steady.map(row => row.pureOrtMs)),
    tensorflowJsInferenceMs: artifact.deploymentId === 'basic-pitch-browser-v1'
      ? distribution(steady.map(row => row.tensorflowJsInferenceDurationMs)) : null,
    backlog,
    captureReadyToPublicationAgeMs: distribution(age.filter(Number.isFinite)),
    oldestOwnedSourceTimeToPublicationAgeMs: distribution(oldestAge.filter(Number.isFinite)),
    terminalResidualRows: residual, steadyRows: steady,
    headroomThresholdMs: threshold, headroomPass: processing.p95 !== null && processing.p95 <= threshold,
    runtimeEligible: artifact.schedulingMode === 'causal' && processing.count >= 20
      && processing.p95 <= threshold && backlog.noSustainedBacklog };
}

export async function runSyntheticRuntime({ root, durationMs = 30220, channel = 'chrome', deployments = DEPLOYMENTS }) {
  const stageA = await materializeSyntheticStageARoot({ root: path.join(root, 'audio_only'), durationMs,
    fixtureId: 'non-smd-runtime-tone' });
  const candidates = {};
  for (const deploymentId of deployments) {
    const artifact = await executeOfficialXc1StageACell({ deploymentId, takeId: stageA.take.takeId,
      stageARoot: stageA.root, stageAManifestPath: stageA.manifestPath,
      outputPath: path.join(root, 'cells', `${deploymentId}.json`), browserChannel: channel, headed: true,
      runtimeMode: 'causal' });
    candidates[deploymentId] = runtimeReceipt(artifact);
    console.log(`${deploymentId} P95=${candidates[deploymentId].warmProcessingMs.p95} eligible=${candidates[deploymentId].runtimeEligible}`);
  }
  const report = { phase: PHASE, evidenceClass: 'NON_SMD_PRE_F5_RUNTIME_QUALIFICATION', candidates };
  await atomicJson(path.join(root, 'runtime_report.json'), report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].slice(2)] = process.argv[index + 1];
  if (args['artifact']) {
    const artifact = JSON.parse(await readFile(args.artifact, 'utf8'));
    atomicJson(args.output, runtimeReceipt(artifact)).catch(error => { console.error(error); process.exitCode = 1; });
  } else runSyntheticRuntime({ root: args.root, deployments: args['deployment-id'] ? [args['deployment-id']] : DEPLOYMENTS })
    .catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
}
