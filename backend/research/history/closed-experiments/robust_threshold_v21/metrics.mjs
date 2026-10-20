import { canonical } from './io.mjs';
export const set = a => [...new Set(a)].sort((x, y) => x - y);
export const covers = (observed, expected) => expected.every(p => observed.includes(p));
export function physicalKey(r, ignoreRate = false) {
  return canonical({ recordingId: r.recordingId, physicalGestureId: r.physicalGestureId,
    ...(ignoreRate ? {} : { sourceRateHz: r.rate }), physicalTruth: set(r.physicalTruth) });
}
export const viewKey = r => physicalKey(r) + ':target:' + canonical(set(r.expected));
export function classify(verdict, supported) {
  if (verdict === null) return supported ? 'SUPPORTED_NO_ATTEMPT' : 'UNSUPPORTED_NO_ATTEMPT';
  if (verdict === 'MATCH') return supported ? 'SAFE_MATCH' : 'DANGEROUS_FALSE_MATCH';
  if (verdict === 'RETRY') return supported ? 'SUPPORTED_RETRY' : 'UNSUPPORTED_RETRY';
  if (verdict !== 'MISMATCH') throw Error('UNKNOWN_RUNTIME_VERDICT');
  return supported ? 'SUPPORTED_MISMATCH' : 'TRUE_REJECT';
}
export function uniqueViews(rows) {
  const views = new Map();
  for (const r of rows) {
    const id = viewKey(r), old = views.get(id);
    if (old && canonical([old.acousticObserved, old.classification]) !== canonical([r.acousticObserved, r.classification])) throw Error('DUPLICATE_TARGET_VIEW_DIVERGENCE');
    if (!old) views.set(id, { ...r, viewId: id, physicalUnitId: physicalKey(r), physicalGestureKey: physicalKey(r, true), multiplicity: 0, rowIds: [] });
    views.get(id).multiplicity++; views.get(id).rowIds.push(r.rowId);
  }
  return [...views.values()];
}
export const classes = ['SAFE_MATCH','DANGEROUS_FALSE_MATCH','SUPPORTED_RETRY','UNSUPPORTED_RETRY',
  'SUPPORTED_MISMATCH','TRUE_REJECT','SUPPORTED_NO_ATTEMPT','UNSUPPORTED_NO_ATTEMPT'];
const fraction = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
export function summarize(rows) {
  const supported = rows.filter(r => r.physicalTargetSupported), unsupported = rows.filter(r => !r.physicalTargetSupported);
  const count = k => rows.filter(r => r.classification === k).length;
  const required = supported.reduce((n, r) => n + r.expected.length, 0);
  const present = supported.reduce((n, r) => n + r.expected.filter(p => r.acousticObserved.includes(p)).length, 0);
  return { intendedGestureTargetViews: rows.length, H50AttemptCoverage: fraction(rows.filter(r => r.productRecord).length, rows.length),
    NO_ATTEMPT: rows.filter(r => !r.productRecord).length,
    verdicts: Object.fromEntries(['MATCH','RETRY','MISMATCH'].map(k => [k, rows.filter(r => r.productRecord?.verdict === k).length])),
    classifications: Object.fromEntries(classes.map(k => [k, count(k)])), requiredTargetPitchRecall: fraction(present, required),
    allRequiredTargetsPresent: fraction(supported.filter(r => covers(r.acousticObserved, r.expected)).length, supported.length),
    cleanExactTargetRate: fraction(count('SAFE_MATCH'), supported.length), safeAutoMatchCoverage: fraction(count('SAFE_MATCH'), supported.length),
    supportedAmbiguityRetryRate: fraction(count('SUPPORTED_RETRY'), supported.length),
    unsupportedTargetHallucination: fraction(unsupported.filter(r => covers(r.acousticObserved, r.expected)).length, unsupported.length),
    rawAssembledExcessPitchProposals: rows.reduce((n, r) => n + r.acousticObserved.filter(p => !r.physicalTruth.includes(p)).length, 0),
    rawExcessMeaning: 'MODEL_QUALITY_DIAGNOSTIC_NOT_PHYSICAL_EXTRA_KEY_ERROR_NOT_SELECTION_OBJECTIVE' };
}
export function evaluate(rows, baselineRows, profile) {
  const views = uniqueViews(rows), baseline = uniqueViews(baselineRows), bm = new Map(baseline.map(r => [r.viewId, r]));
  if (canonical(views.map(r => r.viewId).sort()) !== canonical(baseline.map(r => r.viewId).sort())) throw Error('CANDIDATE_CHANGED_DENOMINATOR');
  const unsupportedCovered = views.filter(r => !r.physicalTargetSupported && covers(r.acousticObserved, r.expected)).map(r => r.viewId).sort();
  const baselineCovered = baseline.filter(r => !r.physicalTargetSupported && covers(r.acousticObserved, r.expected)).map(r => r.viewId).sort();
  const newHallucinations = unsupportedCovered.filter(id => !baselineCovered.includes(id));
  const regressions = views.filter(r => bm.get(r.viewId).classification === 'SAFE_MATCH' && r.classification !== 'SAFE_MATCH').map(r => r.viewId);
  const recovered = views.filter(r => bm.get(r.viewId).classification === 'SUPPORTED_RETRY' && r.classification === 'SAFE_MATCH');
  const recurrence = new Map();
  for (const r of recovered) {
    const key = r.physicalGestureKey + ':target:' + canonical(r.expected);
    if (!recurrence.has(key)) recurrence.set(key, { physicalGestureKey: r.physicalGestureKey, expected: r.expected,
      recordingId: r.recordingId, rates: new Set(), viewIds: [] });
    recurrence.get(key).rates.add(r.rate); recurrence.get(key).viewIds.push(r.viewId);
  }
  const pairedMap = new Map();
  for (const r of recurrence.values()) if ([44100,48000].every(rate => r.rates.has(rate))) {
    if (!pairedMap.has(r.physicalGestureKey)) pairedMap.set(r.physicalGestureKey, {
      physicalGestureKey: r.physicalGestureKey, recordingId: r.recordingId, rates: [44100,48000], pairedTargetViews: [] });
    pairedMap.get(r.physicalGestureKey).pairedTargetViews.push({ expected: r.expected, viewIds: r.viewIds });
  }
  const paired = [...pairedMap.values()];
  const counts = summarize(views), c = counts.classifications;
  const reasons = [];
  if (c.DANGEROUS_FALSE_MATCH) reasons.push('DANGEROUS_FALSE_MATCH');
  if (newHallucinations.length || unsupportedCovered.length > baselineCovered.length) reasons.push('NEW_UNSUPPORTED_TARGET_HALLUCINATION');
  if (c.SUPPORTED_MISMATCH || c.SUPPORTED_NO_ATTEMPT || counts.allRequiredTargetsPresent.numerator !== counts.allRequiredTargetsPresent.denominator) reasons.push('REQUIRED_TARGET_RECALL_REGRESSION');
  if (regressions.length) reasons.push('BASELINE_SAFE_MATCH_REGRESSION');
  if (!recovered.length) reasons.push('NO_STRICT_SAFE_AUTO_MATCH_IMPROVEMENT');
  const eligible = reasons.length === 0, meaningful = eligible && paired.length >= 2 && new Set(paired.map(r => r.recordingId)).size >= 2;
  return { profileId: profile.profileId, rows: summarize(rows), views: counts,
    byRate: [44100,48000].map(rate => ({ rate, rows: summarize(rows.filter(r => r.rate === rate)), views: summarize(views.filter(r => r.rate === rate)) })),
    targetViews: views, unsupportedCoveredViewIds: unsupportedCovered, baselineUnsupportedCoveredViewIds: baselineCovered,
    newUnsupportedCoveredViewIds: newHallucinations, baselineSafeMatchRegressions: regressions,
    newlyRecoveredSafeTargetViewIds: recovered.map(r => r.viewId), pairedRecoveredPhysicalGestures: paired,
    recoveredDistinctPhysicalGestures: new Set(recovered.map(r => r.physicalGestureKey)).size, pairedRecoveredRecordingIds: [...new Set(paired.map(r => r.recordingId))].sort(),
    eligibility: eligible ? 'ELIGIBLE' : 'INELIGIBLE', reasons, meaningful,
    nominationStatus: meaningful ? 'MEANINGFUL_ELIGIBLE_CHALLENGER' : eligible ? 'ELIGIBLE_BUT_IMPROVEMENT_TOO_SPARSE_FOR_CHALLENGER_NOMINATION' : 'INELIGIBLE',
    safetyStatus: c.DANGEROUS_FALSE_MATCH ? 'SAFETY_INELIGIBLE' : 'NO_DANGEROUS_MATCH_OBSERVED_ON_EXPOSED_VIEWS',
    rankingComponents: [paired.length, c.SAFE_MATCH, -unsupportedCovered.length, -c.SUPPORTED_RETRY, -profile.gridStepDistance] };
}
export function rank(results) {
  const sorted = results.filter(r => r.meaningful).sort((a, b) => {
    for (let i = 0; i < 5; i++) if (a.rankingComponents[i] !== b.rankingComponents[i]) return b.rankingComponents[i] - a.rankingComponents[i];
    return 0;
  });
  const leaders = sorted.filter(r => canonical(r.rankingComponents) === canonical(sorted[0]?.rankingComponents));
  return { order: sorted.map(r => ({ profileId: r.profileId, rankingComponents: r.rankingComponents })),
    leaders: leaders.map(r => r.profileId), selected: leaders.length === 1 ? leaders[0].profileId : null,
    disposition: leaders.length === 0 ? 'ROBUST_V21_THRESHOLD_GRID_NO_SAFE_USABILITY_CHALLENGER_BASELINE_RETAINED'
      : leaders.length === 1 ? 'ROBUST_V21_THRESHOLD_DEVELOPMENT_CHALLENGER_NOMINATED'
      : 'ROBUST_V21_MULTIPLE_EQUIVALENT_THRESHOLD_CHALLENGERS_NO_UNIQUE_SELECTION' };
}
