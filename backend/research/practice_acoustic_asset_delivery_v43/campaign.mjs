import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DIR, OUT, load, save, git, gitBytes, sha256, scope, scanFiles, now, BLOCKED, SUCCESS } from './io.mjs';
import { verifyFrozen } from './freeze.mjs';
import { setSensitiveValues } from './process-result.mjs';
import { classifyRequest } from './network.mjs';
import { auditCell, auditCampaign } from './audit.mjs';
import { evidence, assessmentRecord, safeError } from './evidence.mjs';

const input = JSON.parse(readFileSync(0, 'utf8')), sensitive = Object.values(input.auth ?? {});
setSensitiveValues(sensitive);
const raw = { phase: 'V43', stage: 'FROZEN_QUALIFICATION', startedAt: now(), browserLaunches: 0, network: [], cells: [],
  pageErrors: 0, unknownNetwork: 0, inferenceRuns: 0, unauthenticatedWitness: null, authenticated: null };
let browser, timer, activeLocalGate = 'REMOTE_AUTHORIZATION', activeCell = 'UNAUTHENTICATED_SECURITY_WITNESS', disposition = BLOCKED;
try {
  assert.equal(existsSync(OUT + '/browser-result.json'), false, 'FROZEN_CAMPAIGN_ALREADY_TERMINATED');
  assert.equal(existsSync(OUT + '/assessment.json'), false, 'FROZEN_PHASE_TERMINATED');
  const proof = load(OUT + '/remote-proof.json'), { freeze } = verifyFrozen(), contract = freeze.contract;
  assert.equal(proof.qualificationAuthorizationState, 'V43_FROZEN_DELIVERY_AUTHORIZED'); assert.equal(git('rev-parse', 'HEAD'), proof.freezeCommit);
  assert.equal(sha256(gitBytes('show', proof.freezeCommit + ':' + OUT + '/delivery-protocol-freeze.json')), proof.protocolHash);
  assert.ok(proof.remoteVerifiedAt < now()); assert.ok(input.auth?.identity && input.auth?.credential);
  scanFiles([DIR, OUT], sensitive);
  const pending = [], assets = new Map(freeze.execution.ortAssets.map(record => [record.route, record]));
  assets.set('/__v43/entry.mjs', { subject: OUT + '/entry.mjs', sha256: freeze.bundleSha256 });
  const setup = async context => {
    const rows = new WeakMap();
    context.on('request', request => {
      const safe = classifyRequest(request.url(), contract.customerWebOrigin, contract.objectKey, contract.expectedOssHost);
      const row = { ordinal: raw.network.length + 1, cell: activeCell, ...safe, method: request.method(), status: null, responseBodyBytes: null };
      rows.set(request, row); raw.network.push(row); if (safe.classification === 'UNKNOWN') raw.unknownNetwork++;
    });
    context.on('response', response => { const row = rows.get(response.request()); if (row) row.status = response.status(); });
    context.on('requestfinished', request => { const row = rows.get(request); if (row) pending.push(request.sizes().then(s => { row.responseBodyBytes = s.responseBodySize; }, () => { row.sizeUnavailable = true; })); });
    context.on('requestfailed', request => { const row = rows.get(request); if (row) row.transportFailed = true; });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const safe = classifyRequest(request.url(), contract.customerWebOrigin, contract.objectKey, contract.expectedOssHost);
      if (safe.classification === 'UNKNOWN') return route.abort();
      if (url.origin === contract.customerWebOrigin && url.pathname.startsWith('/__v43/')) {
        const asset = assets.get(url.pathname);
        if (!asset || request.method() !== 'GET') { raw.unknownNetwork++; return route.abort(); }
        const bytes = readFileSync(asset.subject); assert.equal(sha256(bytes), asset.sha256);
        return route.fulfill({ status: 200, body: bytes, contentType: asset.subject.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
      }
      return route.continue();
    });
  };
  timer = setTimeout(() => { raw.campaignDeadlineReached = true; void browser?.close(); }, contract.campaignDeadlineMs);
  activeLocalGate = 'BROWSER_LAUNCH'; raw.browserLaunchAt = now(); assert.ok(proof.remoteVerifiedAt < raw.browserLaunchAt);
  const { chromium } = createRequire(import.meta.url)(path.resolve(freeze.execution.playwright.root));
  browser = await chromium.launch({ executablePath: freeze.execution.chrome.subject, headless: false }); raw.browserLaunches++;
  const cdp = await browser.newBrowserCDPSession(), version = await cdp.send('Browser.getVersion'), system = await cdp.send('SystemInfo.getInfo');
  raw.browser = { version: await browser.version(), cdpVersion: version, headed: true, playwrightVersion: freeze.execution.playwright.version,
    executableSha256: freeze.execution.chrome.sha256, gpuDevices: system.gpu.devices.map(d => ({ vendorId: d.vendorId, deviceId: d.deviceId, vendorString: d.vendorString, deviceString: d.deviceString })) };
  await cdp.detach();
  activeLocalGate = 'UNAUTHENTICATED_401_WITNESS';
  const anonymous = await browser.newContext(); await setup(anonymous); const negative = await anonymous.newPage();
  await negative.goto(contract.customerWebOrigin + '/zh/auth/login', { waitUntil: 'domcontentloaded' });
  const status = await negative.evaluate(async endpoint => (await fetch(endpoint, { credentials: 'include' })).status, contract.endpoint);
  raw.unauthenticatedWitness = evidence('ANONYMOUS_401', { status, isolated: true, pathname: contract.endpoint }); assert.equal(status, 401); await anonymous.close();
  activeCell = 'REAL_CUSTOMER_LOGIN'; activeLocalGate = 'REAL_CUSTOMER_LOGIN';
  const context = await browser.newContext(); await setup(context); const page = await context.newPage(); page.on('pageerror', () => { raw.pageErrors++; });
  await page.goto(contract.customerWebOrigin + '/zh/auth/login', { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ type: 'module', url: contract.customerWebOrigin + '/__v43/entry.mjs' });
  await page.waitForFunction(() => typeof window.v43?.login === 'function');
  raw.authenticated = await page.evaluate(value => window.v43.login(value.identity, value.credential), input.auth);
  assert.equal(raw.authenticated.authenticated, true); input.auth = null;
  for (const name of contract.cells) {
    activeCell = name; activeLocalGate = name; let deadline;
    const result = await Promise.race([page.evaluate(name => window.v43.runCell(name), name), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(Error('FROZEN_CELL_DEADLINE')), contract.cellDeadlineMs);
    })]).finally(() => clearTimeout(deadline));
    raw.cells.push(evidence('DELIVERY_CELL', result));
    for (const promise of pending.splice(0)) await promise;
    assert.equal(raw.pageErrors, 0); assert.equal(raw.unknownNetwork, 0);
    auditCell(result, raw.network.filter(row => row.cell === name), contract);
  }
  activeLocalGate = 'INDEPENDENT_AUDIT';
  for (const promise of pending.splice(0)) await promise;
  assert.equal(raw.campaignDeadlineReached, undefined);
  raw.independentAudit = auditCampaign(raw, contract); disposition = SUCCESS;
} catch (error) {
  raw.firstFailure = { activeLocalGate, orchestratorBoundary: 'NONE', at: now(), ...safeError(error),
    safeCode: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'FROZEN_GATE_FAILURE_UNSAFE_DETAIL_OMITTED', productionDefectEstablished: false };
} finally {
  clearTimeout(timer);
  if (browser) { try { await browser.close(); raw.browserClosed = true; } catch { raw.browserClosed = false; disposition = BLOCKED; } }
  raw.finishedAt = now(); raw.disposition = disposition;
  save('browser-result.json', evidence('BROWSER_CAMPAIGN', raw));
  const contract = load(DIR + '/contract.json');
  save('assessment.json', assessmentRecord({ disposition, firstFailure: raw.firstFailure ?? null,
    independentAudit: raw.independentAudit ?? null, coldWarmNotStartedOrStoppedCells: contract.cells.filter(name => !raw.cells.some(c => c.name === name)),
    history: contract.historicalStatements, capabilities: contract.capabilities, disclaimers: contract.disclaimers,
    counters: { browserLaunches: raw.browserLaunches, modelAccessRequests: raw.network.filter(n => n.classification === 'MODEL_ACCESS_DESCRIPTOR_API').length,
      ossModelGets: raw.network.filter(n => n.classification === 'OSS_MODEL_PAYLOAD_GET').length, inferenceRuns: 0 },
    noFrozenRetry: true }, contract, scope()));
  scanFiles([DIR, OUT], sensitive);
}
console.log(JSON.stringify({ disposition, firstFailure: raw.firstFailure ?? null, cellsReturned: raw.cells.length }));
if (disposition !== SUCCESS) process.exitCode = 1;
