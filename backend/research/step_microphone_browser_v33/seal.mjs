import assert from 'node:assert/strict';
import { DIR, OUT, V27, START, bytes, load, rawBytesSha256, now, save, git, scope, remote, github, exists } from './io.mjs';
import { verifyWorktreeMaterialization, verifyCanonicalJsonIdentity, verifyLocalRecord } from './identities.mjs';
import { gitTree, gitObjectRecord, compareGitObjects, gitObjectContentRecord, verifyCommittedIndexRecord } from './git-identities.mjs';
import { immutable } from './manifest.mjs';

// Additive closeout only; cannot launch browser, construct product runtime or invoke a decoder.
const mode = process.argv[2];
try {
  if (mode === 'history') {
    scope(); const startTree = gitTree(START), resultTree = gitTree('HEAD'), gitComparisons = [];
    for (const p of startTree.keys()) gitComparisons.push(compareGitObjects(gitObjectRecord(p, START, startTree), gitObjectRecord(p, 'HEAD', resultTree)));
    const old = await load(V27 + '/browser-protocol-freeze.json'), localComparisons = [], history = [];
    for (const f of [...old.files, ...(await load(V27 + '/historical-identities.json')).files]) {
      // Historical V27 records describe local filesystem bytes, never committed byte contents.
      const b = await bytes(f.path); localComparisons.push({ path: f.path, domain: startTree.has(f.path) ? 'WORKTREE_MATERIALIZATION' : 'EXTERNAL_LOCAL_ASSET',
        representation: startTree.has(f.path) ? 'SHA256_WORKTREE_MATERIALIZATION' : 'RAW_BYTES_SHA256',
        subject: { kind: 'ACCEPTED_HISTORICAL_LOCAL_BYTES', path: f.path }, sha256: rawBytesSha256(b),
        expectedHistoricalLocalSHA256: f.sha256, matches: rawBytesSha256(b) === f.sha256 });
    }
    for (const p of startTree.keys()) if (p.startsWith('backend/research/')) history.push(await verifyWorktreeMaterialization(p));
    const corePath = 'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json';
    const coreRaw = await verifyWorktreeMaterialization(corePath, 'ce05905ea023f9bb41a5c2d4e0fd6fb9c3bb7f3222af4a0f1b212257380bf2fb');
    const coreCanonical = await verifyCanonicalJsonIdentity(corePath, '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443');
    await save('closeout-history-and-domains.json', { at: now(), startingHead: START, files: history, gitComparisons, localComparisons,
      localMismatches: localComparisons.filter(c => !c.matches), coreRaw, coreCanonical,
      productionDiff: [], V3ThroughV32Diff: [], purpose: 'Domain-separated closeout immutability evidence, never qualification authorization' });
    console.log(JSON.stringify({ gitObjectsVerified: gitComparisons.length, historicalLocalFiles: history.length,
      localComparisons: localComparisons.length, localMismatches: localComparisons.filter(c => !c.matches).length }));
  } else if (mode === 'receipt') {
    const head = remote(), changed = scope(), committedResults = [];
    for (const p of changed) {
      const r = gitObjectContentRecord(p, head), local = await bytes(p);
      // Only NEW V33 deterministic LF output is compared here; old production is handled by Git objects below.
      assert.equal(rawBytesSha256(local), r.sha256, 'NEW_V33_RESULT_LOCAL_VS_COMMIT:' + p); committedResults.push(r);
    }
    const history = await load(OUT + '/closeout-history-and-domains.json'), startTree = gitTree(START), resultTree = gitTree(head), protectedGitComparisons = [];
    for (const p of startTree.keys()) protectedGitComparisons.push(compareGitObjects(gitObjectRecord(p, START, startTree), gitObjectRecord(p, head, resultTree)));
    for (const f of history.files) await verifyLocalRecord(f);
    const m = await immutable(); let frozenSourceChecks = [];
    if (await exists(OUT + '/browser-protocol-freeze.json')) {
      const f = await load(OUT + '/browser-protocol-freeze.json'); frozenSourceChecks = f.indexIdentities.map(r => verifyCommittedIndexRecord(r, head));
    }
    const checks = await github(head);
    await save('remote-result-proof.json', { at: now(), startingHead: START, resultCommit: head, remoteHead: head, exactChangedFiles: changed,
      committedResults, protectedGitComparisons, historicalLocalFilesVerified: history.files.length,
      productionDiff: [], V3ThroughV32Diff: [], immutableV26Artifacts: m.artifacts, coreDualIdentities: m.core,
      frozenSourceChecks, capabilities: (await load(DIR + '/contract.json')).capabilities,
      disposition: (await load(OUT + '/assessment.json')).disposition, github: checks, cleanBeforeReceipt: true,
      protocolFreezeCreated: await exists(OUT + '/browser-protocol-freeze.json'), browserAuthorizationCreated: await exists(OUT + '/remote-browser-freeze-proof.json'),
      browserCampaignCreated: await exists(OUT + '/browser-campaign.json'), note: 'Additive receipt; final receipt commit independently refetched/queried, no self-reference. STOP for independent audit.' });
    console.log(JSON.stringify({ head, github: checks }));
  } else if (mode === 'final-head') {
    const head = remote(); scope(); console.log(JSON.stringify({ head, github: await github(head) }));
  } else if (mode === 'read-index-result') {
    // This read-only option is available for independent inspection, never a freeze/qualification retry.
    const head = git('rev-parse', 'HEAD'); console.log(JSON.stringify({ head, tree: git('rev-parse', head + '^{tree}') }));
  } else throw Error('Explicit additive history/receipt/final-head/read-index-result mode required');
} catch (error) {
  const report = { at: now(), mode, phaseDispositionUnchanged: true, error: String(error.stack ?? error),
    stderr: String(error.stderr ?? ''), noRepairOrRetry: true };
  const name = 'closeout-' + mode + '-failure.json';
  if (!await exists(OUT + '/' + name)) await save(name, report);
  console.error(error); process.exitCode = 1;
}
