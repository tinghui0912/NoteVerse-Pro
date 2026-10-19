import { createHash } from 'node:crypto';
export function norm(set) {
  if (!Array.isArray(set) || set.some(p => !Number.isInteger(p) || p < 0 || p > 127)) throw Error('INVALID_PITCH_SET');
  return [...new Set(set)].sort((a, b) => a - b);
}
export const equal = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
export const covers = (whole, required) => norm(required).every(p => norm(whole).includes(p));
export function p2(observed, expected) {
  if (!norm(expected).length) throw Error('EMPTY_TARGET');
  return equal(observed, expected) ? { verdict: 'MATCH', reason: null }
    : covers(observed, expected) ? { verdict: 'RETRY', reason: 'UNCERTAIN' } : { verdict: 'MISMATCH', reason: null };
}
export function physicalClass(result, truth, target) {
  const supported = covers(truth, target);
  return { physicalTargetSupported: supported, classification: result.verdict === 'MATCH'
    ? supported ? 'SAFE_MATCH' : 'DANGEROUS_FALSE_MATCH' : result.verdict === 'RETRY'
      ? supported ? 'SUPPORTED_RETRY' : 'UNSUPPORTED_RETRY' : supported ? 'FALSE_REJECT' : 'TRUE_REJECT' };
}
export const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
export const digest = value => createHash('sha256').update(stable(value)).digest('hex');
export function identity(row) {
  const observations = [...row.observations].sort((a, b) => a.observationId.localeCompare(b.observationId));
  if (new Set(observations.map(o => o.observationId)).size !== observations.length) throw Error('DUPLICATE_OBSERVATION_ID');
  if (observations.some(o => !o.observationId || !o.sourceDomainId || o.sourceSampleRateHz !== row.rate
    || !Number.isFinite(o.sourceEventSample) || !Number.isFinite(o.targetSample) || !Number.isFinite(o.confidence))) throw Error('INVALID_SEALED_OBSERVATION_IDENTITY');
  return { audioBoundCaseId: row.audioBoundCaseId, physicalGestureId: row.physicalGestureId,
    sourceRateHz: row.rate, sealedObservationSetSha256: digest(observations) };
}
export function groupPhysical(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = identity(row), unitId = digest(key), group = groups.get(unitId) ?? { unitId, key,
      recordingId: row.recordingId, physicalTruth: norm(row.physicalTruth), acousticObserved: norm(row.acousticObserved),
      multiplicity: 0, members: [], targetViews: [] };
    if (group.recordingId !== row.recordingId || !equal(group.physicalTruth, row.physicalTruth)) throw Error('PHYSICAL_GROUP_CONFLICT');
    group.multiplicity++; group.members.push({ scenarioId: row.scenarioId, ordinal: row.ordinal, rowId: row.rowId,
      expected: row.expected, P2: row.P2, classification: row.classification });
    let view = group.targetViews.find(v => equal(v.expected, row.expected));
    if (view && (view.P2.verdict !== row.P2.verdict || view.classification !== row.classification)) throw Error('TARGET_VIEW_CONFLICT');
    if (!view) { view = { expected: norm(row.expected), P2: row.P2, physicalTargetSupported: row.physicalTargetSupported,
      classification: row.classification, rowIds: [] }; group.targetViews.push(view); }
    view.rowIds.push(row.rowId); groups.set(unitId, group);
  }
  return [...groups.values()].map(g => {
    const supported = g.targetViews.filter(v => v.physicalTargetSupported), verdicts = [...new Set(supported.map(v => v.P2.verdict))];
    return { ...g, members: g.members.sort((a, b) => a.rowId.localeCompare(b.rowId)),
      targetViews: g.targetViews.map(v => ({ ...v, rowIds: [...v.rowIds].sort() })).sort((a, b) => stable(a.expected).localeCompare(stable(b.expected))),
      supportedTargetViewCount: supported.length,
      supportedUsabilityVerdict: !supported.length ? 'NO_SUPPORTED_TARGET_VIEW' : verdicts.length === 1 ? verdicts[0] : 'MIXED_SUPPORTED_TARGET_CONTEXT_NOT_COMPARABLE' };
  }).sort((a, b) => a.unitId.localeCompare(b.unitId));
}
export function usability(groups) {
  const supported = groups.filter(g => g.supportedTargetViewCount), mixed = supported.filter(g => g.supportedUsabilityVerdict.startsWith('MIXED'));
  const counts = Object.fromEntries(['MATCH', 'RETRY', 'MISMATCH'].map(k => [k, supported.filter(g => g.supportedUsabilityVerdict === k).length]));
  return { supportedUniquePhysicalUnits: supported.length, mixedSupportedTargetContexts: mixed.length, counts,
    SAFE_AUTO_MATCH_COVERAGE: mixed.length || !supported.length ? null : counts.MATCH / supported.length,
    SUPPORTED_AMBIGUITY_RETRY_RATE: mixed.length || !supported.length ? null : counts.RETRY / supported.length,
    supportedMismatchRate: mixed.length || !supported.length ? null : counts.MISMATCH / supported.length,
    interpretation: 'NOT_GENERALIZABLE_PRODUCT_RATE' };
}
export function reopen(groups, dangerousCount) {
  const physical = new Map();
  for (const g of groups.filter(g => g.supportedUsabilityVerdict === 'RETRY')) {
    const k = stable([g.recordingId, g.key.physicalGestureId]), row = physical.get(k) ?? { recordingId: g.recordingId,
      physicalGestureId: g.key.physicalGestureId, rates: [], unitIds: [] };
    row.rates.push(g.key.sourceRateHz); row.unitIds.push(g.unitId); physical.set(k, row);
  }
  const repeated = [...physical.values()].filter(p => [44100, 48000].every(r => p.rates.includes(r)));
  const recordingIds = [...new Set(repeated.map(p => p.recordingId))].sort();
  const justified = dangerousCount === 0 && usability(groups).mixedSupportedTargetContexts === 0 && repeated.length >= 2 && recordingIds.length >= 2;
  return { recommendation: justified ? 'ACOUSTIC_OPERATING_POINT_REOPEN_JUSTIFIED_FOR_EXPOSED_DEVELOPMENT_ONLY'
    : 'ACOUSTIC_OPERATING_POINT_REOPEN_NOT_JUSTIFIED', qualifyingPhysicalGestures: repeated, qualifyingRecordingIds: recordingIds,
    independentRecordingsNotRateVariants: true, executionAuthorized: false };
}
