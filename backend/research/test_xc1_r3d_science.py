import itertools
import random
import numpy as np
import pytest
from backend.research.xc1_scientific_bakeoff import OnsetEvent, match_pitch_onsets, paired_bootstrap, bytedance_linear_resample_full_np
from backend.scripts.bytedance_pcm_preprocessing import extract_resample_linear
from backend.scripts.phase9g_xc1_r3d_stage_b import container_guard, verify_canonical


def test_container_guard():
    assert container_guard()['system'] == 'Linux'


def test_windows_scientific_runtime_refused(monkeypatch):
    monkeypatch.setattr('backend.scripts.phase9g_xc1_r3d_stage_b.platform.system', lambda: 'Windows')
    with pytest.raises(ValueError, match='HOST_SCIENTIFIC_RUNTIME_FORBIDDEN'):
        container_guard()


@pytest.mark.parametrize('rate', [16000, 22050, 44100, 48000])
@pytest.mark.parametrize('count', [3, 7, 511, 512, 1025, 4411])
def test_common_preprocessing_direct_reference_parity(rate, count):
    source = np.random.default_rng(991 + count).standard_normal(count).astype(np.float32)
    output_count = int(count * 16000 // rate)
    actual = bytedance_linear_resample_full_np(source, rate, 16000)
    expected = extract_resample_linear(source, rate, 0, count / rate * 1000, output_count)
    # IEEE source-duration roundtrips may differ by one float32 ULP.
    np.testing.assert_allclose(actual, expected, rtol=0, atol=np.finfo(np.float32).eps * 2)


def test_sparse_matching_matches_exhaustive_lexicographic_objective():
    rng = random.Random(13371)
    for _ in range(100):
        a = sorted(rng.randrange(30) for _ in range(5))
        b = sorted(rng.randrange(30) for _ in range(5))
        truth = [OnsetEvent(f't{i}', 60, time) for i, time in enumerate(a)]
        predictions = [OnsetEvent(f'p{i}', 60, time) for i, time in enumerate(b)]
        result = match_pitch_onsets(truth, predictions, 10)['matches']
        objectives = [(0, 0)]
        for count in range(1, 6):
            for ti in itertools.combinations(range(5), count):
                for pi in itertools.combinations(range(5), count):
                    errors = [abs(a[i] - b[j]) for i, j in zip(ti, pi)]
                    if max(errors) <= 10:
                        objectives.append((count, -sum(errors)))
        assert (len(result), -sum(item['absErrorMs'] for item in result)) == max(objectives)


def test_long_take_sparse_matcher():
    truth = [OnsetEvent(f't{i}', 60, i * 150) for i in range(10000)]
    predictions = [OnsetEvent(f'p{i}', 60, i * 150 + 20) for i in range(10000)]
    result = match_pitch_onsets(truth, predictions, 50)
    assert len(result['matches']) == 10000


def test_bootstrap_missing_pair_fails_closed():
    rows = [{'candidateId': 'a', 'takeId': 'one', 'f1': .5}, {'candidateId': 'b', 'takeId': 'one', 'f1': .4},
            {'candidateId': 'a', 'takeId': 'two', 'f1': .5}]
    with pytest.raises(ValueError, match='UNPAIRED_COVERAGE'):
        paired_bootstrap(rows, 'a', 'b', 'f1')


def test_canonical_artifact_rejects_mutation():
    from backend.scripts.phase9g_xc1_r3d_stage_b import digest
    artifact = {'number': .000000000005, 'values': [1, 2.0]}
    artifact['artifactCanonicalSha256'] = digest(artifact)
    verify_canonical(artifact)
    artifact['number'] = 3
    with pytest.raises(ValueError, match='DIGEST_MISMATCH'):
        verify_canonical(artifact)
