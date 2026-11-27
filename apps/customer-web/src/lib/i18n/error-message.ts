import type { CustomerErrorCode } from '@/generated/api';
import { CUSTOMER_ERROR_MESSAGE_KEYS, isCustomerErrorCode } from './customer-error-codes';

type ErrorTranslator = (key: CustomerErrorCode) => string;

export function translateErrorCode(
  t: ErrorTranslator,
  code?: CustomerErrorCode | null,
  fallback?: string,
): string {
  return code ? t(CUSTOMER_ERROR_MESSAGE_KEYS[code]) : fallback || t('unknown_error');
}

export function userFacingErrorMessage(
  t: ErrorTranslator,
  error: unknown,
  fallback?: string,
): string {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    isCustomerErrorCode(error.code)
      ? error.code
      : null;
  return translateErrorCode(t, code, fallback);
}
