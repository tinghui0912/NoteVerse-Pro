from __future__ import annotations

import wave
from io import BytesIO
from types import SimpleNamespace

from app.processing.engines.playback import (
    CompiledMidi,
    FluidSynthAudioRenderer,
    FluidSynthAudioSynthesizer,
    PlaybackProfile,
)


MUSICXML = b"""<?xml version='1.0'?><score-partwise version='4.0'>
<part-list><score-part id='P1'><part-name>Piano</part-name></score-part></part-list>
<part id='P1'><measure number='1'><sound tempo='96'/>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
</measure></part></score-partwise>"""


def _wav_bytes(sample_rate: int = 4) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00\x01\x00\xff\xff\x00\x00")
    return output.getvalue()


def test_renderer_compiles_musicxml_to_midi_before_synthesizing_audio() -> None:
    calls: dict[str, object] = {}

    class FakeMidiCompiler:
        def compile(self, content: bytes) -> CompiledMidi:
            calls["musicxml"] = content
            return CompiledMidi(
                content=b"MThd-midi",
                generator="test-midi",
                generator_version="1",
            )

    class FakeAudioSynthesizer:
        def synthesize(self, midi: bytes):
            calls["midi"] = midi
            return SimpleNamespace(
                content=_wav_bytes(),
                mime_type="audio/wav",
                extension=".wav",
                duration_ms=1000,
                generator="test-audio",
                generator_version="1",
                soundfont_sha256="a" * 64,
            )

    rendered = FluidSynthAudioRenderer(
        midi_compiler=FakeMidiCompiler(),
        audio_synthesizer=FakeAudioSynthesizer(),
    ).render(MUSICXML)

    assert calls == {"musicxml": MUSICXML, "midi": b"MThd-midi"}
    assert rendered.mime_type == "audio/wav"
    assert rendered.extension == ".wav"
    assert rendered.duration_ms == 1000
    assert rendered.generator == "musicxml-verovio-fluidsynth-preview"
    assert rendered.soundfont_sha256 == "a" * 64


def test_fluidsynth_synthesizer_uses_configured_soundfont_and_sample_rate(
    monkeypatch, tmp_path
) -> None:
    soundfont = tmp_path / "piano.sf2"
    soundfont.write_bytes(b"soundfont")
    calls: dict[str, object] = {}

    def fake_run(args, *, capture_output, check, text, timeout):
        calls["args"] = args
        calls["timeout"] = timeout
        wav_path = args[args.index("-F") + 1]
        assert isinstance(wav_path, str)
        from pathlib import Path

        wav_path = Path(wav_path)
        wav_path.write_bytes(_wav_bytes(sample_rate=8))
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr(
        "app.processing.engines.playback.fluidsynth.ensure_partitura_default_soundfont",
        lambda _: None,
    )
    monkeypatch.setattr(
        "app.processing.engines.playback.fluidsynth.settings.WORK_ROOT", str(tmp_path / "work")
    )
    monkeypatch.setattr("app.processing.engines.playback.fluidsynth.subprocess.run", fake_run)

    rendered = FluidSynthAudioSynthesizer(
        soundfont_path=str(soundfont),
        profile=PlaybackProfile(sample_rate=8, max_duration_seconds=2),
    ).synthesize(b"MThd-midi")

    args = calls["args"]
    assert "fluidsynth" in args
    assert str(soundfont) in args
    assert "-r" in args
    assert "8" in args
    assert calls["timeout"] == 32.0
    assert rendered.mime_type == "audio/wav"
    assert rendered.duration_ms == 500
    assert (
        rendered.soundfont_sha256
        == "f417ae12e574b96b2009148ca55f7f9b50b10ce756174b20919d47edeb762bf7"
    )
