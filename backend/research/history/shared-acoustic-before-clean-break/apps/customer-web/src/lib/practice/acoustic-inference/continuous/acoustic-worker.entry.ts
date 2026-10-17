import { ContinuousModelInference } from './model-inference';
import { onlyFields } from './model-contract';
import type { AcousticInferenceInput } from './inference-types';

const inference = new ContinuousModelInference();
self.onmessage = async (event: MessageEvent<{ id: number; type: string; modelUrl?: string; input?: AcousticInferenceInput }>) => {
  const message = event.data;
  try {
    onlyFields(message, ['id', 'type', ...(message.type === 'LOAD' ? ['modelUrl'] : message.type === 'INFER' ? ['input'] : [])]);
    if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new Error('INVALID_WORKER_REQUEST');
    let result: unknown;
    if (message.type === 'LOAD' && typeof message.modelUrl === 'string') result = await inference.load(message.modelUrl);
    else if (message.type === 'INFER' && message.input) result = await inference.run(message.input);
    else if (message.type === 'DISPOSE') result = await inference.dispose();
    else throw new Error('INVALID_WORKER_REQUEST');
    self.postMessage({ id: message.id, result });
  } catch (error) { self.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
};
