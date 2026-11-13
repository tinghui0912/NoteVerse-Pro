// Generated from contracts/practice/recording-media-admission.json. Do not edit.
export const ORIGINAL_RECORDING_CONTAINERS = Object.freeze([
  Object.freeze({
    kind: "AUDIO",
    mimeType: "audio/webm",
    extension: "webm",
    signature: "EBML",
  } as const),
  Object.freeze({
    kind: "AUDIO",
    mimeType: "audio/mp4",
    extension: "mp4",
    signature: "ISO_BMFF_FTYP",
  } as const),
  Object.freeze({
    kind: "AUDIO",
    mimeType: "audio/ogg",
    extension: "ogg",
    signature: "OGG",
  } as const),
  Object.freeze({
    kind: "AUDIO",
    mimeType: "audio/wav",
    extension: "wav",
    signature: "RIFF_WAVE",
  } as const),
  Object.freeze({
    kind: "AUDIO",
    mimeType: "audio/x-wav",
    extension: "wav",
    signature: "RIFF_WAVE",
  } as const),
  Object.freeze({
    kind: "VIDEO",
    mimeType: "video/webm",
    extension: "webm",
    signature: "EBML",
  } as const),
  Object.freeze({
    kind: "VIDEO",
    mimeType: "video/mp4",
    extension: "mp4",
    signature: "ISO_BMFF_FTYP",
  } as const),
] as const);

export type RecordingMediaKind = (typeof ORIGINAL_RECORDING_CONTAINERS)[number]['kind'];
