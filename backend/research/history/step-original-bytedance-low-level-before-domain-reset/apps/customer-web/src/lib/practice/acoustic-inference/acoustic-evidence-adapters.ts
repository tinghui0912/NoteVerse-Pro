import {
  type CapturedAttack,
} from '../local-core';
import type { AcousticNoteEvent } from './bytedance-contract';

export function acousticEventsToPerformanceEvidence(
  events: readonly AcousticNoteEvent[]
): CapturedAttack[] {
  return events.map((event) => ({
    captureTime: event.onsetTime,
    pitch: event.pitch,
    confidence: event.confidence,
    source: 'ACOUSTIC',
    inferenceCompletedAtMs: event.inferenceCompletedAtMs,
  }));
}
