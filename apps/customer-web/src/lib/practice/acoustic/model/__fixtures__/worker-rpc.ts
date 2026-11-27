import { vi } from 'vitest';
import { AcousticModelWorker } from '../worker-client';
import type { AcousticInferenceInput } from '../../runtime/inference-types';

type Request = { id: number; type: string; sessionId?: string; input?: AcousticInferenceInput };

/** Real client protocol/timers, deterministic service replies; no browser/GPU qualification. */
export function workerRpcRig() {
  class Service extends EventTarget {
    readonly messages: Request[] = [];
    readonly silent = new Set<string>();
    readonly terminate = vi.fn();
    postMessage(message: Request) {
      this.messages.push(message);
      if (!this.silent.has(message.type)) this.answer(message.id, message.type === 'INFER'
        ? { events: [], inferenceMs: 0, decodeMs: 0, actualSessionRunCount: message.input!.window.jobIndex + 1 } : {});
    }
    answer(id: number, result: unknown = {}) { this.dispatchEvent(new MessageEvent('message', { data: { id, result } })); }

  }
  const service = new Service(), client = new AcousticModelWorker(service as unknown as Worker);
  return { service, client };
}
