import type { Page } from '@playwright/test';
import { CAPTURE_TRANSPORT_BLOCK_SAMPLES } from '../../../src/lib/practice/acoustic/source/capture-transport-contract';

type CaptureWitness = { opened: number; closed: number; acknowledgedBlocks: number; maxInFlight: number };

/** Silence protocol double for lifecycle tests; native capture has separate browser coverage.
 * PCM follows the real context frame axis, but its producer advances only after ACK.
 * Main-thread scheduling therefore cannot manufacture a transport overrun.
 */
export async function installAcousticCaptureFixture(page: Page) {
  await page.addInitScript(({ blockSamples }) => {
    const witness: CaptureWitness = { opened: 0, closed: 0, acknowledgedBlocks: 0, maxInFlight: 0 };
    (window as unknown as { __practiceCaptureFixture: CaptureWitness }).__practiceCaptureFixture = witness;
    class CaptureNode extends GainNode {
      readonly port: MessagePort;
      onprocessorerror: ((event: Event) => void) | null = null;
      constructor(context: AudioContext, name: string) {
        super(context);
        if (name !== 'noteverse-practice-pcm') throw new Error('Unexpected capture processor.');
        witness.opened++;
        const channel = new MessageChannel();
        this.port = channel.port1;
        const originFrame = Math.floor(context.currentTime * context.sampleRate);
        let nextSource = 0, sequence = 0, acknowledged = 0, inFlight: number | null = null;
        let frame: number | null = null, closed = false;
        const stop = () => {
          if (closed) return;
          closed = true; witness.closed++;
          if (frame !== null) cancelAnimationFrame(frame);
          context.removeEventListener('statechange', stateChanged);
          channel.port2.onmessage = null; channel.port2.close();
        };
        const closePort = this.port.close.bind(this.port);
        this.port.close = () => { stop(); closePort(); };
        const stateChanged = () => { if (context.state === 'closed') this.port.close(); };
        context.addEventListener('statechange', stateChanged);
        const pump = () => {
          if (frame !== null) cancelAnimationFrame(frame);
          frame = null;
          if (closed || inFlight !== null) return;
          // Never emit future frames or skip elapsed source positions when a callback is late.
          if (context.state !== 'running' || originFrame + nextSource + blockSamples > Math.floor(context.currentTime * context.sampleRate)) {
            frame = requestAnimationFrame(pump); return;
          }
          const samples = new Float32Array(blockSamples), start = nextSource;
          inFlight = sequence++; nextSource += blockSamples;
          witness.maxInFlight = Math.max(witness.maxInFlight, sequence - acknowledged);
          channel.port2.postMessage({ type: 'pcm-chunk', sequence: inFlight, sourceSampleRateHz: context.sampleRate,
            sourceStartSampleIndex: start, sourceEndSampleIndex: nextSource,
            audioContextStartFrame: originFrame + start, inputChannelCount: 1,
            captureTimeSeconds: (originFrame + start) / context.sampleRate, samples }, [samples.buffer]);
        };
        channel.port2.onmessage = event => {
          if (event.data?.type === 'STOP') { this.port.close(); return; }
          if (event.data?.type !== 'ACK' || event.data.sequence !== inFlight) throw new Error('Unexpected capture acknowledgement.');
          inFlight = null; acknowledged++; witness.acknowledgedBlocks++; pump();
        };
        frame = requestAnimationFrame(pump);
      }
    }
    window.AudioWorkletNode = CaptureNode as unknown as typeof AudioWorkletNode;
  }, { blockSamples: CAPTURE_TRANSPORT_BLOCK_SAMPLES });
}

export function acousticCaptureWitness(page: Page) {
  return page.evaluate(() => (window as unknown as { __practiceCaptureFixture: CaptureWitness }).__practiceCaptureFixture);
}
