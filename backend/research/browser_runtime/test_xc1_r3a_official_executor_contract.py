import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


def test_pre_f4_acceptance_uses_official_registry_not_forked_inference():
    acceptance = (REPO_ROOT / "backend/research/browser_runtime/xc1_pre_f4_real_executor_acceptance.mjs").read_text()

    assert "executeOfficialXc1StageACell" in acceptance
    assert "function runOrt" not in acceptance
    assert "window.runBasicPitchAcceptance" not in acceptance
    assert "OFFICIAL_STAGE_A_EXECUTOR_ACCEPTANCE_PASS" in acceptance


def test_stage_a_runner_rejects_direct_asset_overrides():
    runner = (REPO_ROOT / "backend/research/browser_runtime/xc1_stage_a_runner.mjs").read_text()

    for forbidden in [
        "robust-onnx",
        "online-amt-k8-onnx",
        "online-amt-k1-onnx",
        "basic-pitch-work-dir",
        "canonical-pcm",
    ]:
        assert forbidden in runner


def test_official_acceptance_report_has_real_executor_passes_when_present():
    report_path = REPO_ROOT / "backend/research/reports/phase9g_xc1_r3a_official_pre_f4_real_executor_acceptance_2026-10-14.json"
    if not report_path.exists():
        return

    report = json.loads(report_path.read_text())
    assert report["overallStatus"] == "OFFICIAL_STAGE_A_EXECUTOR_ACCEPTANCE_PASS"
    assert report["acceptanceCommandUsesOfficialRegistry"] is True
    for deployment_id, cell in report["cells"].items():
        assert cell["status"] == "OFFICIAL_STAGE_A_REAL_EXECUTOR_PASS", deployment_id
        assert cell["status"] != "XC1_STAGE_A_BROWSER_EXECUTION_NOT_INVOKED_BY_SMOKE"
        assert cell["actualInferenceSessionRunCount"] > 0
        assert cell["implementationIdentity"]["officialRegistry"]["sha256"]
        assert cell["implementationIdentity"]["realExecutor"]["sha256"]
        assert cell["implementationIdentity"]["sharedBrowserRuntime"]["sha256"]
