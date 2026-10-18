/* Qualification only: bounded metadata, never PCM. No transport decisions. */
export {};
const rows: object[] = [], longTasks: object[] = [], workerRows: object[] = [];
const totals = { messages: 0, samples: 0, acknowledgements: 0, peakUnacked: 0,
  maximumReceiveMs: 0, maximumArrivalGapMs: 0, ackOrderViolations: 0, checksumMismatches: 0,
  maximumBlockFillMs: 0, maximumArrivalAfterBlockEndMs: 0, maximumAckAfterArrivalMs: 0, captureFailures: 0 };
let lastArrival: number | null = null, nextAck = 0;
let firstAuthoritative: object | null = null, latestWorklet: object | null = null, activeArrival = 0;
const retain = (ring: object[], row: object, limit = 256) => { ring.push(row); if (ring.length > limit) ring.shift(); };
declare global { interface Window { qualificationTransportDiagnostics: () => unknown; } }
window.qualificationTransportDiagnostics = () => ({ totals: { ...totals }, rows: [...rows], longTasks: [...longTasks], workerRows: [...workerRows],
  firstAuthoritative, latestWorklet,
  diagnosticLimits: { mainRows: 256, workletRows: 64, longTasks: 32, workerRows: 32 }, pcmRetained: false });
if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  new PerformanceObserver(list => { for (const entry of list.getEntries()) retain(longTasks,
    { startTime: entry.startTime, duration: entry.duration, name: entry.name }, 32); }).observe({ type: 'longtask', buffered: true });
}
const NativeNode = window.AudioWorkletNode;
window.AudioWorkletNode = class extends NativeNode {
  constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
    super(context, name, options);
    if (name !== 'noteverse-practice-pcm') return;
    const port = this.port, descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')!;
    Object.defineProperty(port, 'onmessage', { configurable: true,
      get: () => descriptor.get!.call(port),
      set: (handler: ((event: MessageEvent) => void) | null) => descriptor.set!.call(port, handler && ((event: MessageEvent) => {
        const data = event.data;
        const transport = data.__qualificationTransport;
        delete data.__qualificationTransport;
        const arrival = performance.now();
        activeArrival = arrival; latestWorklet = transport ?? null;
        if (data.type === 'capture-failure') totals.captureFailures++;
        if (data.type === 'pcm-chunk') {
          firstAuthoritative ??= { frame: data.audioContextStartFrame, sourceStart: data.sourceStartSampleIndex, arrival,
            contextTime: context.currentTime, stabilizationRestarts: transport?.stabilizationRestarts ?? 0 };
          if (transport?.checksum !== undefined) {
            let checksum = 2166136261;
            for (const byte of new Uint8Array(data.samples.buffer, data.samples.byteOffset, data.samples.byteLength)) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0;
            if (checksum !== transport.checksum) totals.checksumMismatches++;
          }
          totals.maximumBlockFillMs = Math.max(totals.maximumBlockFillMs, transport?.blockFillMs ?? 0);
          totals.maximumArrivalAfterBlockEndMs = Math.max(totals.maximumArrivalAfterBlockEndMs,
            context.currentTime * 1000 - (data.audioContextStartFrame + data.samples.length) / data.sourceSampleRateHz * 1000);
          totals.messages++; totals.samples += data.samples.length;
          totals.peakUnacked = Math.max(totals.peakUnacked, transport?.unackedDepth ?? 0);
          if (lastArrival !== null) totals.maximumArrivalGapMs = Math.max(totals.maximumArrivalGapMs, arrival - lastArrival);
          lastArrival = arrival;
        }
        const row = { kind: data.type, code: data.code, sequence: data.sequence, arrival, contextTime: context.currentTime,
          contextState: context.state, transport, receiveStart: performance.now(), receiveEnd: 0 };
        try { handler.call(port, event); }
        finally { row.receiveEnd = performance.now(); totals.maximumReceiveMs = Math.max(totals.maximumReceiveMs, row.receiveEnd - row.receiveStart); retain(rows, row); }
      })) });
    const post = port.postMessage.bind(port);
    port.postMessage = ((message: { type?: string; sequence?: number }) => {
      if (message.type === 'ACK') {
        totals.acknowledgements++;
        totals.maximumAckAfterArrivalMs = Math.max(totals.maximumAckAfterArrivalMs, performance.now() - activeArrival);
        if (message.sequence !== nextAck++) totals.ackOrderViolations++;
        retain(rows, { kind: 'ACK', sequence: message.sequence, wallTime: performance.now(), contextTime: context.currentTime });
      }
      post(message);
    }) as typeof port.postMessage;
  }
};
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    this.addEventListener('message', event => retain(workerRows, { kind: 'WORKER_RESPONSE', id: event.data?.id,
      wallTime: performance.now(), error: event.data?.error, timings: event.data?.result?.timings }, 32));
  }
  postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
    const metadata = message as { type?: string; id?: number };
    retain(workerRows, { kind: 'WORKER_SEND', type: metadata.type, id: metadata.id, wallTime: performance.now() }, 32);
    if (Array.isArray(options)) super.postMessage(message, options);
    else super.postMessage(message, options);
  }
};
