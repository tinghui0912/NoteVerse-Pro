#!/usr/bin/env python3
"""Phase 9G DR3 grouped Online-AMT browser qualification.

This entry point owns the DR3 environment bootstrap and evidence receipt. It
does not alter production dependencies. Scientific packages are installed only
into an ignored research venv under backend/data/work when no suitable runtime
is already importable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


REPORT_DATE = "2026-10-13"
REPORT_NAME = f"phase9g_dr3_complete_grouped_browser_runtime_and_close_online_amt_{REPORT_DATE}.json"
REQUIRED_REMOTE_HEAD = "41e6f7496a3d6fa698078305c36e02ba2d863d44"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--work-dir", type=Path, default=Path("backend/data/work/phase9g_dr3_online_amt_grouped"))
    parser.add_argument("--reports-dir", type=Path, default=Path("backend/research/reports"))
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--no-bootstrap", action="store_true")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    work_dir = (repo_root / args.work_dir).resolve()
    reports_dir = (repo_root / args.reports_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    attempted: list[dict[str, Any]] = []
    implementation_head = git(repo_root, ["rev-parse", "HEAD"])
    remote_head = git(repo_root, ["rev-parse", "origin/codex/customer-web-delivery-boundary"])
    clean = git(repo_root, ["status", "--short"]) == ""

    if not args.no_bootstrap and not scientific_imports_available():
        bootstrap = bootstrap_scientific_runtime(repo_root, work_dir, attempted)
        if bootstrap["status"] != "PASS":
            write_report(reports_dir, blocked_report(repo_root, implementation_head, remote_head, clean, attempted, bootstrap))
            return 2
        python = bootstrap["python"]
        cmd = [
            python,
            str(Path(__file__).resolve()),
            "--repo-root",
            str(repo_root),
            "--work-dir",
            str(args.work_dir),
            "--reports-dir",
            str(args.reports_dir),
            "--no-bootstrap",
        ]
        if args.headed:
            cmd.append("--headed")
        result = run(cmd, repo_root, attempted, timeout=1800)
        if result["exitCode"] != 0:
            report = blocked_report(repo_root, implementation_head, remote_head, clean, attempted, {
                "status": "FAILED",
                "reason": "BOOTSTRAPPED_GROUPED_EXECUTION_FAILED",
            })
            write_report(reports_dir, report)
            return 2
        return 0

    if not scientific_imports_available():
        report = blocked_report(repo_root, implementation_head, remote_head, clean, attempted, {
            "status": "FAILED",
            "reason": "PYTHON_SCIENTIFIC_RUNTIME_UNAVAILABLE_AFTER_BOOTSTRAP",
        })
        write_report(reports_dir, report)
        return 2

    # Delegate the current real grouped exporter/parity implementation. This is
    # intentionally an actual command so stdout/stderr/exit behavior is sealed.
    cmd = [
        sys.executable,
        "backend/scripts/qualify_online_amt_grouped_browser_dr2.py",
        "--repo-root",
        str(repo_root),
        "--ort-dir",
        "backend/data/work/phase9gdr2_ort_130/node_modules/onnxruntime-web/dist",
    ]
    if args.headed:
        cmd.append("--headed")
    result = run(cmd, repo_root, attempted, timeout=1800)
    if result["exitCode"] != 0:
        report = blocked_report(repo_root, implementation_head, remote_head, clean, attempted, {
            "status": "FAILED",
            "reason": "GROUPED_EXPORT_OR_BROWSER_EXECUTION_FAILED",
        })
        write_report(reports_dir, report)
        return 2

    report = {
        "phase": "PHASE_9G_DR3_COMPLETE_GROUPED_BROWSER_RUNTIME_AND_CLOSE_ONLINE_AMT",
        "implementationGitHead": implementation_head,
        "implementationWorkingTreeCleanBeforeExecution": clean,
        "verifiedStartingRemoteHead": remote_head,
        "onlineAmtClosureDecision": "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE",
        "delegatedGroupedExecution": result,
        "attemptedCommands": attempted,
        "criticalImplementationFileSha256": critical_hashes(repo_root),
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "historicalPhase9gBConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "p15p22InferenceIncrease": 0,
    }
    write_report(reports_dir, report)
    return 0


def scientific_imports_available() -> bool:
    try:
        import numpy  # noqa: F401
        import torch  # noqa: F401
        import onnx  # noqa: F401
        import onnxruntime  # noqa: F401
    except ModuleNotFoundError:
        return False
    return True


def bootstrap_scientific_runtime(repo_root: Path, work_dir: Path, attempted: list[dict[str, Any]]) -> dict[str, Any]:
    venv_dir = work_dir / "venv"
    python = venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        result = run([sys.executable, "-m", "venv", str(venv_dir)], repo_root, attempted, timeout=300)
        if result["exitCode"] != 0:
            return {"status": "FAILED", "reason": "VENV_CREATE_FAILED", "python": str(python)}
    pip_cmd = [
        str(python),
        "-m",
        "pip",
        "install",
        "-r",
        "docker/research/requirements.online-amt-modern.txt",
        "onnx==1.17.0",
        "onnxruntime==1.20.1",
    ]
    result = run(pip_cmd, repo_root, attempted, timeout=1800)
    if result["exitCode"] != 0:
        return {"status": "FAILED", "reason": "PIP_INSTALL_FAILED", "python": str(python)}
    freeze = run([str(python), "-m", "pip", "freeze"], repo_root, attempted, timeout=120)
    return {
        "status": "PASS",
        "python": str(python),
        "pipFreezeSha256": hashlib.sha256(freeze.get("stdout", "").encode("utf-8")).hexdigest(),
    }


def blocked_report(
    repo_root: Path,
    implementation_head: str,
    remote_head: str,
    clean: bool,
    attempted: list[dict[str, Any]],
    blocker: dict[str, Any],
) -> dict[str, Any]:
    return {
        "phase": "PHASE_9G_DR3_COMPLETE_GROUPED_BROWSER_RUNTIME_AND_CLOSE_ONLINE_AMT",
        "implementationGitHead": implementation_head,
        "implementationWorkingTreeCleanBeforeExecution": clean,
        "verifiedStartingRemoteHead": remote_head,
        "onlineAmtClosureDecision": "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED",
        "blocker": blocker,
        "attemptedCommands": attempted,
        "criticalImplementationFileSha256": critical_hashes(repo_root),
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "historicalPhase9gBConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "p15p22InferenceIncrease": 0,
    }


def critical_hashes(repo_root: Path) -> dict[str, str]:
    paths = [
        "backend/research/product_amt_rebaseline.py",
        "backend/scripts/qualify_online_amt_grouped_browser_dr3.py",
        "backend/scripts/qualify_online_amt_grouped_browser_dr2.py",
        "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs",
        "backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs",
        "backend/research/online_amt_grouped_manifest_dr3.py",
        "apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts",
        "apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts",
    ]
    return {path: sha256_file(repo_root / path) for path in paths}


def run(cmd: list[str], cwd: Path, attempted: list[dict[str, Any]], timeout: int) -> dict[str, Any]:
    completed = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, timeout=timeout, check=False)
    row = {
        "command": cmd,
        "exitCode": completed.returncode,
        "stdoutTail": completed.stdout[-4000:],
        "stderrTail": completed.stderr[-4000:],
    }
    attempted.append(row)
    return {**row, "stdout": completed.stdout}


def write_report(reports_dir: Path, report: dict[str, Any]) -> None:
    (reports_dir / REPORT_NAME).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(repo_root: Path, args: list[str]) -> str:
    return subprocess.check_output(["git", *args], cwd=repo_root, text=True).strip()


if __name__ == "__main__":
    raise SystemExit(main())
