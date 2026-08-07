export type PracticeSessionState = 'CREATED' | 'STREAMING' | 'PAUSED' | 'FINISHED' | 'FAILED';
export type PracticeReportStatus = 'NOT_REQUESTED' | 'PENDING' | 'READY' | 'FAILED';

export interface CreatePracticeSessionRequest {
  score_id: string;
  revision_id?: string;
  sample_rate?: number;
  channels?: number;
  frame_format?: string;
}

export interface PracticeSessionSummary {
  session_id: string;
  state: PracticeSessionState;
  ws_url?: string;
}

export interface PracticeSessionDetail {
  session_id: string;
  score_id: string;
  revision_id: string;
  access_origin: 'OWNER' | 'MEMBERSHIP' | 'SHARE' | 'PUBLICATION';
  state: PracticeSessionState;
  sample_rate: number;
  channels: number;
  frame_format: string;
  started_at?: string | null;
  finished_at?: string | null;
  last_beat_position?: number | null;
  last_confidence?: number | null;
  report_status: PracticeReportStatus;
}

export interface PracticeReportPayload {
  summary: string;
  metrics: Record<string, string | number | null>;
  recommendations: string[];
}

export interface PracticeReportResponse {
  session_id: string;
  report_status: PracticeReportStatus;
  report_payload?: PracticeReportPayload | null;
}

export interface PracticeSessionReadyMessage {
  type: 'session.ready';
  payload: { session_id: string; state: PracticeSessionState };
}

export interface PracticeSessionArmedMessage {
  type: 'session.armed';
  payload: { session_id: string; environment_quality: 'good' | 'noisy' | 'poor' };
}

export interface PracticeSessionStateChangedMessage {
  type: 'session.state_changed';
  payload: { state: PracticeSessionState };
}

export interface PracticeSessionFinishedMessage {
  type: 'session.finished';
  payload: { state: PracticeSessionState };
}

export interface PracticeAlignmentUpdateMessage {
  type: 'alignment.update';
  payload: {
    beat_position: number;
    confidence: number;
    alignment_confidence: number;
    audio_confidence: number;
    continuity_confidence: number;
    visual_confidence: number;
    timestamp_ms: number;
    score_completed?: boolean;
    audio_active?: boolean;
    input_rms?: number;
    input_peak?: number;
    match_state?: 'matched' | 'holding_decay' | 'lost' | 'no_input' | string;
    feature_confidence?: number;
    beat_delta?: number | null;
    stream_state?: string;
    frame_class?: 'silence' | 'transient' | 'tonal' | 'uncertain' | string;
    gate_reason?: string;
    queue_decision?: string;
    tonal_signal?: boolean;
    onset_signal?: boolean;
    spectral_flatness?: number;
    peak_prominence?: number;
    spectral_flux?: number;
    alignment_state?: string;
    continuity_state?: string;
    beat_velocity?: number | null;
    validation_confidence?: number;
    input_weight?: number;
    input_policy_confidence?: number;
  };
}

export interface PracticeSessionErrorMessage {
  type: 'session.error';
  payload: { public_code: string; public_message: string };
}

export type PracticeServerMessage =
  | PracticeSessionReadyMessage
  | PracticeSessionArmedMessage
  | PracticeSessionStateChangedMessage
  | PracticeSessionFinishedMessage
  | PracticeAlignmentUpdateMessage
  | PracticeSessionErrorMessage;
