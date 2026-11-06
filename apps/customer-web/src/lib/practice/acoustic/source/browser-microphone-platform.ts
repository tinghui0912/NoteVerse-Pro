import { sourceAdapterContract, sourceRate } from './source-adapter-contract';
import { AcousticFailure } from '@/lib/practice/failure/causal-failure';
import { BrowserAcousticCapture } from './capture';

export const browserMicrophoneCapture = {
  workletUrl: new URL('./capture.worklet.js', import.meta.url).toString(),
  async coefficients(rate: number): Promise<Uint8Array> {
    let contract;
    try { contract = sourceAdapterContract(sourceRate(rate)); }
    catch(cause) { throw new AcousticFailure('SOURCE_RATE_UNSUPPORTED', { cause }); }
    try {
      const response = await fetch(contract.coefficientUrl);
      if (!response.ok) throw new AcousticFailure('MODEL_ASSET_UNAVAILABLE');
      return new Uint8Array(await response.arrayBuffer());
    } catch (cause) { throw cause instanceof AcousticFailure ? cause : new AcousticFailure('MODEL_ASSET_UNAVAILABLE', { cause }); }
  },
  connectCapture: (options: Parameters<typeof BrowserAcousticCapture.connect>[0]): Promise<Pick<BrowserAcousticCapture, 'stop'>> => BrowserAcousticCapture.connect(options),
};
