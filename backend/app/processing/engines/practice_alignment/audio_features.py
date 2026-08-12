"""Shape normalization helpers for browser PCM feature extraction."""


def latest_feature_vector(features, np):
    feature_array = np.asarray(features, dtype=float)
    if feature_array.size == 0:
        return None
    if feature_array.ndim == 1:
        return feature_array
    return feature_array[-1]


def feature_matrix(processor_output):
    if processor_output is None:
        return None
    if isinstance(processor_output, tuple):
        if not processor_output:
            return None
        return processor_output[0]
    return processor_output
