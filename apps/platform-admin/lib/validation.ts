export function reasonError(value: string): string | null {
  const length = Array.from(value.trim()).length;

  return length >= 3 && length <= 500
    ? null
    : "Enter a reason containing 3–500 characters.";
}

export function normalizedPassword(value: string): string {
  return value.normalize("NFC");
}

export function passwordError(value: string): string | null {
  const normalized = normalizedPassword(value);

  const length = Array.from(normalized).length;

  return length >= 12 && length <= 128 && normalized.trim().length > 0
    ? null
    : "Use 12–128 characters; the password must not be blank.";
}
