"""Pure adapters for Matchmaker reference audio and follower construction."""

from __future__ import annotations

from pathlib import Path

from app.core.config import get_practice_runtime_settings


def build_audio_processor(*, sample_rate: int, hop_length: int, chroma_processor):
    """Create Matchmaker's chroma extractor with the negotiated audio format."""
    return chroma_processor(sample_rate=sample_rate, hop_length=hop_length)


def generate_score_audio(*, score, bpm, sample_rate, np, partitura, generate_score_audio):
    soundfont_path = get_practice_runtime_settings().PRACTICE_SOUNDFONT_PATH
    if not soundfont_path:
        if generate_score_audio is None:
            raise RuntimeError("matchmaker score audio generator is not available.")
        return generate_score_audio(score, bpm, sample_rate)
    soundfont = Path(soundfont_path)
    if not soundfont.exists():
        raise RuntimeError(f"PRACTICE_SOUNDFONT_PATH does not exist: {soundfont}")
    note_array = score.note_array()
    bpm_array = np.array([[onset_beat, bpm] for onset_beat in note_array["onset_beat"]])
    score_audio = partitura.save_wav_fluidsynth(score, bpm=bpm_array, samplerate=sample_rate, soundfont=str(soundfont))
    first = note_array["onset_beat"].min()
    padding = int(score.inv_beat_map(first) / score.quarter_duration_map(score.inv_beat_map(first)) * (60 / bpm) * sample_rate)
    score_audio = np.pad(score_audio, (padding, 0))
    last = np.floor(note_array["onset_div"].max())
    duration = last / score.quarter_duration_map(score.inv_beat_map(last)) * (60 / bpm) + 0.1
    return score_audio[: int(duration * sample_rate)]


def normalize_audio_waveform(audio, np):
    if isinstance(audio, tuple):
        if not audio:
            raise RuntimeError("Score audio synthesis returned an empty tuple.")
        audio = audio[0]

    waveform = np.asarray(audio)
    if waveform.ndim == 0:
        raise RuntimeError("Score audio synthesis returned an invalid scalar waveform.")
    waveform = np.squeeze(waveform)
    if waveform.ndim == 2:
        if waveform.shape[0] <= 2 and waveform.shape[1] > waveform.shape[0]:
            waveform = waveform.mean(axis=0)
        elif waveform.shape[1] <= 2:
            waveform = waveform.mean(axis=1)
        else:
            waveform = waveform.mean(axis=-1)
    if waveform.ndim != 1:
        raise RuntimeError(
            f"Score audio synthesis returned unsupported waveform shape: {waveform.shape}"
        )
    return waveform


def build_score_follower(
    reference_features,
    feature_queue,
    frame_rate: int,
    arzt_follower,
    ref_frame_to_beat=None,
    score_positions=None,
):
    follower = arzt_follower(
        reference_features=reference_features,
        score_positions=score_positions,
        queue=feature_queue,
        frame_rate=frame_rate,
        ref_frame_to_beat=ref_frame_to_beat,
    )
    follower.queue_timeout = None
    return follower
