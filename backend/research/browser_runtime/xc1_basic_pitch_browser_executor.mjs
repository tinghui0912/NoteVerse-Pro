export const XC1_BASIC_PITCH_EXECUTOR_SCHEMA_VERSION = 1;

export const BASIC_PITCH_DECODER_EXECUTION_IDENTITY = Object.freeze({
  decoderImportPath: 'node_modules/@spotify/basic-pitch/esm/toMidi.js',
  outputToNotesPolyArgs: {
    onsetThreshold: 0.5,
    frameThreshold: 0.3,
    minNoteLenFrames: 5,
    inferOnsets: true,
    maxFreq: null,
    minFreq: null,
    melodiaTrick: true,
    energyTolerance: 11,
  },
  noteFramesToTimeCalled: true,
});

export async function executeBasicPitchBrowserExecutor(page, request = {}) {
  const result = await page.evaluate(({ acousticInput }) => {
    if (typeof window.runXc1BasicPitchExecutor !== 'function') {
      throw new Error('XC1_BASIC_PITCH_BROWSER_EXECUTOR_BUNDLE_MISSING');
    }
    return window.runXc1BasicPitchExecutor({ takeId: acousticInput.takeId, acousticInput });
  }, { acousticInput: request.acousticInput });
  if (result.browserReceivedPcm?.sha256 !== request.acousticInput?.pcmSha256) {
    throw new Error('XC1_BROWSER_PCM_IDENTITY_MISMATCH');
  }
  return {
    ...result,
    decoderExecutionIdentity: BASIC_PITCH_DECODER_EXECUTION_IDENTITY,
  };
}
