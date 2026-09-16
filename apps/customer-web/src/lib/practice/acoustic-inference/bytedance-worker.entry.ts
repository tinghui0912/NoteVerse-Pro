import { loadOnnxRuntimeWeb } from './bytedance-onnx-provider';
import {
  ByteDanceWorkerHost,
  type ByteDanceWorkerRequest,
} from './bytedance-worker-protocol';

const host = new ByteDanceWorkerHost(loadOnnxRuntimeWeb);

self.addEventListener('message', (event: MessageEvent<ByteDanceWorkerRequest>) => {
  void host.handle(event.data).then((response) => self.postMessage(response));
});
