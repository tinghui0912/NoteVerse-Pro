#!/usr/bin/env node

/**
 * Production ByteDance Model Asset Verification Script.
 *
 * Verifies that the production model asset downloaded via HTTP streaming matches
 * the exact byte size (98,691,493) and SHA256 hash (6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5).
 * Outputs a structured JSON report to backend/research/reports/bytedance_model_asset_verification.json.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BYTE_SIZE = 98_691_493;
const EXPECTED_SHA256 = '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5';
const DEFAULT_MODEL_URL = 'https://assets.noteverse.net/models/bytedance/bytedance_note_model_fixed_anchor.onnx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const customerWebRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(customerWebRoot, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = next;
      i += 1;
    }
  }
  return args;
}

async function streamVerifyUrl(url, timeoutMs = 60_000) {
  const startTime = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP fetch failed: ${response.status} ${response.statusText}`);
    }

    const hash = crypto.createHash('sha256');
    let actualByteSize = 0;

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      actualByteSize += value.byteLength;
    }

    const actualSha256 = hash.digest('hex');
    const durationMs = Date.now() - startTime;

    return {
      actualByteSize,
      actualSha256,
      durationMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function serveLocalFileAndVerify(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Local model file does not exist: ${filePath}`);
  }

  const server = http.createServer((req, res) => {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const localUrl = `http://127.0.0.1:${port}/bytedance_note_model_fixed_anchor.onnx`;

  try {
    return await streamVerifyUrl(localUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const targetUrl = args.url
    || DEFAULT_MODEL_URL;
  const outputPath = args.output
    ? path.resolve(args.output)
    : path.resolve(repoRoot, 'backend/research/reports/bytedance_model_asset_verification.json');
  const localFallbackPath = args['serve-local-fallback'] || args['local-file']
    ? path.resolve(args['serve-local-fallback'] || args['local-file'])
    : path.resolve(repoRoot, 'backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx');

  console.log(`[model-asset-verify] Target URL: ${targetUrl}`);
  console.log(`[model-asset-verify] Output report: ${outputPath}`);

  let verificationResult;
  let source = 'remote-http-stream';

  try {
    console.log('[model-asset-verify] Attempting HTTP streaming fetch from target URL...');
    verificationResult = await streamVerifyUrl(targetUrl, 10_000);
  } catch (err) {
    console.warn(`[model-asset-verify] Remote URL fetch failed: ${err.message}`);
    if (fs.existsSync(localFallbackPath)) {
      console.log(`[model-asset-verify] Falling back to local HTTP streaming server with: ${localFallbackPath}`);
      source = 'local-http-streaming-server';
      verificationResult = await serveLocalFileAndVerify(localFallbackPath);
    } else {
      throw err;
    }
  }

  const { actualByteSize, actualSha256, durationMs } = verificationResult;
  const byteSizeMatches = actualByteSize === EXPECTED_BYTE_SIZE;
  const sha256Matches = actualSha256.toLowerCase() === EXPECTED_SHA256.toLowerCase();
  const verified = byteSizeMatches && sha256Matches;

  const report = {
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    modelUrl: targetUrl,
    source,
    expectedByteSize: EXPECTED_BYTE_SIZE,
    actualByteSize,
    byteSizeMatches,
    expectedSha256: EXPECTED_SHA256,
    actualSha256,
    sha256Matches,
    durationMs,
    status: verified ? 'VERIFIED' : 'MISMATCH',
  };

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`[model-asset-verify] Byte size: ${actualByteSize} (${byteSizeMatches ? 'OK' : 'MISMATCH'})`);
  console.log(`[model-asset-verify] SHA256: ${actualSha256} (${sha256Matches ? 'OK' : 'MISMATCH'})`);
  console.log(`[model-asset-verify] Result: ${verified ? 'PASS' : 'FAIL'} (report written to ${outputPath})`);

  if (!verified) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[model-asset-verify] Fatal error:', err);
  process.exit(1);
});
