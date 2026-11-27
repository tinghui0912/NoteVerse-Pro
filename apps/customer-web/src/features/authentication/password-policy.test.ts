import { expect, it } from 'vitest';
import { passwordPolicyError } from './password-policy';

it.each([
  ['', 'passwordEmpty'], [' '.repeat(12), 'passwordEmpty'], ['a'.repeat(11), 'passwordTooShort'],
  ['a'.repeat(129), 'passwordTooLong'], ['a'.repeat(12), null], ['a'.repeat(128), null],
  ['😀'.repeat(12), null], ['😀'.repeat(129), 'passwordTooLong'], ['e\u0301'.repeat(128), null],
  ['\u0085'.repeat(12), 'passwordEmpty'], ['\ufeff'.repeat(12), null],
] as const)('validates normalized character bounds for %j', (value, expected) => {
  expect(passwordPolicyError(value)).toBe(expected);
});
