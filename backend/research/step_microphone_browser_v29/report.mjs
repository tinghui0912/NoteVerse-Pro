import assert from 'node:assert/strict';
import { DIR, OUT, START, load, save, exists, now, scope, zero } from './io.mjs';
import { auditCell, accounting } from './audit.mjs';
import { verify } from './control.mjs';

const contract = await load(DIR + '/contract.json'); scope();
let disposition = contract.integrityDisposition, failure = null, raw = null, cells = [], totals = zero();
if (await exists(OUT + '/preflight-failure.json')) {
  failure = await load(OUT + '/preflight-failure.json');
  cells = contract.cells.map(c => ({ ...c, status: 'NOT_EXECUTED' }));
} else if (await exists(OUT + '/browser-campaign.json')) {
  raw = await load(OUT + '/browser-campaign.json'); cells = raw.cells; failure = raw.failure;
  const sums = {};
  for (const c of cells) if (c.result?.counts) for (const [key, value] of Object.entries(accounting(c.result))) sums[key] = (sums[key] ?? 0) + value;
  totals = { ...totals, ...sums, chromeLaunches: raw.chromeLaunches, browserContexts: raw.browserContexts, neuralRuns: sums.actualSessionRunsWithReceipts ?? 0,
    modelSessionLoads: sums.modelSessionsObserved ?? 0, decoderRuns: sums.decoderRunsWithReceipts ?? 0,
    browserProductVerdictRuns: sums.attempts ?? 0, hiddenWarmups: sums.hiddenWarmups ?? 0, unknownExecutions: sums.unknownExecutions ?? 0 };
  if (raw.failure) disposition = raw.disposition;
  else {
    try {
      const freeze = await verify(); assert.equal(cells.length, 4);
      assert.deepEqual(cells.map(c => c.id), contract.cells.map(c => c.id));
      assert.equal(raw.remoteProofPrecededLaunch, true); assert.equal(raw.campaigns, 1); assert.equal(raw.chromeLaunches, 1); assert.equal(raw.cellRetries, 0);
      assert.equal(raw.forbiddenRequests, 0); assert.equal(raw.externalRequests, 0);
      for (const cell of cells) { assert.equal(cell.status, 'PASS'); auditCell(cell, freeze.campaignContract, raw.workers); }
      disposition = contract.successDisposition;
    } catch (error) {
      failure = { firstPostBrowserAuditFailure: String(error.stack ?? error) };
      await save('post-browser-audit-failure.json', { at: now(), disposition: contract.integrityDisposition, failure, repairOrRetry: false });
    }
  }
} else {
  failure = { code: 'NO_BROWSER_RESULT_OR_PREFLIGHT_FAILURE', executionNotInferred: true };
  cells = contract.cells.map(c => ({ ...c, status: 'NOT_EXECUTED' }));
}
const result = { phase: contract.phase, disposition, at: now(), startingHead: START, historicalStatements: contract.historicalStatements,
  historicalDispositions: contract.historicalDispositions, browser: raw?.browser ?? null, GPU: raw?.GPU ?? null, freezeProof: raw?.proof ?? null,
  cells: cells.map(c => ({ id: c.id, rate: c.rate, status: c.status, error: c.error ?? null, modelReceipt: c.result?.modelReceipt ?? null,
    accounting: c.executionAccounting ?? null, chronology: c.captureChronology ?? null, gates: c.independentGates ?? null,
    diagnostics: c.engineeringDiagnostics ?? null, teardown: c.result?.teardown ?? null, infrastructure: c.result?.infrastructure ?? null,
    attempts: c.result?.attempts.map(a => ({ identity: a.identity, evidence: a.evidence, expected: a.expected, record: a.record,
      before: { index: a.before.step.currentIndex, generation: a.before.step.targetGeneration }, after: { index: a.after.step.currentIndex, generation: a.after.step.targetGeneration } })) ?? [] })),
  totals, failure, rawReceiptAuthority: 'browser-campaign.json; independent audit recomputes gates; entry PASS is necessary but not sufficient',
  oracleIsolation: await exists(OUT + '/oracle-isolation.json') ? await load(OUT + '/oracle-isolation.json') : 'NOT_EXECUTED',
  localEvidence: await exists(OUT + '/local-verification.json') ? await load(OUT + '/local-verification.json') : 'PRE_EXECUTION_STOP',
  defaults: contract.currentDefaults, capabilities: contract.capabilities, cooldown: contract.cooldown,
  rootLoss: contract.rootLoss, disclaimers: contract.disclaimers, assetDelivery: contract.assetDelivery,
  freshHoldoutAccess: 0, tuning: false, productionDiff: [], V3ThroughV28Diff: [], CI: contract.CI,
  stop: 'STOP_FOR_INDEPENDENT_AUDIT_NO_CONTROLLER_OR_CAPABILITY_INTEGRATION' };
await save('assessment.json', result);
await save('assessment.md', '# V29 Browser Core and Context Interruption\n\n' + disposition + '\n\n' + contract.historicalStatements.join('\n\n') + '\n\n' +
  'Cells: ' + cells.map(c => c.id + '=' + c.status).join(', ') + '.\n\n' +
  'Raw receipts: browser-campaign.json when execution occurred. Machine-readable independently derived gates, intervals, physical boundaries, runtime records, worker taxonomy, teardown and counters are retained in assessment.json. No acoustic observations or EVIDENCE were injected. Recognition verdicts are diagnostic only.\n\n' +
  'Execution totals: ' + JSON.stringify(totals) + '.\n\n' +
  'First failure (if any): ' + JSON.stringify(failure) + '. No same-phase patch, repair or rerun.\n\n' +
  'The passive expected snapshot is accepted only under the frozen AST isolation witness: no expected use or flow before successful runtime FINALIZED, original identity/EVIDENCE passed to runtime. Runtime owns verdict/progression. H50 uses its exact original construction, not subtraction equality or tolerance. Captured-through alone owns retirement; processed frontier is not retirement.\n\n' +
  'Fresh attempts on an unchanged target are not cross-target isolation. Each cell reports FRESH_SAME_TARGET_ATTEMPTS_OBSERVED and/or CROSS_TARGET_SAME_PITCH_ISOLATION_NOT_EVALUATED when appropriate. No natural MATCH is required or forced.\n\n' +
  contract.rootLoss + '\n\n' + contract.disclaimers.join('\n\n') + '\n\n' +
  'Frozen V26 bundles/WAV are reused without rebuild. Production and V3-V28 remain unchanged. Shared Robust, decoder A .30/.05, 600/1050/170, schema6 and all closed capabilities remain current. No fixed cooldown, recognition qualification or physical latency claim. Backend asset access API is not exercised.\n\n' +
  'Local tests, typecheck, lint and Chromium execution are not GitHub CI. CI is deferred and not a success gate; actual final remote statuses/workflows are queried separately. STOP for independent audit.\n');
console.log(JSON.stringify({ disposition, totals, cells: cells.map(c => ({ id: c.id, status: c.status })) }));
