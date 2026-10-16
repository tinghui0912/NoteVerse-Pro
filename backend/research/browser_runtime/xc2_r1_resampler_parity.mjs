import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchXc1Browser } from './xc1_browser_runtime_shared.mjs';
import { atomicJson, fileSha, digest } from './xc1_artifacts.mjs';
import { ROOT, PHASE, load } from './xc2_r1_diagnose.mjs';
export async function resamplerParity() {
  const freeze = await load('backend/research/reports/phase9g_xc2_r1_policy_freeze_2026-10-16.json');
  for (const s of freeze.sources) if (await fileSha(s.path) !== s.sha256) throw new Error('R1_SOURCE_DRIFT');
  const prep = await load(`${ROOT}/preparation.json`), routes = new Map([['/fir', prep.coefficients.path], ['/resampler.mjs', 'backend/research/browser_runtime/xc2_r1_streaming_resampler.mjs']]);
  prep.fixtures.forEach((f, i) => routes.set(`/input/${i}`, f.source.path));
  prep.runtimeClips.forEach((f, i) => routes.set(`/clip/${i}`, f.guardedSource.path));
  for (const asset of [prep.coefficients, ...prep.fixtures.flatMap(f => [f.source, f.reference]), ...prep.runtimeClips.map(f => f.guardedSource)]) if (await fileSha(asset.path) !== asset.sha256) throw new Error('R1_PARITY_ASSET_DRIFT');
  const server = createServer((request, response) => { if (request.url === '/') { response.end('<!doctype html><title>Streaming FIR parity</title>'); return; }
    const p = routes.get(request.url); if (!p) { response.statusCode = 403; response.end(); return; }
    response.setHeader('Content-Type', p.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream'); createReadStream(p).pipe(response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    const launched = await launchXc1Browser({ channel: 'chrome', headed: true }); browser = launched.browser;
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
    const actual = await page.evaluate(async ({ fixtureCount, clipCount }) => {
      const { StreamingRationalResampler } = await import('/resampler.mjs');
      const h = new Float32Array(await (await fetch('/fir')).arrayBuffer());
      const run = (input, chunked) => { const start = performance.now(), r = new StreamingRationalResampler(h), outputs = [];
        const sizes = chunked ? [1, 7, 127, 441, 29, 2048, 17] : [input.length];
        for (let pos = 0, i = 0; pos < input.length; i++) { const end = Math.min(input.length, pos + sizes[i % sizes.length]); outputs.push(r.push(input.subarray(pos, end))); pos = end; }
        outputs.push(r.finish()); const out = new Float32Array(outputs.reduce((n, c) => n + c.length, 0)); let at = 0;
        for (const chunk of outputs) { out.set(chunk, at); at += chunk.length; } return { output: Array.from(out), cpuMs: performance.now() - start }; };
      const fixtures = [];
      for (let i = 0; i < fixtureCount; i++) { const x = new Float32Array(await (await fetch(`/input/${i}`)).arrayBuffer()); fixtures.push({ single: run(x, false), chunked: run(x, true) }); }
      const clips = [];
      for (let i = 0; i < clipCount; i++) { const x = new Float32Array(await (await fetch(`/clip/${i}`)).arrayBuffer()); const r = run(x, true); clips.push({ ...r, output: r.output.slice(16000, 464000) }); }
      return { fixtures, clips };
    }, { fixtureCount: prep.fixtures.length, clipCount: prep.runtimeClips.length });
    const readF32 = async p => { const b = await readFile(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
    const compare = (a, b) => { let max = 0, square = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); max = Math.max(max, d); square += d * d; }
      return { countIdentity: a.length === b.length, outputSamples: a.length, referenceSamples: b.length, maxAbs: max, rms: Math.sqrt(square / a.length), firstSample: a[0], lastSample: a.at(-1) }; };
    const fixtures = [];
    for (let i = 0; i < prep.fixtures.length; i++) { const reference = await readF32(prep.fixtures[i].reference.path), a = actual.fixtures[i];
      fixtures.push({ id: prep.fixtures[i].id, vsScipy: compare(a.single.output, reference), continuousChunkVsSingle: compare(a.chunked.output, a.single.output), cpuMs: { single: a.single.cpuMs, chunked: a.chunked.cpuMs } }); }
    const clips = [];
    for (let i = 0; i < prep.runtimeClips.length; i++) clips.push({ clipId: prep.runtimeClips[i].clip.clipId,
      vsExistingXc2BandPcm: compare(actual.clips[i].output, await readF32(prep.runtimeClips[i].clip.pcm.BAND_LIMITED.path)), cpuMs: actual.clips[i].cpuMs });
    const tolerance = freeze.resamplerTolerance;
    const okay = c => c.countIdentity && c.maxAbs <= tolerance.maxAbs && c.rms <= tolerance.rms;
    const pass = fixtures.every(f => okay(f.vsScipy) && f.continuousChunkVsSingle.maxAbs === 0 && f.continuousChunkVsSingle.countIdentity) && clips.every(c => okay(c.vsExistingXc2BandPcm));
    const result = { phase: PHASE, freezeDigest: digest(freeze), browser: launched.identity, tolerance, fixtures, clips, pass,
      classification: pass ? 'BAND_LIMITED_BROWSER_REFERENCE_PARITY_PASS_RUNTIME_PENDING' : 'BAND_LIMITED_BROWSER_RUNTIME_NOT_YET_QUALIFIED',
      timingCoordinateIdentity: 'output sample m represents source m*441/160; zero-phase compensation requires up to 28 real source samples of lookahead, 0.6349206349ms; no shift fitted to audio or predictions.',
      limits: 'Pinned FIR/rational-rate PCM path only; no AudioWorklet/device capture or UI qualification.' };
    await atomicJson(`${ROOT}/browser_resampler_parity.json`, result); console.log(JSON.stringify({ pass, worst: Math.max(...fixtures.map(f => f.vsScipy.maxAbs), ...clips.map(c => c.vsExistingXc2BandPcm.maxAbs)) }));
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await resamplerParity();
