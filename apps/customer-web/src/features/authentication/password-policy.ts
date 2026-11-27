export function passwordPolicyError(password: string): 'passwordEmpty' | 'passwordTooShort' | 'passwordTooLong' | null {
  const value = password.normalize('NFC');
  const length = Array.from(value).length;
  if (/^[\p{White_Space}\u001c-\u001f]*$/u.test(value)) return 'passwordEmpty';
  if (length < 12) return 'passwordTooShort';
  if (length > 128) return 'passwordTooLong';
  return null;
}
