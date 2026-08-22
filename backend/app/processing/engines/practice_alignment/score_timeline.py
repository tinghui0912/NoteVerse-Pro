"""Minimal music-domain timeline for practice score following."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any
import xml.etree.ElementTree as ET


ScoreBeat = float


@dataclass(frozen=True)
class PracticeScoreEvent:
    event_id: str
    onset_beat: ScoreBeat
    duration_beats: ScoreBeat
    pitches: tuple[str, ...]
    render_note_ids: tuple[str, ...]
    measure_numbers: tuple[str, ...]
    staff_ids: tuple[str, ...]
    voice_ids: tuple[str, ...]
    tie_types: tuple[str, ...]
    playable: bool
    entry_candidate: bool


@dataclass(frozen=True)
class PracticeEntryGroup:
    group_id: str
    onset_beat: ScoreBeat
    event_ids: tuple[str, ...]
    render_note_ids: tuple[str, ...]
    entry_candidate: bool


@dataclass(frozen=True)
class PracticeScoreTimeline:
    events: tuple[PracticeScoreEvent, ...]
    entry_groups: tuple[PracticeEntryGroup, ...]
    first_playable_event_id: str | None
    first_playable_beat: ScoreBeat | None
    end_beat: ScoreBeat

    @classmethod
    def from_note_array(
        cls,
        note_array,
        *,
        musicxml_path: str | Path | None = None,
    ) -> "PracticeScoreTimeline":
        names = set(note_array.dtype.names or ())
        if not {"onset_beat", "duration_beat", "pitch", "id"} <= names:
            return cls(
                events=(),
                entry_groups=(),
                first_playable_event_id=None,
                first_playable_beat=None,
                end_beat=0.0,
            )

        note_metadata = _musicxml_note_metadata(musicxml_path)
        grouped: dict[tuple[ScoreBeat, ScoreBeat, str, str], list[_TimelineNote]] = {}
        for note in note_array:
            onset_beat = _round_beat(float(note["onset_beat"]))
            duration_beats = _round_beat(float(note["duration_beat"]))
            note_id = _field_as_string(note["id"])
            metadata = note_metadata.get(note_id)
            voice_id = _voice_id(note, metadata)
            staff_id = metadata.staff_id if metadata is not None else ""
            grouped.setdefault((onset_beat, duration_beats, voice_id, staff_id), []).append(
                _TimelineNote(note=note, metadata=metadata)
            )

        events = tuple(
            _event_from_notes(index, key, notes)
            for index, (key, notes) in enumerate(
                sorted(grouped.items(), key=lambda item: (item[0][0], item[0][3], item[0][2]))
            )
        )
        entry_groups = _build_entry_groups(events)
        first_playable = next((event for event in events if event.playable), None)
        end_beat = max(
            (event.onset_beat + event.duration_beats for event in events if event.playable),
            default=0.0,
        )
        return cls(
            events=events,
            entry_groups=entry_groups,
            first_playable_event_id=None if first_playable is None else first_playable.event_id,
            first_playable_beat=None if first_playable is None else first_playable.onset_beat,
            end_beat=_round_beat(end_beat),
        )

    @property
    def playable_onset_beats(self) -> tuple[ScoreBeat, ...]:
        return tuple(group.onset_beat for group in self.entry_groups if group.entry_candidate)

    def entry_group_at_or_near(self, beat: ScoreBeat) -> PracticeEntryGroup | None:
        if not self.entry_groups:
            return None
        return min(self.entry_groups, key=lambda group: abs(group.onset_beat - beat))


@dataclass(frozen=True)
class _MusicXmlNoteMetadata:
    staff_id: str
    voice_id: str
    measure_number: str
    tie_types: tuple[str, ...]


@dataclass(frozen=True)
class _TimelineNote:
    note: Any
    metadata: _MusicXmlNoteMetadata | None


def _build_entry_groups(events: tuple[PracticeScoreEvent, ...]) -> tuple[PracticeEntryGroup, ...]:
    grouped: dict[ScoreBeat, list[PracticeScoreEvent]] = {}
    for event in events:
        if not event.entry_candidate:
            continue
        grouped.setdefault(event.onset_beat, []).append(event)

    groups: list[PracticeEntryGroup] = []
    for index, onset_beat in enumerate(sorted(grouped)):
        events_at_beat = grouped[onset_beat]
        groups.append(
            PracticeEntryGroup(
                group_id=f"entry-{index}",
                onset_beat=onset_beat,
                event_ids=tuple(event.event_id for event in events_at_beat),
                render_note_ids=tuple(
                    dict.fromkeys(
                        note_id for event in events_at_beat for note_id in event.render_note_ids
                    )
                ),
                entry_candidate=True,
            )
        )
    return tuple(groups)


def _event_from_notes(
    index: int,
    key: tuple[ScoreBeat, ScoreBeat, str, str],
    notes: list[_TimelineNote],
) -> PracticeScoreEvent:
    onset_beat, duration_beats, voice_id, staff_id = key
    render_note_ids = tuple(_field_as_string(item.note["id"]) for item in notes)
    pitches = tuple(_midi_pitch_name(int(item.note["pitch"])) for item in notes)
    measure_numbers = tuple(
        dict.fromkeys(
            item.metadata.measure_number
            for item in notes
            if item.metadata is not None and item.metadata.measure_number
        )
    )
    tie_types = tuple(
        dict.fromkeys(
            tie_type
            for item in notes
            if item.metadata is not None
            for tie_type in item.metadata.tie_types
        )
    )
    entry_candidate = any(not _is_pure_tie_continuation(item.metadata) for item in notes)
    event_id = _stable_event_id(index, onset_beat, voice_id, staff_id, render_note_ids)
    return PracticeScoreEvent(
        event_id=event_id,
        onset_beat=onset_beat,
        duration_beats=duration_beats,
        pitches=pitches,
        render_note_ids=render_note_ids,
        measure_numbers=measure_numbers,
        staff_ids=() if not staff_id else (staff_id,),
        voice_ids=() if not voice_id else (voice_id,),
        tie_types=tie_types,
        playable=True,
        entry_candidate=entry_candidate,
    )


def _musicxml_note_metadata(path: str | Path | None) -> dict[str, _MusicXmlNoteMetadata]:
    if path is None:
        return {}
    try:
        root = ET.parse(path).getroot()
    except (OSError, ET.ParseError):
        return {}

    metadata: dict[str, _MusicXmlNoteMetadata] = {}
    for measure in root.findall(".//{*}measure"):
        measure_number = measure.get("number", "")
        for note in measure.findall("{*}note"):
            note_id = note.get("id")
            if not note_id:
                continue
            metadata[note_id] = _MusicXmlNoteMetadata(
                staff_id=_child_text(note, "staff"),
                voice_id=_child_text(note, "voice"),
                measure_number=measure_number,
                tie_types=tuple(
                    tie_type
                    for tie in note.findall("{*}tie")
                    if (tie_type := (tie.get("type") or "").strip())
                ),
            )
    return metadata


def _is_pure_tie_continuation(metadata: _MusicXmlNoteMetadata | None) -> bool:
    if metadata is None:
        return False
    tie_types = set(metadata.tie_types)
    return "stop" in tie_types and "start" not in tie_types


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


def _stable_event_id(
    index: int,
    onset_beat: ScoreBeat,
    voice_id: str,
    staff_id: str,
    render_note_ids: tuple[str, ...],
) -> str:
    first_note_id = render_note_ids[0] if render_note_ids else f"event-{index}"
    parts = ["event", _safe_id(str(onset_beat)), _safe_id(staff_id), _safe_id(voice_id), first_note_id]
    return "-".join(part for part in parts if part)


def _field_as_string(value: object) -> str:
    item = value.item() if hasattr(value, "item") else value
    return str(item)


def _round_beat(value: float) -> ScoreBeat:
    return round(value, 6)


def _safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_")


def _midi_pitch_name(pitch: int) -> str:
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    octave = pitch // 12 - 1
    return f"{names[pitch % 12]}{octave}"
