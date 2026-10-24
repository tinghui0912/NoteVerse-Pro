"""Generate/check the CPU Worker resolution; never rewrite source during --check."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import difflib
import importlib.metadata
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit
import venv

INPUT = "backend/requirements/worker-image.in"
LOCK = "backend/requirements/worker-image-py312-linux-amd64.lock"
TOOL = "backend/requirements/worker-lock-tool.txt"
TARGET = "x86_64-manylinux_2_36"
BOOTSTRAP = frozenset({"pip", "setuptools", "wheel", "packaging"})
HEADER = (
    "# GENERATED Worker CPU / Linux amd64 / CPython 3.12 resolution. DO NOT EDIT.\n"
    "# Generate: python backend/scripts/worker_lock.py --generate\n"
    "# Check:    python backend/scripts/worker_lock.py --check\n"
    "# Ordinary checks reuse locked versions; --upgrade is an explicit review event.\n"
)


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


@dataclass(frozen=True)
class Entry:
    version: str
    requirement: str


def read_lock(path: Path) -> dict[str, Entry]:
    """Require exact versions/artifacts and SHA-256 hashes, including sdists."""
    text = path.read_text(encoding="utf-8")
    logical = text.replace("\\\n", " ")
    entries: dict[str, Entry] = {}
    for raw in logical.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        hashes = re.findall(r"--hash=sha256:([a-f0-9]{64})(?=\s|$)", line)
        if not hashes or ";" in line:
            raise ValueError(f"Worker target lock requires exact hashed entries: {line[:160]!r}")
        requirement = line.split(" --hash=", 1)[0].strip()
        pinned = re.fullmatch(r"([A-Za-z0-9_.-]+)==([^\s]+)", requirement)
        direct = re.fullmatch(r"([A-Za-z0-9_.-]+) @ (https://\S+)", requirement)
        if pinned:
            name, version = pinned.groups()
        elif direct:
            name, url = direct.groups()
            filename = unquote(urlsplit(url).path).rsplit("/", 1)[-1]
            parts = filename.split("-")
            if len(parts) != 5 or not filename.endswith(".whl"):
                raise ValueError("Only exact wheel URLs are supported in this Worker lock")
            version = parts[1]
            if normalize(name) != normalize(parts[0]):
                raise ValueError("Wheel filename does not match distribution")
        else:
            raise ValueError(f"Unpinned/unsupported lock requirement: {requirement}")
        key = normalize(name)
        if key in entries:
            raise ValueError(f"Duplicate locked distribution: {key}")
        entries[key] = Entry(version, line)
    if not entries:
        raise ValueError("Empty Worker lock")
    return entries


def bootstrap_requirements(lock: Path) -> str:
    entries = read_lock(lock)
    if not BOOTSTRAP.issubset(entries):
        raise ValueError("Worker lock is missing pinned packaging/build tools")
    return "\n".join(entries[name].requirement for name in sorted(BOOTSTRAP)) + "\n"


def check_installed(lock: Path) -> None:
    expected = {name: e.version for name, e in read_lock(lock).items()}
    actual = {
        normalize(d.metadata["Name"]): d.version
        for d in importlib.metadata.distributions()
        if d.metadata["Name"]
    }
    differences = [
        f"{name}: locked={expected.get(name)!r}, installed={actual.get(name)!r}"
        for name in sorted(expected.keys() | actual.keys())
        if expected.get(name) != actual.get(name)
    ]
    if differences:
        raise ValueError("Installed environment differs from Worker lock:\n" + "\n".join(differences))
    print("Worker installed distribution versions exactly match generated lock")


def resolver_version(repo: Path) -> str:
    match = re.search(r"^uv==([0-9]+\.[0-9]+\.[0-9]+)\b", (repo / TOOL).read_text(), re.M)
    if not match:
        raise ValueError("Expected one pinned stable uv version")
    return match.group(1)


def generate(repo: Path, uv: Path, output: Path, *, upgrade: bool = False) -> bytes:
    if sys.version_info[:2] != (3, 12) or platform.system() != "Linux" or platform.machine() != "x86_64":
        raise ValueError("Generate Worker lock in Linux amd64 CPython 3.12 (use the quality container)")
    version = resolver_version(repo)
    found = subprocess.check_output([str(uv), "--version"], text=True).strip()
    if not re.fullmatch(r"uv " + re.escape(version) + r"(?: \([^\n]+\))?", found):
        raise ValueError(f"Expected uv {version}, got {found}")
    current = repo / LOCK
    if current.exists():
        output.write_bytes(current.read_bytes())  # uv's existing-output version preferences.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("UV_", "PIP_"))}
    env["UV_PYTHON_DOWNLOADS"] = "never"
    env["UV_HTTP_TIMEOUT"] = "120"
    env["UV_CONCURRENT_DOWNLOADS"] = "8"
    command = [
        str(uv), "pip", "compile", INPUT, "--python", sys.executable,
        "--python-version", "3.12", "--python-platform", TARGET,
        "--no-python-downloads", "--no-managed-python", "--no-config",
        "--default-index", "https://pypi.org/simple", "--generate-hashes",
        "--no-header", "--no-annotate", "--quiet", "--output-file", str(output),
    ]
    if upgrade:
        command.append("--upgrade")
    subprocess.run(command, cwd=repo, env=env, check=True)
    # Custom stable header excludes temporary paths and machine-specific commands.
    result = HEADER.encode() + output.read_bytes()
    output.write_bytes(result)
    read_lock(output)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--check", action="store_true")
    modes.add_argument("--generate", action="store_true")
    modes.add_argument("--bootstrap-requirements", action="store_true")
    modes.add_argument("--check-installed", action="store_true")
    parser.add_argument("--lock", type=Path)
    parser.add_argument("--uv", type=Path, help="Existing resolver, still checked against the tool pin")
    parser.add_argument("--upgrade", action="store_true", help="Explicit reviewed lock upgrade only")
    args = parser.parse_args(argv)
    if args.upgrade and not args.generate:
        parser.error("--upgrade requires --generate; CI never upgrades")
    lock = args.lock or args.repo / LOCK
    try:
        if args.bootstrap_requirements:
            print(bootstrap_requirements(lock), end="")
            return 0
        if args.check_installed:
            check_installed(lock)
            return 0
        with tempfile.TemporaryDirectory(prefix="noteverse-worker-lock-") as directory:
            temporary = Path(directory)
            uv = args.uv
            if uv is None:
                tool_env = temporary / "resolver"
                venv.EnvBuilder(with_pip=True).create(tool_env)
                python = tool_env / "bin/python"
                subprocess.run([
                    str(python), "-m", "pip", "--isolated", "install", "--require-hashes",
                    "--disable-pip-version-check", "--index-url", "https://pypi.org/simple",
                    "-r", str(args.repo / TOOL),
                ], check=True)
                uv = tool_env / "bin/uv"
            generated = generate(args.repo.resolve(), uv, temporary / "worker.lock", upgrade=args.upgrade)
            if args.check:
                existing = lock.read_bytes()
                if existing != generated:
                    print("".join(difflib.unified_diff(
                        existing.decode().splitlines(keepends=True), generated.decode().splitlines(keepends=True),
                        fromfile="checked-in lock", tofile="regenerated lock",
                    )), file=sys.stderr)
                    raise ValueError("Stale Worker lock. Run: python backend/scripts/worker_lock.py --generate")
                print("Worker generated lock is fresh (versions preserved; working tree untouched)")
            else:
                lock.write_bytes(generated)
                print(f"Generated {lock}: {len(read_lock(lock))} unique normalized distribution entries")
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Worker lock check failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
