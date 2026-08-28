import { z } from 'zod';

export const PRACTICE_WEBSOCKET_PROTOCOL_VERSION = 1;

const envelope = z.object({ protocol_version: z.literal(PRACTICE_WEBSOCKET_PROTOCOL_VERSION) }).strict();
const practiceSessionState = z.enum(['CREATED', 'STREAMING', 'PAUSED', 'FINISHED', 'FAILED']);
const statePayload = z.object({ state: practiceSessionState }).strict();
const completionOutcome = z.object({
  kind: z.enum(['FULL_PIECE_LEARNING', 'FULL_PIECE_PERFORMANCE', 'SELECTED_SECTION']),
  scope_kind: z.enum(['FULL_PIECE', 'SELECTED_RANGE']),
  summary_artifact_kind: z.enum(['LEARNING_SUMMARY', 'PERFORMANCE_SUMMARY', 'SECTION_SUMMARY']),
  playback_expected: z.boolean(),
  summary_available: z.boolean(),
}).strict();
const alignmentDecision = z.object({
  action: z.enum(['advance', 'hold', 'relocalize', 'wait']),
  reason: z.enum([
    'stable_match',
    'partial_match',
    'insufficient_input',
    'entry_mismatch',
    'low_alignment_confidence',
    'holding_position',
    'reacquiring',
    'large_jump',
    'practice_paused',
    'practice_finished',
    'connection_closed',
  ]),
  experience_state: z.enum([
    'waiting_for_input',
    'listening',
    'following',
    'partially_matched',
    'heard_but_uncertain',
    'possible_wrong_note',
    'recovering',
    'lost',
    'paused',
  ]),
  display_anchor: z.object({
    beat: z.number(),
    event_id: z.string().min(1).optional().nullable(),
    group_id: z.string().min(1).optional().nullable(),
    render_note_ids: z.array(z.string()),
  }).strict().nullable(),
  confidence_summary: z.object({
    visual: z.number(),
    alignment: z.number(),
    audio: z.number(),
    continuity: z.number(),
    validation: z.number(),
    input_policy: z.number(),
  }).strict(),
  attempt_state: z.enum(['pending', 'resolved']).optional().nullable(),
  attempt_id: z.string().min(1).optional().nullable(),
  attempt_sequence: z.number().int().positive().optional().nullable(),
  attempt_started_at_ms: z.number().int().nonnegative().optional().nullable(),
  attempt_resolved_at_ms: z.number().int().nonnegative().optional().nullable(),
  evaluator_version: z.string().min(1).optional().nullable(),
  policy_profile_version: z.string().min(1).optional().nullable(),
}).strict();

const inputHealth = z.object({
  available: z.boolean(),
  level: z.enum(['good', 'too_quiet', 'clipping']),
  noise: z.enum(['good', 'elevated', 'high']),
  confidence: z.number().min(0).max(1),
}).strict();

export const practiceServerMessageSchema = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('session.connecting'), payload: z.object({ session_id: z.string().min(1) }).strict() }),
  envelope.extend({ type: z.literal('session.ready'), payload: z.object({ session_id: z.string().min(1), state: practiceSessionState }).strict() }),
  envelope.extend({ type: z.literal('session.armed'), payload: z.object({ session_id: z.string().min(1), input_health: inputHealth }).strict() }),
  envelope.extend({ type: z.literal('session.state_changed'), payload: statePayload }),
  envelope.extend({
    type: z.literal('session.finished'),
    payload: z.object({
      state: practiceSessionState,
      completion_outcome: completionOutcome,
    }).strict(),
  }),
  envelope.extend({ type: z.literal('session.error'), payload: z.object({ public_code: z.string().min(1), public_message: z.string().min(1) }).strict() }),
  envelope.extend({
    type: z.literal('alignment.update'),
    payload: z.object({
      beat_position: z.number(), confidence: z.number(), alignment_confidence: z.number(), audio_confidence: z.number(),
      continuity_confidence: z.number(), visual_confidence: z.number(), timestamp_ms: z.number().int().nonnegative(),
      scope_completed: z.boolean(),
      completion_reason: z.enum([
        'FULL_SCORE_END_REACHED',
        'SCOPE_END_REACHED',
        'FINAL_EXPECTED_GROUP_MATCHED',
      ]).nullable(),
      audio_active: z.boolean(), input_rms: z.number(), input_peak: z.number(),
      input_health: inputHealth,
      match_state: z.enum(['matched', 'holding_decay', 'lost', 'no_input']), feature_confidence: z.number(),
      beat_delta: z.number().nullable(), stream_state: z.string().min(1),
      frame_class: z.enum(['silence', 'transient', 'tonal', 'uncertain', 'unknown']), gate_reason: z.string().min(1),
      queue_decision: z.string().min(1), tonal_signal: z.boolean(), onset_signal: z.boolean(), spectral_flatness: z.number(),
      peak_prominence: z.number(), spectral_flux: z.number(), alignment_state: z.string().min(1),
      continuity_state: z.string().min(1), beat_velocity: z.number().nullable(), validation_confidence: z.number(),
      input_weight: z.number(), input_policy_confidence: z.number(), decision: alignmentDecision,
    }).strict(),
  }),
]);

export type PracticeServerMessage = z.infer<typeof practiceServerMessageSchema>;
export type PracticeAlignmentUpdateMessage = Extract<PracticeServerMessage, { type: 'alignment.update' }>;

export function parsePracticeServerMessage(value: unknown): PracticeServerMessage {
  return practiceServerMessageSchema.parse(value);
}
