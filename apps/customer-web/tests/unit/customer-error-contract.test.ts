import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en/errors.json';
import zh from '../../messages/zh/errors.json';
import { CUSTOMER_ERROR_MESSAGE_KEYS, isCustomerErrorCode } from '@/lib/i18n/customer-error-codes';
import { translateErrorCode, userFacingErrorMessage } from '@/lib/i18n/error-message';

const contract = JSON.parse(
  readFileSync(
    new URL('../../../../backend/docs/contracts/openapi/customer-api.json', import.meta.url),
    'utf8',
  ),
);

describe('Customer HTTP error presentation contract', () => {
  it('admits exactly the generated vocabulary with both locale message sets', () => {
    const codes = contract.components.schemas.CustomerErrorCode.enum;
    for (const keys of [
      Object.keys(CUSTOMER_ERROR_MESSAGE_KEYS),
      Object.keys(en),
      Object.keys(zh),
    ]) {
      expect(keys.sort()).toEqual([...codes].sort());
    }
    for (const code of codes) expect(isCustomerErrorCode(code)).toBe(true);
    for (const code of ['', 'server_code', '__proto__', 'constructor', null, 42]) {
      expect(isCustomerErrorCode(code)).toBe(false);
    }
  });

  it.each([
    { locale: 'en', messages: en },
    { locale: 'zh', messages: zh },
  ])('localizes every admitted code in $locale', ({ locale, messages }) => {
    const t = createTranslator({ locale, messages });
    for (const code of Object.keys(CUSTOMER_ERROR_MESSAGE_KEYS)) {
      if (!isCustomerErrorCode(code)) throw new Error('Invalid contract fixture');
      expect(translateErrorCode(t, code)).toBe(messages[code]);
    }
    expect(translateErrorCode(t, 'revision_conflict')).not.toBe(
      translateErrorCode(t, 'score_metadata_conflict'),
    );
    expect(userFacingErrorMessage(t, { code: 'private_code' })).toBe(messages.unknown_error);
  });
});
