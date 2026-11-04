"""Logical renderer streams, note pairing and final synthesis channel routing."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace

from .midi_event_semantics import MidiMetaRole, classify_meta_event, is_note_off, is_note_on
from .standard_midi import MidiEvent, MidiRepresentationError, StandardMidiFile


@dataclass(frozen=True, order=True)
class WrittenMidiStreamId:
    source_track_index: int
    source_channel: int


@dataclass(frozen=True)
class WrittenMidiStreams:
    stream_ids: tuple[WrittenMidiStreamId, ...]
    note_pairs: Mapping[tuple[int, int], tuple[int, int]]


def read_written_midi_streams(midi: StandardMidiFile) -> WrittenMidiStreams:
    """Validate renderer events and pair notes only within their logical stream."""
    pairs = {}
    streams = set()
    for track_index, track in enumerate(midi.tracks):
        descriptors = set()
        active: dict[tuple[WrittenMidiStreamId, int], int] = {}
        for index, event in sorted(enumerate(track), key=lambda item: item[1].position):
            if event.status == 0xFF:
                if classify_meta_event(event) is MidiMetaRole.STRUCTURAL:
                    if event.meta_type in descriptors:
                        raise MidiRepresentationError("ambiguous_structural_midi_descriptor")
                    descriptors.add(event.meta_type)
                continue
            if not 0x80 <= event.status < 0xF0:
                raise MidiRepresentationError("unsupported_midi_event")
            stream = WrittenMidiStreamId(track_index, event.status & 15)
            streams.add(stream)
            if (
                event.status & 0xF0 == 0xB0
                and event.data[0] >= 120
                and event.data[0] not in (120, 121, 123)
            ):
                raise MidiRepresentationError("unsupported_midi_channel_mode")
            key = stream, event.data[0]
            if is_note_on(event):
                if key in active:
                    raise MidiRepresentationError("ambiguous_overlapping_midi_note")
                active[key] = index
                pairs[(track_index, index)] = (track_index, index)
            elif is_note_off(event):
                if key not in active:
                    raise MidiRepresentationError("unmatched_midi_note_off")
                onset_index = active.pop(key)
                if event.position <= track[onset_index].position:
                    raise MidiRepresentationError("unsupported_zero_duration_midi_note")
                pairs[(track_index, index)] = (track_index, onset_index)
        if active:
            raise MidiRepresentationError("unterminated_written_midi_note")
    return WrittenMidiStreams(tuple(sorted(streams)), pairs)


def allocate_output_channels(
    streams: Iterable[WrittenMidiStreamId],
) -> dict[WrittenMidiStreamId, int]:
    """Reserve GM percussion and allocate an independent channel to every stream."""
    ordered = sorted(set(streams))
    percussion = [stream for stream in ordered if stream.source_channel == 9]
    if len(percussion) > 1:
        raise MidiRepresentationError("unsupported_multiple_percussion_streams")
    melodic = [stream for stream in ordered if stream.source_channel != 9]
    if len(melodic) > 15:
        raise MidiRepresentationError("insufficient_output_midi_channels")
    assignments = {stream: 9 for stream in percussion}
    available = set(range(16)) - {9}
    # Preserve distinct requested channels before assigning colliding streams.
    for stream in melodic:
        if stream.source_channel in available:
            assignments[stream] = stream.source_channel
            available.remove(stream.source_channel)
    for stream in melodic:
        if stream not in assignments:
            channel = min(available)
            assignments[stream] = channel
            available.remove(channel)
    return assignments


def route_stream_event(
    event: MidiEvent,
    stream: WrittenMidiStreamId,
    assignments: Mapping[WrittenMidiStreamId, int],
) -> MidiEvent:
    """Materialize every channel voice message through the same routing owner."""
    return replace(event, status=(event.status & 0xF0) | assignments[stream])
