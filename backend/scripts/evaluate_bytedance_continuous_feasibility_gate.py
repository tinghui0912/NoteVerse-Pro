"""Finalize the ByteDance Continuous feasibility decision from evidence reports.

This research-only gate intentionally reads immutable reports produced by the
export/parity, browser benchmark, trusted-region, and online-scheduling harnesses.
It does not regenerate prerequisite evidence, and it fails closed when required
reports are absent.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import platform
import subprocess
from pathlib import Path
from typing import Any


REQUIRED_REPORTS = {
    "batch_export_parity": "bytedance_continuous_batch_export_parity_{date}.json",
    "batch_invariance": "bytedance_continuous_batch_invariance_{date}.json",
    "browser_batch_benchmark": "bytedance_continuous_browser_batch_benchmark_{date}.json",
    "trusted_region_dataset": "bytedance_continuous_trusted_region_dataset_{date}.json",
    "trusted_region": "bytedance_continuous_trusted_region_{date}.json",
    "online_schedule": "bytedance_continuous_online_schedule_{date}.json",
    "end_to_end_browser": "bytedance_continuous_end_to_end_browser_{date}.json",
}

MAX_PARITY_DELTA = 0.02
MIN_P95_EFFECTIVE_REALTIME = 1.20


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports-dir", default="backend/research/reports")
    parser.add_argument("--date", default="2026-10-05")
    parser.add_argument("--output-json", default=None)
    parser.add_argument("--output-md", default=None)
    args = parser.parse_args()

    repo = _repo_root()
    reports_dir = (repo / args.reports_dir).resolve()
    loaded: dict[str, dict[str, Any]] = {}
    evidence: dict[str, dict[str, str | None]] = {}
    blockers: list[str] = []

    for key, pattern in REQUIRED_REPORTS.items():
        path = reports_dir / pattern.format(date=args.date)
        evidence[path.name] = {
            "path": str(path.relative_to(repo)),
            "sha256": _sha256(path) if path.exists() else None,
        }
        if not path.exists():
            blockers.append(f"Missing evidence report: {path.relative_to(repo)}")
            continue
        loaded[key] = _read_json(path)

    gates = _evaluate_gates(loaded)
    blockers.extend(gates.pop("blockers"))
    verdict = _decision(gates, blockers)

    decision = {
        "reportType": "final_decision",
        "generatedAt": dt.datetime.now(dt.UTC).isoformat(),
        "gitHead": _git_head(repo),
        "command": " ".join(["python", "backend/scripts/evaluate_bytedance_continuous_feasibility_gate.py", *args_to_list(args)]),
        "os": {
            "platform": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "verdict": verdict,
        "decisionRule": (
            "PASS requires every prerequisite gate. FAIL is used for completed "
            "evidence that violates correctness, trusted-region, or throughput "
            "criteria. INCONCLUSIVE is reserved for missing external evidence."
        ),
        "evidenceReports": evidence,
        "gates": gates,
        "blockers": blockers,
        "browserThroughput": _browser_throughput(loaded.get("browser_batch_benchmark")),
        "trustedRegion": _trusted_region_summary(loaded.get("trusted_region"), loaded.get("trusted_region_dataset")),
        "productionState": "CONTINUOUS_ANALYSIS_UNAVAILABLE",
        "modelDisposition": _model_disposition(verdict),
    }

    output_json = Path(args.output_json) if args.output_json else reports_dir / f"bytedance_continuous_feasibility_decision_{args.date}.json"
    output_md = Path(args.output_md) if args.output_md else reports_dir / f"bytedance_continuous_feasibility_decision_{args.date}.md"
    if not output_json.is_absolute():
        output_json = (repo / output_json).resolve()
    if not output_md.is_absolute():
        output_md = (repo / output_md).resolve()
    output_json.write_text(json.dumps(decision, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    output_md.write_text(_markdown(decision), encoding="utf-8")
    print(json.dumps({"verdict": verdict, "output": str(output_json)}, indent=2))


def args_to_list(args: argparse.Namespace) -> list[str]:
    rendered = ["--reports-dir", str(args.reports_dir), "--date", str(args.date)]
    if args.output_json:
        rendered.extend(["--output-json", str(args.output_json)])
    if args.output_md:
        rendered.extend(["--output-md", str(args.output_md)])
    return rendered


def _evaluate_gates(loaded: dict[str, dict[str, Any]]) -> dict[str, Any]:
    blockers: list[str] = []

    export_report = loaded.get("batch_export_parity")
    invariance_report = loaded.get("batch_invariance")
    browser_report = loaded.get("browser_batch_benchmark")
    trusted_report = loaded.get("trusted_region")
    online_report = loaded.get("online_schedule")
    e2e_report = loaded.get("end_to_end_browser")

    fixed_dynamic = _pass_fail(_max_fixed_dynamic_delta(invariance_report) <= MAX_PARITY_DELTA if invariance_report else None)
    batch_invariance = _pass_fail(_max_batch_invariance_delta(invariance_report) <= MAX_PARITY_DELTA if invariance_report else None)
    export_parity = _pass_fail(_max_export_delta(export_report) <= MAX_PARITY_DELTA if export_report else None)
    browser_raw = _pass_fail(_max_browser_raw_delta(browser_report) <= MAX_PARITY_DELTA if browser_report else None)

    trusted_status = trusted_report.get("candidate", {}).get("status") if trusted_report else None
    trusted_region = "PASS" if trusted_status == "PASS" else "FAIL" if trusted_status == "FAIL" else "BLOCKED"
    selected_width = trusted_report.get("candidate", {}).get("ownedWidthMs") if trusted_report else None

    online_status = online_report.get("status") if online_report else None
    online_schedule = _status_from_report(online_status)
    e2e_status = e2e_report.get("status") if e2e_report else None
    production_like = _status_from_report(e2e_status)

    if trusted_region == "PASS" and not selected_width:
        blockers.append("Trusted-region report passed without an owned width.")
    if trusted_region == "FAIL":
        blockers.append("Trusted-region gate failed; no one-owner geometry can be selected.")

    p95_effective = _selected_p95_effective(online_report)
    throughput = "PASS" if p95_effective is not None and p95_effective >= MIN_P95_EFFECTIVE_REALTIME else "BLOCKED"
    if online_schedule == "FAIL":
        throughput = "FAIL"

    return {
        "fixedVsDynamicB1Parity": fixed_dynamic,
        "dynamicBatchExportParity": export_parity,
        "dynamicBatchInvariance": batch_invariance,
        "chromeWebgpuRawParity": browser_raw,
        "trustedRegion": trusted_region,
        "onlineSchedule": online_schedule,
        "productionLikeEndToEnd": production_like,
        "p95EffectiveRealtime": throughput,
        "blockers": blockers,
    }


def _decision(gates: dict[str, Any], blockers: list[str]) -> str:
    if any(value == "FAIL" for value in gates.values()):
        return "FAIL"
    if blockers:
        return "FAIL" if gates.get("trustedRegion") == "FAIL" else "INCONCLUSIVE"
    return "PASS" if all(value == "PASS" for value in gates.values()) else "INCONCLUSIVE"


def _status_from_report(status: Any) -> str:
    if status in {"PASS", "FAIL"}:
        return status
    if isinstance(status, str) and status.startswith("NOT_RUN"):
        return status
    return "BLOCKED"


def _max_export_delta(report: dict[str, Any] | None) -> float:
    max_delta = 0.0
    for batch in (report or {}).get("parity", {}).values():
        for item in batch.get("items", []):
            max_delta = max(max_delta, float(item.get("onsetMaxAbsDelta", 0.0)), float(item.get("frameMaxAbsDelta", 0.0)))
    return max_delta


def _max_fixed_dynamic_delta(report: dict[str, Any] | None) -> float:
    max_delta = 0.0
    for item in (report or {}).get("fixedVsDynamicB1", []):
        max_delta = max(max_delta, float(item.get("regOnset", {}).get("maxAbsDelta", 0.0)), float(item.get("frame", {}).get("maxAbsDelta", 0.0)))
    return max_delta


def _max_batch_invariance_delta(report: dict[str, Any] | None) -> float:
    max_delta = 0.0
    for batch in (report or {}).get("dynamicBatchInvariance", {}).values():
        for item in batch.get("items", []):
            max_delta = max(max_delta, float(item.get("regOnset", {}).get("maxAbsDelta", 0.0)), float(item.get("frame", {}).get("maxAbsDelta", 0.0)))
    return max_delta


def _max_browser_raw_delta(report: dict[str, Any] | None) -> float:
    max_delta = 0.0
    for result in (report or {}).get("results", []):
        for item in result.get("rawParity", []):
            max_delta = max(max_delta, float(item.get("regOnset", {}).get("maxAbsDelta", 0.0)), float(item.get("frame", {}).get("maxAbsDelta", 0.0)))
    return max_delta


def _selected_p95_effective(report: dict[str, Any] | None) -> float | None:
    value = (report or {}).get("selectedContract", {}).get("p95EffectiveRealtimeFactor")
    return float(value) if isinstance(value, int | float) else None


def _browser_throughput(report: dict[str, Any] | None) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for result in (report or {}).get("results", []):
        batch = result.get("batchSize")
        warm = result.get("warm", {})
        if batch is None:
            continue
        summary[f"b{batch}MedianWindowsPerSecond"] = warm.get("medianWindowsPerSecond")
        summary[f"b{batch}P95WindowsPerSecond"] = warm.get("p95WindowsPerSecond")
    if report:
        summary["browserVersion"] = report.get("browser", {}).get("version")
        summary["ortVersion"] = report.get("ortVersion")
    return summary


def _trusted_region_summary(region: dict[str, Any] | None, dataset: dict[str, Any] | None) -> dict[str, Any]:
    candidate = (region or {}).get("candidate", {})
    dataset_info = (region or {}).get("dataset") or (dataset or {}).get("dataset") or {}
    return {
        "datasetCategoryCounts": dataset_info.get("categoryCounts"),
        "positionGridMs": dataset_info.get("positionGridMs"),
        "status": candidate.get("status"),
        "reason": candidate.get("reason"),
        "selectedTrustedStartMs": candidate.get("selectedTrustedStartMs"),
        "selectedTrustedEndMs": candidate.get("selectedTrustedEndMs"),
        "ownedWidthMs": candidate.get("ownedWidthMs"),
    }


def _model_disposition(verdict: str) -> str:
    if verdict == "PASS":
        return "ByteDance may proceed to a later Continuous microphone integration phase; production remains disabled."
    if verdict == "FAIL":
        return "ByteDance remains STEP-only for now; current note_model is rejected for Continuous microphone under this gate."
    return "ByteDance Continuous feasibility remains inconclusive because required evidence is missing."


def _markdown(decision: dict[str, Any]) -> str:
    lines = [
        "# ByteDance Continuous Feasibility Decision",
        "",
        f"- Verdict: `{decision['verdict']}`",
        f"- Git HEAD: `{decision['gitHead']}`",
        f"- Production state: `{decision['productionState']}`",
        f"- Model disposition: {decision['modelDisposition']}",
        "",
        "## Gates",
    ]
    for key, value in decision["gates"].items():
        lines.append(f"- {key}: `{value}`")
    lines.extend(["", "## Trusted Region"])
    trusted = decision["trustedRegion"]
    lines.append(f"- Status: `{trusted.get('status')}`")
    lines.append(f"- Reason: {trusted.get('reason')}")
    lines.append(f"- Position grid ms: `{trusted.get('positionGridMs')}`")
    lines.append(f"- Category counts: `{trusted.get('datasetCategoryCounts')}`")
    lines.extend(["", "## Evidence"])
    for name, info in decision["evidenceReports"].items():
        lines.append(f"- `{name}`: `{info.get('sha256')}`")
    if decision["blockers"]:
        lines.extend(["", "## Blockers"])
        for blocker in decision["blockers"]:
            lines.append(f"- {blocker}")
    lines.append("")
    return "\n".join(lines)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _git_head(repo: Path) -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    except Exception:
        return None


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _pass_fail(result: bool | None) -> str:
    if result is None:
        return "BLOCKED"
    return "PASS" if result else "FAIL"


if __name__ == "__main__":
    main()
