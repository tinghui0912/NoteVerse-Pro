import { loadOnnxRuntimeWeb } from './bytedance-onnx-provider';
import {
  ByteDanceWorkerProtocolRuntime,
  type ByteDanceWorkerRequest,
} from './bytedance-worker-protocol';

const runtimePromise = loadOnnxRuntimeWeb().then((runtime) => new ByteDanceWorkerProtocolRuntime(runtime));

self.addEventListener('message', (event: MessageEvent<ByteDanceWorkerRequest>) => {
  void runtimePromise
    .then((runtime) => runtime.handle(event.data))
    .then((response) => self.postMessage(response));
});
