import assert from 'node:assert/strict';
export const STEP_ACOUSTIC_GESTURE_MS = 50;
export function intervalGate(anchor, finish, rate) {
  assert.equal(finish, anchor + rate * STEP_ACOUSTIC_GESTURE_MS / 1000, 'H50_ORIGINAL_CONSTRUCTION');
  return { anchor, finish, gestureMs: STEP_ACOUSTIC_GESTURE_MS,
    subtractionResidualNonGating: finish - anchor - rate * STEP_ACOUSTIC_GESTURE_MS / 1000 };
}
const order = (a, b) => a.sourceEventSample - b.sourceEventSample || (a.observationId < b.observationId ? -1 : a.observationId === b.observationId ? 0 : 1);
const unique = values => [...new Set(values)].sort();
const stats = values => {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  const a = [...values].sort((a, b) => a - b); return { count: a.length, p50: a[Math.ceil(a.length * .5) - 1], p95: a[Math.ceil(a.length * .95) - 1], max: a.at(-1) };
};
export function accounting(t) {
  const n = t.counts, last = t.runReceipts.at(-1)?.actualSessionRunCount ?? 0;
  const unresolved = Math.max(0, n.runAttempts - last);
  return { AudioContexts: n.context, rootStreams: n.rootStreams, analysisClones: n.analysisClones, productWorkers: n.workerOwners,
    modelLoadAttempts: n.loadAttempts, modelLoadsSucceeded: n.loadSuccesses, modelSessionsObserved: t.modelReceipt?.actualSessionLoadCount ?? 0,
    neuralRunRequests: n.runAttempts, successfulInferenceResponses: n.runSuccesses, failedInferenceResponses: n.runFailures,
    actualSessionRunsWithReceipts: last, decoderRunsWithReceipts: t.runReceipts.length, unacknowledgedModelRequests: unresolved,
    publications: t.publications.length, attempts: t.attempts.length, retirementBoundaries: t.boundaries.length,
    workerDisposals: n.workerDisposeCalls, sourceDisposals: n.sourceDisposals, captureStopTransitions: n.captureStopTransitions,
    infrastructureFailures: t.infrastructure.length, hiddenWarmups: 0, unknownExecutions: unresolved + Math.max(0, n.loadAttempts - n.loadSuccesses) };
}
export function auditCell(cell, plan, workerEvents) {
  const t = cell.result, n = t.counts, a = accounting(t);
  cell.executionAccounting = a;
  assert.equal(t.status, 'PASS', t.error ?? 'IMMUTABLE_ENTRY_FAILED');
  assert.equal(a.unknownExecutions, 0, 'UNKNOWN_NEURAL_EXECUTION'); assert.equal(a.unacknowledgedModelRequests, 0);
  assert.ok(n.runAttempts <= 96); assert.equal(n.runFailures, 0);
  assert.equal(n.runAttempts, n.runSuccesses); assert.equal(n.runSuccesses, t.runReceipts.length);
  for (const [i, r] of t.runReceipts.entries()) assert.equal(r.actualSessionRunCount, i + 1, 'SESSION_RUN_RECEIPT_SEQUENCE');
  assert.equal(t.publications.length, t.runReceipts.length, 'DECODER_PUBLICATION_RECEIPTS');
  assert.equal(t.modelReceipt.actualSessionLoadCount, 1); assert.equal(t.modelReceipt.ortWebVersion, '1.20.1');
  assert.equal(t.modelReceipt.modelSha256, plan.currentDefaults.modelSHA256); assert.equal(t.modelReceipt.executionProvider, 'webgpu');
  assert.equal(t.modelReceipt.automaticFallback, false);
  for (const name of ['rootStreams', 'analysisClones', 'context', 'workerOwners', 'loadAttempts', 'loadSuccesses', 'sourceRuntimes', 'chronologyInstances', 'assemblerInstances', 'captureConnections']) assert.equal(n[name], 1, 'OWNER_COUNT:' + name);
  const taxonomy = { PRODUCT_ACOUSTIC_OWNER: 0, ORT_RUNTIME_SUBORDINATE: 0, UNCLASSIFIED_RUNTIME_WORKER: 0 };
  for (const w of workerEvents.filter(w => w.cell === cell.id)) taxonomy[w.classification]++;
  assert.equal(taxonomy.PRODUCT_ACOUSTIC_OWNER, 1); assert.equal(taxonomy.UNCLASSIFIED_RUNTIME_WORKER, 0);
  assert.equal(t.afterInputCleanup.input.analysis.counts.regionsStarted, 1);
  assert.equal(n.workerDisposeCalls, 1); assert.equal(n.sourceDisposals, 1); assert.equal(n.captureStopTransitions, 1);
  assert.equal(t.afterInputCleanup.input.analysis.state, 'DISPOSED');
  assert.equal(t.initial.input.resourceState, 'AVAILABLE'); assert.equal(t.initial.input.assembler.phase, 'BLOCKED');
  let end = 0, origin = null;
  assert.ok(t.chronology.length > 0);
  for (const [i, c] of t.chronology.entries()) {
    assert.equal(c.sequence, i); assert.equal(c.start, end); assert.equal(c.end - c.start, c.count); assert.equal(c.rate, cell.rate);
    if (origin === null) origin = c.origin; else assert.equal(c.origin, origin); end = c.end;
  }
  assert.equal(t.afterInputCleanup.input.capture.audioContextOriginFrame, origin);
  const boundaries = [];
  for (const b of t.boundaries) {
    const physical = b.boundary.capturedThroughSourceSample;
    assert.equal(physical, b.before.input.capture.capturedThroughSourceSample);
    assert.equal(physical, b.before.input.analysis.nextSourceSampleIndex);
    assert.equal(b.boundary.sessionTime.sampleIndex, physical); assert.equal(b.sameSynchronousCallStack, true);
    if (!b.initial) assert.equal(b.before.domain.step.attemptState, 'POST_VERDICT');
    const delta = !b.initial && b.before.domain.step.attempts.at(-1)?.verdict === 'MATCH' ? 1 : 0;
    assert.equal(b.after.domain.step.targetGeneration, b.before.domain.step.targetGeneration + delta);
    boundaries.push({ boundary: b.boundary, physical, processed: b.before.input.assembler.processedThroughSourceSample,
      sourceRuntimeNext: b.before.input.analysis.nextSourceSampleIndex, audioContextTime: b.before.contextTime,
      sameSynchronousCallStack: true, domainCommitBeforeArmSourceWitness: 'oracle-isolation.json#synchronousCommit' });
  }
  const all = new Map();
  for (const p of t.publications) for (const o of p.observations) {
    const old = all.get(o.observationId); if (old) assert.deepEqual(o, old, 'MUTATED_OBSERVATION_RECEIPT'); else all.set(o.observationId, o);
    assert.ok(o.sourceEventSample < p.ownedThroughSourceSample);
  }
  const observations = [...all.values()].sort(order), assigned = new Set(), intervals = [];
  for (const [i, attempt] of t.attempts.entries()) {
    assert.equal(attempt.evidence.kind, 'EVIDENCE'); assert.equal(attempt.oracleAssertionAfterRuntime, true);
    assert.equal(attempt.before.version.schemaVersion, 6); assert.equal(attempt.before.version.runtimeVersion, 'step-source-sensitive-verdict-v6');
    const anchor = attempt.identity.attemptStartSessionTime.sampleIndex, finish = attempt.evidence.captureEndSessionTime.sampleIndex;
    const interval = intervalGate(anchor, finish, cell.rate), b = t.boundaries[i]; assert.ok(b);
    assert.ok(anchor > b.boundary.capturedThroughSourceSample, 'STRICT_PHYSICAL_RETIREMENT');
    assert.equal(attempt.identity.targetGeneration, b.after.domain.step.targetGeneration);
    const first = observations.find(o => o.sourceEventSample > b.boundary.capturedThroughSourceSample);
    assert.ok(first); assert.equal(anchor, first.sourceEventSample, 'ASSEMBLER_FIRST_ELIGIBLE_ANCHOR');
    const bounded = observations.filter(o => o.sourceEventSample >= anchor && o.sourceEventSample < finish); assert.ok(bounded.length);
    for (const o of bounded) { assert.ok(!assigned.has(o.observationId), 'OBSERVATION_TWO_ATTEMPTS'); assigned.add(o.observationId); }
    assert.deepEqual(unique(bounded.map(o => o.pitch)), attempt.evidence.observedAttackPitches);
    assert.equal(Math.min(...bounded.map(o => o.confidence)), attempt.evidence.confidence);
    assert.ok(t.publications.some(p => p.ownedThroughSourceSample >= finish), 'SOURCE_FRONTIER_SEAL');
    assert.equal(attempt.after.step.attemptState, 'POST_VERDICT');
    assert.equal(attempt.after.step.targetGeneration, attempt.before.step.targetGeneration);
    assert.equal(attempt.after.step.currentIndex, attempt.before.step.currentIndex);
    // Independent oracle is intentionally after the immutable runtime record is read.
    const observed = unique(attempt.evidence.observedAttackPitches), expected = unique(attempt.expected);
    const oracle = JSON.stringify(observed) === JSON.stringify(expected) ? 'MATCH' : expected.every(p => observed.includes(p)) ? 'RETRY' : 'MISMATCH';
    assert.equal(attempt.record.verdict, oracle);
    intervals.push({ ...interval, committedPhysicalWatermark: b.boundary.capturedThroughSourceSample,
      observationIds: bounded.map(o => o.observationId), evidenceBeforeOracle: true,
      finalizedRecordBeforeOracle: true, isolationSourceWitness: 'oracle-isolation.json#oracle',
      selectedAnchorProvenance: 'First eligible immutable publication observation; production source is frozen; last returned sealed gesture is additionally compared directly' });
  }
  if (t.attempts.length) {
    const last = t.attempts.at(-1), sealed = t.lastSealedGesture; assert.ok(sealed);
    assert.equal(sealed.anchorSourceSample, last.identity.attemptStartSessionTime.sampleIndex);
    assert.equal(sealed.endSourceSample, last.evidence.captureEndSessionTime.sampleIndex); assert.deepEqual(sealed.evidence, last.evidence);
  }
  const teardown = t.teardown.find(x => x.kind === 'INPUT_DISPOSE'); assert.ok(teardown);
  assert.ok(teardown.clone.every(x => x === 'ended')); assert.ok(teardown.root.every(x => x === 'live'));
  if (cell.scenario === 'normal') {
    assert.equal(teardown.contextState, 'running'); assert.ok(t.attempts.length && t.boundaries.length > 1);
  } else {
    assert.equal(cell.scenario, 'context-loss'); assert.ok(t.publications.length >= 2);
    assert.equal(t.beforeInfrastructureLoss.contextTime <= t.afterInfrastructureLoss.contextTime, true);
    assert.ok(t.infrastructure.some(x => x.state === 'suspended'));
    assert.equal(t.applicationFailures.length, 1); assert.equal(teardown.contextState, 'suspended');
    assert.ok(['FAILED', 'DISPOSED'].includes(t.afterInfrastructureLoss.input.resourceState));
    assert.equal(t.afterInfrastructureLoss.domain.step.attempts.length, t.finalDomain.step.attempts.length, 'POST_FAILURE_EVIDENCE');
    assert.equal(t.finalDomain.step.attempts.length, t.attempts.length);
  }
  const cross = t.attempts.flatMap((current, i, attempts) => {
    if (!i) return []; const previous = attempts[i - 1];
    return previous.record.verdict === 'MATCH' && current.identity.targetGeneration === previous.identity.targetGeneration + 1
      && JSON.stringify(current.expected) === JSON.stringify(previous.expected) ? [{ previous: previous.identity, current: current.identity }] : [];
  });
  const repeatedSameTarget = t.attempts.some((current, i, attempts) => i > 0 && current.identity.targetGeneration === attempts[i - 1].identity.targetGeneration
    && current.identity.attemptStartSessionTime.sampleIndex > attempts[i - 1].identity.attemptStartSessionTime.sampleIndex);
  cell.captureChronology = { gapless: true, gaps: 0, fixedOrigin: origin, chunks: t.chronology.length, samples: end, rate: cell.rate };
  cell.independentGates = { workerTaxonomy: taxonomy, ordinaryEvidence: true, intervals, boundaries, observationReuse: 0,
    oneLongLivedGraph: true, physicalRetirementOnly: true, freshSameTarget: repeatedSameTarget ? 'FRESH_SAME_TARGET_ATTEMPTS_OBSERVED' : 'NOT_EXERCISED',
    crossTargetIsolation: cross.length ? cross : 'CROSS_TARGET_SAME_PITCH_ISOLATION_NOT_EVALUATED',
    capturedThroughGreaterThanProcessed: boundaries.some(b => b.processed !== null && b.physical > b.processed),
    contextInterruption: cell.scenario === 'context-loss' ? { infrastructure: t.infrastructure, failures: t.failures, applicationFailures: t.applicationFailures,
      after: t.afterInfrastructureLoss, noReconnect: true, noPostFailureEvidence: true } : 'NOT_APPLICABLE' };
  cell.engineeringDiagnostics = { inferenceMs: stats(t.runReceipts.map(r => r.inferenceMs)),
    verdicts: Object.fromEntries(['MATCH', 'RETRY', 'MISMATCH'].map(v => [v, t.attempts.filter(x => x.record.verdict === v).length])), noPhysicalUXLatencyClaim: true };
  return cell.independentGates;
}
