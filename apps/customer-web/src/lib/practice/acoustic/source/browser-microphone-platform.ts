import { AcousticFailure } from '@/lib/practice/failure/causal-failure';
import { BrowserAcousticCapture } from './capture';

export const browserMicrophoneCapture = {
  workletUrl: new URL('./capture.worklet.js', import.meta.url).toString(),
  async coefficients(rate: number): Promise<Uint8Array> {
    const file = rate === 44100 ? 'fir-160-441.f32' : rate === 48000 ? 'fir-1-3.f32' : null;
    if (!file) throw new AcousticFailure('SOURCE_RATE_UNSUPPORTED');
    try {
      const response = await fetch(`/model-assets/practice-acoustic/${file}`);
      if (!response.ok) throw new AcousticFailure('MODEL_ASSET_UNAVAILABLE');
      return new Uint8Array(await response.arrayBuffer());
    } catch (cause) { throw cause instanceof AcousticFailure ? cause : new AcousticFailure('MODEL_ASSET_UNAVAILABLE', { cause }); }
  },
  connectCapture: (options: Parameters<typeof BrowserAcousticCapture.connect>[0]): Promise<Pick<BrowserAcousticCapture, 'stop'>> => BrowserAcousticCapture.connect(options),
};
