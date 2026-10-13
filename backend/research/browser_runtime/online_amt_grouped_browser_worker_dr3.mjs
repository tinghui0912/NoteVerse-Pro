// Research-only DR3 Online-AMT grouped browser Worker.
// Owns recurrent state and serializes all jobs through an explicit queue.

/* global self, performance, setTimeout */

let chain = Promise.resolve();
let outstanding = 0;
let artificialDelayMs = 0;

function nowAbs() {
  return performance.timeOrigin + performance.now();
}

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function processGroup(message) {
  const workerReceiveTimestamp = message.workerReceiveTimestamp ?? nowAbs();
  const queueEnterTimestamp = nowAbs();
  const k = Number(message.k);
  const groupIndex = Number(message.groupIndex);
  const processingStartTimestamp = nowAbs();
  const ortInferenceStartTimestamp = nowAbs();
  await delay(artificialDelayMs);
  const ortInferenceFinishTimestamp = nowAbs();
  const publicationFinishTimestamp = nowAbs();
  const hopRows = [];
  for (let offset = 0; offset < k; offset += 1) {
    const hopIndex = groupIndex * k + offset;
    const hopAudioReadyTimestamp = Number(message.feedStartTimestamp) + (hopIndex + 1) * 32;
    hopRows.push({
      hopIndex,
      hopAudioReadyTimestamp,
      groupPublicationTimestamp: publicationFinishTimestamp,
      captureToPublicationAgeMs: publicationFinishTimestamp - hopAudioReadyTimestamp,
    });
  }
  return {
    type: 'group-result',
    groupIndex,
    k,
    scheduledGroupReadyTimestamp: message.scheduledGroupReadyTimestamp,
    pagePostTimestamp: message.pagePostTimestamp,
    workerReceiveTimestamp,
    workerQueueEnterTimestamp: queueEnterTimestamp,
    workerProcessingStartTimestamp: processingStartTimestamp,
    ortInferenceStartTimestamp,
    ortInferenceFinishTimestamp,
    publicationFinishTimestamp,
    outstandingPostedNotCompletedDepth: outstanding,
    groupedProcessingDurationMs: publicationFinishTimestamp - processingStartTimestamp,
    queueDelayMs: processingStartTimestamp - queueEnterTimestamp,
    internalHops: hopRows,
  };
}

self.onmessage = (event) => {
  const receivedAt = nowAbs();
  const message = event.data;
  if (message.type === 'init') {
    artificialDelayMs = Number(message.artificialDelayMs ?? 0);
    self.postMessage({ id: message.id, result: { status: 'PASS', explicitQueue: true, artificialDelayMs } });
    return;
  }
  if (message.type !== 'group') {
    self.postMessage({ id: message.id, error: `unknown DR3 worker message: ${message.type}` });
    return;
  }
  outstanding += 1;
  chain = chain
    .then(() => processGroup({ ...message, workerReceiveTimestamp: receivedAt }))
    .then((result) => {
      outstanding -= 1;
      self.postMessage({ id: message.id, result });
    })
    .catch((error) => {
      outstanding -= 1;
      self.postMessage({ id: message.id, error: String(error && error.stack ? error.stack : error) });
    });
};
