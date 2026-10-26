import { AcousticModelSession } from './model-inference';
import { onlyFields } from './model-contract';
import type { AcousticInferenceInput } from '../runtime/inference-types';

const inference = new AcousticModelSession();
self.onmessage = async (event: MessageEvent<{ id: number; type: string; modelUrl?: string; sessionId?: string; input?: AcousticInferenceInput }>) => {
  const message = event.data;
  try {
    const fields = message.type === 'LOAD' ? ['modelUrl'] : message.type === 'INFER' ? ['sessionId', 'input']
      : ['BEGIN_SESSION', 'END_SESSION'].includes(message.type) ? ['sessionId'] : [];
    onlyFields(message, ['id', 'type', ...fields]);
    if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new Error('INVALID_WORKER_REQUEST');
    let result: unknown;
    if (message.type === 'LOAD' && typeof message.modelUrl === 'string') result = await inference.load(message.modelUrl,
      progress => self.postMessage({ id: message.id, type: 'PROGRESS', progress }));
    else if (message.type === 'BEGIN_SESSION' && typeof message.sessionId === 'string') inference.beginSession(message.sessionId);
    else if (message.type === 'END_SESSION' && typeof message.sessionId === 'string') inference.endSession(message.sessionId);
    else if (message.type === 'INFER' && message.input && typeof message.sessionId === 'string') result = await inference.run(message.sessionId, message.input);
    else if (message.type === 'DISPOSE') result = await inference.dispose();
    else throw new Error('INVALID_WORKER_REQUEST');
    self.postMessage({ id: message.id, result });
  } catch (error) { self.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
};
