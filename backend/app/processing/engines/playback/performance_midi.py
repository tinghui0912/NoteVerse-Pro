"""Project written-axis MIDI encounters through one canonical performance plan."""

from dataclasses import replace
from fractions import Fraction

from app.score_semantics.performance_plan import CanonicalPerformancePlan
from app.score_semantics.written_point import WrittenPoint

from .standard_midi import MidiEvent, MidiRepresentationError, StandardMidiFile, exact_output_ppq


def _note_on(event: MidiEvent) -> bool:
    return event.status & 0xF0 == 0x90 and event.data[1] > 0


def _note_off(event: MidiEvent) -> bool:
    return event.status & 0xF0 == 0x80 or (event.status & 0xF0 == 0x90 and event.data[1] == 0)


def _validate_and_pair(midi: StandardMidiFile) -> dict[tuple[int, int], tuple[int, int]]:
    pairs = {}
    channel_tracks: dict[int, int] = {}
    for track_index, track in enumerate(midi.tracks):
        active: dict[tuple[int, int], tuple[int, int]] = {}
        for index, event in enumerate(track):
            if event.status == 0xFF:
                # Text, sequence/track/instrument identity, routing on the single
                # supported MIDI port, meter and key are ordinary preserved facts.
                sizes = {0x00: 2, 0x20: 1, 0x21: 1, 0x58: 4, 0x59: 2, 0x2F: 0}
                if event.meta_type not in {*range(1, 10), *sizes, 0x51}:
                    raise MidiRepresentationError("unsupported_midi_meta_event")
                if event.meta_type in sizes and len(event.data) != sizes[event.meta_type]:
                    raise MidiRepresentationError("invalid_midi_meta_payload")
                if event.meta_type == 0x21 and event.data != b"\x00":
                    raise MidiRepresentationError("unsupported_midi_port")
                if event.meta_type == 0x20 and event.data[0] > 15:
                    raise MidiRepresentationError("invalid_midi_channel_prefix")
                continue
            if not 0x80 <= event.status < 0xF0:
                raise MidiRepresentationError("unsupported_midi_event")
            channel = event.status & 15
            if channel in channel_tracks and channel_tracks[channel] != track_index:
                raise MidiRepresentationError("ambiguous_cross_track_midi_channel")
            channel_tracks[channel] = track_index
            if (
                event.status & 0xF0 == 0xB0
                and event.data[0] >= 120
                and event.data[0] not in (120, 121, 123)
            ):
                raise MidiRepresentationError("unsupported_midi_channel_mode")
            key = channel, event.data[0]
            if _note_on(event):
                if key in active:
                    raise MidiRepresentationError("ambiguous_overlapping_midi_note")
                active[key] = (track_index, index)
                pairs[(track_index, index)] = (track_index, index)
            elif _note_off(event):
                if key not in active:
                    raise MidiRepresentationError("unmatched_midi_note_off")
                if event.position <= track[active[key][1]].position:
                    raise MidiRepresentationError("unsupported_zero_duration_midi_note")
                pairs[(track_index, index)] = active.pop(key)
        if active:
            raise MidiRepresentationError("unterminated_written_midi_note")
    return pairs


def _owner(event: MidiEvent, plan: CanonicalPerformancePlan) -> int:
    spans = plan.projection.written_spans
    candidates = [i for i, (start, end) in enumerate(spans) if start <= event.position <= end]
    if not candidates:
        raise MidiRepresentationError("midi_event_outside_written_score")
    if _note_off(event):
        return candidates[0]
    if _note_on(event):
        interiors = [i for i in candidates if event.position < spans[i][1]]
        if not interiors:
            raise MidiRepresentationError("midi_note_on_at_written_end")
        return interiors[-1]
    if len(candidates) > 1:
        # SMF does not retain source measure-side ownership for state/meta events.
        # Only an identical encounter mapping makes either side unambiguous.
        mappings = [
            plan.projection.project_position(WrittenPoint(i, event.position)) for i in candidates
        ]
        if any(mapping != mappings[0] for mapping in mappings[1:]):
            raise MidiRepresentationError("ambiguous_midi_boundary_state")
    return candidates[-1]


def project_performance_midi(
    written: StandardMidiFile, plan: CanonicalPerformancePlan
) -> StandardMidiFile:
    pairs = _validate_and_pair(written)
    by_measure: dict[int, list[tuple[int, int, MidiEvent]]] = {}
    for track_index, written_track in enumerate(written.tracks):
        for index, event in enumerate(written_track):
            if event.meta_type in (0x51, 0x2F):
                continue  # Tempo and terminal coordinates are owned by the plan.
            owner = _owner(event, plan)
            by_measure.setdefault(owner, []).append((track_index, index, event))
    for events in by_measure.values():
        events.sort(key=lambda item: (item[2].position, item[0], item[1]))

    output: list[list[MidiEvent]] = [[] for _ in written.tracks]
    # State carries across transfers. Only notes are terminated at discontinuities;
    # program/controller/pitch state changes only on actual encounters.
    active: dict[tuple[int, int, int], tuple[int, int]] = {}
    used_channels: set[tuple[int, int]] = set()
    occurrences = plan.projection.occurrences
    for ordinal, occurrence in enumerate(occurrences):
        for track, index, event in by_measure.get(occurrence.measure_index, ()):
            if not occurrence.written_start <= event.position <= occurrence.written_end:
                continue
            if _note_on(event) and event.position == occurrence.written_end:
                continue  # An onset needs performed duration, not just an endpoint.
            key = (track, event.status & 15, event.data[0]) if event.status < 0xF0 else None
            if _note_on(event):
                assert key is not None
                if key in active:
                    raise MidiRepresentationError("ambiguous_performed_midi_note")
                active[key] = pairs[(track, index)]
                used_channels.add((track, event.status & 15))
            elif _note_off(event):
                assert key is not None
                if active.get(key) != pairs[(track, index)]:
                    continue  # Its onset was skipped by an entry or terminated at a cut.
                del active[key]
            elif event.status & 0xF0 == 0xB0 and event.data[0] in (120, 123):
                active = {k: v for k, v in active.items() if k[:2] != (track, event.status & 15)}
            output[track].append(
                replace(event, position=occurrence.project_position(event.position))
            )
        next_occurrence = occurrences[ordinal + 1] if ordinal + 1 < len(occurrences) else None
        continuous = (
            next_occurrence is not None
            and next_occurrence.measure_index == occurrence.measure_index + 1
            and occurrence.written_end == next_occurrence.written_start
        )
        if not continuous:
            for track, channel, pitch in sorted(active):
                output[track].append(
                    MidiEvent(occurrence.performance_end, 0x80 | channel, bytes((pitch, 0)))
                )
            active.clear()
            # All Sound Off also terminates pedal-held voices without resetting
            # the encountered controller/program state at the destination.
            for track, channel in sorted(used_channels):
                output[track].append(
                    MidiEvent(occurrence.performance_end, 0xB0 | channel, b"\x78\x00")
                )
            used_channels.clear()

    conductor = [MidiEvent(Fraction(0), 0xFF, meta_type=0x51, tempo_bpm=plan.initial_tempo_bpm)]
    conductor.extend(
        MidiEvent(t.performance_position, 0xFF, meta_type=0x51, tempo_bpm=t.bpm)
        for t in plan.tempo_events
    )
    output[0] = conductor + output[0]
    for output_track in output:
        output_track.sort(key=lambda e: e.position)  # Stable encounter order at equal quarters.
        output_track.append(MidiEvent(plan.projection.end, 0xFF, meta_type=0x2F))
    boundaries = [
        p
        for o in occurrences
        for p in (o.written_start, o.written_end, o.performance_start, o.performance_end)
    ]
    ppq = exact_output_ppq(
        written.ppq, boundaries + [e.position for track in output for e in track]
    )
    return StandardMidiFile(ppq, tuple(tuple(track) for track in output), written.format)
