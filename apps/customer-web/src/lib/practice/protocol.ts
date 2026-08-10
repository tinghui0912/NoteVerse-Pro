import { z } from 'zod';

export const PRACTICE_WEBSOCKET_PROTOCOL_VERSION = 1;

const envelope = z.object({ protocol_version: z.literal(PRACTICE_WEBSOCKET_PROTOCOL_VERSION) }).strict();
const practiceSessionState = z.enum(['CREATED', 'STREAMING', 'PAUSED', 'FINISHED', 'FAILED']);
const statePayload = z.object({ state: practiceSessionState }).strict();

export const practiceServerMessageSchema = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('session.ready'), payload: z.object({ session_id: z.string().min(1), state: practiceSessionState }).strict() }),
  envelope.extend({ type: z.literal('session.armed'), payload: z.object({ session_id: z.string().min(1), environment_quality: z.enum(['good', 'noisy', 'poor']) }).strict() }),
  envelope.extend({ type: z.literal('session.state_changed'), payload: statePayload }),
  envelope.extend({ type: z.literal('session.finished'), payload: statePayload }),
  envelope.extend({ type: z.literal('session.error'), payload: z.object({ public_code: z.string().min(1), public_message: z.string().min(1) }).strict() }),
  envelope.extend({
    type: z.literal('alignment.update'),
    payload: z.object({
      beat_position: z.number(), confidence: z.number(), alignment_confidence: z.number(), audio_confidence: z.number(),
      continuity_confidence: z.number(), visual_confidence: z.number(), timestamp_ms: z.number().int().nonnegative(),
      score_completed: z.boolean(), audio_active: z.boolean(), input_rms: z.number(), input_peak: z.number(),
      match_state: z.enum(['matched', 'holding_decay', 'lost', 'no_input']), feature_confidence: z.number(),
      beat_delta: z.number().nullable(), stream_state: z.string().min(1),
      frame_class: z.enum(['silence', 'transient', 'tonal', 'uncertain', 'unknown']), gate_reason: z.string().min(1),
      queue_decision: z.string().min(1), tonal_signal: z.boolean(), onset_signal: z.boolean(), spectral_flatness: z.number(),
      peak_prominence: z.number(), spectral_flux: z.number(), alignment_state: z.string().min(1),
      continuity_state: z.string().min(1), beat_velocity: z.number().nullable(), validation_confidence: z.number(),
      input_weight: z.number(), input_policy_confidence: z.number(),
    }).strict(),
  }),
]);

export type PracticeServerMessage = z.infer<typeof practiceServerMessageSchema>;
export type PracticeAlignmentUpdateMessage = Extract<PracticeServerMessage, { type: 'alignment.update' }>;

export function parsePracticeServerMessage(value: unknown): PracticeServerMessage {
  return practiceServerMessageSchema.parse(value);
}
