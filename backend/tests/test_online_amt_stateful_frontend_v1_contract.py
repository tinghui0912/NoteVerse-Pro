import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_online_amt_stateful_frontend_v1.py"
POLICY = ROOT / "research" / "policies" / "online_amt_stateful_policy_2026-10-06.json"
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("online_amt_v1", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_policy_pins_candidate_identity_and_disables_shortcut():
    import json

    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    assert policy["candidate"]["commit"] == "ad12550909a1d86f699097d11885f427054a5ac2"
    assert policy["candidate"]["expectedCheckpointSha256"] == "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0"
    assert policy["runtime"]["hopSamples"] == 512
    assert policy["runtime"]["pseudoIntensityShortcut"] == "DISABLED_FOR_AUTHORITATIVE_QUALITY_ADAPTER"


def test_gate_verdict_truth_table():
    m = load_module()
    assert m.gate_verdict({"a": {"verdict": "PASS"}}) == "PASS"
    assert m.gate_verdict({"a": {"verdict": "PASS"}, "b": {"verdict": "NOT_EVALUATED"}}) == "INCONCLUSIVE"
    assert m.gate_verdict({"a": {"verdict": "PASS"}, "b": {"verdict": "FAIL"}}) == "FAIL"


def test_later_real_same_pitch_excluded_from_false_onset_interval():
    m = load_module()
    episodes = [{
        "episodeId": "x",
        "source": "s",
        "family": "long_held_no_retrigger",
        "pitch": "C4",
        "previousAttackMs": 1000.0,
        "nextAttackMs": 1500.0,
        "intervalStartMs": 1050.0,
        "intervalEndMs": 1500.0,
    }]
    events = {
        "s": [
            {"pitch": "C4", "physicalOnsetTimeMs": 1490.0, "stateId": 3, "onsetProbabilityMass": 0.9},
            {"pitch": "C4", "physicalOnsetTimeMs": 1510.0, "stateId": 3, "onsetProbabilityMass": 0.9},
        ]
    }
    scored = m.score_no_retrigger(episodes, events)
    assert len(scored["byFamily"]["long_held_no_retrigger"]) == 1
    assert scored["byFamily"]["long_held_no_retrigger"][0]["eventTimeMs"] == 1490.0


def test_source_event_matching_is_one_to_one():
    m = load_module()
    events = [
        {"midi": 60, "physicalOnsetTimeMs": 1000.0},
        {"midi": 60, "physicalOnsetTimeMs": 1005.0},
    ]
    notes = [{"midi": 60, "startMs": 1002.0, "endMs": 1100.0, "pitch": "C4"}]
    metrics = m.source_event_metrics(events, notes, [10])["10"]
    assert metrics["matched"] == 1
    assert metrics["predicted"] == 2


def test_markdown_reports_production_disabled():
    m = load_module()
    md = m.markdown({
        "metadata": {"researchHarnessGitHead": "h"},
        "final": {
            "verdict": "Online-AMT Stateful Acoustic Frontend = FAIL",
            "failureCategory": "PRODUCT_ACOUSTIC_GATE_FAILURE",
            "reason": "x",
        },
    })
    assert "Production microphone remains disabled after Phase 8." in md
    assert "No production integration was performed." in md


def test_harness_hard_checks_research_head():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "researchHarnessGitHead mismatch" in source
    assert "git_head(args.repo_root)" in source
