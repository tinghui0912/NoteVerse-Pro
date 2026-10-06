import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_online_amt_stateful_frontend_v2.py"
POLICY = ROOT / "research" / "policies" / "online_amt_stateful_policy_v2_2026-10-06.json"
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("online_amt_v2", SCRIPT)
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
    assert policy["phase8Disposition"]["supersededAsFinalModelVerdict"] is True
    assert policy["alignment"]["coarseOffsetCandidatesMs"][-1] == -256


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
            {"eventId": "near-real-next", "pitch": "C4", "physicalOnsetTimeMs": 1490.0, "stateId": 3, "onsetProbabilityMass": 0.9},
            {"eventId": "false-mid-sustain", "pitch": "C4", "physicalOnsetTimeMs": 1300.0, "stateId": 3, "onsetProbabilityMass": 0.9},
        ]
    }
    notes = {"s": [
        {"pitch": "C4", "midi": 60, "startMs": 1000.0, "endMs": 1400.0},
        {"pitch": "C4", "midi": 60, "startMs": 1500.0, "endMs": 1600.0},
    ]}
    scored = m.score_no_retrigger(episodes, events, notes, 50)
    assert len(scored["byFamily"]["long_held_no_retrigger"]) == 1
    assert scored["byFamily"]["long_held_no_retrigger"][0]["eventTimeMs"] == 1300.0


def test_source_event_matching_is_one_to_one():
    m = load_module()
    events = [
        {"midi": 60, "decisionTimeMs": 1128.0, "physicalOnsetTimeMs": 1000.0},
        {"midi": 60, "decisionTimeMs": 1133.0, "physicalOnsetTimeMs": 1005.0},
    ]
    notes = [{"midi": 60, "startMs": 1002.0, "endMs": 1100.0, "pitch": "C4"}]
    metrics = m.source_event_metrics(events, notes, [10])["10"]
    assert metrics["matched"] == 1
    assert metrics["predicted"] == 2
    assert metrics["timing"]["errorsMs"] == [-2.0]
    assert metrics["timing"]["decisionLatenciesMs"] == [126.0]
    assert metrics["timing"]["sampleCount"] == 1


def test_alignment_boundary_rejection_and_fine_generation():
    import json

    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    assert 0 in policy["alignment"]["boundaryOffsetsMs"]
    assert -256 in policy["alignment"]["boundaryOffsetsMs"]
    winner = -128
    fine = list(range(winner - policy["alignment"]["fineRadiusMs"], winner + policy["alignment"]["fineRadiusMs"] + 1))
    assert fine[0] == -159
    assert fine[-1] == -97
    assert len(fine) == 63


def test_per_pitch_positive_scoring_uses_canonical_gt_times():
    m = load_module()
    target = {"targetId": "t", "metricFamily": "complete_chord", "sourceFile": "x/foo.wav", "expectedPitches": ["C4", "E4"], "physicalAttackTime": 1.0}
    instances = [
        {"pitch": "C4", "midi": 60, "canonicalAttackTimeMs": 1000.0, "oldGroupPhysicalAttackTimeMs": 1000.0, "deltaFromOldAnchorMs": 0},
        {"pitch": "E4", "midi": 64, "canonicalAttackTimeMs": 1070.0, "oldGroupPhysicalAttackTimeMs": 1000.0, "deltaFromOldAnchorMs": 70},
    ]
    events = [
        {"eventId": "c", "pitch": "C4", "decisionTimeMs": 1128.0, "physicalOnsetTimeMs": 1000.0, "stateId": 3, "onsetProbabilityMass": 0.9},
        {"eventId": "e", "pitch": "E4", "decisionTimeMs": 1198.0, "physicalOnsetTimeMs": 1070.0, "stateId": 3, "onsetProbabilityMass": 0.9},
    ]
    row = m.score_positive_target(target, instances, events, 50)
    assert row["verdict"] == "PASS"


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
    assert "Production microphone remains disabled after Phase 8B." in md
    assert "No production integration was performed." in md


def test_harness_hard_checks_research_head():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "researchHarnessGitHead mismatch" in source
    assert "git_head(args.repo_root)" in source
