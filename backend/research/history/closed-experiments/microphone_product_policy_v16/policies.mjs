export function normalized(values) {
  if (!Array.isArray(values) || values.some(p => !Number.isInteger(p) || p < 0 || p > 127)) throw Error('INVALID_PITCH_SET');
  return [...new Set(values)].sort((a, b) => a - b);
}
export const contains = (whole, required) => normalized(required).every(p => normalized(whole).includes(p));
export const exact = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const required = expected => { if (!normalized(expected).length) throw Error('EMPTY_TARGET'); return expected; };
export const p0 = (observed, expected) => exact(observed, required(expected)) ? 'MATCH' : 'MISMATCH';
export const p1 = (observed, expected) => contains(observed, required(expected)) ? 'MATCH' : 'MISMATCH';
export function classify(verdict, physicalTruth, expected) {
  const fullPhysicalSupport = contains(physicalTruth, expected);
  return { fullPhysicalSupport, classification: verdict === 'MATCH'
    ? fullPhysicalSupport ? 'TRUE_ACCEPT' : 'FALSE_ACCEPT'
    : fullPhysicalSupport ? 'FALSE_REJECT' : 'TRUE_REJECT' };
}
export function midiNumber(pitch) {
  const m = /^([A-G])(#?)(-?\d)$/.exec(pitch);
  if (!m) throw Error('INVALID_PITCH_NAME');
  return (Number(m[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
}
export function confusion(rows) {
  return Object.fromEntries(['TRUE_ACCEPT', 'FALSE_REJECT', 'TRUE_REJECT', 'FALSE_ACCEPT'].map(k => [k, rows.filter(r => r.classification === k).length]));
}
const fraction = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
const quantile = (sorted, q) => sorted.length ? sorted[Math.ceil(sorted.length * q) - 1] : null;

/** Interpret finalized evidence without changing deterministic domain ownership. */
export function continuousProjection(evaluation, source, mode) {
  if (evaluation.status !== 'COMPLETE') throw Error('COMPLETED_EVALUATION_REQUIRED');
  if (!['MICROPHONE', 'MIDI'].includes(source) || !['C0', 'C1'].includes(mode)) throw Error('INVALID_PROJECTION');
  const strikes = evaluation.groups.flatMap(g => g.strikes), matched = strikes.filter(s => s.state === 'MATCHED');
  const missing = strikes.filter(s => s.state === 'MISSING').length, notReached = strikes.filter(s => s.state === 'NOT_REACHED').length;
  const chords = evaluation.groups.filter(g => g.strikes.length >= 2 && g.strikes.every(s => s.state !== 'NOT_REACHED'));
  const wrong = evaluation.observationOwnership.filter(o => o.disposition === 'WRONG').length;
  const extra = evaluation.observationOwnership.filter(o => o.disposition === 'EXTRA').length;
  const weak = mode === 'C1' && source === 'MICROPHONE';
  const signed = matched.map(s => s.match.timingOffsetMs), absolute = signed.map(Math.abs).sort((a, b) => a - b);
  return { source, mode, internalCategoryCounts: { MATCHED: matched.length, MISSING: missing, WRONG: wrong, EXTRA: extra, NOT_REACHED: notReached },
    reportCategoryCounts: { MATCHED: matched.length, MISSING: missing, WRONG: weak ? 0 : wrong, EXTRA: weak ? 0 : extra,
      POSSIBLE_UNMATCHED_ACOUSTIC: weak ? wrong + extra : 0, NOT_REACHED: notReached },
    observationInterpretations: evaluation.observationOwnership.map(o => ({ observationId: o.observationId, internalDisposition: o.disposition,
      interpretation: weak && ['WRONG', 'EXTRA'].includes(o.disposition) ? 'POSSIBLE_UNMATCHED_ACOUSTIC' : o.disposition })),
    targetStrikeRecall: fraction(matched.length, matched.length + missing),
    chordCompleteness: fraction(chords.filter(g => g.strikes.every(s => s.state === 'MATCHED')).length, chords.length),
    timing: { count: signed.length, signedOffsetsMs: signed, absoluteP50Ms: quantile(absolute, .5), absoluteP95Ms: quantile(absolute, .95), absoluteMaxMs: absolute.at(-1) ?? null },
    strongNegativeVector: { MISSING_TARGET_STRIKES: missing, WRONG_OBSERVATIONS: weak ? 0 : wrong, EXTRA_OBSERVATIONS: weak ? 0 : extra },
    strongNegativeCount: missing + (weak ? 0 : wrong + extra),
    strongNegativeCountMeaning: 'DIAGNOSTIC_CATEGORY_ITEMS_NOT_UNIQUE_ERRORS_NOT_CURRENT_SCORE_FORMULA',
    currentWiredFeedback: { greenMatchedStrikeAnnotations: matched.length, redMissingStrikeAnnotations: missing,
      directWrongObservationAnnotation: 'NOT_CURRENTLY_WIRED', directExtraObservationAnnotation: 'NOT_CURRENTLY_WIRED',
      finalReviewExtraPitchCount: extra, C1ProposedPossibleAcousticSummary: weak ? wrong + extra : null },
    finalScore: 'NOT_COMPARABLE_NO_CURRENT_DETERMINISTIC_PERFORMANCE_SCORE_FORMULA',
    wrongExtraStrongScoreContribution: weak ? 'EXCLUDED_BY_RESEARCH_DESIGN_NO_NUMERIC_FORMULA_TO_RECOMPUTE' : 'NO_CURRENT_NUMERIC_FORMULA_FOUND',
    internalOwnershipRetained: true, researchModelQualityMetricsChanged: false };
}
