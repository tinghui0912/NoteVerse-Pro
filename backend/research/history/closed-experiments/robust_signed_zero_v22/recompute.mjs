import assert from 'node:assert/strict';
import { identityJSON, compareVectors, vectorsEqual } from './numeric.mjs';

const labels = ['SAFE_MATCH','DANGEROUS_FALSE_MATCH','SUPPORTED_RETRY','UNSUPPORTED_RETRY',
  'SUPPORTED_MISMATCH','TRUE_REJECT','SUPPORTED_NO_ATTEMPT','UNSUPPORTED_NO_ATTEMPT'];
const orderedSet = values => Array.from(new Set(values)).sort((a,b) => a-b);
export const targetCovered = (expected, pitches) => expected.every(p => pitches.includes(p));

export function physicalIdentity(row, includeRate = true) {
  const identity = { recordingId: row.recordingId, physicalGestureId: row.physicalGestureId,
    physicalTruth: orderedSet(row.physicalTruth) };
  if (includeRate) identity.sourceRateHz = row.rate;
  return identityJSON(identity);
}
export const targetIdentity = row => physicalIdentity(row) + ':target:' + identityJSON(orderedSet(row.expected));

export function physicalClassification(verdict, support) {
  const table = { MATCH: ['DANGEROUS_FALSE_MATCH','SAFE_MATCH'], RETRY: ['UNSUPPORTED_RETRY','SUPPORTED_RETRY'],
    MISMATCH: ['TRUE_REJECT','SUPPORTED_MISMATCH'], NO_ATTEMPT: ['UNSUPPORTED_NO_ATTEMPT','SUPPORTED_NO_ATTEMPT'] };
  const pair = table[verdict === null ? 'NO_ATTEMPT' : verdict];
  if (!pair) throw Error('UNKNOWN_SERIALIZED_VERDICT');
  return pair[Number(support)];
}

/** Consume immutable evidence rows, not stored support/classification summary fields. */
export function verifyRows(rows, check) {
  return rows.map(row => {
    assert.ok([44100,48000].includes(row.rate));
    const supported = targetCovered(row.expected, row.physicalTruth);
    const verdict = row.productRecord ? row.productRecord.verdict : null;
    const classification = physicalClassification(verdict, supported);
    check(supported, row.physicalTargetSupported, row.rowId + ':physicalSupport');
    check(classification, row.classification, row.rowId + ':classification');
    if (row.productRecord) {
      assert.equal(row.submittedEvidence.kind, 'EVIDENCE');
      assert.equal(row.domainTrace.ready.version.schemaVersion, 6);
      assert.equal(row.domainTrace.ready.version.runtimeVersion, 'step-source-sensitive-verdict-v6');
      const observed = orderedSet(row.observations.map(o => o.midiPitch));
      check(observed, row.acousticObserved, row.rowId + ':serializedObservationSet');
      assert.equal(row.productRecord.confidence, row.submittedEvidence.confidence);
    } else {
      assert.equal(row.status, 'NO_ELIGIBLE_ACOUSTIC_GESTURE');
      assert.equal(row.submittedEvidence, null); assert.equal(row.assembly, null);
    }
    return { ...row, physicalTargetSupported: supported, classification };
  });
}

export function groupViews(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = targetIdentity(row);
    if (map.has(key)) {
      const previous = map.get(key);
      assert.deepEqual([row.acousticObserved,row.classification], [previous.acousticObserved,previous.classification], 'DUPLICATE_TARGET_VIEW_DIVERGENCE');
    } else {
      map.set(key, { ...row, viewId: key, physicalUnitId: physicalIdentity(row),
        physicalGestureKey: physicalIdentity(row, false), multiplicity: 0, rowIds: [] });
    }
    const view = map.get(key); view.multiplicity += 1; view.rowIds.push(row.rowId);
  }
  return Array.from(map.values());
}

function ratio(numerator, denominator) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

export function statistics(rows) {
  const classifications = Object.fromEntries(labels.map(k => [k,0]));
  const verdicts = { MATCH:0, RETRY:0, MISMATCH:0 };
  let attempts = 0, requiredPitches = 0, presentPitches = 0, supportViews = 0, unsupportedViews = 0,
    coveredSupport = 0, coveredUnsupported = 0, excess = 0;
  for (const row of rows) {
    classifications[row.classification] += 1;
    if (row.productRecord) { attempts++; verdicts[row.productRecord.verdict]++; }
    if (row.physicalTargetSupported) {
      supportViews++; requiredPitches += row.expected.length;
      presentPitches += row.expected.filter(p => row.acousticObserved.includes(p)).length;
      if (targetCovered(row.expected, row.acousticObserved)) coveredSupport++;
    } else {
      unsupportedViews++;
      if (targetCovered(row.expected, row.acousticObserved)) coveredUnsupported++;
    }
    excess += row.acousticObserved.filter(p => !row.physicalTruth.includes(p)).length;
  }
  return { intendedGestureTargetViews: rows.length, H50AttemptCoverage: ratio(attempts,rows.length), NO_ATTEMPT: rows.length-attempts,
    verdicts, classifications, requiredTargetPitchRecall: ratio(presentPitches,requiredPitches),
    allRequiredTargetsPresent: ratio(coveredSupport,supportViews), cleanExactTargetRate: ratio(classifications.SAFE_MATCH,supportViews),
    safeAutoMatchCoverage: ratio(classifications.SAFE_MATCH,supportViews), supportedAmbiguityRetryRate: ratio(classifications.SUPPORTED_RETRY,supportViews),
    unsupportedTargetHallucination: ratio(coveredUnsupported,unsupportedViews), rawAssembledExcessPitchProposals: excess,
    rawExcessMeaning: 'MODEL_QUALITY_DIAGNOSTIC_NOT_PHYSICAL_EXTRA_KEY_ERROR_NOT_SELECTION_OBJECTIVE' };
}

export function acousticStatistics(jobs) {
  const scores = { onset: [], frame: [] }, perJob = [];
  let observations = 0;
  for (const job of jobs) {
    let count = 0;
    for (const p of job.publications) count += p.observations.length;
    observations += count; perJob.push({ jobId: job.jobId, observations: count });
    for (const window of job.rawDerivedEvents) for (const event of window.events) {
      scores.onset.push(event.onsetScore); scores.frame.push(event.frameScore);
    }
  }
  const moments = Object.fromEntries(Object.entries(scores).map(([name, values]) => {
    let sum = 0, min = Infinity, max = -Infinity;
    for (const value of values) { sum += value; min = Math.min(min,value); max = Math.max(max,value); }
    return [name, { count:values.length, min:values.length ? min : null, max:values.length ? max : null,
      mean:values.length ? sum / values.length : null }];
  }));
  return { totalDecodedEvents:scores.onset.length, totalOwnedObservations:observations, observationsPerJob:perJob, scores:moments,
    unmatchedExcessScope:'Assembled pitch proposals outside frozen physical attack set; not full-take truth alignment or physical extra-key claims' };
}

export function recompute(rows, baselineRows, profile) {
  const targetViews = groupViews(rows), control = groupViews(baselineRows), lookup = new Map(control.map(v => [v.viewId,v]));
  assert.deepEqual(targetViews.map(v=>v.viewId).sort(),control.map(v=>v.viewId).sort(),'CANDIDATE_CHANGED_DENOMINATOR');
  const covered = list => list.filter(v => !v.physicalTargetSupported && targetCovered(v.expected,v.acousticObserved)).map(v=>v.viewId).sort();
  const unsupported = covered(targetViews), baselineUnsupported = covered(control), newUnsupported = unsupported.filter(id=>!baselineUnsupported.includes(id));
  const regressed = [], recovered = [];
  for (const view of targetViews) {
    const previous = lookup.get(view.viewId);
    if (previous.classification === 'SAFE_MATCH' && view.classification !== 'SAFE_MATCH') regressed.push(view.viewId);
    if (previous.classification === 'SUPPORTED_RETRY' && view.classification === 'SAFE_MATCH') recovered.push(view);
  }
  const groupedRecoveries = new Map();
  for (const view of recovered) {
    const key = view.physicalGestureKey + ':target:' + identityJSON(view.expected);
    if (!groupedRecoveries.has(key)) groupedRecoveries.set(key, { gesture:view.physicalGestureKey, expected:view.expected,
      recording:view.recordingId, rates:new Set(), ids:[] });
    const g = groupedRecoveries.get(key); g.rates.add(view.rate); g.ids.push(view.viewId);
  }
  const pairedByGesture = new Map();
  for (const recovery of groupedRecoveries.values()) {
    if (!recovery.rates.has(44100) || !recovery.rates.has(48000)) continue;
    if (!pairedByGesture.has(recovery.gesture)) pairedByGesture.set(recovery.gesture, { physicalGestureKey:recovery.gesture,
      recordingId:recovery.recording, rates:[44100,48000], pairedTargetViews:[] });
    pairedByGesture.get(recovery.gesture).pairedTargetViews.push({ expected:recovery.expected, viewIds:recovery.ids });
  }
  const paired = Array.from(pairedByGesture.values()), views = statistics(targetViews), c = views.classifications;
  const reasons = [];
  if (c.DANGEROUS_FALSE_MATCH !== 0) reasons.push('DANGEROUS_FALSE_MATCH');
  if (newUnsupported.length > 0 || unsupported.length > baselineUnsupported.length) reasons.push('NEW_UNSUPPORTED_TARGET_HALLUCINATION');
  if (c.SUPPORTED_MISMATCH !== 0 || c.SUPPORTED_NO_ATTEMPT !== 0 || views.allRequiredTargetsPresent.numerator !== views.allRequiredTargetsPresent.denominator) reasons.push('REQUIRED_TARGET_RECALL_REGRESSION');
  if (regressed.length > 0) reasons.push('BASELINE_SAFE_MATCH_REGRESSION');
  if (recovered.length === 0) reasons.push('NO_STRICT_SAFE_AUTO_MATCH_IMPROVEMENT');
  const recordings = Array.from(new Set(paired.map(v=>v.recordingId))).sort();
  const eligible = reasons.length === 0, meaningful = eligible && paired.length >= 2 && recordings.length >= 2;
  return { profileId:profile.profileId, rows:statistics(rows), views,
    byRate:[44100,48000].map(rate=>({ rate, rows:statistics(rows.filter(v=>v.rate===rate)), views:statistics(targetViews.filter(v=>v.rate===rate)) })),
    targetViews, unsupportedCoveredViewIds:unsupported, baselineUnsupportedCoveredViewIds:baselineUnsupported,
    newUnsupportedCoveredViewIds:newUnsupported, baselineSafeMatchRegressions:regressed,
    newlyRecoveredSafeTargetViewIds:recovered.map(v=>v.viewId), pairedRecoveredPhysicalGestures:paired,
    recoveredDistinctPhysicalGestures:new Set(recovered.map(v=>v.physicalGestureKey)).size,
    pairedRecoveredRecordingIds:recordings, eligibility:eligible ? 'ELIGIBLE' : 'INELIGIBLE', reasons, meaningful,
    nominationStatus:meaningful ? 'MEANINGFUL_ELIGIBLE_CHALLENGER' : eligible ? 'ELIGIBLE_BUT_IMPROVEMENT_TOO_SPARSE_FOR_CHALLENGER_NOMINATION' : 'INELIGIBLE',
    safetyStatus:c.DANGEROUS_FALSE_MATCH ? 'SAFETY_INELIGIBLE' : 'NO_DANGEROUS_MATCH_OBSERVED_ON_EXPOSED_VIEWS',
    rankingComponents:[paired.length,c.SAFE_MATCH,-unsupported.length,-c.SUPPORTED_RETRY,-profile.gridStepDistance] };
}

export function selection(profiles) {
  const order = profiles.filter(p=>p.meaningful).sort((a,b)=>compareVectors(a.rankingComponents,b.rankingComponents));
  const leaders = order.filter(p=>vectorsEqual(p.rankingComponents,order[0].rankingComponents));
  return { order:order.map(p=>({profileId:p.profileId,rankingComponents:p.rankingComponents})),
    leaders:leaders.map(p=>p.profileId), selected:leaders.length===1 ? leaders[0].profileId : null,
    disposition:leaders.length===0 ? 'ROBUST_V21_THRESHOLD_GRID_NO_SAFE_USABILITY_CHALLENGER_BASELINE_RETAINED'
      : leaders.length===1 ? 'ROBUST_V21_THRESHOLD_DEVELOPMENT_CHALLENGER_NOMINATED'
      : 'ROBUST_V21_MULTIPLE_EQUIVALENT_THRESHOLD_CHALLENGERS_NO_UNIQUE_SELECTION' };
}
