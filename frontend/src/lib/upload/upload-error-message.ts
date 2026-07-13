import { translateErrorCode } from '@/lib/i18n/error-message';

type ErrorTranslator = {
  (key: never): string;
  has(key: never): boolean;
};

export function uploadErrorMessage(
  tErrors: ErrorTranslator,
  code: string | null | undefined,
  fallback: string
): string {
  return translateErrorCode(tErrors, code, fallback);
}
