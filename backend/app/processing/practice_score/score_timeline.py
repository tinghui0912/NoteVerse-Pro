"""Canonical notation graph and chronological Practice moments for one revision."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
from pathlib import Path
import re
from typing import Any, Literal
import xml.etree.ElementTree as ET

from app.processing.practice_score.piano_key import PracticeScoreInvalidError, practice_piano_key

ScoreBeat = float
MeterSource = Literal["MUSICXML"]


@dataclass(frozen=True)
class PracticeScoreNote:
    note_id: str
    event_id: str
    piano_key: int
    render_note_id: str
    measure_number: str
    staff_id: str
    voice_id: str
    tie_types: tuple[str, ...]


@dataclass(frozen=True)
class PracticeScoreEvent:
    event_id: str
    onset_beat: ScoreBeat
    duration_beats: ScoreBeat


@dataclass(frozen=True)
class PracticeAttack:
    attack_id: str
    piano_key: int
    note_ids: tuple[str, ...]


@dataclass(frozen=True)
class PracticeMoment:
    group_id: str
    onset_beat: ScoreBeat
    canonical_end_beat: ScoreBeat
    attacks: tuple[PracticeAttack, ...]
    continuation_note_ids: tuple[str, ...]


@dataclass(frozen=True)
class PracticeMeterSegment:
    start_beat: ScoreBeat
    numerator: int
    denominator: int
    source: MeterSource = "MUSICXML"

    @property
    def measure_duration_beats(self) -> ScoreBeat:
        try:
            duration = _round_beat(self.numerator * 4.0 / self.denominator)
        except (OverflowError, ZeroDivisionError) as error:
            raise PracticeScoreInvalidError("Invalid Practice meter duration.") from error
        if not math.isfinite(duration) or duration <= 0:
            raise PracticeScoreInvalidError("Invalid Practice meter duration.")
        return duration

    @property
    def count_in_pulses(self) -> int:
        return self.numerator


@dataclass(frozen=True)
class PracticeScoreTimeline:
    notes: tuple[PracticeScoreNote, ...]
    events: tuple[PracticeScoreEvent, ...]
    moments: tuple[PracticeMoment, ...]
    first_playable_beat: ScoreBeat | None
    end_beat: ScoreBeat
    meter_segments: tuple[PracticeMeterSegment, ...]

    @classmethod
    def from_note_array(
        cls,
        note_array,
        *,
        meter_segments: tuple[PracticeMeterSegment, ...],
        musicxml_path: str | Path | None = None,
    ) -> "PracticeScoreTimeline":
        names = set(note_array.dtype.names or ())
        if not {"onset_beat", "duration_beat", "pitch", "id"} <= names:
            raise ValueError("Partitura note array is missing required columns.")
        metadata_by_id = _musicxml_note_metadata(musicxml_path)
        grouped: dict[tuple[ScoreBeat, ScoreBeat, str, str, bool], list[_TimelineNote]] = {}
        for raw in note_array:
            # Reject unsupported physical facts before any mode/scope projection.
            practice_piano_key(raw["pitch"])
            onset, duration = (
                _round_beat(float(raw["onset_beat"])),
                _round_beat(float(raw["duration_beat"])),
            )
            if not math.isfinite(onset) or not math.isfinite(duration) or duration < 0:
                raise PracticeScoreInvalidError("Invalid Practice note chronology.")
            metadata = metadata_by_id.get(_field_as_string(raw["id"]))
            voice = _voice_id(raw, metadata)
            staff = metadata.staff_id if metadata else ""
            continuation = metadata is not None and "stop" in metadata.tie_types
            grouped.setdefault((onset, duration, voice, staff, continuation), []).append(
                _TimelineNote(raw, metadata)
            )
        events: list[PracticeScoreEvent] = []
        notes: list[PracticeScoreNote] = []
        for index, (key, rows) in enumerate(
            sorted(
                grouped.items(),
                key=lambda item: (item[0][0], item[0][3], item[0][2], item[0][1], item[0][4]),
            )
        ):
            onset, duration, voice, staff, _ = key
            event_id = _stable_event_id(
                index, onset, duration, voice, staff, _event_semantic_locator(index, rows)
            )
            events.append(PracticeScoreEvent(event_id, onset, duration))
            for row in rows:
                render_id = _field_as_string(row.note["id"])
                metadata = row.metadata
                notes.append(
                    PracticeScoreNote(
                        note_id=f"{event_id}:{render_id}",
                        event_id=event_id,
                        piano_key=practice_piano_key(row.note["pitch"]),
                        render_note_id=render_id,
                        measure_number=metadata.measure_number if metadata else "",
                        staff_id=staff,
                        voice_id=voice,
                        tie_types=metadata.tie_types if metadata else (),
                    )
                )
        canonical_events, canonical_notes = tuple(events), tuple(notes)
        moments = _build_moments(canonical_notes, canonical_events)
        timeline = cls(
            notes=canonical_notes,
            events=canonical_events,
            moments=moments,
            first_playable_beat=events[0].onset_beat if events else None,
            end_beat=_round_beat(
                max((e.onset_beat + e.duration_beats for e in events), default=0.0)
            ),
            meter_segments=meter_segments,
        )
        assert_practice_timeline(timeline)
        return timeline

    @property
    def playable_onset_beats(self) -> tuple[ScoreBeat, ...]:
        return tuple(moment.onset_beat for moment in self.moments)

    def meter_at(self, beat: ScoreBeat) -> PracticeMeterSegment:
        if not self.meter_segments or self.meter_segments[0].start_beat != 0:
            raise PracticeScoreInvalidError("Practice requires explicit initial meter timing.")
        active = self.meter_segments[0]
        for segment in self.meter_segments:
            if segment.start_beat > max(0.0, float(beat)):
                break
            active = segment
        return active

    def count_in_duration_beats_at(self, beat: ScoreBeat) -> ScoreBeat:
        return self.meter_at(beat).measure_duration_beats

    def count_in_pulses_at(self, beat: ScoreBeat) -> int:
        return self.meter_at(beat).count_in_pulses


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
                _round_beat(
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
            <= current_event.onset_beat + current_event.duration_beats
        ]
        if not candidates:
            break
        current = min(candidates, key=lambda n: events[n.event_id].onset_beat)
        visited.add(current.note_id)
        e = events[current.event_id]
        end = max(end, e.onset_beat + e.duration_beats)
    return _round_beat(end)


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
    ].onset_beat or timeline.end_beat != _round_beat(
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
        expected_end = _round_beat(
            max(note_sounding_end_beat(notes[n], timeline.notes, events) for n in expected)
        )
        if moment.canonical_end_beat != expected_end:
            raise ValueError("Invalid canonical moment endpoint.")


@dataclass(frozen=True)
class _MusicXmlNoteMetadata:
    staff_id: str
    voice_id: str
    measure_number: str
    semantic_locator: str
    tie_types: tuple[str, ...]


@dataclass(frozen=True)
class _TimelineNote:
    note: Any
    metadata: _MusicXmlNoteMetadata | None


def _musicxml_note_metadata(path: str | Path | None) -> dict[str, _MusicXmlNoteMetadata]:
    if path is None:
        return {}
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError):
        return {}

    metadata: dict[str, _MusicXmlNoteMetadata] = {}
    for part_index, part in enumerate(_direct_children_by_local_name(root, "part"), start=1):
        for measure_index, measure in enumerate(
            _direct_children_by_local_name(part, "measure"),
            start=1,
        ):
            measure_number = measure.get("number", "")
            selectable_index = 0
            for element in list(measure):
                tag = _local_name(element.tag)
                if tag not in {"note", "forward"}:
                    continue
                selectable_index += 1
                if tag != "note":
                    continue
                note_id = element.get("id")
                if not note_id:
                    continue
                metadata[note_id] = _MusicXmlNoteMetadata(
                    staff_id=_child_text(element, "staff"),
                    voice_id=_child_text(element, "voice"),
                    measure_number=measure_number,
                    semantic_locator=f"p{part_index}-m{measure_index}-e{selectable_index}",
                    tie_types=tuple(
                        tie_type
                        for tie in element.findall("{*}tie")
                        if (tie_type := (tie.get("type") or "").strip())
                    ),
                )
    return metadata


def practice_meter_segments_from_musicxml(path: str | Path) -> tuple[PracticeMeterSegment, ...]:
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError) as error:
        raise PracticeScoreInvalidError("Practice meter timing cannot be read.") from error
    if any(_local_name(element.tag) == "senza-misura" for element in root.iter()):
        raise PracticeScoreInvalidError("Unmetered notation is unsupported for Practice.")

    first_part = next(iter(_direct_children_by_local_name(root, "part")), None)
    if first_part is None:
        raise PracticeScoreInvalidError("Practice requires initial part meter timing.")

    divisions = 1.0
    current_measure_duration_beats: float | None = None
    measure_start_beat = 0.0
    segments: list[PracticeMeterSegment] = []

    for measure in _direct_children_by_local_name(first_part, "measure"):
        cursor = 0.0
        measure_extent = 0.0
        for element in list(measure):
            tag = _local_name(element.tag)
            if tag == "attributes":
                if divisions_text := _child_text(element, "divisions"):
                    divisions = _positive_float_or_default(divisions_text, divisions)
                time = element.find("{*}time")
                if time is not None:
                    try:
                        numerator = int(_child_text(time, "beats"))
                        denominator = int(_child_text(time, "beat-type"))
                    except ValueError as error:
                        raise PracticeScoreInvalidError(
                            "Invalid Practice time signature."
                        ) from error
                    if numerator <= 0 or denominator <= 0 or cursor != 0:
                        raise PracticeScoreInvalidError("Invalid Practice time signature timing.")
                    meter = PracticeMeterSegment(
                        start_beat=_round_beat(measure_start_beat),
                        numerator=numerator,
                        denominator=denominator,
                    )
                    current_measure_duration_beats = meter.measure_duration_beats
                    segments.append(meter)
                continue

            if tag in {"note", "forward"}:
                cursor += _duration_beats(element, divisions)
                measure_extent = max(measure_extent, cursor)
            elif tag == "backup":
                cursor = max(0.0, cursor - _duration_beats(element, divisions))

        if current_measure_duration_beats is None:
            raise PracticeScoreInvalidError("Practice requires an explicit initial time signature.")
        measure_start_beat += (
            measure_extent if measure_extent > 0 else current_measure_duration_beats
        )

    if not segments or segments[0].start_beat != 0:
        raise PracticeScoreInvalidError("Practice requires explicit initial meter timing.")

    deduped: dict[ScoreBeat, PracticeMeterSegment] = {
        segment.start_beat: segment for segment in segments
    }
    return tuple(deduped[beat] for beat in sorted(deduped))


def _duration_beats(element: ET.Element, divisions: float) -> ScoreBeat:
    duration = _positive_float_or_default(_child_text(element, "duration"), 0.0)
    if duration <= 0 or divisions <= 0:
        return 0.0
    return _round_beat(duration / divisions)


def _positive_float_or_default(value: str, default: float) -> float:
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _direct_children_by_local_name(element: ET.Element, name: str) -> tuple[ET.Element, ...]:
    return tuple(child for child in list(element) if _local_name(child.tag) == name)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _voice_id(note: Any, metadata: _MusicXmlNoteMetadata | None) -> str:
    if metadata is not None and metadata.voice_id:
        return metadata.voice_id
    names = set(note.dtype.names or ())
    if "voice" in names:
        return _field_as_string(note["voice"])
    return ""


def _child_text(parent: ET.Element, child_name: str) -> str:
    child = parent.find(f"{{*}}{child_name}")
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _event_semantic_locator(index: int, notes: list[_TimelineNote]) -> str:
    for item in notes:
        if item.metadata is not None and item.metadata.semantic_locator:
            return item.metadata.semantic_locator
    return f"i{index}"


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


def _field_as_string(value: object) -> str:
    item = value.item() if hasattr(value, "item") else value
    return str(item)


def _round_beat(value: float) -> ScoreBeat:
    return round(value, 6)


def _safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_")
