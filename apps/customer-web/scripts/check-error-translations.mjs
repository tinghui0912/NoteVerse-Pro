import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../../..');
const frontendDir = path.resolve(rootDir, 'apps/customer-web');
const errorCodesPath = path.resolve(rootDir, 'backend/app/shared/error_codes.py');
const locales = ['en', 'zh'];

function readErrorCodes() {
  const errorCodes = fs.readFileSync(errorCodesPath, 'utf8');
  return new Set(
    [...errorCodes.matchAll(/^\s+[A-Z0-9_]+\s*=\s*"([^"]+)"/gm)].map((match) => match[1])
  );
}

function readMessages(locale) {
  const filePath = path.resolve(frontendDir, `messages/${locale}/errors.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const errorCodes = readErrorCodes();
let failed = false;
const localeKeys = new Map();

for (const locale of locales) {
  const messages = readMessages(locale);
  const keys = Object.keys(messages).sort();
  localeKeys.set(locale, keys);

  const nonBackendKeys = keys.filter((key) => !errorCodes.has(key));
  if (nonBackendKeys.length > 0) {
    failed = true;
    console.error(`[${locale}] errors.json contains keys that are not backend ErrorCode values:`);
    console.error(`  ${nonBackendKeys.join(', ')}`);
  }

  const missingBackendCodes = [...errorCodes].filter((key) => !keys.includes(key));
  if (missingBackendCodes.length > 0) {
    failed = true;
    console.error(`[${locale}] errors.json is missing backend ErrorCode values:`);
    console.error(`  ${missingBackendCodes.join(', ')}`);
  }
}

const [firstLocale, ...otherLocales] = locales;
const baseline = localeKeys.get(firstLocale) ?? [];
for (const locale of otherLocales) {
  const keys = localeKeys.get(locale) ?? [];
  const missing = baseline.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !baseline.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`[${locale}] errors.json keys differ from ${firstLocale}:`);
    if (missing.length > 0) console.error(`  Missing: ${missing.join(', ')}`);
    if (extra.length > 0) console.error(`  Extra: ${extra.join(', ')}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('Error translation keys are clean.');
