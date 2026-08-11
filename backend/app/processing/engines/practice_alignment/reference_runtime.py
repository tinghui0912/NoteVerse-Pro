"""Pure adapters for Matchmaker reference audio and follower construction."""

from __future__ import annotations


def build_audio_processor(*, sample_rate: int, hop_length: int, chroma_processor):
    """Create Matchmaker's chroma extractor with the negotiated audio format."""
    return chroma_processor(sample_rate=sample_rate, hop_length=hop_length)


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
