import { collectWebGpuAdapter } from './xc1_browser_runtime_shared.mjs';
import { createOnlineAmtPublicationStream } from './xc1_online_amt_publication_bridge.mjs';

export async function executeOnlineAmtK8BrowserExecutor(page, request = {}) {
  const webgpuAdapter = await collectWebGpuAdapter(page);
  const stream = createOnlineAmtPublicationStream({ takeId: request.acousticInput.takeId,
    sampleCount: request.acousticInput.sampleCount, scoreableInterval: request.acousticInput.scoreableInterval,
    retainRawHops: request.retainRawHops });
  await page.exposeFunction('xc1PublishOnlineGroup', group => stream.publishGroup(group));
  const result = await page.evaluate(async ({ acousticInput, runtimeMode, retainRawHops }) => {
    const pcm = await window.loadXc1ExternalPcm();
    if (pcm.sha256 !== acousticInput.pcmSha256) throw new Error('XC1_BROWSER_PCM_IDENTITY_MISMATCH');
    const worker = new Worker('/online-worker.mjs');
    let id = 0;
    const pending = new Map();
    worker.onmessage = event => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.error) entry.reject(new Error(event.data.error)); else entry.resolve(event.data.result);
    };
    worker.onerror = error => { for (const entry of pending.values()) entry.reject(new Error(error.message)); pending.clear(); };
    const rpc = (message, transfer = []) => new Promise((resolve, reject) => {
      id += 1; pending.set(id, { resolve, reject }); worker.postMessage({ ...message, id }, transfer);
    });
    try {
      const init = await rpc({ type: 'init', targetK: 8, fixtureRoot: '/online-fixtures/', manifestFile: 'manifest.json',
        ortScript: '/ort/ort.webgpu.min.js', wasmPaths: '/ort/' });
      const reset = await rpc({ type: 'reset' });
      if (JSON.stringify(reset.stateSnapshot) !== JSON.stringify(init.initialStateSnapshot)) throw new Error('XC1_ONLINE_RESET_PARITY_FAILED');
      const totalHops = Math.floor(pcm.sampleCount / 512);
      const plan = [];
      for (let hop = 0; hop < totalHops;) {
        const k = totalHops - hop >= 8 ? 8 : 1;
        plan.push({ startHopIndex: hop, hopCountInMessage: k, k }); hop += k;
      }
      const feedStartTimestamp = performance.timeOrigin + performance.now();
      const now = () => performance.timeOrigin + performance.now();
      const promises = [];
      let outstanding = 0;
      const post = spec => {
        const groupPcm = pcm.samples.slice(spec.startHopIndex * 512, (spec.startHopIndex + spec.k) * 512);
        outstanding += 1;
        const depth = outstanding;
        const promise = rpc({ type: 'group', ...spec, groupIndex: promises.length,
          pcm: groupPcm.buffer, feedStartTimestamp,
          scheduledGroupReadyTimestamp: feedStartTimestamp + (spec.startHopIndex + spec.k) * 32,
          pagePostTimestamp: now() }, [groupPcm.buffer]).then(async row => {
            const publication = await window.xc1PublishOnlineGroup(row);
            outstanding -= 1;
            const { probabilities: _probabilities, chosenStates: _chosen, ...timing } = row;
            return { ...timing, pageOutstandingDepth: depth,
              rawHopOutputFinishTimestamp: row.publicationFinishTimestamp,
              rawGroupedProcessingDurationMs: row.groupedProcessingDurationMs,
              publicationFinishTimestamp: publication.acousticPublicationFinishTimestamp,
              groupedProcessingDurationMs: publication.acousticPublicationFinishTimestamp - row.workerProcessingStartTimestamp,
              groupPublicationCount: publication.groupPublicationCount, groupObservationCount: publication.groupObservationCount,
              internalHops: row.internalHops.map(hop => ({ ...hop,
                groupPublicationTimestamp: publication.acousticPublicationFinishTimestamp,
                captureToPublicationAgeMs: runtimeMode === 'causal' ? publication.acousticPublicationFinishTimestamp - hop.hopAudioReadyTimestamp : null,
              })),
            };
          });
        promises.push(promise);
        return promise;
      };
      if (runtimeMode === 'causal') {
        await Promise.all(plan.map(spec => new Promise(resolve => {
          setTimeout(() => { post(spec); resolve(); }, (spec.startHopIndex + spec.k) * 32);
        })));
      } else { for (const spec of plan) await post(spec); }
      const rows = await Promise.all(promises);
      const finalState = await rpc({ type: 'snapshot', includeValues: retainRawHops });
      return { backend: 'webgpu', browserReceivedPcm: { sha256: pcm.sha256, byteLength: pcm.byteLength, sampleCount: pcm.sampleCount },
        modelLoadMs: init.sessionLoads.reduce((sum, row) => sum + row.sessionLoadDurationMs, 0),
        sessionLoadCount: init.sessionCount, sessionLoads: init.sessionLoads, warmup: init.warmup,
        actualInferenceSessionRunCount: rows.reduce((sum, row) => sum + row.ortRuns.length, 0),
        totalHopCount: totalHops, residualUnprocessedSamples: pcm.sampleCount % 512,
        groupRows: rows, finalState: finalState.stateSnapshot,
        ...(retainRawHops ? { finalStateValues: finalState.stateValues } : {}),
        initialState: init.initialStateSnapshot, stateResetParity: 'PASS', schedulingMode: runtimeMode ?? 'accelerated',
        processingMs: rows.reduce((sum, row) => sum + row.groupedProcessingDurationMs, 0) };
    } finally { worker.terminate(); }
  }, { acousticInput: request.acousticInput, runtimeMode: request.runtimeMode, retainRawHops: request.retainRawHops });
  return { ...result, ...stream.finish(), webgpuAdapter, publicationProjectionInvoked: true,
    publicationProjectionIdentity: 'runOnlineAmtStreamingCandidateFromHopArtifact' };
}
