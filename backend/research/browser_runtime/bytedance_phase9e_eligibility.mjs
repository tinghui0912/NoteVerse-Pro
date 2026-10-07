export function classifyCausalCase(item) {
  const normalized = normalizeCausalCase(item);
  if (!normalized.expectedGroups?.length) {
    return excluded(normalized, 'NO_EXPECTED_GROUPS', 'Case does not expose authoritative non-empty expected groups for a Continuous interval.');
  }
  if (!Number.isFinite(normalized.completionPerformanceTimeMs)) {
    return excluded(normalized, 'NO_COMPLETION', 'Case has no finite Continuous completion boundary.');
  }
  if (!Number.isFinite(normalized.performanceOriginSourceMs)) {
    return excluded(normalized, 'NO_PERFORMANCE_ORIGIN', 'Case has no source-audio performance origin.');
  }
  if (!normalized.sourceAudioSha256) {
    return excluded(normalized, 'NO_AUDIO_HASH', 'Case has no source audio SHA256.');
  }
  if (!normalized.sourceMidiSha256) {
    return excluded(normalized, 'NO_MIDI_HASH', 'Case has no source MIDI SHA256.');
  }
  if (!normalized.hasSynchronizedPhysicalMidi) {
    return excluded(normalized, 'NO_SYNCHRONIZED_PHYSICAL_MIDI', 'Case lacks synchronized physical MIDI truth evidence.');
  }
  if (!normalized.scoreIntervalComplete) {
    return excluded(normalized, 'INCOMPLETE_SCORE_INTERVAL', 'Case does not prove all score events in the owned interval are represented.');
  }
  if (
    !Array.isArray(normalized.chunkPlans)
    || normalized.clipStartMs === undefined
    || normalized.clipEndMs === undefined
  ) {
    return excluded(normalized, 'INSUFFICIENT_CONTEXT', 'Case lacks actual ByteDance chunk-plan context evidence.');
  }
  const requiredStart = Math.min(...normalized.chunkPlans.map((plan) => normalized.performanceOriginSourceMs + plan.inputStartPerformanceMs));
  const requiredEnd = Math.max(...normalized.chunkPlans.map((plan) => normalized.performanceOriginSourceMs + plan.inputEndPerformanceMs));
  if (requiredStart < normalized.clipStartMs || requiredEnd > normalized.clipEndMs) {
    return excluded(normalized, 'INSUFFICIENT_CONTEXT', 'Case lacks required source audio for the actual ByteDance chunk plan.');
  }
  return {
    caseId: normalized.caseId,
    status: 'ELIGIBLE_CONTINUOUS_SCENARIO',
    reason: 'Case exposes the required Continuous scenario fields and actual ByteDance chunk-plan context.',
    sourceAudioSha256: normalized.sourceAudioSha256 ?? null,
    sourceMidiSha256: normalized.sourceMidiSha256 ?? null,
  };
}

export function normalizeCausalCase(item) {
  return {
    caseId: String(item.case_id ?? item.caseId ?? 'unknown-case'),
    expectedGroups: item.expected_groups ?? item.expectedGroups,
    completionPerformanceTimeMs: item.completion_performance_time_ms ?? item.completionPerformanceTimeMs,
    performanceOriginSourceMs: item.performance_origin_source_ms ?? item.performanceOriginSourceMs,
    sourceAudioSha256: item.source_audio_sha256 ?? item.sourceAudioSha256,
    sourceMidiSha256: item.source_midi_sha256 ?? item.sourceMidiSha256,
    hasSynchronizedPhysicalMidi: item.has_synchronized_physical_midi ?? item.hasSynchronizedPhysicalMidi,
    scoreIntervalComplete: item.score_interval_complete ?? item.scoreIntervalComplete,
    clipStartMs: item.clip_start_ms ?? item.clipStartMs,
    clipEndMs: item.clip_end_ms ?? item.clipEndMs,
    chunkPlans: item.chunk_plans ?? item.chunkPlans,
  };
}

function excluded(item, status, reason) {
  return {
    caseId: item.caseId,
    status: `EXCLUDED_${status}`,
    reason,
    sourceAudioSha256: item.sourceAudioSha256 ?? null,
    sourceMidiSha256: item.sourceMidiSha256 ?? null,
  };
}
