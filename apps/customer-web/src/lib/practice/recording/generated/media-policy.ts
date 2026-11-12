// Generated from contracts/practice/recording-media-policy.json. Do not edit.
export const CAPTURE_CONTAINERS = Object.freeze([
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

export const VIDEO_CAPTURE_MIME_CANDIDATES = Object.freeze([
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
] as const);

export type CaptureMediaKind = (typeof CAPTURE_CONTAINERS)[number]['kind'];
