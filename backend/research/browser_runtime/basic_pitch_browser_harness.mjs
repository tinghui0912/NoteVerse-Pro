import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

function parseArgs(argv) {
  const args = {
    warmRuns: 20,
    headed: false,
    browserChannel: undefined,
    mappingProbeFrames: undefined,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--headed') {
      args.headed = true;
    } else if (arg === '--fixture-dir') {
      args.fixtureDir = argv[++i];
    } else if (arg === '--basic-pitch-dir') {
      args.basicPitchDir = argv[++i];
    } else if (arg === '--node-modules-dir') {
      args.nodeModulesDir = argv[++i];
    } else if (arg === '--playwright-node-modules-dir') {
      args.playwrightNodeModulesDir = argv[++i];
    } else if (arg === '--bundle') {
      args.bundle = argv[++i];
    } else if (arg === '--browser-channel') {
      args.browserChannel = argv[++i];
    } else if (arg === '--warm-runs') {
      args.warmRuns = Number(argv[++i]);
    } else if (arg === '--mapping-probe-frames') {
      args.mappingProbeFrames = Number(argv[++i]);
    } else if (arg === '--output') {
      args.output = argv[++i];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  for (const required of ['fixtureDir', 'basicPitchDir', 'nodeModulesDir', 'output']) {
    if (!args[required]) throw new Error(`missing --${required.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  }
  return args;
}

function loadPlaywright(playwrightNodeModulesDir) {
  const candidates = [
    playwrightNodeModulesDir,
    'apps/customer-web/node_modules',
    'node_modules',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!existsSync(path.join(resolved, 'playwright', 'package.json'))) continue;
    const require = createRequire(path.join(resolved, 'package.json'));
    return require('playwright');
  }
  throw new Error('playwright package not found; pass --playwright-node-modules-dir');
}

async function bundleEntry({ nodeModulesDir, bundlePath }) {
  const entry = path.resolve('backend/research/browser_runtime/basic_pitch_browser_entry.js');
  const esbuildPath = path.join(nodeModulesDir, 'esbuild', 'lib', 'main.js');
  if (!existsSync(esbuildPath)) {
    throw new Error(`esbuild not found at ${esbuildPath}`);
  }
  const esbuild = await import(pathToFileURL(esbuildPath).href);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile: bundlePath,
    absWorkingDir: process.cwd(),
    nodePaths: [path.resolve(nodeModulesDir)],
    logLevel: 'silent',
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.bin')) return 'application/octet-stream';
  if (filePath.endsWith('.npy')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function startServer({ fixtureDir, basicPitchDir, bundlePath, warmRuns, mappingProbeFrames }) {
  const modelDir = path.join(basicPitchDir, 'model');
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let filePath;
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html>
<meta charset="utf-8">
<title>Basic Pitch browser feasibility</title>
<script>window.__CONFIG__ = ${JSON.stringify({ warmRuns, mappingProbeFrames })};</script>
<script type="module" src="/bundle.js"></script>`);
        return;
      }
      if (url.pathname === '/bundle.js') {
        filePath = bundlePath;
      } else if (url.pathname.startsWith('/model/')) {
        filePath = path.join(modelDir, decodeURIComponent(url.pathname.slice('/model/'.length)));
      } else if (url.pathname.startsWith('/fixtures/')) {
        filePath = path.join(fixtureDir, decodeURIComponent(url.pathname.slice('/fixtures/'.length)));
      } else {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(error && error.stack ? error.stack : error));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const { chromium } = loadPlaywright(args.playwrightNodeModulesDir);
  const bundlePath = path.resolve(args.bundle ?? 'backend/data/work/basic_pitch_browser_feasibility/basic_pitch_browser_bundle.js');
  await bundleEntry({ nodeModulesDir: path.resolve(args.nodeModulesDir), bundlePath });
  const { server, url } = await startServer({
    fixtureDir: path.resolve(args.fixtureDir),
    basicPitchDir: path.resolve(args.basicPitchDir),
    bundlePath,
    warmRuns: args.warmRuns,
    mappingProbeFrames: args.mappingProbeFrames,
  });

  const browser = await chromium.launch({
    channel: args.browserChannel,
    headless: !args.headed,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__RESULT__ || window.__ERROR__, null, { timeout: 120000 });
    const error = await page.evaluate(() => window.__ERROR__ ?? null);
    if (error) throw new Error(error);
    const result = await page.evaluate(() => window.__RESULT__);
    result.browser = {
      channel: args.browserChannel ?? 'default-chromium',
      version: await browser.version(),
      headed: args.headed,
    };
    result.environment = {
      os: `${process.platform} ${process.arch}`,
      node: process.version,
    };
    result.model_assets = {
      package: '@spotify/basic-pitch',
      model_json_bytes: (await readFile(path.join(args.basicPitchDir, 'model', 'model.json'))).byteLength,
      shard_bytes: (await readFile(path.join(args.basicPitchDir, 'model', 'group1-shard1of1.bin'))).byteLength,
    };
    await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
