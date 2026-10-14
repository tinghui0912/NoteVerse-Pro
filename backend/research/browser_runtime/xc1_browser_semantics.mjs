export { planOwnedWindows, decodeRobustRawOutputs, filterOwnedObservations } from './xc1_robust_decoder.mjs';

export function resampleLinear(input, sourceRate, targetRate) {
  const count = Math.floor(input.length * targetRate / sourceRate);
  const output = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const position = index * sourceRate / targetRate;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

export function distribution(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = fraction => {
    const position = (ordered.length - 1) * fraction;
    const low = Math.floor(position), high = Math.ceil(position);
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low);
  };
  return { count: values.length, p50: percentile(0.5), p95: percentile(0.95), max: ordered.at(-1) };
}

// Producer timers enqueue independently of the serialized asynchronous consumer.
export async function executeSchedule(jobs, execute, { causal = false, warmupCount = 3 } = {}) {
  const warmupRows = [];
  for (let index = 0; index < warmupCount; index += 1) {
    const start = performance.now(); await execute(jobs[0], true);
    warmupRows.push({ index, processingMs: performance.now() - start });
  }
  const origin = performance.timeOrigin + performance.now();
  const now = () => performance.timeOrigin + performance.now();
  const rows = [], results = [];
  let chain = Promise.resolve(), outstanding = 0, failure;
  const arrivalOrigin = causal && jobs.length ? jobs[0].readyMs : 0;
  const postJob = (job, index) => {
    const post = () => {
      const receive = now();
      outstanding += 1;
      const depth = outstanding;
      chain = chain.then(async () => {
        if (failure) return;
        const start = now();
        try {
          const result = await execute(job, false);
          const finish = now();
          rows.push({ index, ...job, scheduledReadyTimestamp: origin + job.readyMs - arrivalOrigin,
            pagePostTimestamp: receive, receiveTimestamp: receive, processingStartTimestamp: start,
            publicationFinishTimestamp: finish, queueDelayMs: start - receive,
            outstandingDepth: depth, processingMs: finish - start,
            captureToPublicationAgeMs: causal ? finish - (origin + job.readyMs - arrivalOrigin) : null,
            ...result.timing });
          results.push(result);
        } catch (error) { failure = error; }
        finally { outstanding -= 1; }
      });
    };
    post();
  };
  if (causal) {
    await Promise.all(jobs.map((job, index) => new Promise(resolve => {
      setTimeout(() => { postJob(job, index); resolve(); }, Math.max(0, job.readyMs - arrivalOrigin));
    })));
  } else {
    for (let index = 0; index < jobs.length; index += 1) { postJob(jobs[index], index); await chain; }
  }
  await chain;
  if (failure) throw failure;
  return { rows, results, warmupCount, warmupRows, origin, completedTimestamp: now() };
}

export function classifyBacklog(rows, cadenceMs) {
  if (rows.length < 8) return { status: 'INSUFFICIENT_RUNTIME_ROWS', noSustainedBacklog: false };
  const tail = rows.slice(-8);
  const trend = (tail.at(-1).queueDelayMs - tail[0].queueDelayMs) / (tail.length - 1);
  const producerDurationMs = rows.at(-1).scheduledReadyTimestamp - rows[0].scheduledReadyTimestamp + cadenceMs;
  const consumerDurationMs = rows.at(-1).publicationFinishTimestamp - rows[0].scheduledReadyTimestamp + cadenceMs;
  const factor = producerDurationMs / consumerDurationMs;
  const maxOutstandingDepth = Math.max(...rows.map(row => row.outstandingDepth));
  const noSustainedBacklog = tail.at(-1).queueDelayMs <= cadenceMs + 8 && trend <= 8
    && maxOutstandingDepth <= 3 && factor >= 0.95;
  return { status: noSustainedBacklog ? 'NO_SUSTAINED_BACKLOG' : 'BACKLOG_PRESENT', noSustainedBacklog,
    schedulerJitterAllowanceMs: 8, cadenceMs, tailQueueTrendMsPerGroup: trend, producerDurationMs,
    consumerDurationMs, realtimeFactor: factor, maxOutstandingDepth, finalQueueDelayMs: rows.at(-1).queueDelayMs,
    queueDelayMs: distribution(rows.map(row => row.queueDelayMs)) };
}
