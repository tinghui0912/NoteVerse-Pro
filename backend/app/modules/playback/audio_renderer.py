from __future__ import annotations

import io
import math
import struct
import wave
import xml.etree.ElementTree as ET
from dataclasses import dataclass


@dataclass(frozen=True)
class RenderedAudio:
    content: bytes
    mime_type: str
    extension: str
    duration_ms: int
    generator: str
    generator_version: str


class MusicXmlAudioRenderer:
    """Generate a bounded audio preview from MusicXML without exposing score structure."""

    sample_rate = 22_050
    max_duration_seconds = 180.0
    generator = "musicxml-audio-preview"
    generator_version = "1"

    def render(self, content: bytes) -> RenderedAudio:
        root = ET.fromstring(content)
        events = self._events(root)
        if not events:
            events = [([440.0], 0.25), ([], 0.25)]
        total_seconds = min(sum(duration for _, duration in events), self.max_duration_seconds)
        wav = self._wav(events, total_seconds)
        return RenderedAudio(
            content=wav,
            mime_type="audio/wav",
            extension=".wav",
            duration_ms=int(total_seconds * 1000),
            generator=self.generator,
            generator_version=self.generator_version,
        )

    def _events(self, root: ET.Element) -> list[tuple[list[float], float]]:
        events: list[tuple[list[float], float]] = []
        divisions = 1
        tempo = 120.0
        elapsed = 0.0
        for measure in root.findall(".//{*}part/{*}measure"):
            attributes = measure.find("{*}attributes/{*}divisions")
            if attributes is not None and attributes.text:
                try:
                    divisions = max(1, int(attributes.text.strip()))
                except ValueError:
                    divisions = 1
            sound = measure.find("{*}sound")
            if sound is not None and sound.get("tempo"):
                try:
                    tempo = max(20.0, float(sound.get("tempo", "120")))
                except ValueError:
                    tempo = 120.0
            for note in measure.findall("{*}note"):
                event = self._note_event(note, divisions, tempo)
                if event is None:
                    continue
                frequencies, seconds = event
                if elapsed + seconds > self.max_duration_seconds:
                    seconds = max(0.0, self.max_duration_seconds - elapsed)
                if seconds <= 0:
                    break

                if note.find("{*}chord") is not None and events:
                    previous_freqs, previous_duration = events[-1]
                    previous_freqs.extend(frequencies)
                    events[-1] = (previous_freqs, max(previous_duration, seconds))
                else:
                    events.append((frequencies, seconds))
                elapsed += seconds
                if elapsed >= self.max_duration_seconds:
                    break
            if elapsed >= self.max_duration_seconds:
                break
        return events

    def _note_event(
        self, note: ET.Element, divisions: int, tempo: float
    ) -> tuple[list[float], float] | None:
        duration_node = note.find("{*}duration")
        if duration_node is None or not duration_node.text:
            return None
        try:
            duration_units = max(1, int(duration_node.text.strip()))
        except ValueError:
            return None
        seconds = duration_units / divisions * (60.0 / tempo)
        frequency = self._frequency(note)
        return ([frequency] if frequency is not None else [], seconds)

    @staticmethod
    def _frequency(note: ET.Element) -> float | None:
        if note.find("{*}rest") is not None:
            return None
        pitch = note.find("{*}pitch")
        if pitch is None:
            return None
        step_node = pitch.find("{*}step")
        octave_node = pitch.find("{*}octave")
        if step_node is None or octave_node is None or not step_node.text or not octave_node.text:
            return None
        semitone_by_step = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
        step = step_node.text.strip().upper()
        if step not in semitone_by_step:
            return None
        try:
            octave = int(octave_node.text.strip())
            alter_node = pitch.find("{*}alter")
            alter = (
                int(alter_node.text.strip())
                if alter_node is not None and alter_node.text
                else 0
            )
        except ValueError:
            return None
        midi = (octave + 1) * 12 + semitone_by_step[step] + alter
        return 440.0 * (2 ** ((midi - 69) / 12))

    def _wav(self, events: list[tuple[list[float], float]], total_seconds: float) -> bytes:
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(self.sample_rate)
            written = 0
            max_samples = int(total_seconds * self.sample_rate)
            for frequencies, duration in events:
                frame_count = min(int(duration * self.sample_rate), max_samples - written)
                if frame_count <= 0:
                    break
                for index in range(frame_count):
                    value = 0.0
                    if frequencies:
                        for frequency in frequencies[:6]:
                            phase = 2 * math.pi * frequency * (index / self.sample_rate)
                            value += math.sin(phase)
                        value = value / len(frequencies[:6]) * 0.22
                    sample = int(max(-1.0, min(1.0, value)) * 32767)
                    wav.writeframesraw(struct.pack("<h", sample))
                written += frame_count
        return output.getvalue()
