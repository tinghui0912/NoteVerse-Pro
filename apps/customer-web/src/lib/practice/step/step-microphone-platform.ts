import { getPracticeAcousticModelAccess } from '../../api/practice-acoustic-model-asset';
import { createAcousticModelWorker } from '@/lib/practice/acoustic/model/worker-client';
import { BrowserAcousticCapture } from '@/lib/practice/acoustic/source/capture';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';

export interface StepMicrophoneWorker extends AcousticInferencePort { load(url: string): Promise<unknown>; }
export interface StepMicrophonePlatform {
  modelUrl(signal: AbortSignal): Promise<string>;
  createWorker(): StepMicrophoneWorker;
  coefficients(rate: number): Promise<Uint8Array>;
  workletUrl: string;
  connectCapture(options: Parameters<typeof BrowserAcousticCapture.connect>[0]): Promise<Pick<BrowserAcousticCapture, 'stop'>>;
}

/** Score-blind acoustic infrastructure, composed by the STEP application platform. */
export const browserStepMicrophonePlatform: StepMicrophonePlatform = {
  modelUrl: async signal => (await getPracticeAcousticModelAccess(signal)).downloadUrl,
  createWorker: createAcousticModelWorker,
  workletUrl: new URL('../acoustic/source/capture.worklet.js', import.meta.url).toString(),
  async coefficients(rate) {
    const file = rate === 44100 ? 'fir-160-441.f32' : rate === 48000 ? 'fir-1-3.f32' : null;
    if (!file) throw new Error('SOURCE_SAMPLE_RATE_NOT_QUALIFIED');
    const response = await fetch(`/model-assets/practice-acoustic/${file}`);
    if (!response.ok) throw new Error('FIR_ASSET_UNAVAILABLE');
    return new Uint8Array(await response.arrayBuffer());
  },
  connectCapture: options => BrowserAcousticCapture.connect(options),
};
