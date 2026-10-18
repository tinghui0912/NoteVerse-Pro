import {createHash} from 'node:crypto';

export function normalizedPitchSet(values) {
  if (!Array.isArray(values) || !values.length || values.some(p => !Number.isInteger(p) || p < 0 || p > 127)) {
    throw Error('INVALID_PHYSICAL_PITCH_SET');
  }
  return Object.freeze([...new Set(values)].sort((a, b) => a - b));
}

/** MIDI metadata classification only, never an acoustic trigger or product verifier. */
export function repeatedGestureKind(first, second) {
  const a = normalizedPitchSet(first), b = normalizedPitchSet(second);
  if (a.length !== b.length || a.some((p, i) => p !== b[i])) return null;
  return a.length === 1 ? 'SINGLE_SAME_PITCH_RETRIGGER' : 'EXACT_REPEATED_CHORD';
}

export function physicalPair(source, first, second) {
  if (!source.recordingId || !/^[a-f0-9]{64}$/.test(source.audioSha256) || !/^[a-f0-9]{64}$/.test(source.midiSha256)) {
    throw Error('INVALID_PAIR_SOURCE_IDENTITY');
  }
  if (!first.gestureId || !second.gestureId || first.gestureId === second.gestureId
    || !Number.isFinite(first.onsetSeconds) || !Number.isFinite(second.onsetSeconds)
    || first.onsetSeconds < 0 || second.onsetSeconds <= first.onsetSeconds) throw Error('INVALID_PHYSICAL_PAIR');
  const firstPitchSet = normalizedPitchSet(first.pitches), secondPitchSet = normalizedPitchSet(second.pitches);
  const kind = repeatedGestureKind(firstPitchSet, secondPitchSet);
  const gapSeconds = second.onsetSeconds - first.onsetSeconds;
  const identity = {recordingId:source.recordingId, audioSha256:source.audioSha256, midiSha256:source.midiSha256,
    firstGestureId:first.gestureId, firstOnsetSeconds:first.onsetSeconds, firstPitchSet,
    secondGestureId:second.gestureId, secondOnsetSeconds:second.onsetSeconds, secondPitchSet};
  return Object.freeze({pairId:createHash('sha256').update(JSON.stringify(identity)).digest('hex'), ...identity,
    gapMs:gapSeconds * 1000, kind,
    eligibleBusySingle:kind === 'SINGLE_SAME_PITCH_RETRIGGER' && gapSeconds >= .2 && gapSeconds <= .25,
    eligibleRapidRepeatedGesture:kind !== null && gapSeconds >= .2 && gapSeconds <= .25});
}
