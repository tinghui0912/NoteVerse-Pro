"""Versioned tuning profile for realtime practice alignment.

These values are coupled to the 30 fps Chroma/OLTW pipeline. They deliberately
live with the implementation rather than in deployment environment variables so
that a tuning change is reviewed and replay-tested with the code that uses it.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PracticeAudioProfile:
    frame_rate: int = 30
    rms_gate: float = 0.015
    peak_gate: float = 0.06
    start_rms_gate: float = 0.025
    start_peak_gate: float = 0.06
    min_active_frames: int = 3
    warmup_frames: int = 30
    rms_noise_multiplier: float = 4.0
    peak_noise_multiplier: float = 2.5
    no_input_frames: int = 24
    tonal_gate_enabled: bool = True
    # Chosen by the real-engine fixture matrix: this rejects the combined
    # speech/typing/knock negative while retaining all Once Again positives.
    max_spectral_flatness: float = 0.12
    min_peak_prominence: float = 12.0
    onset_flux_gate: float = 0.35
    onset_hold_frames: int = 45


DEFAULT_PRACTICE_AUDIO_PROFILE = PracticeAudioProfile()
