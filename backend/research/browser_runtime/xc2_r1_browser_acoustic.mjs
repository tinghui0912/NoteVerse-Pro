import { decodeXc2 } from './xc2_decoders.mjs';
import { StreamingRationalResampler } from './xc2_r1_streaming_resampler.mjs';

// The acoustic constructor has no score/finalizer argument or score dependency.
export async function createAcousticExecutor({ pcm, guardedSource, coefficients, clipId, resampler }) {
  const allowed = new Set(['pcm', 'guardedSource', 'coefficients', 'clipId', 'resampler']);
  if (Object.keys(arguments[0]).some(k => !allowed.has(k))) throw new Error('R1_ACOUSTIC_FIELD_VIOLATION');
  const now = () => performance.timeOrigin + performance.now();
  const load = now(), session = await ort.InferenceSession.create('/robust.onnx', { executionProviders: ['webgpu'], graphOptimizationLevel: 'disabled' });
  const loadMs = now() - load;
  let filter, sourceCursor, target, targetCursor, runCount = 0;
  const reset = () => { filter = resampler === 'BAND_LIMITED' ? new StreamingRationalResampler(coefficients) : null;
    sourceCursor = 0; targetCursor = 0; target = filter ? new Float32Array(480000) : pcm; };
  reset();
  const prepare = endSample => {
    if (!filter) return;
    const finalOutputIndex = endSample + 16000 - 1;
    const inputEnd = Math.floor((finalOutputIndex * 441 + 4410) / 160) + 1;
    if (inputEnd > guardedSource.length) throw new Error('R1_REAL_RESAMPLER_CONTEXT_UNAVAILABLE');
    const chunk = filter.push(guardedSource.subarray(sourceCursor, inputEnd));
    target.set(chunk, targetCursor); targetCursor += chunk.length; sourceCursor = inputEnd;
    if (targetCursor < endSample + 16000) throw new Error('R1_RESAMPLER_NOT_READY');
  };
  async function run(spec) {
    const preprocessingStart = now(); prepare(spec.endSample); const resamplerFinish = now();
    const offset = filter ? 16000 : 0, input = target.slice(spec.startSample + offset, spec.endSample + offset), preprocessingFinish = now();
    if (input.length !== 29120) throw new Error('R1_MODEL_INPUT_GEOMETRY');
    const inferenceStart = now(); runCount += 1;
    const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 29120]) });
    const inferenceFinish = now(), decoderStart = now();
    const observations = decodeXc2({ regData: outputs.reg_onset_output.data, frameData: outputs.frame_output.data,
      dims: outputs.reg_onset_output.dims, inputWindowStartMs: spec.inputWindowStartMs, takeId: clipId, windowId: spec.windowId, spec }, 'A')
      .map((e, i) => ({ ...e, observationId: [clipId, spec.windowId, e.pitch, Math.round(e.performanceTimeMs * 16), i].join(':') }));
    const decoderFinish = now();
    for (const tensor of Object.values(outputs)) tensor.dispose?.();
    return { observations, preprocessMs: preprocessingFinish - preprocessingStart, resamplerMs: filter ? resamplerFinish - preprocessingStart : 0,
      inputCopyMs: preprocessingFinish - resamplerFinish,
      ortSessionRunStartTimestamp: inferenceStart, ortSessionRunFinishTimestamp: inferenceFinish,
      ortSessionRunDurationMs: inferenceFinish - inferenceStart, decoderMs: decoderFinish - decoderStart };
  }
  return { run, reset, identity: () => ({ sessionLoadCount: 1, actualSessionRunCount: runCount, loadMs,
    executionProviders: ['webgpu'], ortVersion: '1.20.1', rawTensorExportEnabled: false, decoder: 'A' }) };
}
