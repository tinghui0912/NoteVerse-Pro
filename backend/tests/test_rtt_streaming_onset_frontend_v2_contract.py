import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_rtt_streaming_onset_frontend_v2.py"
POLICY = ROOT / "research" / "policies" / "rtt_streaming_onset_policy_v2_2026-10-05.json"


def test_zero_sample_is_not_eligible_pass():
    source = SCRIPT.read_text(encoding="utf-8")
    assert '"NOT_EVALUATED"' in source
    assert 'result["verdict"] == "PASS"' in source


def test_policy_freezes_threshold_sweep_and_upstream_identity():
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    assert policy["runtime"]["thresholdSweep"] == [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]
    assert policy["runtime"]["officialOnsetThreshold"] == 0.5
    assert policy["candidate"]["commit"] == "b3197cfa538cc6f7698042b87ecee709223fc58e"


def test_decision_artifact_references_development_instead_of_duplicating_blob():
    source = SCRIPT.read_text(encoding="utf-8")
    assert '"path": str(args.development_output)' in source
    assert 'args.development_output.write_text' in source


def test_upstream_metric_reproduction_uses_official_runtime():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "PianoTranscription" in source
    assert "compute_notewise_transcription_metrics" in source
    assert "segment_samples=16000 * 3" in source
    assert "overlap=True" in source
    assert "RTTPostProcessor" in source
    assert "exact official metric recomputation is not implemented" not in source


def test_acoustic_inference_has_no_practice_runtime_coupling():
    source = SCRIPT.read_text(encoding="utf-8")
    for token in ["StepPracticeRuntime", "ExpectedStrike", "currentStepTarget", "PracticeScore", "PerformanceClockRuntime"]:
        assert token not in source
