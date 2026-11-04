"""Project written-axis MIDI encounters through one canonical performance plan."""

from dataclasses import replace
from fractions import Fraction

from app.score_semantics.performance_plan import CanonicalPerformancePlan
from app.score_semantics.written_point import WrittenPoint

from .standard_midi import MidiEvent, MidiRepresentationError, StandardMidiFile, exact_output_ppq
from .midi_event_semantics import MidiMetaRole, classify_meta_event


def _note_on(event: MidiEvent) -> bool:
    return event.status & 0xF0 == 0x90 and event.data[1] > 0


def _note_off(event: MidiEvent) -> bool:
    return event.status & 0xF0 == 0x80 or (event.status & 0xF0 == 0x90 and event.data[1] == 0)


def _validate_and_pair(
    midi: StandardMidiFile,
) -> tuple[dict[tuple[int, int], tuple[int, int]], dict[int, int]]:
    pairs = {}
    channel_stream_tracks: dict[int, int] = {}
    ordered = []
    for track_index, track in enumerate(midi.tracks):
        descriptors = set()
        for index, event in enumerate(track):
            if event.status == 0xFF:
                if classify_meta_event(event) is MidiMetaRole.STRUCTURAL:
                    if event.meta_type in descriptors:
                        raise MidiRepresentationError("ambiguous_structural_midi_descriptor")
                    descriptors.add(event.meta_type)
                continue
            if not 0x80 <= event.status < 0xF0:
                raise MidiRepresentationError("unsupported_midi_event")
            channel = event.status & 15
            # This is an output stream owner, not a restriction on input tracks.
            channel_stream_tracks[channel] = min(
                channel_stream_tracks.get(channel, track_index), track_index
            )
            if (
                event.status & 0xF0 == 0xB0
                and event.data[0] >= 120
                and event.data[0] not in (120, 121, 123)
            ):
                raise MidiRepresentationError("unsupported_midi_channel_mode")
            ordered.append((track_index, index, event))
    active: dict[tuple[int, int], tuple[int, int]] = {}
    # The written-realization adapter uses stable source track/event order for
    # equal-quarter input. Channel state and note pairing are global across tracks.
    for track_index, index, event in sorted(
        ordered, key=lambda item: (item[2].position, item[0], item[1])
    ):
        key = event.status & 15, event.data[0]
        if _note_on(event):
            if key in active:
                raise MidiRepresentationError("ambiguous_overlapping_midi_note")
            active[key] = (track_index, index)
            pairs[(track_index, index)] = (track_index, index)
        elif _note_off(event):
            if key not in active:
                raise MidiRepresentationError("unmatched_midi_note_off")
            onset_track, onset_index = active[key]
            if event.position <= midi.tracks[onset_track][onset_index].position:
                raise MidiRepresentationError("unsupported_zero_duration_midi_note")
            pairs[(track_index, index)] = active.pop(key)
    if active:
        raise MidiRepresentationError("unterminated_written_midi_note")
    return pairs, channel_stream_tracks


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
    pairs, channel_stream_tracks = _validate_and_pair(written)
    by_measure: dict[int, list[tuple[int, int, MidiEvent]]] = {}
    output: list[list[MidiEvent]] = [[] for _ in written.tracks]
    for track_index, written_track in enumerate(written.tracks):
        for index, event in enumerate(written_track):
            if event.status == 0xFF:
                role = classify_meta_event(event)
                if role is MidiMetaRole.STRUCTURAL:
                    output[track_index].append(event)
                    continue
                if role in (MidiMetaRole.CONDUCTOR, MidiMetaRole.TERMINAL):
                    continue  # Tempo and terminal coordinates are owned by the plan.
            owner = _owner(event, plan)
            by_measure.setdefault(owner, []).append((track_index, index, event))
    for events in by_measure.values():
        events.sort(key=lambda item: (item[2].position, item[0], item[1]))
    conductor_descriptors = len(output[0])

    # State carries across transfers. Only notes are terminated at discontinuities;
    # program/controller/pitch state changes only on actual encounters.
    active: dict[tuple[int, int], tuple[int, int]] = {}
    occurrences = plan.projection.occurrences
    for ordinal, occurrence in enumerate(occurrences):
        for track, index, event in by_measure.get(occurrence.measure_index, ()):
            if not occurrence.written_start <= event.position <= occurrence.written_end:
                continue
            if _note_on(event) and event.position == occurrence.written_end:
                continue  # An onset needs performed duration, not just an endpoint.
            key = (event.status & 15, event.data[0]) if event.status < 0xF0 else None
            if _note_on(event):
                assert key is not None
                if key in active:
                    raise MidiRepresentationError("ambiguous_performed_midi_note")
                active[key] = pairs[(track, index)]
            elif _note_off(event):
                assert key is not None
                if active.get(key) != pairs[(track, index)]:
                    continue  # Its onset was skipped by an entry or terminated at a cut.
                del active[key]
            elif event.status & 0xF0 == 0xB0 and event.data[0] in (120, 123):
                active = {k: v for k, v in active.items() if k[0] != event.status & 15}
            # One serialized stream per channel keeps source/cut/destination
            # ordering even when those events originally came from different tracks.
            target_track = (
                channel_stream_tracks[event.status & 15] if event.status < 0xF0 else track
            )
            output[target_track].append(
                replace(event, position=occurrence.project_position(event.position))
            )
        next_occurrence = occurrences[ordinal + 1] if ordinal + 1 < len(occurrences) else None
        continuous = (
            next_occurrence is not None
            and next_occurrence.measure_index == occurrence.measure_index + 1
            and occurrence.written_end == next_occurrence.written_start
        )
        if not continuous:
            for channel, pitch in sorted(active):
                output[channel_stream_tracks[channel]].append(
                    MidiEvent(occurrence.performance_end, 0x80 | channel, bytes((pitch, 0)))
                )
            active.clear()

    conductor = [MidiEvent(Fraction(0), 0xFF, meta_type=0x51, tempo_bpm=plan.initial_tempo_bpm)]
    conductor.extend(
        MidiEvent(t.performance_position, 0xFF, meta_type=0x51, tempo_bpm=t.bpm)
        for t in plan.tempo_events
    )
    output[0][conductor_descriptors:conductor_descriptors] = conductor
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
