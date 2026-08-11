"""Pure reference-feature transformations for score following."""


def trim_to_playable_start(reference_features, ref_frame_to_beat, *, score_start_beat: float, np):
    """Drop score-only leading rests that browser audio never contributes."""
    beats = np.asarray(ref_frame_to_beat, dtype=np.float32)
    features = np.asarray(reference_features)
    indices = np.flatnonzero(beats >= score_start_beat)
    if indices.size == 0:
        return features, beats
    start_index = int(indices[0])
    return features[start_index:], beats[start_index:]
