"""Project written-axis MIDI encounters through one canonical performance plan."""

from dataclasses import replace
from fractions import Fraction

from app.score_semantics.performance_plan import CanonicalPerformancePlan
from app.score_semantics.written_point import WrittenPoint

from .standard_midi import MidiEvent, MidiRepresentationError, StandardMidiFile, exact_output_ppq
from .midi_event_semantics import MidiMetaRole, classify_meta_event, is_note_on, is_note_off
from .written_midi_streams import (
    WrittenMidiStreamId,
    read_written_midi_streams,
    allocate_output_channels,
    route_stream_event,
)


def _owner(event: MidiEvent, plan: CanonicalPerformancePlan) -> int:
    spans = plan.projection.written_spans
    candidates = [i for i, (start, end) in enumerate(spans) if start <= event.position <= end]
    if not candidates:
        raise MidiRepresentationError("midi_event_outside_written_score")
    if is_note_off(event):
        return candidates[0]
    if is_note_on(event):
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
    streams = read_written_midi_streams(written)
    pairs = streams.note_pairs
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
    active: dict[tuple[WrittenMidiStreamId, int], tuple[int, int]] = {}
    occurrences = plan.projection.occurrences
    for ordinal, occurrence in enumerate(occurrences):
        for track, index, event in by_measure.get(occurrence.measure_index, ()):
            if not occurrence.written_start <= event.position <= occurrence.written_end:
                continue
            if is_note_on(event) and event.position == occurrence.written_end:
                continue  # An onset needs performed duration, not just an endpoint.
            stream = WrittenMidiStreamId(track, event.status & 15)
            key = (stream, event.data[0]) if event.status < 0xF0 else None
            if is_note_on(event):
                assert key is not None
                if key in active:
                    raise MidiRepresentationError("ambiguous_performed_midi_note")
                active[key] = pairs[(track, index)]
            elif is_note_off(event):
                assert key is not None
                if active.get(key) != pairs[(track, index)]:
                    continue  # Its onset was skipped by an entry or terminated at a cut.
                del active[key]
            elif event.status & 0xF0 == 0xB0 and event.data[0] in (120, 123):
                active = {k: v for k, v in active.items() if k[0] != stream}
            projected = replace(event, position=occurrence.project_position(event.position))
            output[track].append(projected)
        next_occurrence = occurrences[ordinal + 1] if ordinal + 1 < len(occurrences) else None
        continuous = (
            next_occurrence is not None
            and next_occurrence.measure_index == occurrence.measure_index + 1
            and occurrence.written_end == next_occurrence.written_start
        )
        if not continuous:
            for stream, pitch in sorted(active):
                release = MidiEvent(
                    occurrence.performance_end, 0x80 | stream.source_channel, bytes((pitch, 0))
                )
                output[stream.source_track_index].append(release)
            active.clear()

    assignments = allocate_output_channels(
        WrittenMidiStreamId(track, event.status & 15)
        for track, projected_track in enumerate(output)
        for event in projected_track
        if event.status < 0xF0
    )
    for track, projected_track in enumerate(output):
        output[track] = [
            route_stream_event(event, WrittenMidiStreamId(track, event.status & 15), assignments)
            if event.status < 0xF0
            else event
            for event in projected_track
        ]

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
