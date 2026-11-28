"""Worker-owned media processing dependencies."""

from app.processing.engines.playback.fluidsynth import FluidSynthAudioSynthesizer
from app.processing.engines.playback.renderer import FluidSynthAudioRenderer
from app.runtime.worker.context import get_context


def build_audio_renderer() -> FluidSynthAudioRenderer:
    config = get_context().settings
    return FluidSynthAudioRenderer(
        audio_synthesizer=FluidSynthAudioSynthesizer(
            soundfont_path=config.PLAYBACK_SOUNDFONT_PATH, work_root=config.WORK_ROOT
        )
    )
