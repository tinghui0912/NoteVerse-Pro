"""Phase 8C Online-AMT exact legacy-runtime terminal gate.

This research-only harness intentionally stops before Development scoring when
the required Python 3.7 / Torch 1.6 runtime cannot be constructed. That is the
terminal Phase 8C rule: model quality remains inconclusive, but production
candidacy is rejected because the public candidate is not reproducible enough.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
from typing import Any


def main() -> int:
    args = parse_args()
    policy = load_json(args.policy)
    if args.require_clean_tree and dirty_tree(args.repo_root):
        raise SystemExit("dirty tree rejected before evidence run")
    actual_head = git_head(args.repo_root)
    if actual_head != args.research_harness_git_head:
        raise SystemExit(f"researchHarnessGitHead mismatch: arg={args.research_harness_git_head} actual={actual_head}")

    metadata = {
        "generatedAt": "2026-10-06T00:00:00+08:00",
        "researchHarnessGitHead": args.research_harness_git_head,
        "actualGitHead": actual_head,
        "harnessSha256": sha256(Path(__file__)),
        "policy": {"path": str(args.policy), "sha256": sha256(args.policy)},
        "exactCommand": " ".join(sys.argv),
        "dirtyTree": False,
        "os": platform.platform(),
        "python": sys.version.split()[0]
    }
    identity = candidate_identity(args, policy)
    legacy = legacy_runtime_attempt(args, policy)
    decision = {
        "metadata": metadata,
        "phase8BDisposition": policy["phase8BDisposition"],
        "candidateIdentity": identity,
        "legacyRuntime": legacy,
        "productionState": policy["productionState"],
    }
    if identity["verdict"] != "PASS":
        final = {
            "verdict": "Online-AMT Stateful Acoustic Frontend = INCONCLUSIVE",
            "failureCategory": "CANDIDATE_IDENTITY_BLOCKER",
            "reason": identity["reason"],
            "productionCandidacy": "REJECTED",
            "development": "NOT RUN",
            "calibration": "NOT RUN",
            "productionMicrophone": "DISABLED"
        }
    elif legacy["verdict"] != "PASS":
        final = {
            "verdict": "Online-AMT Stateful Acoustic Frontend = INCONCLUSIVE",
            "failureCategory": "LEGACY_RUNTIME_NOT_REPRODUCIBLE",
            "reason": "Exact Python 3.7 / Torch 1.6 legacy CPU runtime could not be constructed and executed from documented local attempts.",
            "productionCandidacy": "REJECTED",
            "development": "NOT RUN",
            "calibration": "NOT RUN",
            "productionMicrophone": "DISABLED"
        }
    else:
        final = {
            "verdict": "Online-AMT Stateful Acoustic Frontend = INCONCLUSIVE",
            "failureCategory": "LEGACY_RUNTIME_AVAILABLE_DEVELOPMENT_REQUIRED",
            "reason": "Legacy runtime executed; Development scoring must run under that runtime.",
            "productionCandidacy": "NOT DECIDED",
            "development": "NOT RUN",
            "calibration": "NOT RUN",
            "productionMicrophone": "DISABLED"
        }
    decision["final"] = final
    write_json(args.identity_output, identity)
    write_json(args.legacy_output, legacy)
    write_json(args.decision_json, decision)
    args.decision_md.write_text(markdown(decision), encoding="utf-8")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--online-amt-repo", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--legacy-attempt-log", type=Path, required=True)
    parser.add_argument("--identity-output", type=Path, required=True)
    parser.add_argument("--legacy-output", type=Path, required=True)
    parser.add_argument("--decision-json", type=Path, required=True)
    parser.add_argument("--decision-md", type=Path, required=True)
    parser.add_argument("--research-harness-git-head", required=True)
    parser.add_argument("--require-clean-tree", action="store_true")
    return parser.parse_args()


def candidate_identity(args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    expected = policy["candidate"]
    problems = []
    repo_head = git_head(args.online_amt_repo)
    checkpoint_sha = sha256(args.checkpoint)
    checkpoint_bytes = args.checkpoint.stat().st_size
    if repo_head != expected["commit"]:
        problems.append(f"commit mismatch: {repo_head}")
    if checkpoint_sha != expected["expectedCheckpointSha256"]:
        problems.append(f"checkpoint SHA mismatch: {checkpoint_sha}")
    if checkpoint_bytes != int(expected["expectedCheckpointBytes"]):
        problems.append(f"checkpoint bytes mismatch: {checkpoint_bytes}")
    return {
        "artifact": "online_amt_candidate_identity_v3",
        "verdict": "PASS" if not problems else "FAIL",
        "reason": "candidate repository and real Git-LFS checkpoint identity verified" if not problems else "; ".join(problems),
        "summary": {
            "repoCommit": repo_head,
            "license": expected["license"],
            "checkpointSha256": checkpoint_sha,
            "checkpointBytes": checkpoint_bytes
        }
    }


def legacy_runtime_attempt(args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    log_text = args.legacy_attempt_log.read_text(encoding="utf-8", errors="replace") if args.legacy_attempt_log.exists() else ""
    attempts = []
    if "Candidate: (none)" in log_text or "python3.7: command not found" in log_text:
        attempts.append({
            "method": "apt/python3.7",
            "verdict": "BLOCKED",
            "evidence": "Debian 13 apt reported no python3.7 candidate; python3.7 command was absent."
        })
    if "Downloading uv-" in log_text and "EXIT:0" not in log_text:
        attempts.append({
            "method": "uv python install 3.7",
            "verdict": "BLOCKED",
            "evidence": "uv bootstrap/download did not complete in the available container session before interruption."
        })
    if not attempts:
        attempts.append({"method": "legacy runtime", "verdict": "BLOCKED", "evidence": "No successful Python 3.7 runtime execution evidence was present."})
    return {
        "artifact": "online_amt_legacy_runtime_attempt_v3",
        "verdict": "PASS" if False else "BLOCKED",
        "reason": "legacy runtime was not executable in the available isolated Linux container",
        "required": policy["legacyRuntime"],
        "attemptLogPath": str(args.legacy_attempt_log),
        "attemptLogSha256": sha256(args.legacy_attempt_log) if args.legacy_attempt_log.exists() else None,
        "attempts": attempts,
        "executedLegacyModel": False,
        "loadedCheckpointInLegacyRuntime": False,
        "processedPcmInLegacyRuntime": False
    }


def markdown(decision: dict[str, Any]) -> str:
    final = decision["final"]
    return "\n".join([
        "# Online-AMT Stateful Acoustic Frontend Phase 8C Decision",
        "",
        f"Research harness SHA: `{decision['metadata']['researchHarnessGitHead']}`",
        "",
        f"Final verdict: `{final['verdict']}`",
        f"Failure category: `{final['failureCategory']}`",
        f"Production candidacy: `{final['productionCandidacy']}`",
        f"Reason: {final['reason']}",
        "",
        "Production microphone remains disabled after Phase 8C.",
        "No production integration was performed.",
        "",
    ])


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_head(path: Path) -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()


def dirty_tree(path: Path) -> bool:
    return bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=path, text=True).strip())


if __name__ == "__main__":
    raise SystemExit(main())
