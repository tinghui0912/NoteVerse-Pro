import assert from 'node:assert/strict';

export function canonicalNumericZero(value) {
  return typeof value === 'number' && value === 0 ? 0 : value;
}

/** Clone JSON structure without reordering lists, dropping fields or coercing values. */
export function normalizeSignedZero(value) {
  if (Array.isArray(value)) return value.map(normalizeSignedZero);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeSignedZero(item)]));
  }
  return canonicalNumericZero(value);
}

export function equalEvidence(actual, stored, label) {
  try { assert.deepStrictEqual(normalizeSignedZero(actual), normalizeSignedZero(stored)); }
  catch (cause) { throw Object.assign(Error('ROBUST_V22_V21_SEMANTIC_RECOMPUTATION_MISMATCH:' + label, { cause }), { semanticMismatch: true }); }
}

// This sorted-key encoding is the frozen identity formula, not comparison normalization.
export function identityJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(identityJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + identityJSON(value[key])).join(',') + '}';
}

export function compareVectors(a, b) {
  for (let i = 0; i < 5; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}
export const vectorsEqual = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
