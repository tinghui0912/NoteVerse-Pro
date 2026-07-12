from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.config import settings
from app.processing.engines.soundfont import ensure_partitura_default_soundfont


@dataclass(frozen=True)
class SynthesizedAudio:
    content: bytes
    mime_type: str
    extension: str
    duration_ms: int
    generator: str
    generator_version: str


class FluidSynthAudioSynthesizer:
    """Synthesize MIDI into a bounded WAV asset using FluidSynth and a soundfont."""

    generator = "midi-fluidsynth-audio"
    generator_version = "1"

    def __init__(
        self,
        *,
        soundfont_path: str | None = None,
        sample_rate: int | None = None,
        max_duration_seconds: float | None = None,
    ) -> None:
        self.soundfont_path = soundfont_path or settings.PLAYBACK_SOUNDFONT_PATH
        self.sample_rate = sample_rate or settings.PLAYBACK_SAMPLE_RATE
        self.max_duration_seconds = (
            max_duration_seconds or settings.PLAYBACK_MAX_DURATION_SECONDS
        )

    def synthesize(self, midi: bytes) -> SynthesizedAudio:
        soundfont = self._soundfont()
        ensure_partitura_default_soundfont(str(soundfont))

        Path(settings.WORK_ROOT).mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=settings.WORK_ROOT) as work_dir:
            midi_path = Path(work_dir) / "score.mid"
            wav_path = Path(work_dir) / "score.wav"
            midi_path.write_bytes(midi)
            self._run_fluidsynth(soundfont, midi_path, wav_path)
            content = self._bounded_wav_content(wav_path)
            duration_ms = self._wav_duration_ms(content)

        return SynthesizedAudio(
            content=content,
            mime_type="audio/wav",
            extension=".wav",
            duration_ms=duration_ms,
            generator=self.generator,
            generator_version=self.generator_version,
        )

    def _soundfont(self) -> Path:
        if not self.soundfont_path:
            raise RuntimeError("PLAYBACK_SOUNDFONT_PATH is not configured")
        path = Path(self.soundfont_path).expanduser()
        if not path.is_file():
            raise RuntimeError(f"PLAYBACK_SOUNDFONT_PATH does not exist: {path}")
        return path

    def _run_fluidsynth(self, soundfont: Path, midi_path: Path, wav_path: Path) -> None:
        timeout = max(30.0, self.max_duration_seconds + 30.0)
        result = subprocess.run(
            [
                "fluidsynth",
                "-ni",
                "-F",
                str(wav_path),
                "-r",
                str(self.sample_rate),
                str(soundfont),
                str(midi_path),
            ],
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "unknown error").strip()
            raise RuntimeError(f"FluidSynth failed: {detail}")
        if not wav_path.is_file() or wav_path.stat().st_size == 0:
            raise RuntimeError("FluidSynth produced no audio")

    def _wav_duration_ms(self, content: bytes) -> int:
        import io
        import wave

        with wave.open(io.BytesIO(content), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
        if rate <= 0:
            return 0
        return int(frames / rate * 1000)

    def _bounded_wav_content(self, path: Path) -> bytes:
        import io
        import wave

        with wave.open(str(path), "rb") as source:
            params = source.getparams()
            max_frames = int(self.max_duration_seconds * params.framerate)
            frame_count = source.getnframes()
            frames = source.readframes(min(frame_count, max_frames))
        if frame_count <= max_frames:
            return path.read_bytes()

        output = io.BytesIO()
        with wave.open(output, "wb") as target:
            target.setparams(params)
            target.writeframes(frames)
        return output.getvalue()
