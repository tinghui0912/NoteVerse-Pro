#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { startXc1BrowserAssetServer, launchXc1Browser, materializeSyntheticStageARoot, REPO_ROOT } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, PHASE } from './xc1_artifacts.mjs';
const root = path.join(REPO_ROOT, 'backend/data/work/xc1_r3d_validation/browser_boundary');
const fixture = await materializeSyntheticStageARoot({ root: path.join(root, 'audio_only') });
const { server, url } = await startXc1BrowserAssetServer({ stageARoot: fixture.root });
let browser;
try {
  const request = rawPath => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: new URL(url).port, path: rawPath }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  const routes = {};
  for (const rawPath of ['/../midi/x.mid', '/%2e%2e/midi/x.mid', '/..%5Cmidi%5Cx.mid', '/C:%5Ctruth.mid',
    '/midi/x.mid', '/backend/data/work/smd_v2/SMD-piano_v2.zip', '/truth.json']) {
    routes[rawPath] = await request(rawPath); assert.ok(routes[rawPath] >= 400);
  }
  const launched = await launchXc1Browser({ channel: 'chrome', headed: true }); browser = launched.browser;
  const page = await browser.newPage(); await page.goto(url);
  await page.waitForFunction(() => window.decodeXc1BasicPitchActivations);
  const decoderParity = await page.evaluate(() => {
    const frames = Array.from({ length: 32 }, () => new Array(88).fill(0));
    const onsets = Array.from({ length: 32 }, () => new Array(88).fill(0));
    for (let index = 5; index < 20; index += 1) frames[index][39] = .8;
    onsets[5][39] = .9;
    const actual = window.decodeXc1BasicPitchActivations(frames.map(row => [...row]), onsets.map(row => [...row]));
    const notes = window.xc1BasicPitchOfficialDecoder.outputToNotesPoly(frames, onsets, .5, .3, 5, true, null, null, true, 11);
    const expected = { notes, timedNotes: window.xc1BasicPitchOfficialDecoder.noteFramesToTime(notes) };
    return { equal: JSON.stringify(actual) === JSON.stringify(expected), actual, expected };
  });
  assert.ok(decoderParity.equal); assert.ok(decoderParity.actual.notes.length > 0);
  const overload = await page.evaluate(async () => {
    const semantics = window.xc1Semantics;
    const jobs = Array.from({ length: 20 }, (_, index) => ({ readyMs: (index + 1) * 32 }));
    const result = await semantics.executeSchedule(jobs, async () => {
      await new Promise(resolve => setTimeout(resolve, 65)); return {};
    }, { causal: true, warmupCount: 0 });
    return { evidenceClass: 'SYNTHETIC_QUEUE_INSTRUMENTATION_PROOF_ONLY', rows: result.rows,
      classification: semantics.classifyBacklog(result.rows, 32) };
  });
  assert.equal(overload.classification.noSustainedBacklog, false);
  assert.ok(overload.rows.at(-1).queueDelayMs > overload.rows[0].queueDelayMs);
  await atomicJson(path.join(root, 'receipt.json'), { phase: PHASE, routes, decoderParity, overload, browser: launched.identity });
  console.log('STAGE_A_HTTP_ISOLATION_AND_ESM_DECODER_AND_OVERLOAD_PASS');
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
