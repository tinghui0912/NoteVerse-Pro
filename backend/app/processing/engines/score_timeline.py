from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import TypedDict


class ScoreTimelineEvent(TypedDict):
    event_index: int
    measure_index: int
    measure_number: int
    beat_position: float
    duration_beats: float
    is_rest: bool
    staff: int | None
    voice: str | None
    pitches: list[str]


class ScoreTimelineResult(TypedDict):
    events: list[ScoreTimelineEvent]
    total_events: int
    total_measures: int


class ScoreTimelineBuilder:
    """Build a simple event timeline from MusicXML."""

    def build_from_file(self, xml_path: str) -> ScoreTimelineResult:
        tree = ET.parse(xml_path)
        root = tree.getroot()

        events: list[ScoreTimelineEvent] = []
        event_index = 0
        measure_index = 0
        beat_cursor = 0.0
        divisions = 1

        for part in root.findall("part"):
            for measure in part.findall("measure"):
                measure_number = int(measure.get("number", str(measure_index + 1)))

                attributes = measure.find("attributes")
                if attributes is not None:
                    divisions_text = attributes.findtext("divisions")
                    if divisions_text:
                        divisions = max(int(divisions_text), 1)

                for note in measure.findall("note"):
                    duration_value = note.findtext("duration")
                    duration_divisions = int(duration_value) if duration_value else 0
                    duration_beats = duration_divisions / divisions if divisions else 0.0
                    is_chord = note.find("chord") is not None
                    event_beat_position = (
                        events[-1]["beat_position"] if is_chord and events else beat_cursor
                    )

                    is_rest = note.find("rest") is not None
                    if not is_rest:
                        pitch = self._build_pitch_token(note)
                        previous_event = events[-1] if events else None
                        should_merge_with_previous = (
                            previous_event is not None
                            and previous_event["measure_index"] == measure_index
                            and previous_event["beat_position"] == event_beat_position
                        )

                        if should_merge_with_previous:
                            if pitch:
                                previous_event["pitches"].append(pitch)
                        else:
                            events.append(
                                {
                                    "event_index": event_index,
                                    "measure_index": measure_index,
                                    "measure_number": measure_number,
                                    "beat_position": event_beat_position,
                                    "duration_beats": duration_beats,
                                    "is_rest": False,
                                    "staff": self._parse_int(note.findtext("staff")),
                                    "voice": note.findtext("voice"),
                                    "pitches": [pitch] if pitch else [],
                                }
                            )
                            event_index += 1

                    if not is_chord:
                        beat_cursor += duration_beats

                measure_index += 1

        return {
            "events": events,
            "total_events": len(events),
            "total_measures": measure_index,
        }

    @staticmethod
    def _build_pitch_token(note: ET.Element) -> str:
        pitch = note.find("pitch")
        if pitch is None:
            return ""

        step = pitch.findtext("step", "")
        octave = pitch.findtext("octave", "")
        alter = pitch.findtext("alter")
        accidental = ""
        if alter == "1":
            accidental = "#"
        elif alter == "-1":
            accidental = "b"

        return f"{step}{accidental}{octave}"

    @staticmethod
    def _parse_int(value: str | None) -> int | None:
        if value is None:
            return None
        return int(value)


score_timeline_builder = ScoreTimelineBuilder()
