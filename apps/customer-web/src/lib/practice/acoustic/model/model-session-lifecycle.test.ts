import { afterEach, expect, it, vi } from 'vitest';
import { AcousticModelSession } from './model-inference';
import { AcousticEngine } from './acoustic-engine';
import { ACOUSTIC_MODEL as M } from './model-contract';

const calls = vi.hoisted(() => ({ create: vi.fn(), release: vi.fn(), infer: vi.fn(), load: vi.fn() }));
vi.mock('../../../model-assets/verified-model-asset-loader', () => ({ createVerifiedModelAssetLoader: () => calls.load }));
vi.mock('./model-contract', async importOriginal => {
  const actual = await importOriginal<typeof import('./model-contract')>();
  return { ...actual, sha256: (bytes: Uint8Array) => bytes.length === actual.ACOUSTIC_MODEL.modelBytes
    ? Promise.resolve(actual.ACOUSTIC_MODEL.modelSha256) : actual.sha256(bytes) };
});
vi.mock('onnxruntime-web/webgpu', () => ({
  env: { versions: { web: '1.20.1' } }, InferenceSession: { create: calls.create },
  Tensor: class { constructor(readonly type: string, readonly data: Float32Array, readonly dims: number[]) {} dispose() {} },
}));
afterEach(() => vi.unstubAllGlobals());
it('loads weights and creates ONNX once while every smoke/STEP/Continuous session starts at job zero', async () => {
  vi.stubGlobal('navigator', { gpu: {} });
  calls.load.mockResolvedValue({ bytes: new Uint8Array(M.modelBytes), diagnostics: {} });
  calls.infer.mockImplementation(async () => Object.fromEntries(['reg_onset_output', 'frame_output'].map(name => [name, {
    type: 'float32', data: new Float32Array(183 * 88), dims: [1, 183, 88], dispose() {},
  }])));
  calls.create.mockResolvedValue({ inputNames: ['audio'], outputNames: ['reg_onset_output', 'frame_output'], run: calls.infer, release: calls.release });
  const model = new AcousticModelSession();
  const engine = new AcousticEngine(() => ({ load: url => model.load(url),
    beginSession: async token => model.beginSession(token), run: (token, input) => model.run(token, input),
    endSession: async token => model.endSession(token), dispose: () => model.dispose(), terminate() {}, onFailure: () => () => {},
  }));
  await engine.prepare('/verified-model');
  const input = { pcm: new Float32Array(29120), window: { jobIndex: 0, regionIndex: 0, windowIndex: 0,
    ownedStartTarget: 16800, ownedEndTarget: 26400, startSample: 0, endSample: 29120 } };
  for (const mode of ['STEP', 'CONTINUOUS']) {
    const lease = await engine.acquire(); expect((await lease.run(input)).actualSessionRunCount, mode).toBe(1);
    await expect(model.run('retired-token', input)).rejects.toThrow('SESSION_MISMATCH');
    await lease.dispose();
  }
  expect(calls.load).toHaveBeenCalledOnce(); expect(calls.create).toHaveBeenCalledOnce(); expect(calls.infer).toHaveBeenCalledTimes(3);
  expect(calls.create.mock.calls[0][1]).toEqual({ executionProviders: ['webgpu'], graphOptimizationLevel: 'disabled' });
  expect(calls.release).not.toHaveBeenCalled(); await engine.dispose(); expect(calls.release).toHaveBeenCalledOnce();
});
