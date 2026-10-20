import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {createGzip} from 'node:zlib';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {DirectClaimantCommitFinalizer} from '../browser_runtime/xc8_direct_claimant_commit_finalizer.mjs';
import {minimumCostPairs} from '../browser_runtime/xc2_r1_bounded_finalizer.mjs';

export const PHASE = 'PRACTICE_CONTINUOUS_V2_CLEAN_BREAK_PRODUCT_CORE_PROMOTION';
export const START = '705da526368320469e3090523f14f75fd3f3f8a5';
const branch = 'codex/customer-web-delivery-boundary';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
process.chdir(root);
const reports = 'backend/research/reports';
const work = 'backend/data/work/continuous_product_core/v2';
const freezePath = `${reports}/continuous_product_core_freeze_v2_2026-10-16.json`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = async file => sha(await readFile(file));
const load = async file => JSON.parse(await readFile(file, 'utf8'));
const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 30 * 1024 * 1024}).trim();
const json = async (file, value) => {
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
};
const sorted = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const pitch = midi => typeof midi === 'string' ? midi : ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][midi % 12] + (Math.floor(midi / 12) - 1);
const cells = ['DEVELOPMENT', 'EVALUATION'].flatMap(split => ['LINEAR_A_600_220', 'BAND_LIMITED_A_600_170'].map(configuration => ({split, configuration})));

async function freeze() {
  const implementationCommit = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('IMPLEMENTATION_TREE_NOT_CLEAN');
  const files = git('ls-files', 'apps/customer-web/src', 'apps/customer-web/scripts', 'apps/customer-web/package.json',
    'apps/customer-web/package-lock.json', 'apps/customer-web/tsconfig.json', 'apps/customer-web/vitest.config.*', 'apps/customer-web/next.config.ts', 'docs/architecture/practice-product-contract-v2.md',
    'apps/customer-web/docs/customer-web_engineering_principles.md', 'backend/research/qualification', 'backend/research/history').split('\n').filter(Boolean);
  const reference = ['backend/research/browser_runtime/xc8_direct_claimant_commit_finalizer.mjs',
    'backend/research/browser_runtime/xc2_r2_direct_conflict_finalizer.mjs', 'backend/research/browser_runtime/xc2_r1_bounded_finalizer.mjs',
    'backend/research/browser_runtime/xc1_artifacts.mjs'];
  const oldFreeze = await load(`${reports}/phase9g_xc8_source_protocol_freeze_v1_2026-10-16.json`);
  const inputs = [...new Set(oldFreeze.inputs.filter(file => file.path.startsWith('backend/')).map(file => file.path))];
  for (const {split, configuration} of cells) {
    inputs.push(`backend/data/work/xc8_finalizer/${split}_${configuration}_audit.json.gz`,
      `backend/data/work/xc8_finalizer/${split}_${configuration}_metrics.json`);
  }
  const record = {phase: PHASE, startingHead: START, implementationCommit, createdAt: new Date().toISOString(),
    sources: await Promise.all([...files, ...reference].map(async file => ({path: file, sha256: await fileHash(file)}))),
    inputs: await Promise.all([...new Set(inputs)].sort().map(async file => ({path: file, sha256: await fileHash(file)}))), cells,
    canonicalization: 'Each expected group uses the minimum original expected performance time. Identical canonical strikes go to the frozen reference and product. Acoustic publications/IDs/times are unchanged. Original reference replay is separately disclosed, never rewritten.',
    userApproval: 'Allowed bilateral canonicalization; explicitly disclose differences.',
    policy: {assignmentWindowMs: 250, directDistanceMs: 500, strikeBoundMs: 750, groupBoundMs: 1250, extraBoundMs: 1500,
      groupTime: 'ONE_CANONICAL_ONSET', reservation: 'LITERAL_DIRECT_CLAIMANT_OWN_FIXED_COMMIT_ONLY'},
    mathematicalHorizon: 'H(t)=max(u+w: same pitch, |u-t|<=2w)<=t+3w. Local incompatible o satisfies |o-g|<=w; its direct correct claimant s<=g+2w, H(s)<=g+5w. Local WRONG claimant g<=o+w, G(g)<=o+6w. No recursion; w=250ms.',
    verdictSchema: ['CORRECT', 'MISSING', 'WRONG', 'INCOMPLETE_CHORD', 'EXTRA', 'NOT_REACHED'],
    changedProductFiles: git('diff', '--name-status', START, implementationCommit, '--', 'apps/customer-web/src').split('\n'),
    testPlan: ['33+ hand-authored/product generated invariants', 'all local-core/MIDI/session/completion/Review tests', 'full customer-web Vitest suite', 'full TypeScript noEmit', 'repository ESLint'],
    buildPlan: 'npm run build -- --webpack: full Next production build using the repository webpack configuration; no single-entry substitute.',
    parityPlan: 'Four frozen cells; compare assignments, ownership, groups, extras, required/unclamped frontiers and availability after every publication and terminal. Report original-vs-canonical differences separately. No inference or acoustic decode.',
    acceptance: 'Zero canonical-reference/product semantic differences; zero double ownership, horizon violations, unresolved terminal reservations or new target regression; clean-break only; full tests/typecheck/build pass.',
    classification: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION', newNeuralInferenceCount: 0, newDatasetCount: 0,
    productionMicrophone: false, continuousCapability: 'MODEL_NOT_VALIDATED', stepCapability: 'ATTEMPT_ANALYZER_NOT_VALIDATED'};
  const prior = await load(`${reports}/continuous_product_core_freeze_v1_2026-10-16.json`);
  for (const file of prior.sources.filter(file => file.path.startsWith('apps/customer-web/src/'))) {
    if (await fileHash(file.path) !== file.sha256) throw new Error('PRODUCT_SOURCE_CHANGED_DURING_TOOLING_REPAIR');
  }
  record.productImplementationCommit = prior.implementationCommit;
  record.supersedesInvalidatedFreeze = {commit: 'f19480f0829afd4c579d8b913566d31227e13f43',
    reason: 'Qualification evidence serialization only; all product/test source hashes unchanged.', productAndTestSourcesIdentical: true};
  record.freezeSha256 = sha(JSON.stringify(record));
  await json(freezePath, record);
  console.log(JSON.stringify({freezePath, freezeSha256: record.freezeSha256, sourceCount: record.sources.length, inputCount: record.inputs.length}));
}

export async function verify() {
  const freeze = await load(freezePath), {freezeSha256, ...content} = freeze;
  if (sha(JSON.stringify(content)) !== freezeSha256) throw new Error('FREEZE_DIGEST_CHANGED');
  for (const file of [...freeze.sources, ...freeze.inputs]) if (await fileHash(file.path) !== file.sha256) throw new Error(`FROZEN_FILE_CHANGED:${file.path}`);
  const freezeCommit = git('log', '-1', '--format=%H', '--', freezePath);
  const remote = git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
  if (!freezeCommit || remote !== freezeCommit || git('rev-parse', 'HEAD') !== freezeCommit) throw new Error(`REMOTE_FREEZE_REQUIRED:${remote}`);
  return {freeze, proof: {freezeCommit, remoteHead: remote, verifiedAt: new Date().toISOString(), freezeSha256}};
}

function expected(scenario, canonicalize) {
  const rows = scenario.expected.map((s, i) => ({strikeId: s.strikeId, groupId: s.groupId, pitch: pitch(s.pitch),
    expectedPerformanceTimeMs: scenario.beatPositions[i] * 60000 / scenario.fixedBpm, renderNoteIds: []}));
  if (!canonicalize) return rows;
  const times = new Map();
  for (const row of rows) times.set(row.groupId, Math.min(times.get(row.groupId) ?? Infinity, row.expectedPerformanceTimeMs));
  return rows.map(row => ({...row, expectedPerformanceTimeMs: times.get(row.groupId)}));
}
function normalizedReference(snapshot) {
  const witnesses = new Map(snapshot.strikeWitnesses.map(s => [s.strikeId, s]));
  const finality = witness => witness ? {required: witness.requiredAnalysisFrontierMs ?? witness.requiredFrontierMs,
    unclamped: witness.unclampedRequiredFrontierMs, available: witness.finalizationTimeMs ?? witness.availabilityTimeMs,
    terminalClamp: witness.terminalClamp} : null;
  return {strikes: sorted(snapshot.lowLevel.strikes.map(s => ({id: s.strikeId, state: s.verdict,
    observation: s.matchedObservationId ?? null, offset: s.timingOffsetMs ?? null, finality: finality(witnesses.get(s.strikeId))}))),
    groups: sorted(snapshot.verdicts.filter(v => v.groupId).map(v => ({id: v.groupId, verdict: v.verdict,
      evidence: [...v.evidenceObservationIds].sort(), finality: finality(v.witness)}))),
    extras: sorted(snapshot.verdicts.filter(v => v.verdict === 'EXTRA').map(v => ({id: v.id, finality: finality(v.witness)}))),
    owners: sorted(snapshot.observationConsumption.map(o => ({id: o.observationId, disposition: o.disposition, owner: o.owner}))),
    reservations: [...snapshot.provisionalReservations.map(r => r.observationId)].sort(),
  };
}
function normalizedProduct(snapshot) {
  const finality = f => f ? {required: f.requiredAnalysisFrontierMs, unclamped: f.unclampedRequiredFrontierMs,
    available: f.finalizationTimeMs, terminalClamp: f.terminalClamp} : null;
  return {strikes: sorted(snapshot.groups.flatMap(g => g.strikes.map(s => ({id: s.strikeId, state: s.state,
    observation: s.state === 'MATCHED' ? s.match.observation.observationId : null,
    offset: s.state === 'MATCHED' ? s.match.timingOffsetMs : null, finality: finality(s.finality)})))),
    groups: sorted(snapshot.groups.filter(g => g.verdict !== 'PENDING').map(g => ({id: g.groupId, verdict: g.verdict,
      evidence: [...g.evidenceObservationIds].sort(), finality: finality(g.finality)}))),
    extras: sorted(snapshot.extras.map(e => ({id: e.observation.observationId, finality: finality(e.finality)}))),
    owners: sorted(snapshot.observationOwnership.map(o => ({id: o.observationId, disposition: o.disposition, owner: o.ownerId}))),
    reservations: [...snapshot.reservedObservationIds].sort(),
  };
}
const differences = (left, right) => Object.keys(left).filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
const changedRowCount = (left, right) => {
  const key = row => typeof row === 'string' ? row : row.id;
  const a = new Map(left.map(row => [key(row), JSON.stringify(row)]));
  const b = new Map(right.map(row => [key(row), JSON.stringify(row)]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(id => a.get(id) !== b.get(id)).length;
};

async function parity() {
  const {freeze, proof} = await verify();
  const executionStartedAt = new Date().toISOString();
  await json(`${work}/execution_start.json`, {phase: PHASE, proof, executionStartedAt});
  const require = createRequire(path.resolve('apps/customer-web/package.json'));
  const {createJiti} = require('jiti');
  const jiti = createJiti(import.meta.url);
  const {ContinuousFinalizer} = await jiti.import(path.resolve('apps/customer-web/src/lib/practice/local-core/continuous-finalizer.ts'));
  const summaries = [];
  const auditPath = `${work}/parity_audits.ndjson.gz`;
  const gzip = createGzip();
  const auditFinished = pipeline(gzip, createWriteStream(auditPath, {flags: 'wx'}));
  const writeAudit = async value => { if (!gzip.write(JSON.stringify(value) + '\n')) await once(gzip, 'drain'); };
  for (const cell of freeze.cells) {
    const {split, configuration} = cell;
    const benchmark = await load(`backend/data/work/xc2_robust_product_baseline_v1/${split.toLowerCase()}_benchmark.json`);
    const originalAudit = JSON.parse(gunzipSync(await readFile(`backend/data/work/xc8_finalizer/${split}_${configuration}_audit.json.gz`)));
    const immutableScenarios = new Map(originalAudit.audits.map(a => [a.scenarioId, a.snapshot]));
    const targets = (await load(`backend/data/work/xc8_finalizer/${split}_${configuration}_metrics.json`)).fixedTruthRows;
    const summary = {...cell, scenarios: 0, publicationComparisons: 0, semanticDifferences: [], canonicalizationChanges: [],
      originalReferenceReproductionDifferences: [], changedExpectedStrikeCount: 0,
      safetyCounters: {doubleOwnership: 0, horizonViolations: 0, terminalReservations: 0, newTargetRegressions: 0}, targetRows: []};
    const [resampler, , owned, future] = configuration.split('_').length === 5
      ? [configuration.startsWith('BAND_LIMITED') ? 'BAND_LIMITED' : 'LINEAR', 'A', ...configuration.split('_').slice(-2)]
      : configuration.split('_');
    for (const clip of benchmark.clips) {
      const rawPath = `backend/data/work/xc2_robust_product_baseline_v1/raw/${split}_${resampler}_${owned}_${future}_1.20.1/${clip.clipId}.json`;
      if (!freeze.inputs.some(file => file.path === rawPath)) throw new Error(`RAW_INPUT_NOT_FROZEN:${rawPath}`);
      const raw = await load(rawPath);
      const publications = raw.publications.A.map(p => ({publicationId: p.publicationId, analyzedThroughPerformanceMs: p.analyzedThroughPerformanceMs,
        availabilityTimeMs: p.availabilityTimeMs, observations: p.observations.map(o => ({observationId: o.observationId, pitch: pitch(o.pitch),
          performanceTimeMs: o.performanceTimeMs, confidence: o.confidence, source: 'ACOUSTIC'}))}));
      for (const scenario of clip.scenarios) {
        const strikes = expected(scenario, true), originalStrikes = expected(scenario, false);
        summary.changedExpectedStrikeCount += strikes.filter((s, i) => s.expectedPerformanceTimeMs !== originalStrikes[i].expectedPerformanceTimeMs).length;
        const reference = new DirectClaimantCommitFinalizer(strikes), original = new DirectClaimantCommitFinalizer(originalStrikes);
        const product = new ContinuousFinalizer(scenario.id, strikes);
        const checks = [];
        for (const publication of publications) {
          reference.publish(publication); original.publish(publication);
          product.publish({...publication, sessionDomainId: scenario.id});
          const keys = differences(normalizedReference(reference.snapshot()), normalizedProduct(product.snapshot()));
          summary.publicationComparisons++;
          if (keys.length) checks.push({publicationId: publication.publicationId, keys,
            reference: normalizedReference(reference.snapshot()), product: normalizedProduct(product.snapshot())});
        }
        const last = publications.at(-1);
        const referenceResult = reference.completeNaturalScope(last.analyzedThroughPerformanceMs, last.availabilityTimeMs);
        const originalResult = original.completeNaturalScope(last.analyzedThroughPerformanceMs, last.availabilityTimeMs);
        const productResult = product.complete({reason: 'SCOPE_COMPLETED', performanceTimeMs: last.analyzedThroughPerformanceMs, availabilityTimeMs: last.availabilityTimeMs});
        const normalized = normalizedProduct(productResult), ref = normalizedReference(referenceResult), old = normalizedReference(originalResult);
        const keys = differences(ref, normalized);
        if (keys.length) checks.push({terminal: true, keys, reference: ref, product: normalized});
        if (checks.length) summary.semanticDifferences.push({scenarioId: scenario.id, checks});
        const immutable = normalizedReference(immutableScenarios.get(scenario.id));
        if (differences(immutable, old).length) summary.originalReferenceReproductionDifferences.push({scenarioId: scenario.id, keys: differences(immutable, old)});
        const changes = differences(old, ref);
        if (changes.length) summary.canonicalizationChanges.push({scenarioId: scenario.id, changedFields: changes,
          changedRowsByField: Object.fromEntries(changes.map(field => [field, changedRowCount(old[field], ref[field])])),
          groupVerdictChanges: ref.groups.filter(row => old.groups.find(prior => prior.id === row.id)?.verdict !== row.verdict)
            .map(row => ({groupId: row.id, original: old.groups.find(prior => prior.id === row.id)?.verdict, canonical: row.verdict})),
          fullWitness: `${auditPath}#${scenario.id}`});
        summary.safetyCounters.doubleOwnership += normalized.owners.length - new Set(normalized.owners.map(o => o.id)).size;
        summary.safetyCounters.terminalReservations += normalized.reservations.length;
        for (const g of productResult.groups) {
          if (g.finality.unclampedRequiredFrontierMs > g.performanceTimeMs + 1250 + 1e-8) summary.safetyCounters.horizonViolations++;
          for (const s of g.strikes) if (s.finality.unclampedRequiredFrontierMs > s.expectedPerformanceTimeMs + 750 + 1e-8) summary.safetyCounters.horizonViolations++;
        }
        for (const e of productResult.extras) if (e.finality.unclampedRequiredFrontierMs > e.observation.performanceTimeMs + 1500 + 1e-8) summary.safetyCounters.horizonViolations++;
        const rows = targets.filter(row => row.targetId.startsWith(scenario.id + ':'));
        const extraTargets = scenario.targetExtra;
        const extras = sorted(referenceResult.verdicts.filter(v => v.verdict === 'EXTRA').map(v => ({id: v.id,
          ...publications.flatMap(p => p.observations).find(o => o.observationId === v.id)})));
        const extraPairs = minimumCostPairs(extraTargets, extras, (a, b) => pitch(a.pitch) === b.pitch && Math.abs(a.timeMs - b.performanceTimeMs) <= 50
          ? Math.abs(a.timeMs - b.performanceTimeMs) : Infinity);
        const productExtras = productResult.extras.map(extra => extra.observation).sort((a, b) => a.observationId.localeCompare(b.observationId));
        const productExtraPairs = minimumCostPairs(extraTargets, productExtras, (a, b) => pitch(a.pitch) === b.pitch && Math.abs(a.timeMs - b.performanceTimeMs) <= 50
          ? Math.abs(a.timeMs - b.performanceTimeMs) : Infinity);
        for (const row of rows) {
          const target = row.targetId.slice(scenario.id.length + 1);
          const result = productResult.groups.find(g => g.groupId === target);
          const referenceGroup = referenceResult.verdicts.find(group => group.groupId === target);
          const canonicalVerdict = referenceGroup?.verdict ?? (extraPairs.some(([i]) => extraTargets[i].id === target) ? 'EXTRA' : 'NOT_DETECTED');
          const productVerdict = result?.verdict ?? (productExtraPairs.some(([i]) => extraTargets[i].id === target) ? 'EXTRA' : 'NOT_DETECTED');
          if (canonicalVerdict === row.truth && productVerdict !== row.truth) summary.safetyCounters.newTargetRegressions++;
          summary.targetRows.push({targetId: row.targetId, truth: row.truth, historical: row.candidate, canonicalReference: canonicalVerdict,
            product: productVerdict, readoutDiffersFromFrozen: row.candidate !== canonicalVerdict});
        }
        await writeAudit({...cell, scenarioId: scenario.id, product: product.completedEvaluation(), reference: ref, original: old});
        summary.scenarios++;
      }
    }
    summary.parityPass = summary.semanticDifferences.length === 0 && summary.originalReferenceReproductionDifferences.length === 0
      && Object.values(summary.safetyCounters).every(count => count === 0);
    summaries.push(summary);
    console.log(JSON.stringify({...cell, scenarios: summary.scenarios, comparisons: summary.publicationComparisons,
      differences: summary.semanticDifferences.length, normalizationChanges: summary.canonicalizationChanges.length, pass: summary.parityPass}));
  }
  gzip.end();
  await auditFinished;
  const result = {phase: PHASE, classification: 'POST_XC2_DIAGNOSTIC_ONLY_NOT_FRESH_EVALUATION', proof, executionStartedAt,
    completedAt: new Date().toISOString(), canonicalization: freeze.canonicalization,
    targetReadoutNote: 'Group readout uses fixed target truth from the frozen receipt. EXTRA qualification readout pairs target-only extras at the historical 50ms tolerance, identically for canonical reference and product; this is not the original scenario-wide oracle EXTRA metric. Readout differences from frozen targets are not all attributed to canonicalization. Full original/canonical semantic changes are independently retained in the lossless audit.',
    cells: summaries,
    auditPath, auditFormat: 'GZIP_NDJSON_ONE_SCENARIO_PER_LINE', auditSha256: await fileHash(auditPath), pass: summaries.every(cell => cell.parityPass),
    newNeuralInferenceCount: 0, newDatasetCount: 0, newMidiTruthReads: 0};
  await json(`${work}/parity.json`, result);
  await json(`${reports}/continuous_product_core_parity_v2_2026-10-16.json`, result);
  const {ContinuousPracticeSession, ManualClock} = await jiti.import(path.resolve('apps/customer-web/src/lib/practice/local-core/index.ts'));
  const clock = new ManualClock(0);
  const session = new ContinuousPracticeSession({artifact: await load('apps/customer-web/src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json'),
    scope: {kind: 'FULL'}, clock, tempoSelection: {mode: 'CUSTOM_FIXED_BPM', bpm: 60}, inputSource: 'MIDI', countInBeats: 0, localSessionId: 'completed-example'});
  session.start(); let now = 0;
  for (const [time, pitch] of [[0,'C4'],[2000,'F#4'],[3000,'A4'],[3900,'F#4'],[4500,'D5']]) {
    clock.advance(time - now); now = time;
    session.observeCapturedAttack({captureTime: session.timebase.atSessionMs(time), pitch, source: 'MIDI', confidence: 1});
  }
  clock.advance(2500); session.snapshot();
  await json(`${work}/completed_example.json`, session.completedEvaluation());
  if (!result.pass) throw new Error('PRODUCT_IMPLEMENTATION_PARITY_FAILED');
}

async function github() {
  const head = git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
  const credential = execFileSync('git', ['credential', 'fill'], {input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8'});
  const token = credential.split('\n').find(line => line.startsWith('password='))?.slice(9);
  if (!token) throw new Error('GITHUB_READ_CREDENTIAL_UNAVAILABLE');
  const api = async suffix => {
    const response = await fetch(`https://api.github.com/repos/tinghui0912/NoteVerse-Pro/${suffix}`, {
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}});
    if (!response.ok) throw new Error(`GITHUB_API_${response.status}`);
    return response.json();
  };
  const combined = await api(`commits/${head}/status`), workflow = await api(`actions/runs?head_sha=${head}`);
  const receipt = {phase: PHASE, queriedAt: new Date().toISOString(), remoteHead: head,
    combinedState: combined.state, statuses: combined.statuses, workflowRuns: workflow.workflow_runs,
    interpretation: combined.statuses.length === 0 && workflow.workflow_runs.length === 0 ? 'NOT CI PASS' : 'ACTUAL_API_STATE_NOT_INFERRED_FROM_LOCAL_TESTS'};
  await json(`${reports}/continuous_product_core_github_receipt_2026-10-16.json`, receipt);
  console.log(JSON.stringify(receipt));
}

async function report() {
  const freeze = await load(freezePath), parity = await load(`${work}/parity.json`), checks = await load(`${work}/checks.json`);
  const history = await load('backend/research/history/continuous-product-core-before-promotion/manifest.json');
  for (const file of history.files) {
    const archived = file.path.replace('apps/customer-web/src/lib/practice/', 'backend/research/history/continuous-product-core-before-promotion/');
    if (await fileHash(archived) !== file.sha256) throw new Error('HISTORICAL_SOURCE_ARCHIVE_CHANGED');
  }
  const historicalReportChanges = git('diff', '--name-only', START, '--', reports).split('\n').filter(file => file && !file.includes('/continuous_product_core_'));
  if (historicalReportChanges.length) throw new Error('HISTORICAL_REPORT_CHANGED');
  const pass = parity.pass && checks.runs.every(run => run.exitCode === 0);
  const result = {phase: PHASE, disposition: pass ? 'CONTINUOUS_V2_PRODUCT_CORE_PROMOTED_MICROPHONE_DISABLED' : 'CONTINUOUS_V2_PRODUCT_CORE_PROMOTION_BLOCKED',
    startingHead: START, implementationCommit: freeze.productImplementationCommit, qualificationToolingCommit: freeze.implementationCommit,
    invalidatedFreeze: freeze.supersedesInvalidatedFreeze, freezeCommit: parity.proof.freezeCommit,
    freezeSha256: freeze.freezeSha256, remoteFreezeProof: parity.proof, executionStartedAt: parity.executionStartedAt,
    sourceHashes: freeze.sources, inputHashes: freeze.inputs,
    moduleResponsibilities: {observation: 'immutable identities and coverage', assignment: 'single max-cardinality/min-error matcher',
      policy: 'literal direct horizon queries', finalizer: 'reservation and irreversible lifecycle', session: 'artifact construction',
      midi: 'sequence identities and clock-authorized publications', projection: 'accumulated completion, no reevaluation'},
    oldArchitecture: {transitiveProductLedgerDeleted: true, flatCompletedStrikeMirrorDeleted: true, compatibilityFallback: false,
      historicalSourceArchiveFiles: history.files.length, byteIdenticalArchive: true, historicalReportsChanged: historicalReportChanges},
    mathematicalHorizon: freeze.mathematicalHorizon, parity: {path: 'continuous_product_core_parity_v2_2026-10-16.json', pass: parity.pass,
      comparison: 'BILATERALLY_CANONICALIZED_EXPECTED_GROUP_TIME_NOT_CLAIM_OF_ORIGINAL_INPUT_EQUIVALENCE',
      cells: parity.cells.map(cell => ({split: cell.split, configuration: cell.configuration, scenarios: cell.scenarios,
        publicationComparisons: cell.publicationComparisons, pass: cell.parityPass, safetyCounters: cell.safetyCounters,
        changedExpectedStrikeCount: cell.changedExpectedStrikeCount, canonicalizationChangedScenarios: cell.canonicalizationChanges.length,
        targetReadoutDifferencesFromFrozen: cell.targetRows.filter(row => row.readoutDiffersFromFrozen)})),
      targetReadoutNote: parity.targetReadoutNote},
    verification: checks, completedExample: await load(`${work}/completed_example.json`),
    protections: {continuousCapability: 'MODEL_NOT_VALIDATED', stepCapability: 'ATTEMPT_ANALYZER_NOT_VALIDATED', productionMicrophone: false,
      acousticCoreSha256: '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443',
      f5: 'NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER', phase9gB: 'STATISTICAL_TIE', winner: null,
      r2HistoricalStatus: 'DIRECT_CONFLICT_RESERVATION_PARTIALLY_RECOVERS_SAFETY', viennaProtectedInferenceIncrease: 0,
      d4: false, backendPracticeRuntime: false, practiceWebSocket: false, scoreFollowing: false,
      commercialQualification: 'NOT_PERFORMED', productLatencySlo: 'NOT_YET_FROZEN', newNeuralInferenceCount: 0, newDatasetCount: 0},
    limitations: ['Parity uses already exposed observations, not fresh accuracy/generalization evidence.',
      'Canonicalization changes historical expected times; original reference is reproduced and differences are disclosed, not overwritten.',
      'No microphone, acoustic runtime promotion, natural fixed-BPM capture, UI latency or commercial qualification.',
      'Diagnostic product parity does not change any historical scientific disposition.']};
  await json(`${reports}/continuous_product_core_final_2026-10-16.json`, result);
  console.log(JSON.stringify({disposition: result.disposition}));
}

const command = process.argv[2];
if (command === 'freeze') await freeze();
else if (command === 'verify') console.log(JSON.stringify((await verify()).proof));
else if (command === 'parity') await parity();
else if (command === 'github') await github();
else if (command === 'report') await report();
else throw new Error('COMMAND_REQUIRED');
