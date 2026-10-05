import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_rtt_streaming_onset_frontend.py"
POLICY = ROOT / "research" / "policies" / "rtt_streaming_onset_policy_2026-10-05.json"


def test_rtt_streaming_policy_pins_upstream_identity_and_official_threshold():
    policy = json.loads(POLICY.read_text(encoding="utf-8"))

    assert policy["candidate"]["repo"] == "https://github.com/huispaty/rtt"
    assert policy["candidate"]["commit"] == "b3197cfa538cc6f7698042b87ecee709223fc58e"
    assert policy["candidate"]["expectedCheckpointBytes"] == 67843364
    assert (
        policy["candidate"]["expectedCheckpointSha256"]
        == "901fc3da306fb4cffd96c55298d1439447e5a79f48cf436b4e76fde46db569f1"
    )
    assert policy["runtime"]["inputScaling"] == "OFFICIAL_RUNTIME"
    assert policy["runtime"]["onsetThreshold"] == 0.5
    assert policy["runtime"]["frozenEvaluationUsed"] is False


def test_rtt_streaming_frontend_does_not_import_practice_or_score_runtime():
    source = SCRIPT.read_text(encoding="utf-8")

    forbidden_tokens = [
        "StepPracticeRuntime",
        "ExpectedStrike",
        "currentStepTarget",
        "PerformanceClockRuntime",
        "ContinuousPracticeSession",
        "PracticeScore",
        "tempo",
        "practice mode",
    ]
    for token in forbidden_tokens:
        assert token not in source

