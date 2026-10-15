import io
import wave
import numpy as np
import pytest
from scipy.signal import resample_poly
from backend.scripts.bytedance_pcm_preprocessing import extract_resample_linear


def test_host_receipt_paths_resolve_in_docker_without_escape():
    from backend.research.xc2_prepare import receipt_path, ROOT
    assert receipt_path('backend\\data\\work\\cell.json') == ROOT / 'backend/data/work/cell.json'
    assert receipt_path('backend/data/work/cell.json') == ROOT / 'backend/data/work/cell.json'
    for value in ['../truth.mid', '/outside.json', 'C:\\outside.json', 'backend\\..\\..\\..\\outside']:
        with pytest.raises(ValueError, match='OUTSIDE_REPOSITORY'):
            receipt_path(value)


def test_frozen_mono_and_resampler_determinism_and_boundaries():
    rng = np.random.default_rng(13371)
    for count in [7, 441, 4411, 44101]:
        stereo = rng.integers(-32768, 32768, (count, 2), dtype=np.int16)
        source = stereo.astype(np.float32) / np.float32(32768)
        mono = source.astype(np.float64).mean(axis=1).astype(np.float32)
        assert np.array_equal(mono, source.mean(axis=1, dtype=np.float32))
        samples = int(count * 16000 / 44100)
        first = extract_resample_linear(mono, 44100, 0, count / 44100 * 1000, samples)
        second = extract_resample_linear(mono, 44100, 0, count / 44100 * 1000, samples)
        assert np.array_equal(first, second)
        band = resample_poly(mono, 160, 441, window=('kaiser', 5.0), padtype='constant', cval=0.0)
        assert np.array_equal(band, resample_poly(mono, 160, 441, window=('kaiser', 5.0), padtype='constant', cval=0.0))
        assert np.isfinite(first).all() and np.isfinite(band).all()


def test_counterfactual_rules_are_deterministic_and_score_only():
    from backend.research.xc2_prepare import build_scenarios
    notes = [{'id': str(i), 'pitch': 60 + i % 3, 'timeMs': 2000 + i * 600, 'endMs': 2900 + i * 600} for i in range(12)]
    assert build_scenarios(notes, 'fixture') == build_scenarios(notes, 'fixture')
    scenarios = build_scenarios(notes, 'fixture')
    assert all(s['fixedBpm'] == 120 for s in scenarios)
    for scenario in scenarios:
        assert scenario['beatPositions'] == [s['timeMs'] / 500 for s in scenario['expected']]
