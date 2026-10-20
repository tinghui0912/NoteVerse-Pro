import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const report = JSON.parse(readFileSync(new URL('../reports/step_waiting_h50_holdout_v2/inventory.json',import.meta.url)));
test('every current local SMD recording has an explicit completed Robust execution receipt', () => {
  assert.equal(report.localRecordings.length,50);
  assert.equal(report.counts.unusedPrimaryRecordings,0);
  for (const source of report.localRecordings) {
    assert.equal(source.primaryEligible,false);
    assert.ok(source.priorActualExecution.length > 0);
    assert.match(source.audioSha256,/^[a-f0-9]{64}$/);
    assert.match(source.midiSha256,/^[a-f0-9]{64}$/);
    for (const receipt of source.priorActualExecution) {
      assert.equal(receipt.execution.candidateId,'robust-browser-v1');
      assert.equal(receipt.execution.status,'XC1_STAGE_A_SCIENTIFIC_PREDICTION_COMPLETE');
      assert.ok(receipt.execution.actualInferenceSessionRunCount > 0);
    }
  }
});
test('all required prior phase families are represented in the exclusion ledger', () => {
  const families = new Set(report.priorExposureInventory.flatMap(r=>r.evidence.map(e=>e.family)));
  for (const name of ['F5_REAL_BROWSER_ROBUST_ALL_TAKES','CONTINUOUS_PAIRED_REPLAY',
    'STEP_DECODED_SUFFICIENCY_AND_H_WINDOW_DEVELOPMENT','FRESH_STRIKE_DEVELOPMENT','WAITING_ATTEMPT_V2',
    'TOPOLOGY_V3_AND_AFTER_CAPTURE_PREFLIGHT','HISTORICAL_STEP_TRIGGER_RESEARCH']) assert.ok(families.has(name));
  assert.equal(new Set(report.priorExposureInventory.map(r=>r.recordingId)).size,report.priorExposureInventory.length);
});
test('the source selector opens metadata receipts, not candidate predictions or scores', () => {
  assert.equal(report.candidateModelOutputsOpened,false);
  assert.equal(report.candidateScoresOpened,false);
  assert.equal(report.audioPcmDecoded,false);
  assert.equal(report.candidateMidiEventsParsed,false);
  const code = readFileSync(new URL('./inventory.py',import.meta.url),'utf8');
  const files = [...code.matchAll(/read_receipt\('([^']+)'/g)].map(m=>m[1]);
  assert.equal(files.length,9);
  assert.ok(files.every(f=>!/\/acoustic\.json|\/scores\.json|raw_output|raw_tensor/.test(f)));
});
test('zero opportunity counts are NOT turned into safety PASS or inherited regression PASS', () => {
  assert.equal(report.disposition,'STEP_WAITING_H50_HOLDOUT_TOPOLOGY_NOT_ESTABLISHED');
  assert.equal(report.primaryCorpusManifest.selected.length,0);
  assert.equal(report.primaryCorpusManifest.selectedRapidSinglePair,null);
  assert.equal(report.qualification.freezeCommit,null);
  assert.equal(report.qualification.actualModelRuns,0);
  assert.equal(report.qualification.safetyCounters,null);
  assert.equal(report.qualification.opportunityDenominators,0);
  assert.equal(report.qualification.continuousRegression,'NOT_STARTED_PREFLIGHT_BLOCKED');
  assert.equal(report.productionDiff,'');
});
