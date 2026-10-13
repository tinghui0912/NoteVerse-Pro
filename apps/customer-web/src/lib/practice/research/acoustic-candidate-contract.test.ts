import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT,
  validateGreenfieldAudioOnlyAcousticRequest,
} from './acoustic-candidate-contract';

const repoRoot = resolve(__dirname, '../../../../../..');

function validRequest() {
  return {
    pcm: new Float32Array([0, 0.1, -0.1]),
    sampleRateHz: 16000,
    channelCount: 1,
    sourceId: 'dev-source',
    captureSessionId: 'capture-1',
    captureStartSample: 0,
    captureStartTimeMs: 0,
    acousticChunkId: 'chunk-1',
    ownershipStartMs: 0,
    ownershipEndMs: 600,
    contextStartMs: -1220,
    contextEndMs: 820,
    modelContextMs: 1820,
    futureContextMs: 220,
    runtimeRequestId: 'req-1',
  };
}

describe('greenfield audio-only acoustic candidate contract', () => {
  it('accepts acoustic/runtime fields only', () => {
    expect(GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT.contractId).toBe('GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT');
    expect(validateGreenfieldAudioOnlyAcousticRequest(validRequest()).acousticChunkId).toBe('chunk-1');
  });

  it('rejects score and truth fields at the executable boundary', () => {
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({
      ...validRequest(),
      expectedStrikes: [{ pitch: 60 }],
    })).toThrow(/SCORE_TRUTH_FIELD_FORBIDDEN/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({
      ...validRequest(),
      nested: { truthMidi: 'hidden' },
    })).toThrow(/SCORE_TRUTH_FIELD_FORBIDDEN/);
  });

  it('rejects unknown fields instead of creating a score-aware side channel', () => {
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({
      ...validRequest(),
      arbitraryScoreHint: 'C4',
    })).toThrow(/UNKNOWN_ACOUSTIC_REQUEST_FIELD/);
  });

  it('distinguishes the greenfield contract from historical score-aware research adapters', () => {
    const historicalAdapter = readFileSync(
      resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'),
      'utf-8',
    );
    const contractSource = readFileSync(
      resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts'),
      'utf-8',
    );
    expect(historicalAdapter).toContain('BenchmarkScenario');
    expect(contractSource).toContain('GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT');
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({
      ...validRequest(),
      expectedGroupIds: ['historical-score-aware-field'],
    })).toThrow(/SCORE_TRUTH_FIELD_FORBIDDEN/);
  });
});
