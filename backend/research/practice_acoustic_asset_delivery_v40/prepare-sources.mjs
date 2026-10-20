import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Source patterns only; no historical result or execution authorization is reused.
const source = 'backend/research/practice_acoustic_asset_delivery_v39';
const target = 'backend/research/practice_acoustic_asset_delivery_v40';
const files = ['discovery.mjs', 'security.mjs', 'io.mjs', 'contract.json', 'eslint.config.mjs',
  'browser-entry.mjs', 'network.mjs', 'audit.mjs', 'tests.mjs', 'closeout-machine.mjs',
  'identities.mjs', 'control.mjs', 'campaign.mjs', 'closeout.mjs', 'quality-runtime-proof.mjs',
  'process-result.mjs', 'process-result-tests.mjs'];
for (const file of files) {
  assert.equal(existsSync(target + '/' + file), false, 'NO_PREPARATION_REPEAT');
  const text = readFileSync(source + '/' + file, 'utf8').replaceAll('\r\n', '\n')
    .replaceAll('v39', 'v40').replaceAll('V39', 'V40')
    .replaceAll('608de261abb8ad5e9707ebfa3bf12235754ea918', 'c93b6181535d583ccaf4d1bb9ac5ff7359fcaa4f')
    .replaceAll('V3ThroughV38Diff', 'V3ThroughV39Diff');
  writeFileSync(target + '/' + file, text, { flag: 'wx' });
}
console.log(JSON.stringify({ prospectiveSourceFiles: files.length, historicalExecutionReceiptsCopied: 0 }));
