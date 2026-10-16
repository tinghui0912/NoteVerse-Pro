import { Xc4WorkerAdapter, type Xc4WorkerInput } from './xc4-robust-worker-adapter';
import { onlyFields } from './xc4-robust-runtime-contract';

const adapter = new Xc4WorkerAdapter();
self.addEventListener('message', (event: MessageEvent<{ id: number; type: string; modelUrl?: string; input?: Xc4WorkerInput }>) => {
  const m = event.data;
  void (async () => {
    if (!Number.isSafeInteger(m.id) || m.id <= 0) throw new Error('XC4_WORKER_MESSAGE');
    if (m.type === 'LOAD' && typeof m.modelUrl === 'string') {
      onlyFields(m, ['id', 'type', 'modelUrl']); return adapter.load(m.modelUrl);
    }
    if (m.type === 'RUN' && m.input) {
      onlyFields(m, ['id', 'type', 'input']); return adapter.run(m.input);
    }
    if (m.type === 'DISPOSE') {
      onlyFields(m, ['id', 'type']); return adapter.dispose();
    }
    throw new Error('XC4_WORKER_MESSAGE');
  })().then(result => self.postMessage({ id: m.id, result }),
    error => self.postMessage({ id: m.id, error: String(error instanceof Error ? error.message : error) }));
});
