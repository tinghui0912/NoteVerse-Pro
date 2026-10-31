"""Canonical event/moment projection of compiler-owned note positions."""

from __future__ import annotations
import hashlib
import math
import re
from .domain import (
    CompiledPracticeScore,
    CompiledPracticeNote,
    PracticeScoreTimeline,
    PracticeScoreNote,
    PracticeScoreEvent,
    PracticeMoment,
    PracticeAttack,
    ScoreBeat,
    canonical_beat,
)
from .piano_key import PracticeScoreInvalidError, practice_piano_key


def practice_timeline_from_compiled(compiled: CompiledPracticeScore) -> PracticeScoreTimeline:
    grouped: dict[tuple[float, float, str, str, bool], list[CompiledPracticeNote]] = {}
    for note in compiled.notes:
        practice_piano_key(note.piano_key)
        if (
            not math.isfinite(note.onset_beat)
            or not math.isfinite(note.duration_beats)
            or note.duration_beats < 0
        ):
            raise PracticeScoreInvalidError("Invalid Practice note chronology.")
        grouped.setdefault(
            (
                note.onset_beat,
                note.duration_beats,
                note.voice_id,
                note.staff_id,
                "stop" in note.tie_types,
            ),
            [],
        ).append(note)
    events: list[PracticeScoreEvent] = []
    notes: list[PracticeScoreNote] = []
    for index, (key, rows) in enumerate(
        sorted(
            grouped.items(),
            key=lambda item: (item[0][0], item[0][3], item[0][2], item[0][1], item[0][4]),
        )
    ):
        onset, duration, voice, staff, _ = key
        event_id = _stable_event_id(index, onset, duration, voice, staff, rows[0].semantic_locator)
        events.append(PracticeScoreEvent(event_id, onset, duration))
        for row in rows:
            notes.append(
                PracticeScoreNote(
                    f"{event_id}:{row.render_note_id}",
                    event_id,
                    row.piano_key,
                    row.render_note_id,
                    row.measure_number,
                    staff,
                    voice,
                    row.tie_types,
                )
            )
    timeline = PracticeScoreTimeline(
        tuple(notes),
        tuple(events),
        _build_moments(tuple(notes), tuple(events)),
        events[0].onset_beat if events else None,
        canonical_beat(max((e.onset_beat + e.duration_beats for e in events), default=0.0)),
        compiled.meter_segments,
    )
    assert_practice_timeline(timeline)
    return timeline


def _build_moments(
    notes: tuple[PracticeScoreNote, ...], events: tuple[PracticeScoreEvent, ...]
) -> tuple[PracticeMoment, ...]:
    event_by_id = {event.event_id: event for event in events}
    by_onset: dict[ScoreBeat, list[PracticeScoreNote]] = {}
    for note in notes:
        by_onset.setdefault(event_by_id[note.event_id].onset_beat, []).append(note)
    moments = []
    for onset, onset_notes in sorted(by_onset.items()):
        attack_notes = [note for note in onset_notes if "stop" not in note.tie_types]
        if not attack_notes:
            # Pure tie onsets remain in the notation/event graph, not learning targets.
            continue
        event_ids = tuple(dict.fromkeys(note.event_id for note in attack_notes))
        group_id = _stable_entry_group_id(onset, event_ids)
        by_key: dict[int, list[str]] = {}
        for note in attack_notes:
            by_key.setdefault(note.piano_key, []).append(note.note_id)
        moments.append(
            PracticeMoment(
                group_id,
                onset,
                canonical_beat(
                    max(note_sounding_end_beat(note, notes, event_by_id) for note in attack_notes)
                ),
                tuple(
                    PracticeAttack(f"{group_id}:strike:{key}", key, tuple(ids))
                    for key, ids in by_key.items()
                ),
                tuple(note.note_id for note in onset_notes if "stop" in note.tie_types),
            )
        )
    return tuple(moments)


def note_sounding_end_beat(
    note: PracticeScoreNote,
    notes: tuple[PracticeScoreNote, ...],
    events: dict[str, PracticeScoreEvent],
) -> ScoreBeat:
    current = note
    event = events[note.event_id]
    end = event.onset_beat + event.duration_beats
    visited = {note.note_id}
    while "start" in current.tie_types:
        current_event = events[current.event_id]
        candidates = [
            n
            for n in notes
            if n.note_id not in visited
            and "stop" in n.tie_types
            and n.piano_key == current.piano_key
            and n.staff_id == current.staff_id
            and n.voice_id == current.voice_id
            and current_event.onset_beat
            <= events[n.event_id].onset_beat
            <= canonical_beat(current_event.onset_beat + current_event.duration_beats)
        ]
        if not candidates:
            break
        current = min(candidates, key=lambda n: events[n.event_id].onset_beat)
        visited.add(current.note_id)
        e = events[current.event_id]
        end = max(end, e.onset_beat + e.duration_beats)
    return canonical_beat(end)


def assert_practice_timeline(timeline: PracticeScoreTimeline) -> None:
    """Validate canonical identities, references, chronology and complete physical membership."""
    if not timeline.notes or not timeline.events or not timeline.moments:
        raise PracticeScoreInvalidError("Score has no playable Practice targets.")
    if not timeline.meter_segments or timeline.meter_segments[0].start_beat != 0:
        raise PracticeScoreInvalidError("Practice requires explicit initial meter timing.")
    previous_meter = -math.inf
    for meter in timeline.meter_segments:
        if (
            not math.isfinite(meter.start_beat)
            or meter.start_beat < 0
            or meter.start_beat <= previous_meter
            or type(meter.numerator) is not int
            or meter.numerator <= 0
            or type(meter.denominator) is not int
            or meter.denominator <= 0
            or not math.isfinite(meter.measure_duration_beats)
            or meter.measure_duration_beats <= 0
            or type(meter.count_in_pulses) is not int
            or meter.count_in_pulses < 0
            or meter.source != "MUSICXML"
        ):
            raise PracticeScoreInvalidError("Invalid Practice meter timing.")
        previous_meter = meter.start_beat
    notes = {n.note_id: n for n in timeline.notes}
    events = {e.event_id: e for e in timeline.events}
    if len(notes) != len(timeline.notes) or len(events) != len(timeline.events):
        raise ValueError("Duplicate canonical note/event identity.")
    if len({n.render_note_id for n in timeline.notes}) != len(timeline.notes):
        raise ValueError("Duplicate Practice render identity.")
    for note in timeline.notes:
        practice_piano_key(note.piano_key)
        if not note.note_id or not note.render_note_id or note.event_id not in events:
            raise ValueError("Missing or dangling Practice notation identity.")
        if len(set(note.tie_types)) != len(note.tie_types) or any(
            t not in {"start", "stop"} for t in note.tie_types
        ):
            raise ValueError("Invalid canonical tie facts.")
    previous = -math.inf
    for event in timeline.events:
        if (
            not event.event_id
            or not math.isfinite(event.onset_beat)
            or event.onset_beat < previous
            or not math.isfinite(event.duration_beats)
            or event.duration_beats < 0
        ):
            raise ValueError("Invalid canonical event chronology.")
        if not any(n.event_id == event.event_id for n in timeline.notes):
            raise ValueError("Canonical event has no notation owner.")
        previous = event.onset_beat
    if timeline.first_playable_beat != timeline.events[
        0
    ].onset_beat or timeline.end_beat != canonical_beat(
        max(e.onset_beat + e.duration_beats for e in timeline.events)
    ):
        raise ValueError("Canonical score extent differs from event chronology.")
    expected_onsets = sorted(
        {events[n.event_id].onset_beat for n in timeline.notes if "stop" not in n.tie_types}
    )
    if [m.onset_beat for m in timeline.moments] != expected_onsets:
        raise ValueError("Practice moments do not cover chronological attacks exactly.")
    if len({m.group_id for m in timeline.moments}) != len(timeline.moments):
        raise ValueError("Duplicate Practice moment identity.")
    attack_ids: set[str] = set()
    for moment in timeline.moments:
        if (
            not moment.group_id
            or not moment.attacks
            or not math.isfinite(moment.canonical_end_beat)
        ):
            raise ValueError("Invalid Practice moment.")
        expected = {
            n.note_id
            for n in timeline.notes
            if events[n.event_id].onset_beat == moment.onset_beat and "stop" not in n.tie_types
        }
        continuation = {
            n.note_id
            for n in timeline.notes
            if events[n.event_id].onset_beat == moment.onset_beat and "stop" in n.tie_types
        }
        owned: set[str] = set()
        keys: set[int] = set()
        for attack in moment.attacks:
            practice_piano_key(attack.piano_key)
            if (
                not attack.attack_id
                or attack.attack_id in attack_ids
                or attack.piano_key in keys
                or not attack.note_ids
            ):
                raise ValueError("Duplicate or empty physical attack.")
            attack_ids.add(attack.attack_id)
            keys.add(attack.piano_key)
            for note_id in attack.note_ids:
                if (
                    note_id not in expected
                    or note_id in owned
                    or notes[note_id].piano_key != attack.piano_key
                ):
                    raise ValueError("Invalid physical attack note ownership.")
                owned.add(note_id)
        if owned != expected:
            raise ValueError("Missing physical attack note reference.")
        if (
            len(set(moment.continuation_note_ids)) != len(moment.continuation_note_ids)
            or set(moment.continuation_note_ids) != continuation
        ):
            raise ValueError("Invalid continuation note ownership.")
        expected_end = canonical_beat(
            max(note_sounding_end_beat(notes[n], timeline.notes, events) for n in expected)
        )
        if moment.canonical_end_beat != expected_end:
            raise ValueError("Invalid canonical moment endpoint.")


def _stable_event_id(
    index: int,
    onset_beat: ScoreBeat,
    duration_beats: ScoreBeat,
    voice_id: str,
    staff_id: str,
    semantic_locator: str,
) -> str:
    parts = [
        "event",
        _safe_id(str(onset_beat)),
        _safe_id(str(duration_beats)),
        _safe_id(staff_id),
        _safe_id(voice_id),
        _safe_id(semantic_locator or f"i{index}"),
    ]
    return "-".join(part for part in parts if part)


def _stable_entry_group_id(onset_beat: ScoreBeat, event_ids: tuple[str, ...]) -> str:
    identity = "|".join((str(onset_beat), *event_ids))
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:12]
    return f"entry-{_safe_id(str(onset_beat))}-{digest}"


def _safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_")
