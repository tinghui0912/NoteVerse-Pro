import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, OUT, V20, load, bytes, save, hash, now, zero } from './io.mjs';
import { profiles, CONTROL } from './profiles.mjs';
import { covers, classify, uniqueViews, evaluate, rank } from './metrics.mjs';
import { verify } from './control.mjs';

const freeze = await verify(), proof = await load(OUT + '/remote-stage-a-proof.json'), startedAt = now();
assert.equal(proof.stageASealSha256, hash(await bytes(OUT + '/stage-a-seal.json')));
assert.ok(proof.remoteVerifiedAt < startedAt); assert.equal(proof.commit, proof.remoteHead);
for (const f of proof.artifacts) assert.equal(hash(await bytes(f.path)), f.sha256);
await save(OUT + '/stage-b-started.json', { startedAt, proof, executionsAllowed: 1, zero });
const completedProfiles = [], evaluatedRows = []; let productVerdictRuns = 0;
try {
  const plan = await load(OUT + '/replay-plan.json'), manifest = await load(V20 + '/tensor-corpus-manifest.json');
  const bundle = freeze.bundles.find(b => b.name === 'domain');
  assert.equal(hash(await bytes(bundle.path)), bundle.sha256);
  const d = await import(pathToFileURL(path.join(ROOT, bundle.path)).href); assert.equal(d.GESTURE_WIDTH_MS, 50);
  const all = [];
  for (const profile of profiles) {
    const decoded = await load(proof.artifacts.find(f => f.profileId === profile.profileId).path), rows = [];
    for (const fixed of plan.rows) {
      const job = decoded.jobs.find(j => j.jobId === fixed.jobId), w = manifest.windows.find(w => w.jobId === fixed.jobId);
      assert.equal(w.sourceRateHz, fixed.rate);
      const gate = new d.WaitingTopologyGate(fixed.rate, 'evidence-only', fixed.eligibilityBoundarySample, fixed.semanticEndSample, 1, 0);
      gate.arm(fixed.eligibilityBoundarySample, 0);
      let assembly = null;
      for (const p of job.publications) {
        gate.accept({ publicationId: `${p.sourceDomainId}:w${p.window.windowIndex}`,
          frontier: w.sourceOriginSample + p.window.ownedEndTarget * fixed.rate / 16000,
          capturedThrough: fixed.eligibilityBoundarySample, wallMs: 0, observations: p.observations });
        const sealed = gate.actions.find(a => a.type === 'SEAL');
        if (sealed) { assembly = sealed.attempt; break; }
      }
      if (!assembly && gate.actions.some(a => a.type === 'OPEN')) throw Error('H50_COVERAGE_INCOMPLETE');
      const row = { ...fixed, acousticObserved: [], observations: [], assembly, gateActions: gate.actions,
        gateReceipts: gate.receipts, productRecord: null, submittedEvidence: null,
        status: assembly ? 'RECONSTRUCTED_H50_ATTEMPT' : 'NO_ELIGIBLE_ACOUSTIC_GESTURE',
        physicalTargetSupported: covers(fixed.physicalTruth, fixed.expected), profileId: profile.profileId };
      if (assembly) {
        const sourceMs = assembly.anchor * 1000 / fixed.rate;
        const nearest = fixed.attributionGestures.map(g => ({ gestureId: g.gestureId, distanceMs: Math.abs(g.onsetMs - sourceMs) }))
          .filter(g => g.distanceMs <= 100).sort((a,b) => a.distanceMs - b.distanceMs);
        assert.ok(nearest.length && nearest[0].gestureId === fixed.physicalGestureId, 'INTENDED_GESTURE_ATTRIBUTION_MISMATCH');
        assert.ok(nearest.length < 2 || nearest[0].distanceMs !== nearest[1].distanceMs, 'AMBIGUOUS_TRUTH_ATTRIBUTION');
        row.attribution = nearest[0]; row.observations = assembly.observations;
        row.acousticObserved = [...new Set(assembly.observations.map(o => o.midiPitch))].sort((a,b) => a-b);
        const h = d.runtime([fixed.expected], `v21:${profile.profileId}:${fixed.rowId}`);
        const project = sample => plan.epoch.readyMs + (sample - fixed.eligibilityBoundarySample) * 1000 / fixed.rate;
        assert.ok(project(assembly.end) < plan.epoch.rearmMs, 'FIXED_EPOCH_OVERFLOW');
        h.owner.setInputUnavailable(); h.owner.acceptInputAfter(h.time(plan.epoch.readyMs));
        const ready = h.owner.snapshot();
        assert.equal(ready.version.schemaVersion, 6); assert.equal(ready.version.runtimeVersion, 'step-source-sensitive-verdict-v6');
        assert.equal(h.owner.verdictPolicy, 'MICROPHONE_CONSERVATIVE_TRISTATE');
        assert.equal(h.owner.openAttempt(h.time(plan.epoch.readyMs)), null);
        h.clock.set(project(assembly.anchor));
        const identity = h.owner.openAttempt(h.time(h.clock.nowMs())); assert.ok(identity);
        assert.equal(h.owner.analyzeAttempt(identity), true);
        const evidence = { kind: 'EVIDENCE', observedAttackPitches: [...assembly.pitches], confidence: assembly.confidence,
          captureEndSessionTime: h.time(project(assembly.end)) };
        productVerdictRuns++;
        const result = h.owner.completeAttempt(identity, evidence); assert.equal(result.kind, 'FINALIZED');
        const postVerdict = h.owner.snapshot(); assert.equal(postVerdict.step.attemptState, 'POST_VERDICT');
        assert.equal(postVerdict.step.targetGeneration, ready.step.targetGeneration);
        assert.equal(h.owner.openAttempt(h.time(project(assembly.end) + 1)), null);
        assert.deepEqual(result.record.observedAttackPitches, [...new Set(evidence.observedAttackPitches)].sort());
        assert.equal(result.record.confidence, evidence.confidence);
        h.clock.set(plan.epoch.rearmMs); h.owner.rearm(h.time(h.clock.nowMs()));
        const rearmed = h.owner.snapshot();
        assert.equal(rearmed.step.targetGeneration, ready.step.targetGeneration + (result.record.verdict === 'MATCH' ? 1 : 0));
        assert.equal(h.owner.openAttempt(h.time(h.clock.nowMs())), null);
        row.identity = identity; row.productRecord = result.record; row.submittedEvidence = evidence;
        row.domainTrace = { ready, postVerdict, rearmed }; row.verdictOwner = 'StepPracticeRuntime.completeAttempt';
      }
      row.classification = classify(row.productRecord?.verdict ?? null, row.physicalTargetSupported);
      row.requiredPitchPresence = fixed.expected.map(p => ({ midiPitch: p, present: row.acousticObserved.includes(p) }));
      rows.push(row); evaluatedRows.push(row);
    }
    all.push({ profile, rows, decoded });
  }
  const baseline = all.find(a => a.profile.profileId === CONTROL);
  for (const r of baseline.rows) {
    assert.deepEqual(r.acousticObserved, r.baselineObserved, 'BASELINE_H50_OBSERVATION_PARITY');
    assert.deepEqual(r.observations.map(o => o.observationId), r.baselineObservationIds);
    assert.equal(r.productRecord?.verdict, r.baselineVerdict); assert.equal(r.classification, r.baselineClassification);
  }
  const baseViews = uniqueViews(baseline.rows);
  assert.deepEqual(baseViews.filter(r => r.classification === 'SAFE_MATCH').map(r => r.viewId).sort(), plan.baselineSafeMatchViewIds);
  assert.deepEqual(baseViews.filter(r => !r.physicalTargetSupported && covers(r.acousticObserved, r.expected)).map(r => r.viewId).sort(), plan.baselineUnsupportedCoveredViewIds);
  const results = [];
  for (const item of all) {
    const result = evaluate(item.rows, baseline.rows, item.profile);
    const scores = { onset: [], frame: [] };
    for (const job of item.decoded.jobs) for (const w of job.rawDerivedEvents) for (const e of w.events) {
      scores.onset.push(e.onsetScore); scores.frame.push(e.frameScore);
    }
    result.acousticDiagnostics = { totalDecodedEvents: scores.onset.length,
      totalOwnedObservations: item.decoded.jobs.reduce((n,j) => n + j.publications.reduce((n,p) => n + p.observations.length, 0), 0),
      observationsPerJob: item.decoded.jobs.map(j => ({ jobId: j.jobId, observations: j.publications.reduce((n,p) => n + p.observations.length, 0) })),
      scores: Object.fromEntries(Object.entries(scores).map(([k,a]) => [k, { count: a.length, min: a.length ? Math.min(...a) : null,
        max: a.length ? Math.max(...a) : null, mean: a.length ? a.reduce((n,v) => n+v,0) / a.length : null }])),
      unmatchedExcessScope: 'Assembled pitch proposals outside frozen physical attack set; not full-take truth alignment or physical extra-key claims' };
    const p = OUT + '/stage-b/' + item.profile.profileId + '.json';
    await save(p, { profile: item.profile, rows: item.rows, result, zero });
    completedProfiles.push({ profileId: item.profile.profileId, path: p, sha256: hash(await bytes(p)) });
    results.push(result);
  }
  const selection = rank(results.filter(r => r.profileId !== CONTROL));
  await verify();
  await save(OUT + '/study-results.json', { phase: 'ROBUST_A_THRESHOLD_OPERATING_POINT_V21', startedAt, completedAt: now(),
    classification: freeze.classification, proof, artifacts: completedProfiles, selection,
    nominatedCandidate: selection.selected ? profiles.find(p => p.profileId === selection.selected) : null,
    profiles: results.map(r => ({ ...Object.fromEntries(Object.entries(r).filter(([key]) => key !== 'targetViews')),
      targetViewArtifact: completedProfiles.find(f => f.profileId === r.profileId).path })),
    denominators: { counterfactualRowsPerProfile: plan.rows.length, targetViewsPerProfile: plan.targetViewIds.length,
      physicalRateUnits: plan.physicalUnits.length, physicalGesturesIgnoringRate: plan.rateIgnoredPhysicalGestures.length,
      ratesCorrelatedNotIndependentRecordings: true, populationEstimate: 'NOT_GENERALIZABLE_PRODUCT_RATE' },
    receipt: { ...zero, stageADecoderCalls: 4560, StageBDecoderCalls: 0, productVerdictRuns,
      evidenceOnly: true, externalP2Executions: 0, profiles: 20 },
    baselineControlV17V18Parity: true, geometryChanged: false, productionDefaultChanged: false,
    sharedDefault: { onset: 0.30, frame: 0.05, geometry: { owned: 600, past: 1050, future: 170 } },
    promotion: 'SHARED_DEFAULT_PROMOTION_BLOCKED_PENDING_BROAD_CONTINUOUS_REGRESSION_AND_FRESH_QUALIFICATION',
    microphoneCooldownSelected: false, futureQualificationStarted: false, freshHoldoutSelected: false,
    capabilities: { Continuous: 'MODEL_NOT_VALIDATED', STEP: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false, D4: false },
    disposition: selection.disposition, nextAllowedPhase: 'INDEPENDENT_AUDIT_ONLY_STOP_NO_AUTOMATIC_EXECUTION' });
  console.log(JSON.stringify({ selection, productVerdictRuns, profiles: results.length }));
} catch (error) {
  await save(OUT + '/stage-b-failure.json', { failedAt: now(), failure: String(error.stack ?? error), completedProfiles,
    evaluatedRows, productVerdictRuns, zero, rerunAllowed: false, disposition: 'ROBUST_V21_THRESHOLD_STUDY_INTEGRITY_BLOCKED' });
  throw error;
}
