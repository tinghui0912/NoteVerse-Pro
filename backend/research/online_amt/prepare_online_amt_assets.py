"""Prepare external Online-AMT research assets under ignored data/work paths."""

from __future__ import annotations

import argparse
import hashlib
import subprocess
from pathlib import Path


REPO_URL = "https://github.com/jdasam/online_amt"
REPO_COMMIT = "ad12550909a1d86f699097d11885f427054a5ac2"
CHECKPOINT_SHA256 = "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0"
CHECKPOINT_BYTES = 178_804_960


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("backend/data/work/online_amt"))
    parser.add_argument("--checkpoint-name", default="model-180000.pt")
    args = parser.parse_args()

    if not args.repo.exists():
        args.repo.parent.mkdir(parents=True, exist_ok=True)
        subprocess.check_call(["git", "clone", REPO_URL, str(args.repo)])
    subprocess.check_call(["git", "-C", str(args.repo), "fetch", "--all", "--tags"])
    subprocess.check_call(["git", "-C", str(args.repo), "checkout", REPO_COMMIT])
    subprocess.call(["git", "-C", str(args.repo), "lfs", "pull"])

    checkpoint = args.repo / args.checkpoint_name
    if not checkpoint.exists():
        raise SystemExit(f"checkpoint missing after checkout/LFS pull: {checkpoint}")
    actual_sha = sha256(checkpoint)
    actual_bytes = checkpoint.stat().st_size
    if actual_sha != CHECKPOINT_SHA256:
        raise SystemExit(f"checkpoint SHA256 mismatch: {actual_sha}")
    if actual_bytes != CHECKPOINT_BYTES:
        raise SystemExit(f"checkpoint byte mismatch: {actual_bytes}")
    print({
        "repo": str(args.repo),
        "commit": REPO_COMMIT,
        "checkpoint": str(checkpoint),
        "checkpointSha256": actual_sha,
        "checkpointBytes": actual_bytes,
    })
    return 0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
