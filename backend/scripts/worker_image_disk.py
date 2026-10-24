"""Phase-scoped cleanup for ephemeral GitHub-hosted Worker runners only."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess

SDK_PATHS = (
    "/usr/local/lib/android", "/usr/share/dotnet", "/opt/ghc", "/opt/hostedtoolcache/CodeQL",
)


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=check)


def report(label: str) -> None:
    print(f"WORKER_DISK phase={label}", flush=True)
    run("df", "-h")
    run("docker", "system", "df")


def require_ephemeral_runner() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("NOTEVERSE_EPHEMERAL_RUNNER") != "github-hosted":
        raise ValueError("Cleanup is restricted to ephemeral GitHub-hosted runners; local use is report-only")


def scan_directory(root: Path, image: str, kind: str = "scan") -> Path:
    if image not in ("deps", "worker") or kind not in ("scan", "sbom"):
        raise ValueError("Unknown Worker scan phase")
    root = root.resolve(strict=True)
    destination = root / "noteverse-worker-v2" / (image + "-" + kind)
    # Reject pre-existing symlink escapes before any recursive removal.
    resolved = destination.resolve()
    if not resolved.is_relative_to(root) or resolved == root or resolved != destination:
        raise ValueError("Unsafe Worker scan temporary path")
    return destination


def cleanup(phase: str, *, builder: str, image: str, remove_images: list[str], root: Path) -> None:
    require_ephemeral_runner()
    if builder not in ("docker", "buildx"):
        raise ValueError("Unknown builder")
    if phase not in ("initial", "release", "before-scan", "after-scan", "before-sbom", "after-sbom"):
        raise ValueError("Unknown cleanup phase")
    for reference in remove_images:
        if not reference or reference.startswith("-") or any(c.isspace() for c in reference):
            raise ValueError("Invalid local image reference")
    temporary = scan_directory(root, image, "sbom" if phase.endswith("sbom") else "scan") if phase.startswith(("before-", "after-")) else None
    report(phase + "-before-" + image)
    if phase == "initial":
        for sdk_path in SDK_PATHS:
            run("sudo", "rm", "-rf", "--", sdk_path)
    if phase in ("release", "before-scan"):
        # Invoke only after a build has finished. Tagged PR images stay present;
        # trusted phases remove only explicitly named no-longer-needed pulls.
        run("docker", "buildx" if builder == "buildx" else "builder", "prune", "--all", "--force")
        for reference in remove_images:
            exists = subprocess.run(["docker", "image", "inspect", reference], capture_output=True)
            if exists.returncode == 0:
                run("docker", "image", "rm", reference)
    if temporary is not None:
        assert temporary is not None
        path = temporary
        if path.exists():
            shutil.rmtree(path)
        if phase.startswith("before-"):
            (path / "tmp").mkdir(parents=True)
            (path / "cache").mkdir()
    # Never delete Docker credentials, all of /tmp, arbitrary stopped containers,
    # or the active builder. Remote scans do not need a daemon image export.
    report(phase + "-after-" + image)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("report", "initial", "release", "before-scan", "after-scan", "before-sbom", "after-sbom"))
    parser.add_argument("--builder", choices=("docker", "buildx"), default="docker")
    parser.add_argument("--image", choices=("deps", "worker"), default="deps")
    parser.add_argument("--remove-image", action="append", default=[])
    args = parser.parse_args()
    if args.phase == "report":
        report("report-" + args.image)
    else:
        cleanup(args.phase, builder=args.builder, image=args.image,
                remove_images=args.remove_image, root=Path(os.environ["RUNNER_TEMP"]))


if __name__ == "__main__":
    main()
