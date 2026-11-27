import type { MidiData } from 'midi-file';
import { safeInteger } from './rational';

const noteMetadata = new Set([
  'sequenceNumber',
  'text',
  'copyrightNotice',
  'trackName',
  'instrumentName',
  'lyrics',
  'marker',
  'cuePoint',
  'setTempo',
  'timeSignature',
  'keySignature',
  'endOfTrack',
]);

/** Validate a static, single-channel note realization per raw renderer track. */
export function validateWrittenMidiCapability(midi: MidiData): void {
  if (midi.header.format !== 0 && midi.header.format !== 1) {
    throw new Error('unsupported_score_preview_midi_layout');
  }
  safeInteger(midi.header.ticksPerBeat!, 1);
  for (const track of midi.tracks) {
    let ticks = 0;
    let channel: number | undefined;
    let program: number | undefined;
    let encounteredOnset = false;
    const active = new Map<number, number>();
    for (const event of track) {
      ticks = safeInteger(ticks + safeInteger(event.deltaTime));
      if ('meta' in event && event.meta && noteMetadata.has(event.type))
        continue;
      if (
        event.type !== 'programChange' &&
        event.type !== 'noteOn' &&
        event.type !== 'noteOff'
      ) {
        throw new Error(`unsupported_score_preview_midi_state: ${event.type}`);
      }
      safeInteger(event.channel);
      if (
        event.channel > 15 ||
        (channel !== undefined && channel !== event.channel)
      ) {
        throw new Error('unsupported_score_preview_midi_track');
      }
      channel = event.channel;
      if (event.type === 'programChange') {
        if (
          ticks !== 0 ||
          encounteredOnset ||
          (program !== undefined && program !== event.programNumber)
        ) {
          throw new Error('unsupported_score_preview_instrument_change');
        }
        program = safeInteger(event.programNumber);
        if (program > 127)
          throw new Error('unsupported_score_preview_instrument_change');
        continue;
      }
      const pitch = safeInteger(event.noteNumber);
      const velocity = safeInteger(event.velocity);
      if (pitch > 127 || velocity > 127)
        throw new Error('unsupported_score_preview_midi_note');
      if (event.type === 'noteOn' && velocity > 0) {
        encounteredOnset = true;
        if (active.has(pitch))
          throw new Error('unsupported_score_preview_midi_note_lifecycle');
        active.set(pitch, ticks);
      } else {
        const onset = active.get(pitch);
        if (onset === undefined || ticks <= onset)
          throw new Error('unsupported_score_preview_midi_note_lifecycle');
        active.delete(pitch);
      }
    }
    if (active.size)
      throw new Error('unsupported_score_preview_midi_note_lifecycle');
  }
}
