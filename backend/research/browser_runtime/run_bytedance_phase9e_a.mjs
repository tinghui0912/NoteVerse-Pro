#!/usr/bin/env node
// Research-only Phase 9E-A runner/auditor for the ByteDance chunked candidate.
//
// This command intentionally does not integrate with production Practice. It:
// 1. verifies the claimed ByteDance ONNX model identity,
// 2. executes real ORT Web browser inference on arbitrary 29120-sample chunks
//    or, by default, one smoke chunk,
// 3. audits DEVELOPMENT causal cases for Practice v2 Continuous eligibility,
// 4. writes a normalized research artifact without manufacturing product metrics.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '../../../apps/customer-web/node_modules/playwright/index.js';
import { classifyCausalCase } from './bytedance_phase9e_eligibility.mjs';

const EXPECTED_MODEL_SHA256 = '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';
const EXPECTED_MODEL_BYTES = 98691493;
const ORT_WEB_VERSION = '1.20.1';
const EXECUTION_PROVIDER = 'wasm';
const GRAPH_OPTIMIZATION_LEVEL = 'disabled';
const CANDIDATE_INFERENCE_CONCURRENCY = 1;
const INPUT_SAMPLES = 29120;
const OUTPUT_NAMES = ['reg_onset_output', 'frame_output'];
const OUTPUT_DIMS = [1, 183, 88];

const { chromium } = playwright;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = value;
      index += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const repoRoot = path.resolve(args['repo-root'] ?? process.cwd());
const modelRelPath = args.model ?? 'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx';
const modelPath = path.resolve(repoRoot, modelRelPath);
const causalManifestRelPath = args['causal-manifest'] ?? 'backend/data/work/datasets/maestro-v3.0.0/production_step_development_set/public_step_causal_cases_manifest.json';
const causalManifestPath = path.resolve(repoRoot, causalManifestRelPath);
const ortDirRelPath = args['ort-dir'] ?? 'backend/data/work/ort-ab/1.20.1/node_modules/onnxruntime-web/dist';
const ortDir = path.resolve(repoRoot, ortDirRelPath);
const outputDirRelPath = args['output-dir'] ?? 'backend/research/reports';
const outputDir = path.resolve(repoRoot, outputDirRelPath);
const gitHead = String(args['git-head'] ?? 'UNKNOWN');
const backend = String(args.backend ?? 'wasm');
const browserChannel = args['browser-channel'] ? String(args['browser-channel']) : undefined;
const chunkInputRelPath = args['chunk-input-json'] ? String(args['chunk-input-json']) : null;
const chunkInputPath = chunkInputRelPath ? path.resolve(repoRoot, chunkInputRelPath) : null;
const rawOutputRelPath = args['raw-output-json'] ? String(args['raw-output-json']) : null;
const rawOutputPath = rawOutputRelPath ? path.resolve(repoRoot, rawOutputRelPath) : null;

await mkdir(outputDir, { recursive: true });
if (rawOutputPath) await mkdir(path.dirname(rawOutputPath), { recursive: true });

const modelIdentity = existsSync(modelPath)
  ? {
      path: modelRelPath,
      sha256: await sha256File(modelPath),
      bytes: statSync(modelPath).size,
      available: true,
    }
  : { path: modelRelPath, available: false };

const modelStatus = modelIdentity.available
  && modelIdentity.sha256 === EXPECTED_MODEL_SHA256
  && modelIdentity.bytes === EXPECTED_MODEL_BYTES
  ? 'PASS'
  : 'BLOCKED';

if (backend !== EXECUTION_PROVIDER) {
  throw new Error(`Execution provider ${backend} does not match frozen Phase 9E-A.3 profile ${EXECUTION_PROVIDER}.`);
}

const chunkInput = chunkInputPath
  ? await loadChunkInputJson(chunkInputPath)
  : {
      mode: 'RUNTIME_EXECUTION_SMOKE_ONLY',
      chunks: [{ chunkId: 'runtime-smoke-zero-input', pcm16k: new Array(INPUT_SAMPLES).fill(0) }],
    };

const runtimeSmoke = modelStatus === 'PASS'
  ? await runBrowserChunkExecutor({ modelPath, ortDir, backend, browserChannel, chunks: chunkInput.chunks, rawOutputPath }).catch((error) => ({
      status: 'FAIL',
      error: error instanceof Error ? error.message : String(error),
      backend,
    }))
  : { status: 'NOT_RUN', reason: 'Model identity was not verified.', backend };

const causalManifest = existsSync(causalManifestPath)
  ? JSON.parse(await readFile(causalManifestPath, 'utf8'))
  : null;
const cases = Array.isArray(causalManifest?.cases) ? causalManifest.cases : [];
const eligibility = cases.map(classifyCausalCase);
const reasonCounts = eligibility.reduce((counts, item) => {
  counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}, {});

const artifact = {
  schemaVersion: 2,
  artifact: 'phase9e_a_2_bytedance_runner_audit',
  generatedAt: new Date().toISOString(),
  researchHarnessGitHead: gitHead,
  normalizedCommand: [
    'node backend/research/browser_runtime/run_bytedance_phase9e_a.mjs',
    '--repo-root .',
    `--git-head ${gitHead}`,
    `--model ${modelRelPath}`,
    `--causal-manifest ${causalManifestRelPath}`,
    `--ort-dir ${ortDirRelPath}`,
    `--backend ${backend}`,
    `--output-dir ${outputDirRelPath}`,
    ...(chunkInputRelPath ? [`--chunk-input-json ${chunkInputRelPath}`] : []),
    ...(rawOutputRelPath ? [`--raw-output-json ${rawOutputRelPath}`] : []),
  ].join(' '),
  runtimeEnvironment: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    ortWebVersion: ORT_WEB_VERSION,
    executionProvider: EXECUTION_PROVIDER,
    graphOptimizationLevel: GRAPH_OPTIMIZATION_LEVEL,
    candidateInferenceConcurrency: CANDIDATE_INFERENCE_CONCURRENCY,
  },
  modelIdentity: {
    expectedSha256: EXPECTED_MODEL_SHA256,
    expectedBytes: EXPECTED_MODEL_BYTES,
    ...modelIdentity,
    status: modelStatus,
  },
  runtimeSmoke,
  chunkExecution: {
    mode: chunkInput.mode,
    chunkInput: chunkInputRelPath,
    rawOutput: rawOutputRelPath,
    chunkCount: chunkInput.chunks.length,
  },
  causalManifest: {
    path: causalManifestRelPath,
    available: Boolean(causalManifest),
    caseCount: cases.length,
  },
  eligibilitySummary: {
    eligibleContinuousScenarioCount: eligibility.filter((item) => item.status === 'ELIGIBLE_CONTINUOUS_SCENARIO').length,
    excludedCount: eligibility.filter((item) => item.status !== 'ELIGIBLE_CONTINUOUS_SCENARIO').length,
    reasons: reasonCounts,
  },
  eligibility,
  result: {
    status: 'BLOCKED_NOT_RUN',
    blocker: 'NO_ELIGIBLE_CONTINUOUS_DEVELOPMENT_SCENARIOS',
    reason: 'The real ByteDance ONNX runtime smoke was executed, but no causal case proved a complete Practice v2 Continuous score interval; no CandidateScenarioRun or product metric was produced.',
    candidateScenarioRunCount: 0,
    productMetricsStatus: 'NOT_EVALUATED',
  },
};

const outputPath = path.join(outputDir, 'bytedance_chunked_phase9e_a2_runner_audit_2026-10-07.json');
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(path.relative(repoRoot, outputPath).replaceAll(path.sep, '/'));

async function runBrowserChunkExecutor(input) {
  if (!existsSync(input.ortDir)) throw new Error(`Missing ORT dist directory: ${input.ortDir}`);
  const ortScript = input.backend === 'webgpu' ? 'ort.webgpu.min.js' : 'ort.min.js';
  const ortScriptPath = path.join(input.ortDir, ortScript);
  if (!existsSync(ortScriptPath)) throw new Error(`Missing ORT script: ${ortScriptPath}`);
  const ortPackagePath = path.resolve(input.ortDir, '..', 'package.json');
  const ortPackage = JSON.parse(await readFile(ortPackagePath, 'utf8'));
  if (ortPackage.version !== ORT_WEB_VERSION) {
    throw new Error(`ORT Web version ${ortPackage.version} does not match frozen execution profile ${ORT_WEB_VERSION}.`);
  }
  const server = createSmokeServer({ modelPath: input.modelPath, ortDir: input.ortDir, ortScript });
  const port = await listen(server);
  const browser = await chromium.launch({
    channel: input.browserChannel,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    const result = validateSmokeResult(await page.evaluate(({ chunks, includeRawOutputs }) => (
      window.__runChunks(chunks, includeRawOutputs)
    ), { chunks: input.chunks, includeRawOutputs: Boolean(input.rawOutputPath) }));
    if (input.rawOutputPath) {
      await writeFile(input.rawOutputPath, `${JSON.stringify({
        schemaVersion: 1,
        artifact: 'phase9e_a_bytedance_browser_chunk_raw_outputs',
        chunks: result.chunks,
      })}\n`);
    }
    const summarizedChunks = result.chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      inferenceLatencyMs: chunk.inferenceLatencyMs,
      outputNames: chunk.outputNames,
      outputs: chunk.outputs,
    }));
    return {
      status: 'PASS',
      ortWebVersion: ortPackage.version,
      browserVersion: await browser.version(),
      backend: EXECUTION_PROVIDER,
      graphOptimizationLevel: GRAPH_OPTIMIZATION_LEVEL,
      candidateInferenceConcurrency: CANDIDATE_INFERENCE_CONCURRENCY,
      ...result,
      chunks: summarizedChunks,
    };
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function createSmokeServer({ modelPath, ortDir, ortScript }) {
  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>ByteDance Phase 9E-A Smoke</title></head>
<body><script src="/ort/${ortScript}"></script><script>
async function runSmoke() {
  return runChunks([{ chunkId: 'runtime-smoke-zero-input', pcm16k: Array(${INPUT_SAMPLES}).fill(0) }], false);
}
async function runChunks(chunks, includeRawOutputs) {
  ort.env.logLevel = 'warning';
  const options = {
    executionProviders: [${JSON.stringify(ortScript.includes('webgpu') ? 'webgpu' : 'wasm')}],
    graphOptimizationLevel: '${GRAPH_OPTIMIZATION_LEVEL}'
  };
  const session = await ort.InferenceSession.create('/model.onnx', options);
  const results = [];
  for (const chunk of chunks) {
    if (!chunk.chunkId || !Array.isArray(chunk.pcm16k) || chunk.pcm16k.length !== ${INPUT_SAMPLES}) {
      throw new Error('Each ByteDance chunk must have chunkId and exactly ${INPUT_SAMPLES} pcm16k samples.');
    }
    const input = new Float32Array(chunk.pcm16k);
    const tensor = new ort.Tensor('float32', input, [1, ${INPUT_SAMPLES}]);
    const start = performance.now();
    const outputs = await session.run({ audio: tensor });
    const end = performance.now();
    const names = Object.keys(outputs);
    const summary = {};
    const rawOutputs = {};
    for (const name of names) {
      summary[name] = { dims: outputs[name].dims, type: outputs[name].type, length: outputs[name].data.length };
      for (const value of outputs[name].data) {
        if (!Number.isFinite(value)) {
          throw new Error('ByteDance output contains a non-finite value.');
        }
      }
      if (includeRawOutputs) {
        rawOutputs[name] = {
          dims: outputs[name].dims,
          type: outputs[name].type,
          data: Array.from(outputs[name].data)
        };
      }
    }
    results.push({
      chunkId: chunk.chunkId,
      outputNames: names,
      outputs: summary,
      rawOutputs: includeRawOutputs ? rawOutputs : undefined,
      inferenceLatencyMs: end - start
    });
  }
  return {
    sessionInputNames: session.inputNames,
    sessionOutputNames: session.outputNames,
    chunks: results,
    outputNames: results[0]?.outputNames ?? [],
    outputs: results[0]?.outputs ?? {},
    inferenceLatencyMs: results[0]?.inferenceLatencyMs ?? null
  };
}
window.__runSmoke = runSmoke;
window.__runChunks = runChunks;
</script></body></html>`;
  return createServer(async (req, res) => {
    try {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(pageHtml);
        return;
      }
      if (req.url === '/model.onnx') {
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(modelPath).pipe(res);
        return;
      }
      if (req.url?.startsWith('/ort/')) {
        const file = path.join(ortDir, path.basename(req.url));
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
        createReadStream(file).pipe(res);
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}

function validateSmokeResult(result) {
  if (!Array.isArray(result.chunks) || result.chunks.length === 0) {
    throw new Error('ByteDance browser executor produced no chunk results.');
  }
  for (const name of OUTPUT_NAMES) {
    const output = result.outputs?.[name];
    if (!output) throw new Error(`Missing ByteDance output ${name}.`);
    if (
      output.type !== 'float32'
      || !Array.isArray(output.dims)
      || output.dims.length !== OUTPUT_DIMS.length
      || output.dims.some((value, index) => value !== OUTPUT_DIMS[index])
      || output.length !== OUTPUT_DIMS.reduce((product, value) => product * value, 1)
    ) {
      throw new Error(`Unexpected ByteDance output shape for ${name}.`);
    }
  }
  return result;
}

async function loadChunkInputJson(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing ByteDance chunk input JSON: ${filePath}`);
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  const chunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
  if (chunks.length === 0) throw new Error('ByteDance chunk input JSON contains no chunks.');
  for (const chunk of chunks) {
    if (!chunk.chunkId || !Array.isArray(chunk.pcm16k) || chunk.pcm16k.length !== INPUT_SAMPLES) {
      throw new Error('Each ByteDance chunk input must include chunkId and exactly 29120 pcm16k samples.');
    }
    for (const sample of chunk.pcm16k) {
      if (!Number.isFinite(sample)) throw new Error(`ByteDance chunk ${chunk.chunkId} contains a non-finite PCM sample.`);
    }
  }
  return {
    mode: 'GENERIC_BROWSER_CHUNK_EXECUTOR',
    chunks,
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

async function sha256File(filePath) {
  const buffer = await readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}
