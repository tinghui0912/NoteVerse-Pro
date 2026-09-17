import type {
  PracticeReplayArtifactKind,
  SavedPracticeReplayArtifactRead,
} from '@/generated/practice-api';
import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';

const NOTEVERSE_MIDI_REPLAY_CONTENT_TYPE = 'application/vnd.noteverse.replay+json';
const NOTEVERSE_MIDI_REPLAY_FILENAME = 'performance-replay.nvr.json';
const AUDIO_REPLAY_FILENAME = 'performance-recording';
const SAVED_REPLAY_FORMAT_VERSION = 1;

export type SavedPerformanceReplayUpload = {
  kind: PracticeReplayArtifactKind;
  file: Blob;
  filename: string;
  contentType: string;
  durationMs: number;
  timebaseVersion: number;
  formatVersion: number;
};

type NoteVerseMidiReplayPayload = {
  formatVersion: 1;
  timebaseVersion: 1;
  durationMs: number;
  speedRatio: number;
  events: PlayablePerformanceReplayEvent[];
};

type PlayablePerformanceReplayEvent = Extract<
  PlayablePerformanceReplay,
  { kind: 'MIDI_EVENTS' }
>['events'][number];

export function buildSavedPerformanceReplayUpload(
  replay: PlayablePerformanceReplay
): SavedPerformanceReplayUpload {
  if (replay.kind === 'AUDIO_RECORDING') {
    const contentType = normalizeAudioReplayContentType(replay.contentType);
    return {
      kind: 'AUDIO_RECORDING',
      file: replay.blob,
      filename: audioReplayFilename(contentType),
      contentType,
      durationMs: replay.durationMs,
      timebaseVersion: replay.timebase.version,
      formatVersion: SAVED_REPLAY_FORMAT_VERSION,
    };
  }

  const payload: NoteVerseMidiReplayPayload = {
    formatVersion: SAVED_REPLAY_FORMAT_VERSION,
    timebaseVersion: replay.timebase.version,
    durationMs: replay.durationMs,
    speedRatio: replay.timebase.speedRatio,
    events: replay.events,
  };
  const file = new Blob([JSON.stringify(payload)], {
    type: NOTEVERSE_MIDI_REPLAY_CONTENT_TYPE,
  });
  return {
    kind: 'MIDI_EVENTS',
    file,
    filename: NOTEVERSE_MIDI_REPLAY_FILENAME,
    contentType: NOTEVERSE_MIDI_REPLAY_CONTENT_TYPE,
    durationMs: replay.durationMs,
    timebaseVersion: replay.timebase.version,
    formatVersion: SAVED_REPLAY_FORMAT_VERSION,
  };
}

export async function checksumSha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function readSavedPerformanceReplay(
  artifact: SavedPracticeReplayArtifactRead,
  playbackUrl: string
): Promise<PlayablePerformanceReplay> {
  if (artifact.kind === 'MIDI_EVENTS') {
    const response = await fetch(playbackUrl);
    if (!response.ok) {
      throw new Error('saved MIDI replay download failed');
    }
    return midiReplayFromPayload(await response.json(), artifact);
  }

  const response = await fetch(playbackUrl);
  if (!response.ok) {
    throw new Error('saved audio replay download failed');
  }
  const blob = await response.blob();
  return {
    kind: 'AUDIO_RECORDING',
    blob,
    contentType: artifact.content_type,
    byteSize: artifact.byte_size,
    durationMs: artifact.duration_ms,
    timebase: {
      version: 1,
      speedRatio: 1,
    },
  };
}

function midiReplayFromPayload(
  payload: unknown,
  artifact: SavedPracticeReplayArtifactRead
): PlayablePerformanceReplay {
  if (!isNoteVerseMidiReplayPayload(payload)) {
    throw new Error('saved MIDI replay payload is invalid');
  }
  return {
    kind: 'MIDI_EVENTS',
    events: payload.events,
    durationMs: artifact.duration_ms,
    timebase: {
      version: 1,
      speedRatio: payload.speedRatio,
    },
  };
}

function isNoteVerseMidiReplayPayload(
  payload: unknown
): payload is NoteVerseMidiReplayPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as Partial<NoteVerseMidiReplayPayload>;
  return (
    candidate.formatVersion === SAVED_REPLAY_FORMAT_VERSION &&
    candidate.timebaseVersion === 1 &&
    typeof candidate.durationMs === 'number' &&
    typeof candidate.speedRatio === 'number' &&
    Array.isArray(candidate.events) &&
    candidate.events.every(isPlayablePerformanceReplayEvent)
  );
}

function isPlayablePerformanceReplayEvent(
  event: unknown
): event is PlayablePerformanceReplayEvent {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const candidate = event as Partial<PlayablePerformanceReplayEvent>;
  return (
    (candidate.event_type === 'note_on' || candidate.event_type === 'note_off') &&
    typeof candidate.note_number === 'number' &&
    typeof candidate.velocity === 'number' &&
    typeof candidate.timestamp_ms === 'number'
  );
}

function audioReplayFilename(contentType: string): string {
  if (contentType === 'audio/wav' || contentType === 'audio/wave' || contentType === 'audio/x-wav') {
    return `${AUDIO_REPLAY_FILENAME}.wav`;
  }
  return `${AUDIO_REPLAY_FILENAME}.webm`;
}

function normalizeAudioReplayContentType(contentType: string): string {
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase();
  if (mediaType === 'audio/wav' || mediaType === 'audio/wave' || mediaType === 'audio/x-wav') {
    return mediaType;
  }
  if (mediaType === 'audio/webm') {
    return mediaType;
  }
  throw new Error(`unsupported audio replay content type: ${contentType}`);
}
