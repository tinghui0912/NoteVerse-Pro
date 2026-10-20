import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ROOT, DIR, OUT, V27, START, bytes, load, rawBytesSha256, now, save, git, scope, remote, github, exists } from './io.mjs';
import { RAW, CANONICAL, canonicalJsonSha256, verifyRawFileIdentity } from './identities.mjs';

// Additive evidence/remote closeout only. No campaign, inference, decoder, or product runtime imports.
const mode = process.argv[2];
if (mode === 'history') {
  scope(); const old = await load(V27 + '/browser-protocol-freeze.json'), comparisons = [], files = [];
  for (const f of [...old.files, ...(await load(V27 + '/historical-identities.json')).files]) {
    const actual = await verifyRawFileIdentity(f.path);
    comparisons.push({ ...actual, expectedRawSHA256: f.sha256, matches: actual.sha256 === f.sha256 });
  }
  for (const p of git('ls-tree', '-r', '--name-only', START, '--', 'backend/research').split('\n').filter(Boolean)) files.push(await verifyRawFileIdentity(p));
  const corePath = 'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json';
  const coreRaw = await verifyRawFileIdentity(corePath);
  const coreCanonical = { path: corePath, representation: CANONICAL, sha256: canonicalJsonSha256(await load(corePath)) };
  await save('closeout-history-and-dual-identities.json', { at: now(), startingHead: START, files, acceptedHistoricalRawComparisons: comparisons,
    rawComparisonMismatches: comparisons.filter(c => !c.matches), coreRaw, coreCanonical,
    canonicalDefinition: await verifyRawFileIdentity('apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts'),
    productionDiff: [], V3ThroughV29Diff: [], purpose: 'Closeout immutability/identity evidence, never browser authorization or qualification execution' });
  console.log(JSON.stringify({ historicalRawFiles: files.length, acceptedRawComparisons: comparisons.length, rawMismatches: comparisons.filter(c => !c.matches).length, coreRaw, coreCanonical }));
} else if (mode === 'receipt') {
  const head = remote(), changed = scope(), identities = [];
  for (const p of changed) {
    const b = await bytes(p), committed = execFileSync('git', ['show', head + ':' + p], { cwd: ROOT, shell: false, maxBuffer: 128 * 1024 * 1024 });
    assert.equal(rawBytesSha256(b), rawBytesSha256(committed), 'REMOTE_RESULT_RAW_BYTES:' + p);
    identities.push({ path: p, representation: RAW, sha256: rawBytesSha256(b), bytes: b.length });
  }
  const history = await load(OUT + '/closeout-history-and-dual-identities.json');
  for (const f of history.files) await verifyRawFileIdentity(f.path, f.sha256);
  const old = (await load(V27 + '/browser-protocol-freeze.json')).immutableCandidate;
  for (const f of [...old.artifacts, ...old.assets]) await verifyRawFileIdentity(f.path, f.sha256, f.bytes);
  const checks = await github(head);
  await save('remote-result-proof.json', { at: now(), startingHead: START, resultCommit: head, remoteHead: head, exactChangedFiles: changed, identities,
    historicalRawFilesReverified: history.files.length, productionDiff: [], V3ThroughV29Diff: [],
    coreRaw: history.coreRaw, coreCanonical: history.coreCanonical, canonicalDefinition: history.canonicalDefinition,
    disposition: (await load(OUT + '/assessment.json')).disposition, capabilities: (await load(DIR + '/contract.json')).capabilities,
    protocolFreezeCreated: await exists(OUT + '/browser-protocol-freeze.json'), browserCampaignCreated: await exists(OUT + '/browser-campaign.json'),
    github: checks, cleanBeforeReceipt: true, note: 'Additive remote receipt, final receipt HEAD independently refetched/queried; no self-reference; STOP for independent audit' });
  console.log(JSON.stringify({ head, github: checks }));
} else if (mode === 'final-head') {
  const head = remote(); scope(); console.log(JSON.stringify({ head, github: await github(head) }));
} else throw Error('Only additive history/receipt/final-head evidence modes are supported');
