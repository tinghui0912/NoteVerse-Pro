import { fail } from './errors';
export function onlyFields(value: object, allowed: readonly string[]): void {
  if (!value || Object.keys(value).some((k) => !allowed.includes(k)))
    fail('ACOUSTIC_FIELD_VIOLATION');
}
export function safeIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    fail('INVALID_SOURCE_SAMPLE_IDENTITY');
}
export function previousFloat(value: number): number {
  if (!(value > 0) || !Number.isFinite(value))
    fail('INVALID_COVERAGE_BOUNDARY');
  const floats = new Float64Array([value]),
    bits = new BigUint64Array(floats.buffer);
  bits[0] -= BigInt(1);
  return floats[0];
}
