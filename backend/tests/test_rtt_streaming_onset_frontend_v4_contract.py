import importlib.util
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "evaluate_rtt_streaming_onset_frontend_v4.py"
POLICY = ROOT / "research" / "policies" / "rtt_streaming_onset_policy_v4_2026-10-05.json"
sys.path.insert(0, str(ROOT / "scripts"))


def load_module():
    spec = importlib.util.spec_from_file_location("rtt_v4", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_policy_freezes_exact_8_row_cohort():
    import json
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    assert len(policy["upstreamMetricReproduction"]["frozenBasenames"]) == 8
    assert policy["runtime"]["officialCommand"] == "python src/inference.py <tmp-maestro-root> --split test"


def test_compare_results_requires_f1_tolerance_for_every_row():
    m = load_module()
    policy = {
        "upstreamMetricReproduction": {
            "tolerancesSeconds": [0.01, 0.02, 0.03],
            "compareMetrics": ["note-on-p", "note-on-r", "note-on-f"],
            "perFileF1Tolerance": 0.01,
            "aggregateMeanF1Tolerance": 0.005,
        }
    }
    expected = {"a": row(0.5)}
    computed = {"a": row(0.7)}
    result = m.compare_results(policy, expected_rows=expected, computed_rows=computed)
    assert result["pass"] is False
    assert result["perRow"][0]["perFileF1Pass"] is False


def test_compare_results_passes_exact_match():
    m = load_module()
    policy = {
        "upstreamMetricReproduction": {
            "tolerancesSeconds": [0.01, 0.02, 0.03],
            "compareMetrics": ["note-on-p", "note-on-r", "note-on-f"],
            "perFileF1Tolerance": 0.01,
            "aggregateMeanF1Tolerance": 0.005,
        }
    }
    result = m.compare_results(policy, expected_rows={"a": row(0.5)}, computed_rows={"a": row(0.5)})
    assert result["pass"] is True


def test_script_invokes_unmodified_upstream_cli_and_checks_fresh_results():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "src\" / \"inference.py" in source
    assert "my_results.csv" in source
    assert "unexpectedly contains my_results.csv" in source
    assert "len(rows) != 8" in source


def test_script_cross_checks_cli_against_wrapper():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "run_noteverse_wrapper" in source
    assert "cliVsWrapperAgreement" in source
    assert "compare_rows_exact" in source


def test_markdown_reports_production_disabled():
    m = load_module()
    md = m.markdown({
        "metadata": {"researchHarnessGitHead": "h", "checkpointSha256": "c"},
        "final": {
            "verdict": "RTT Shared Streaming Onset Frontend = FAIL",
            "failureCategory": "UPSTREAM_REPRODUCIBILITY_FAILURE",
            "reason": "x",
        },
        "upstreamMetricReproduction": {"summary": {"verdict": "FAIL"}},
    })
    assert "Production microphone remains disabled after Phase 7D." in md


def row(value):
    data = {"file": "a"}
    for tolerance in [0.01, 0.02, 0.03]:
        for metric in ["note-on-p", "note-on-r", "note-on-f"]:
            data[f"{metric}-{tolerance}"] = str(value)
    return data
