import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { OUT, DIR, load, save, now, scope, git, gitBytes, sha256, scanFiles, BLOCKED, SUCCESS } from './io.mjs';
import { verifyFreeze } from './control.mjs';
import { classifyRequest } from './network.mjs';
import { auditCell, auditCampaign } from './audit.mjs';

export async function runCampaign(input) {
  const sensitive = [input.identity, input.credential].filter(Boolean);
  const raw = { phase: 'V38', startedAt: now(), browserLaunches: 0, network: [], cells: [], pageErrors: 0, unknownNetwork: 0,
    inferenceRuns: 0, unauthenticatedWitness: null, authenticated: null };
  let browser, stage = 'REMOTE_DELIVERY_AUTHORIZATION', disposition = BLOCKED;
  try {
    assert.equal(existsSync(OUT + '/campaign-started.json'), false, 'NO_CAMPAIGN_RETRY');
    assert.equal(typeof input.identity, 'string'); assert.equal(typeof input.credential, 'string');
    const freeze = verifyFreeze(), proof = load(OUT + '/remote-delivery-authorization.json'), contract = freeze.contract;
    assert.equal(proof.authorization, 'V38_PROSPECTIVE_DELIVERY_AUTHORIZED');
    assert.equal(git('rev-parse', 'HEAD'), proof.freezeCommit);
    assert.equal(sha256(gitBytes('show', proof.freezeCommit + ':' + OUT + '/delivery-protocol-freeze.json')), proof.protocolGitContentSha256);
    assert.ok(proof.remoteVerifiedAt < now());
    scanFiles([DIR, OUT], sensitive);
    save('campaign-started.json', { campaignOrdinal: 1, at: now(), freezeCommit: proof.freezeCommit,
      remoteVerifiedAt: proof.remoteVerifiedAt, authMode: 'EXPLICIT_TEST_LOGIN_IN_MEMORY', retries: 0 });
    const require = createRequire(import.meta.url), { chromium } = require(path.resolve(freeze.execution.playwright.root));
    const assets = new Map(freeze.execution.ortAssets.map(record => [record.route, record]));
    assets.set('/__v38/entry.mjs', { subject: OUT + '/bundles/entry.js', sha256: sha256(readFileSync(OUT + '/bundles/entry.js')) });
    let activeCell = 'UNAUTHENTICATED_SECURITY_WITNESS';
    const pending = [];
    const setup = async context => {
      const rows = new WeakMap();
      context.on('request', request => {
        const safe = classifyRequest(request.url(), contract.customerWebOrigin, contract.objectKey, contract.expectedOssHost);
        const row = { ordinal: raw.network.length + 1, cell: activeCell, ...safe, method: request.method(), status: null,
          responseBodyBytes: null };
        rows.set(request, row); raw.network.push(row);
        if (safe.classification === 'UNKNOWN') raw.unknownNetwork++;
      });
      context.on('response', response => { const row = rows.get(response.request()); if (row) row.status = response.status(); });
      context.on('requestfinished', request => {
        const row = rows.get(request); if (row) pending.push(request.sizes().then(size => { row.responseBodyBytes = size.responseBodySize; }, () => { row.sizeUnavailable = true; }));
      });
      context.on('requestfailed', request => { const row = rows.get(request); if (row) row.transportFailed = true; });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const safe = classifyRequest(request.url(), contract.customerWebOrigin, contract.objectKey, contract.expectedOssHost);
        if (safe.classification === 'UNKNOWN') return route.abort();
        if (url.origin === contract.customerWebOrigin && url.pathname.startsWith('/__v38/')) {
          const asset = assets.get(url.pathname);
          if (!asset || request.method() !== 'GET') { raw.unknownNetwork++; return route.abort(); }
          const bytes = readFileSync(asset.subject); assert.equal(sha256(bytes), asset.sha256);
          return route.fulfill({ status: 200, body: bytes, contentType: asset.subject.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
        }
        return route.continue();
      });
    };
    stage = 'BROWSER_LAUNCH'; raw.browserLaunchAt = now(); assert.ok(proof.remoteVerifiedAt < raw.browserLaunchAt);
    browser = await chromium.launch({ executablePath: freeze.execution.chrome.subject, headless: false }); raw.browserLaunches++;
    const browserCdp = await browser.newBrowserCDPSession();
    const cdpVersion = await browserCdp.send('Browser.getVersion'), system = await browserCdp.send('SystemInfo.getInfo');
    raw.browser = { version: await browser.version(), cdpVersion, executableSha256: freeze.execution.chrome.sha256,
      playwrightVersion: freeze.execution.playwright.version, headed: true,
      gpuDevices: system.gpu.devices.map(d => ({ vendorId: d.vendorId, deviceId: d.deviceId, vendorString: d.vendorString, deviceString: d.deviceString })) };
    await browserCdp.detach();
    stage = 'UNAUTHENTICATED_401_WITNESS';
    const anonymous = await browser.newContext(); await setup(anonymous);
    const negative = await anonymous.newPage();
    await negative.goto(contract.customerWebOrigin + '/zh/auth/login', { waitUntil: 'domcontentloaded' });
    const status = await negative.evaluate(async endpoint => (await fetch(endpoint, { credentials: 'include' })).status, contract.endpoint);
    raw.unauthenticatedWitness = { status, isolated: true, pathname: contract.endpoint };
    assert.equal(status, 401); await anonymous.close();
    stage = 'PROSPECTIVE_REAL_CUSTOMER_LOGIN'; activeCell = 'REAL_CUSTOMER_LOGIN';
    const context = await browser.newContext(); await setup(context);
    const page = await context.newPage(); page.on('pageerror', () => { raw.pageErrors++; });
    await page.goto(contract.customerWebOrigin + '/zh/auth/login', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ type: 'module', url: contract.customerWebOrigin + '/__v38/entry.mjs' });
    await page.waitForFunction(() => typeof window.v38?.login === 'function');
    raw.authenticated = await page.evaluate(async value => window.v38.login(value.identity, value.credential),
      { identity: input.identity, credential: input.credential });
    assert.equal(raw.authenticated.authenticated, true);
    input.identity = null; input.credential = null;
    for (const name of contract.cells) {
      stage = name; activeCell = name;
      const result = await page.evaluate(name => window.v38.runCell(name), name); raw.cells.push(result);
      for (const promise of pending.splice(0)) await promise;
      assert.equal(raw.pageErrors, 0); assert.equal(raw.unknownNetwork, 0);
      const audit = auditCell(result, raw.network.filter(row => row.cell === name), contract);
      save(name + '.json', { raw: result, independentAudit: audit });
    }
    for (const promise of pending.splice(0)) await promise;
    stage = 'INDEPENDENT_CAMPAIGN_AUDIT';
    const audit = auditCampaign(raw, contract); save('independent-audit.json', audit);
    disposition = SUCCESS;
  } catch (error) {
    raw.firstFailure = { stage, at: now(), errorClass: error.name,
      safeCode: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'MANDATORY_GATE_FAILED_UNSAFE_DETAILS_OMITTED',
      noRetry: true, productionDefectEstablished: false };
  } finally {
    if (browser) { try { await browser.close(); raw.browserClosed = true; } catch { raw.browserClosed = false; disposition = BLOCKED; } }
    raw.finishedAt = now(); raw.disposition = disposition;
    save('campaign-raw-sanitized.json', raw);
    const contract = load(DIR + '/contract.json');
    save('assessment.json', { disposition, firstFailure: raw.firstFailure ?? null, historicalStatements: contract.historicalStatements,
      qualificationScope: 'MODEL_ASSET_DELIVERY_ONLY', cells: raw.cells.map(c => ({ name: c.name, executionResult: c.result })),
      capabilities: contract.capabilities, disclaimers: contract.disclaimers, productionDiff: [], V3ThroughV37Diff: [],
      forbiddenMicrophoneCapture: 0, inferenceRuns: 0, secretValuesPersisted: 0, noRetry: true });
    scope(); scanFiles([DIR, OUT], sensitive);
  }
  console.log(JSON.stringify({ disposition, cellsExecuted: raw.cells.length, firstFailure: raw.firstFailure ?? null }));
  return disposition;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const result = await runCampaign(input); if (result !== SUCCESS) process.exitCode = 1;
}
