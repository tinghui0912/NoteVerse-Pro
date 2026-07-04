type ErrorTranslator = {
  (key: never): string;
  has(key: never): boolean;
};

export function translateErrorCode(
  t: ErrorTranslator,
  code?: string | null,
  fallback?: string
): string {
  if (code && t.has(code as never)) return t(code as never);
  return fallback || t('unknown_error' as never);
}
