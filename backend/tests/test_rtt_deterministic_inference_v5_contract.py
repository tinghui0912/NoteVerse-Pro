import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_rtt_deterministic_inference_v5.py"
POLICY = ROOT / "research" / "policies" / "rtt_deterministic_policy_2026-10-06.json"
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("rtt_v5", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_policy_freezes_phase7d_sha_correction_and_scale_rule():
    import json

    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    assert policy["phase7DCorrection"]["incorrectRecordedHarnessSha"] == "22d3054b87d6ef7db1a24f52e479a908904fbeea"
    assert policy["phase7DCorrection"]["actualHarnessSha"] == "22d3054b3e126fc22ebab5b9d498e815349e82d1"
    assert policy["scaleAudit"]["contracts"] == ["OFFICIAL_FLOAT", "INT16_EQUIVALENT"]
    assert policy["scaleAudit"]["clearImprovementFactor"] == 2.0


def test_scale_selection_requires_same_contract_to_win_both_diagnostics():
    m = load_module()
    policy = {"scaleAudit": {"clearImprovementFactor": 2.0}}
    result = m.select_scale(policy, {
        "OFFICIAL_FLOAT": {"meanDistance": 1.0, "varianceDistance": 10.0},
        "INT16_EQUIVALENT": {"meanDistance": 10.0, "varianceDistance": 1.0},
    })
    assert result["selectedScale"] is None
    assert "did not provide" in result["reason"]


def test_scale_selection_accepts_clear_two_axis_winner():
    m = load_module()
    policy = {"scaleAudit": {"clearImprovementFactor": 2.0}}
    result = m.select_scale(policy, {
        "OFFICIAL_FLOAT": {"meanDistance": 1.0, "varianceDistance": 1.0},
        "INT16_EQUIVALENT": {"meanDistance": 3.0, "varianceDistance": 4.0},
    })
    assert result["selectedScale"] == "OFFICIAL_FLOAT"


def test_deterministic_eval_code_applies_eval_before_transcribe():
    m = load_module()
    cohort = {"sources": {"a": {"audioPath": Path("/tmp/source.wav")}}}
    code = m.deterministic_eval_code(
        dummy_args(),
        {"scaleAudit": {"sampleSecondsPerSource": 1.0}},
        cohort,
        scale="OFFICIAL_FLOAT",
    )
    assert "t.model.eval()" in code
    assert "result = t.transcribe(audio)" in code


def test_training_audit_records_inference_mode_without_eval():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "beforeInferenceMode" in source
    assert "insideInferenceMode" in source
    assert "with torch.inference_mode()" in source


def test_markdown_reports_production_disabled():
    m = load_module()
    md = m.markdown({
        "metadata": {
            "researchHarnessGitHead": "h",
            "checkpointSha256": "c",
        },
        "final": {
            "verdict": "RTT Shared Streaming Onset Frontend = INCONCLUSIVE",
            "failureCategory": "INCONCLUSIVE_INPUT_SCALE",
            "reason": "x",
        },
    })
    assert "Production microphone remains disabled after Phase 7E." in md
    assert "No production integration was performed." in md


def dummy_args():
    class Args:
        rtt_repo = Path("/tmp/rtt")
        checkpoint = Path("/tmp/rtt/ckpts/CustomAMT.ckpt")

    return Args()
