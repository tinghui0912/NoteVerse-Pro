import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_online_amt_stateful_frontend_v3.py"
POLICY = ROOT / "research" / "policies" / "online_amt_stateful_policy_v3_2026-10-06.json"
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("online_amt_v3", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_policy_freezes_candidate_and_runtime_contract():
    import json

    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    assert policy["candidate"]["commit"] == "ad12550909a1d86f699097d11885f427054a5ac2"
    assert policy["candidate"]["expectedCheckpointSha256"] == "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0"
    assert policy["runtimeContract"]["hopSamples"] == 512
    assert policy["runtimeContract"]["pseudoIntensityShortcut"] == "DISABLED"
    assert policy["productionState"]["stepMic"] == "STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED"


def test_legacy_attempt_log_schema_detects_blocked_runtime(tmp_path):
    m = load_module()
    log = tmp_path / "attempt.log"
    log.write_text("python3.7: command not found\nCandidate: (none)\nDownloading uv-0.12.23\n", encoding="utf-8")
    args = type("Args", (), {"legacy_attempt_log": log})
    policy = {"legacyRuntime": {"requiredPython": "3.7"}}
    result = m.legacy_runtime_attempt(args, policy)
    assert result["verdict"] == "BLOCKED"
    assert result["executedLegacyModel"] is False
    assert result["loadedCheckpointInLegacyRuntime"] is False
    assert len(result["attempts"]) >= 2


def test_markdown_reports_phase8c_disabled():
    m = load_module()
    md = m.markdown({
        "metadata": {"researchHarnessGitHead": "h"},
        "final": {
            "verdict": "Online-AMT Stateful Acoustic Frontend = INCONCLUSIVE",
            "failureCategory": "LEGACY_RUNTIME_NOT_REPRODUCIBLE",
            "productionCandidacy": "REJECTED",
            "reason": "x",
        },
    })
    assert "Production microphone remains disabled after Phase 8C." in md
    assert "No production integration was performed." in md


def test_harness_hard_checks_research_head():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "researchHarnessGitHead mismatch" in source
    assert "git_head(args.repo_root)" in source
