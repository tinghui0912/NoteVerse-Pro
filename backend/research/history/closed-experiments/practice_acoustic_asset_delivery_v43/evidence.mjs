import assert from 'node:assert/strict';
import { scanText } from './security.mjs';
import { reportSensitiveValues } from './process-result.mjs';

const shapes = {
  REMOTE_FREEZE_AUTHORIZATION: ['qualificationAuthorizationState', 'freezeCommit', 'protocolHash', 'remote', 'remoteVerifiedAt', 'serializedNetworkEvents', 'protectedObjects', 'frozenIndexIdentitiesVerified', 'committedSecretScan', 'productionDiff', 'V3ThroughV42Diff'],
  ANONYMOUS_401: ['status', 'isolated', 'pathname'],
  DELIVERY_CELL: ['name', 'result', 'events', 'inferenceRuns'],
  BROWSER_CAMPAIGN: ['phase', 'stage', 'startedAt', 'browserLaunches', 'network', 'cells', 'pageErrors', 'unknownNetwork', 'inferenceRuns', 'unauthenticatedWitness', 'authenticated', 'finishedAt', 'disposition'],
  TERMINAL_ASSESSMENT: ['disposition', 'firstFailure', 'scope', 'independentAudit', 'coldWarmNotStartedOrStoppedCells', 'history', 'capabilities', 'disclaimers', 'counters', 'noFrozenRetry', 'productionDiff', 'V3ThroughV42Diff', 'capabilitiesUnchanged'],
  REMOTE_RESULT_PROOF: ['subjectCommit', 'identity', 'github', 'checkedAt', 'protectedGitObjectsVerified', 'secretScan', 'productionDiff', 'V3ThroughV42Diff', 'capabilitiesUnchanged', 'resultDisposition', 'serializedEvents', 'selfReference']
};
export function evidence(kind, values) {
  const record = { evidenceSchema: kind, ...values };
  validateEvidence(record); return record;
}
export function validateEvidence(record) {
  assert.ok(shapes[record.evidenceSchema], 'UNKNOWN_EVIDENCE_SCHEMA');
  for (const key of shapes[record.evidenceSchema]) assert.ok(Object.hasOwn(record, key), 'MISSING_EVIDENCE_FIELD_' + key);
  assert.equal(Object.hasOwn(record, 'authorization'), false, 'RESERVED_SECURITY_SENSITIVE_FIELD');
  if (record.evidenceSchema === 'REMOTE_FREEZE_AUTHORIZATION') {
    assert.equal(record.qualificationAuthorizationState, 'V43_FROZEN_DELIVERY_AUTHORIZED');
    assert.match(record.freezeCommit, /^[0-9a-f]{40}$/); assert.match(record.protocolHash, /^[0-9a-f]{64}$/);
  }
  if (record.evidenceSchema === 'BROWSER_CAMPAIGN') {
    if (record.unauthenticatedWitness) validateEvidence(record.unauthenticatedWitness);
    record.cells.forEach(validateEvidence);
  }
}
export function serializeReport(record, forbidden = reportSensitiveValues()) {
  if (record.evidenceSchema) validateEvidence(record);
  const text = JSON.stringify(record, null, 2) + '\n';
  assert.equal(scanText(text, forbidden).length, 0, 'UNSAFE_REPORT_REFUSED');
  return text;
}
export function assessmentRecord(values, contract, scope) {
  return evidence('TERMINAL_ASSESSMENT', {
    scope: 'MODEL_ASSET_DELIVERY_ONLY', independentAudit: null,
    coldWarmNotStartedOrStoppedCells: [...contract.cells], history: contract.historicalStatements,
    capabilities: contract.capabilities, disclaimers: contract.disclaimers, noFrozenRetry: true,
    ...scope, ...values
  });
}
export function safeError(error) {
  const detail = String(error.stack ?? error);
  return { errorClass: error.name, safeCode: error.safeCode ?? 'FROZEN_PROTOCOL_FAILURE',
    detail: scanText(detail, reportSensitiveValues()).length ? 'OUTPUT_REDACTED_FOR_SECRET_SAFETY' : detail.slice(0, 5000) };
}
