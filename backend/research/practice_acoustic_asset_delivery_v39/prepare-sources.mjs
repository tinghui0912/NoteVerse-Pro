import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Prospective source templates only. No historical receipt or result is copied.
const from = 'backend/research/practice_acoustic_asset_delivery_v38';
const to = 'backend/research/practice_acoustic_asset_delivery_v39';
const files = ['discovery.mjs', 'security.mjs', 'io.mjs', 'contract.json', 'eslint.config.mjs',
  'browser-entry.mjs', 'network.mjs', 'audit.mjs', 'tests.mjs', 'closeout-machine.mjs',
  'identities.mjs', 'control.mjs', 'campaign.mjs', 'closeout.mjs'];
for (const file of files) {
  assert.equal(existsSync(to + '/' + file), false, 'NO_TEMPLATE_GENERATION_RETRY');
  const text = readFileSync(from + '/' + file, 'utf8').replaceAll('\r\n', '\n')
    .replaceAll('v38', 'v39').replaceAll('V38', 'V39')
    .replaceAll('24235c53a99b5c09d7d725b41a0f6f63cd0b5f47', '608de261abb8ad5e9707ebfa3bf12235754ea918');
  writeFileSync(to + '/' + file, text, { flag: 'wx' });
}
console.log(JSON.stringify({ newProspectiveSourceTemplates: files.length, historicalReceiptsCopied: 0 }));
