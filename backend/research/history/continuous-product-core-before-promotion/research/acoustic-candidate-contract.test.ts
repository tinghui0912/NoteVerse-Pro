import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  executeGreenfieldAcousticCandidate,
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

  it('rejects malformed PCM and invalid timing invariants', () => {
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), pcm: [0, 1] })).toThrow(/PCM_INVALID/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), pcm: new Float32Array([Number.NaN]) })).toThrow(/PCM_NONFINITE/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), sampleRateHz: 0 })).toThrow(/SAMPLE_RATE/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), channelCount: 1.5 })).toThrow(/CHANNEL_COUNT/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), captureStartSample: -1 })).toThrow(/CAPTURE_START_SAMPLE/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), ownershipStartMs: 700 })).toThrow(/OWNERSHIP_RANGE/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), contextStartMs: 1 })).toThrow(/CONTEXT_START/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), contextEndMs: 599 })).toThrow(/CONTEXT_END/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), modelContextMs: -1 })).toThrow(/CONTEXT_GEOMETRY/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), candidateId: '' })).toThrow(/OPTIONAL_STRING/);
    expect(() => validateGreenfieldAudioOnlyAcousticRequest({ ...validRequest(), deploymentId: 42 })).toThrow(/OPTIONAL_STRING/);
  });

  it('validates before invoking the greenfield executor and passes only acoustic keys', async () => {
    const seen: string[][] = [];
    const output = await executeGreenfieldAcousticCandidate(validRequest(), (request) => {
      seen.push(Object.keys(request).sort());
      return { observationCount: request.pcm.length };
    });
    expect(output).toEqual({ observationCount: 3 });
    expect(seen[0]).toEqual([
      'acousticChunkId',
      'captureSessionId',
      'captureStartSample',
      'captureStartTimeMs',
      'channelCount',
      'contextEndMs',
      'contextStartMs',
      'futureContextMs',
      'modelContextMs',
      'ownershipEndMs',
      'ownershipStartMs',
      'pcm',
      'runtimeRequestId',
      'sampleRateHz',
      'sourceId',
    ]);
    expect(() => executeGreenfieldAcousticCandidate({ ...validRequest(), truthMidi: 'nope' }, () => {
      throw new Error('executor must not run');
    })).toThrow(/SCORE_TRUTH_FIELD_FORBIDDEN/);
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
