from dataclasses import dataclass

from app.modules.playback.audio_synthesizer import FluidSynthAudioSynthesizer
from app.modules.playback.midi_compiler import VerovioMidiCompiler


@dataclass(frozen=True)
class RenderedAudio:
    content: bytes
    mime_type: str
    extension: str
    duration_ms: int
    generator: str
    generator_version: str
    soundfont_sha256: str


class FluidSynthAudioRenderer:
    """Render MusicXML playback previews through Verovio MIDI and FluidSynth audio."""

    generator = "musicxml-verovio-fluidsynth-preview"
    generator_version = "1"

    def __init__(
        self,
        *,
        midi_compiler: VerovioMidiCompiler | None = None,
        audio_synthesizer: FluidSynthAudioSynthesizer | None = None,
    ) -> None:
        self.midi_compiler = midi_compiler or VerovioMidiCompiler()
        self.audio_synthesizer = audio_synthesizer or FluidSynthAudioSynthesizer()

    def render(self, content: bytes) -> RenderedAudio:
        midi = self.midi_compiler.compile(content)
        audio = self.audio_synthesizer.synthesize(midi.content)
        return RenderedAudio(
            content=audio.content,
            mime_type=audio.mime_type,
            extension=audio.extension,
            duration_ms=audio.duration_ms,
            generator=self.generator,
            generator_version=self.generator_version,
            soundfont_sha256=audio.soundfont_sha256,
        )
