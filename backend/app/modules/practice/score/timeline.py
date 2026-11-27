"""Canonical event/moment projection of compiler-owned note positions."""

from __future__ import annotations
import hashlib
import re
from .domain import (
    CompiledPracticeScore,
    CompiledPracticeNote,
    PracticeScoreTimeline,
    PracticeScoreNote,
    PracticeScoreEvent,
    PracticeMoment,
    PracticeAttack,
    ScoreTick,
)
from .time import score_tick, ticks_per_quarter, PracticeScoreTimebase
from .piano_key import PracticeScoreInvalidError, practice_piano_key


def practice_timeline_from_compiled(compiled: CompiledPracticeScore) -> PracticeScoreTimeline:
    grouped: dict[tuple[int, int, str, str, bool], list[CompiledPracticeNote]] = {}
    for note in compiled.notes:
        practice_piano_key(note.piano_key)
        score_tick(note.onset_tick)
        score_tick(note.duration_ticks)
        score_tick(note.onset_tick + note.duration_ticks)
        grouped.setdefault(
            (
                note.onset_tick,
                note.duration_ticks,
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
        compiled.score_end_tick,
        compiled.timebase.ticks_per_quarter,
        compiled.meter_segments,
    )
    assert_practice_timeline(timeline)
    return timeline


def _build_moments(
    notes: tuple[PracticeScoreNote, ...], events: tuple[PracticeScoreEvent, ...]
) -> tuple[PracticeMoment, ...]:
    event_by_id = {event.event_id: event for event in events}
    by_onset: dict[ScoreTick, list[PracticeScoreNote]] = {}
    for note in notes:
        by_onset.setdefault(event_by_id[note.event_id].onset_tick, []).append(note)
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
                max(note_sounding_end_tick(note, notes, event_by_id) for note in attack_notes),
                tuple(
                    PracticeAttack(f"{group_id}:strike:{key}", key, tuple(ids))
                    for key, ids in by_key.items()
                ),
                tuple(note.note_id for note in onset_notes if "stop" in note.tie_types),
            )
        )
    return tuple(moments)


def note_sounding_end_tick(
    note: PracticeScoreNote,
    notes: tuple[PracticeScoreNote, ...],
    events: dict[str, PracticeScoreEvent],
) -> ScoreTick:
    current = note
    event = events[note.event_id]
    end = event.onset_tick + event.duration_ticks
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
            and current_event.onset_tick
            <= events[n.event_id].onset_tick
            <= current_event.onset_tick + current_event.duration_ticks
        ]
        if not candidates:
            break
        current = min(candidates, key=lambda n: events[n.event_id].onset_tick)
        visited.add(current.note_id)
        e = events[current.event_id]
        end = max(end, e.onset_tick + e.duration_ticks)
    return end


def assert_practice_timeline(timeline: PracticeScoreTimeline) -> None:
    """Validate canonical identities, references, chronology and complete physical membership."""
    if not timeline.notes or not timeline.events or not timeline.moments:
        raise PracticeScoreInvalidError("Score has no playable Practice targets.")
    if not timeline.meter_segments or timeline.meter_segments[0].start_tick != 0:
        raise PracticeScoreInvalidError("Practice requires explicit initial meter timing.")
    ticks_per_quarter(timeline.ticks_per_quarter)
    score_tick(timeline.score_end_tick)
    previous_meter = -1
    for meter in timeline.meter_segments:
        if (
            type(meter.start_tick) is not int
            or meter.start_tick < 0
            or meter.start_tick <= previous_meter
        ):
            raise PracticeScoreInvalidError("Invalid Practice meter timing.")
        _ = meter.measure_duration_ticks(timeline.ticks_per_quarter)
        PracticeScoreTimebase(timeline.ticks_per_quarter).meter_pulse_ticks(meter.denominator)
        score_tick(meter.start_tick)
        if meter.start_tick > timeline.score_end_tick:
            raise PracticeScoreInvalidError("Meter lies outside Practice score.")
        previous_meter = meter.start_tick
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
    previous = -1
    for event in timeline.events:
        if (
            not event.event_id
            or type(event.onset_tick) is not int
            or event.onset_tick < previous
            or type(event.duration_ticks) is not int
            or event.duration_ticks < 0
        ):
            raise ValueError("Invalid canonical event chronology.")
        score_tick(event.onset_tick)
        score_tick(event.duration_ticks)
        score_tick(event.onset_tick + event.duration_ticks)
        if not any(n.event_id == event.event_id for n in timeline.notes):
            raise ValueError("Canonical event has no notation owner.")
        previous = event.onset_tick
    if timeline.score_end_tick < max(e.onset_tick + e.duration_ticks for e in timeline.events):
        raise ValueError("Canonical score extent differs from event chronology.")
    expected_onsets = sorted(
        {events[n.event_id].onset_tick for n in timeline.notes if "stop" not in n.tie_types}
    )
    if [m.onset_tick for m in timeline.moments] != expected_onsets:
        raise ValueError("Practice moments do not cover chronological attacks exactly.")
    if len({m.group_id for m in timeline.moments}) != len(timeline.moments):
        raise ValueError("Duplicate Practice moment identity.")
    attack_ids: set[str] = set()
    for moment in timeline.moments:
        if not moment.group_id or not moment.attacks or type(moment.canonical_end_tick) is not int:
            raise ValueError("Invalid Practice moment.")
        score_tick(moment.onset_tick)
        score_tick(moment.canonical_end_tick)
        if moment.canonical_end_tick > timeline.score_end_tick:
            raise PracticeScoreInvalidError("Moment lies outside Practice score.")
        expected = {
            n.note_id
            for n in timeline.notes
            if events[n.event_id].onset_tick == moment.onset_tick and "stop" not in n.tie_types
        }
        continuation = {
            n.note_id
            for n in timeline.notes
            if events[n.event_id].onset_tick == moment.onset_tick and "stop" in n.tie_types
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
        expected_end = max(
            note_sounding_end_tick(notes[n], timeline.notes, events) for n in expected
        )
        if moment.canonical_end_tick != expected_end:
            raise ValueError("Invalid canonical moment endpoint.")


def _stable_event_id(
    index: int,
    onset_tick: ScoreTick,
    duration_ticks: ScoreTick,
    voice_id: str,
    staff_id: str,
    semantic_locator: str,
) -> str:
    parts = [
        "event",
        _safe_id(str(onset_tick)),
        _safe_id(str(duration_ticks)),
        _safe_id(staff_id),
        _safe_id(voice_id),
        _safe_id(semantic_locator or f"i{index}"),
    ]
    return "-".join(part for part in parts if part)


def _stable_entry_group_id(onset_tick: ScoreTick, event_ids: tuple[str, ...]) -> str:
    identity = "|".join((str(onset_tick), *event_ids))
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:12]
    return f"entry-{_safe_id(str(onset_tick))}-{digest}"


def _safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_")
