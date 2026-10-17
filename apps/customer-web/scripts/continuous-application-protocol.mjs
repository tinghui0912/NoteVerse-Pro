import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, APP, git, hash, newJson, fileIdentity } from './continuous-runtime-protocol.mjs';
export { ROOT, APP, git, hash, newJson, fileIdentity };
export const START = '580512dc75110d48b0cb6c6eece74f2156dea9fe';
export const PHASE = 'PRACTICE_CONTINUOUS_APPLICATION_ORCHESTRATION_CLEAN_INTEGRATION_DISABLED';
export const WORK = path.join(ROOT, 'backend/data/work/continuous_application');
export const FREEZE = path.join(ROOT, 'backend/research/reports/continuous_application_clock_gate_freeze_v1_2026-10-17.json');
export async function inventory() {
  const require = createRequire(import.meta.url), ts = require(path.join(APP, 'node_modules/typescript'));
  const files = git('ls-tree', '-r', '--name-only', START, 'apps/customer-web/src', 'apps/customer-web/scripts').split('\n').filter(p => /\.(ts|tsx|js|mjs)$/.test(p));
  const known = new Set(files), edges = [], calls = [];
  for (const file of files) {
    const text = execFileSync('git', ['show', `${START}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const resolve = spec => {
      const base = spec.startsWith('@/') ? `apps/customer-web/src/${spec.slice(2)}` : spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : null;
      if (!base) return null;
      return [base, base + '.ts', base + '.tsx', base + '.js', base + '.mjs', base + '/index.ts'].find(p => known.has(p)) ?? null;
    };
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const typeOnly = node.isTypeOnly === true || clause?.isTypeOnly === true || Boolean(!clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length && bindings.elements.every(n => n.isTypeOnly));
        edges.push({ from: file, specifier: node.moduleSpecifier.text, to: resolve(node.moduleSpecifier.text), typeOnly });
      }
      if (ts.isNewExpression(node) && node.expression.getText(tree) === 'Worker') calls.push({ file, kind: 'Worker construction', expression: node.getText(tree).slice(0, 300) });
      if (ts.isCallExpression(node) && /createByteDanceBrowserWorkerClient|defaultByteDanceModelManifest|createOpfsByteDanceModelLoader|getUserMedia/.test(node.expression.getText(tree))) {
        calls.push({ file, kind: 'Executable/model boundary call', expression: node.expression.getText(tree) });
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  const executableCandidates = files.filter(p => /bytedance-worker|bytedance-capture\.worklet|scripts\/bytedance-.*smoke/.test(p));
  const reach = root => {
    const seen = new Set(), pending = [root];
    while (pending.length) { const p = pending.pop(); if (seen.has(p)) continue; seen.add(p); for (const e of edges) if (e.from === p && e.to && !e.typeOnly) pending.push(e.to); }
    return [...seen].sort();
  };
  const report = { phase: PHASE, baselineRevision: START, parser: `typescript ${ts.version}`, filesInspected: files.length,
    edges, calls, roots: { hook: reach('apps/customer-web/src/hooks/practice/use-local-practice.ts'),
      promotedModel: reach('apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts') },
    executableCandidates: executableCandidates.map(file => ({ file, incoming: edges.filter(e => e.to === file),
      classification: 'ALTERNATE_EXECUTABLE_OR_SUPPORT_REQUIRES_CLEANUP_AFTER_CLOCK_GATE',
      actionBeforeClockGate: 'INVENTORIED_NOT_YET_ARCHIVED_NO_PROMOTION_CLAIM' })),
    sharedPrimitives: ['bytedance-decoder.ts', 'bytedance-contract.ts'],
    limitation: 'AST import/export reachability plus Worker/call sites; dynamic generated-script imports appear in retained calls/scripts and require explicit cleanup. No old path deleted before this inventory.' };
  await newJson(path.join(ROOT, 'backend/research/reports/continuous_application_import_inventory_2026-10-17.json'), report);
}
export async function freeze() {
  if (git('status', '--porcelain')) throw new Error('SOURCE_NOT_CLEAN_COMMITTED');
  const paths = git('ls-files', 'apps/customer-web', 'backend/app/modules/model_assets', 'backend/tests/test_continuous_model_asset.py',
    'backend/research/browser_runtime/xc1_browser_runtime_shared.mjs').split('\n').filter(Boolean);
  const files = await Promise.all(paths.map(fileIdentity));
  await newJson(FREEZE, { phase: PHASE, gate: 'PRE_CONTROLLER_CAPTURE_CLOCK_CONTRACT_GATE_NOT_APPLICATION_ACCEPTANCE',
    startingHead: START, productImplementationCommit: git('log', '-1', '--format=%H', '--', 'apps/customer-web/src'),
    qualificationToolingCommit: git('rev-parse', 'HEAD'), createdAt: new Date().toISOString(), files,
    assets: await Promise.all(['backend/data/work/xc6_capture/fake-device.wav',
      'backend/research/reports/continuous_application_import_inventory_2026-10-17.json', ...['package.json', 'dist/ort.webgpu.min.mjs',
      'dist/ort-wasm-simd-threaded.jsep.mjs', 'dist/ort-wasm-simd-threaded.jsep.wasm'].map(p => `apps/customer-web/node_modules/onnxruntime-web/${p}`)].map(fileIdentity)),
    model: { assetId: 'practice-acoustic-robust-browser', assetVersion: 'v1', bytes: 98689283,
      sha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3', ort: '1.20.1', provider: 'webgpu', automaticFallback: false },
    protocol: { method: 'SINGLE_FIXED_AFFINE_GET_OUTPUT_TIMESTAMP_ANCHOR_UNIT_SLOPE', anchor: 'First pair after >=2s real captured context and nonzero output timestamp; no quality-based pair selection.',
      sourceRates: [44100, 48000], witnessDelayMs: [0, 100, 200, 400, 600, 800, 1000, 1200],
      formula: 'round((anchor.contextTime+(runtimeMs-anchor.performanceTime)/1000)*sourceRate)-sourceOriginContextFrame',
      validation: 'Subsequent output timestamp pairs are independent witnesses, never refits. Absolute consistency error <=1 source sample. Quantization error reported separately.',
      stopRule: 'First >1-source-sample error stops this gate, subsequent rates and controller implementation. No alternate mapper/tolerance sweep.',
      sourceBoundaryDiagnostics: 'Record whether mapped command samples have already been captured; these are metadata-only block witnesses, not controller acceptance.',
      noClockAuthority: true, inferenceRuns: 0, modelOrScoreInput: false },
    acceptance: 'Passing this gate only permits further controller implementation and a separate full controller freeze/qualification. Failure returns CONTINUOUS_CAPTURE_CLOCK_CONTRACT_BLOCKED.',
    testPlan: ['full Vitest', 'full tsc', 'ESLint JSON', 'Next build --webpack', 'Docker backend model-asset unittest', 'headed Chrome fake-media clock-only gate'],
    productionMicrophone: false, D4: false, continuous: 'MODEL_NOT_VALIDATED', step: 'ATTEMPT_ANALYZER_NOT_VALIDATED' });
}
export async function verify() {
  const plan = JSON.parse(await readFile(FREEZE, 'utf8')), freezeCommit = git('log', '-1', '--format=%H', '--', path.relative(ROOT, FREEZE).replaceAll('\\', '/'));
  const remote = git('ls-remote', 'origin', 'refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
  if (remote !== freezeCommit || git('rev-parse', 'HEAD') !== freezeCommit) throw new Error('REMOTE_FREEZE_MISMATCH');
  for (const expected of [...plan.files, ...plan.assets]) if ((await fileIdentity(expected.path)).sha256 !== expected.sha256) throw new Error('FROZEN_FILE_CHANGED:' + expected.path);
  return { phase: PHASE, freezeCommit, freezeSha256: hash(await readFile(FREEZE)), remoteHead: remote, remoteVerifiedAt: new Date().toISOString() };
}
if (process.argv[2] === 'inventory') await inventory();
else if (process.argv[2] === 'freeze-clock-gate') await freeze();
else if (process.argv[2] === 'verify-clock-gate') console.log(JSON.stringify(await verify()));
