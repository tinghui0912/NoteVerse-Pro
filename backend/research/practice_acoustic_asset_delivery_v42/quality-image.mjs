import assert from 'node:assert/strict';
import { captureProcess, requireProcessSuccess } from './process-result.mjs';

export const IMAGE_NAME = 'noteverse-backend-quality:dev';
export function requireImageIdentity(actual, expected) {
  if (!actual) throw Object.assign(Error('QUALITY_IMAGE_UNAVAILABLE'), { safeCode: 'QUALITY_IMAGE_UNAVAILABLE' });
  assert.match(expected, /^sha256:[a-f0-9]{64}$/);
  if (actual.imageId !== expected) throw Object.assign(Error('QUALITY_IMAGE_ID_CHANGED'), { safeCode: 'QUALITY_IMAGE_ID_CHANGED' });
  return actual;
}
export function inspectPreparedImage(expected) {
  const result = captureProcess('docker', ['image', 'inspect', IMAGE_NAME], { timeout: 20000 });
  if (result.exitCode !== 0) throw Object.assign(Error('QUALITY_IMAGE_UNAVAILABLE'), { safeCode: 'QUALITY_IMAGE_UNAVAILABLE' });
  const rows = JSON.parse(requireProcessSuccess(result, 'QUALITY_IMAGE_INSPECT').toString());
  assert.equal(rows.length, 1); const image = rows[0];
  return requireImageIdentity({ domain: 'EXTERNAL_LOCAL_CONTAINER_IMAGE', representation: 'DOCKER_CONTENT_ADDRESSED_IMAGE_ID',
    subject: IMAGE_NAME, imageName: IMAGE_NAME, imageId: image.Id, repoTags: image.RepoTags, createdAt: image.Created,
    architecture: image.Architecture, os: image.Os, entrypoint: image.Config.Entrypoint ?? null, cmd: image.Config.Cmd }, expected);
}
export function failureContext(activeLocalGate, boundary = 'NONE', childProcessLive = false) {
  return { activeLocalGate, orchestratorBoundary: boundary, childProcessLive,
    terminalCause: boundary === 'NONE' ? 'LOCAL_GATE_FAILURE' : 'OUTER_ORCHESTRATOR_TRANSPORT_FAILURE' };
}
export function regressionProof(prepared) {
  assert.equal(prepared.pytestVersion, '9.0.3');
  assert.equal(prepared.collection.exitCode, 0); assert.equal(prepared.collection.testBodiesExecuted, 0);
  assert.equal(prepared.collection.firstModuleCollected, true); assert.equal(prepared.collection.secondModuleCollected, true);
  assert.equal(prepared.repositoryWasClean, true); assert.equal(prepared.phase0B, 'V42_PHASE0B_QUALITY_ENVIRONMENT_READY');
  return { longConstructionIsPreparationNotQualification: true,
    invariant: 'LONG_RUNNING_QUALITY_IMAGE_CONSTRUCTION_IS_ENVIRONMENT_PREPARATION_NOT_QUALIFICATION_EXECUTION',
    qualificationInvariant: 'NO_IMAGE_BUILD_DURING_V42_QUALIFICATION',
    V39HistoricalDispositionUnchanged: true, localGateAndOrchestratorAreSeparate: true,
    outerTransportEnvelopeMs: 300000, backendInnerLimitMs: 90000, completePreflightOuterBudgetMs: 240000,
    noBuildOrPullOrDependencyStartup: true, preparedImageId: prepared.imageId };
}
