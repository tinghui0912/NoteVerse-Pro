import { ByteDanceBrowserWorkerClient } from './bytedance-worker-protocol';

export function createByteDanceBrowserWorkerClient(): ByteDanceBrowserWorkerClient {
  return new ByteDanceBrowserWorkerClient(
    new Worker(new URL('./bytedance-worker.entry.ts', import.meta.url), { type: 'module' })
  );
}
