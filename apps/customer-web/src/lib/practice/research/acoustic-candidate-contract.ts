export const GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT = {
  schemaVersion: 1,
  contractId: 'GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT',
  forbiddenBoundary: 'SCORE_AWARE_9G_RESEARCH_ADAPTER',
} as const;

const allowedTopLevelFields = new Set([
  'pcm',
  'sampleRateHz',
  'channelCount',
  'sourceId',
  'captureSessionId',
  'captureStartSample',
  'captureStartTimeMs',
  'acousticChunkId',
  'ownershipStartMs',
  'ownershipEndMs',
  'contextStartMs',
  'contextEndMs',
  'modelContextMs',
  'futureContextMs',
  'runtimeRequestId',
  'candidateId',
  'deploymentId',
]);

const forbiddenScoreTruthFields = new Set([
  'BenchmarkScenario',
  'benchmarkScenario',
  'expectedPitch',
  'expectedPitches',
  'expectedStrikes',
  'expectedGroups',
  'expectedGroupIds',
  'scoreNote',
  'scoreNotes',
  'scoreDerivedGroupIds',
  'truthMidi',
  'truthMIDI',
  'correctnessLabel',
  'mutationCategory',
  'scenarioCategory',
  'targetTimestamp',
]);

export type GreenfieldAcousticInferenceRequest = {
  pcm: Float32Array | readonly number[];
  sampleRateHz: number;
  channelCount: number;
  sourceId: string;
  captureSessionId: string;
  captureStartSample: number;
  captureStartTimeMs: number;
  acousticChunkId: string;
  ownershipStartMs: number;
  ownershipEndMs: number;
  contextStartMs: number;
  contextEndMs: number;
  modelContextMs: number;
  futureContextMs: number;
  runtimeRequestId: string;
  candidateId?: string;
  deploymentId?: string;
};

export function validateGreenfieldAudioOnlyAcousticRequest(input: unknown): GreenfieldAcousticInferenceRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('ACOUSTIC_REQUEST_MUST_BE_OBJECT');
  }
  const record = input as Record<string, unknown>;
  const forbidden = collectForbiddenScoreTruthFields(record);
  if (forbidden.length > 0) {
    throw new Error(`SCORE_TRUTH_FIELD_FORBIDDEN_IN_GREENFIELD_ACOUSTIC_CONTRACT:${forbidden.join(',')}`);
  }
  const unknown = Object.keys(record).filter((key) => !allowedTopLevelFields.has(key));
  if (unknown.length > 0) {
    throw new Error(`UNKNOWN_ACOUSTIC_REQUEST_FIELD:${unknown.sort().join(',')}`);
  }
  for (const key of [
    'sampleRateHz',
    'channelCount',
    'captureStartSample',
    'captureStartTimeMs',
    'ownershipStartMs',
    'ownershipEndMs',
    'contextStartMs',
    'contextEndMs',
    'modelContextMs',
    'futureContextMs',
  ]) {
    if (!Number.isFinite(record[key])) {
      throw new Error(`ACOUSTIC_REQUEST_NUMERIC_FIELD_INVALID:${key}`);
    }
  }
  for (const key of ['sourceId', 'captureSessionId', 'acousticChunkId', 'runtimeRequestId']) {
    if (typeof record[key] !== 'string' || record[key].length === 0) {
      throw new Error(`ACOUSTIC_REQUEST_STRING_FIELD_INVALID:${key}`);
    }
  }
  if (!(record.pcm instanceof Float32Array) && !Array.isArray(record.pcm)) {
    throw new Error('ACOUSTIC_REQUEST_PCM_INVALID');
  }
  return record as GreenfieldAcousticInferenceRequest;
}

function collectForbiddenScoreTruthFields(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value) || value instanceof Float32Array) {
    return [];
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (forbiddenScoreTruthFields.has(key)) {
      found.push(currentPath);
    }
    found.push(...collectForbiddenScoreTruthFields(child, currentPath));
  }
  return found.sort();
}
