import { describe, expect, it } from 'vitest';

import {
  decodeBasicPitchAllPitchContinuousObservations,
  executeBasicPitchBrowserV1Candidate,
  executeOnlineAmtK8BrowserV1Candidate,
  executeRobustBrowserV1Candidate,
  XC1_BASIC_PITCH_BROWSER_V1_IDENTITY,
  XC1_DEPLOYMENT_IDENTITIES,
  XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY,
  XC1_ROBUST_BROWSER_V1_IDENTITY,
} from './xc1-acoustic-candidates';

function validRequest() {
  return {
    pcm: new Float32Array([0, 0.1, -0.1, 0.2]),
    sampleRateHz: 16000,
    channelCount: 1,
    sourceId: 'smd-audio-only-take',
    captureSessionId: 'xc1-capture',
    captureStartSample: 0,
    captureStartTimeMs: 0,
    acousticChunkId: 'chunk-001',
    ownershipStartMs: 1000,
    ownershipEndMs: 1600,
    contextStartMs: 0,
    contextEndMs: 1820,
    modelContextMs: 1820,
    futureContextMs: 220,
    runtimeRequestId: 'req-xc1',
  };
}

describe('XC1 acoustic candidate wrappers', () => {
  it('freezes the three deployment identities before external inference', () => {
    expect(XC1_DEPLOYMENT_IDENTITIES.map((identity) => identity.deploymentId)).toEqual([
      'robust-browser-v1',
      'online-amt-k8-browser-v1',
      'basic-pitch-browser-v1',
    ]);
    expect(XC1_ROBUST_BROWSER_V1_IDENTITY.deploymentIdentitySha256).toBe(
      '196a9a2ceb03569f6e266c4f5973125bb8596146882079105ee94ef7e621deed',
    );
    expect(XC1_ONLINE_AMT_K8_BROWSER_V1_IDENTITY.k8OnnxSha256).toBe(
      '818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18',
    );
    expect(XC1_BASIC_PITCH_BROWSER_V1_IDENTITY.packageVersion).toBe('1.0.1');
  });

  it.each([
    ['robust-browser-v1', executeRobustBrowserV1Candidate],
    ['online-amt-k8-browser-v1', executeOnlineAmtK8BrowserV1Candidate],
    ['basic-pitch-browser-v1', executeBasicPitchBrowserV1Candidate],
  ])('validates %s through the greenfield audio-only boundary before executor invocation', async (deploymentId, execute) => {
    const seen: string[][] = [];
    const result = await execute(validRequest(), (request) => {
      seen.push(Object.keys(request).sort());
      expect(request.deploymentId).toBe(deploymentId);
      return { ok: true, sampleRateHz: request.sampleRateHz };
    });

    expect(result).toEqual({ ok: true, sampleRateHz: 16000 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain('expectedPitches');
    expect(seen[0]).not.toContain('truthMidi');
    expect(seen[0]).not.toContain('BenchmarkScenario');
  });

  it.each([
    executeRobustBrowserV1Candidate,
    executeOnlineAmtK8BrowserV1Candidate,
    executeBasicPitchBrowserV1Candidate,
  ])('rejects score and truth metadata before the candidate executor can see it', (execute) => {
    let invoked = false;
    expect(() => execute({
      ...validRequest(),
      expectedStrikes: [{ pitch: 60, timeMs: 1000 }],
    }, () => {
      invoked = true;
      return null;
    })).toThrow(/SCORE_TRUTH_FIELD_FORBIDDEN/);
    expect(invoked).toBe(false);
  });

  it('decodes Basic Pitch as all-pitch acoustic observations without expected-pitch filtering', () => {
    const observations = decodeBasicPitchAllPitchContinuousObservations([
      {
        timeMs: 1200,
        onsetByMidiPitch: { 60: 0.8, 61: 0.9, 90: 0.49 },
        frameByMidiPitch: { 60: 0.5, 61: 0.4, 90: 0.9 },
      },
      {
        timeMs: 1700,
        onsetByMidiPitch: { 64: 0.95 },
        frameByMidiPitch: { 64: 0.95 },
      },
    ], {
      ownershipStartMs: 1000,
      ownershipEndMs: 1600,
    });

    expect(observations.map((observation) => observation.pitch)).toEqual([60, 61]);
    expect(observations.every((observation) => observation.candidateObservationId.startsWith('basic-pitch:'))).toBe(true);
  });
});
