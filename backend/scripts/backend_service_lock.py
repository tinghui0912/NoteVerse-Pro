"""Generate/check API and Beat resolutions without changing capability ownership."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import difflib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import venv

TOOL = "backend/requirements/backend-service-lock-tool.txt"
TARGET = "x86_64-manylinux_2_36"
BOOTSTRAP = frozenset({"pip", "setuptools", "wheel", "packaging"})


@dataclass(frozen=True)
class Role:
    input: str
    lock: str


ROLES = {
    role: Role(f"backend/requirements/{role}-image.in",
               f"backend/requirements/{role}-image-py312-linux-amd64.lock")
    for role in ("api", "beat")
}


def role_paths(role: str) -> Role:
    if role not in ROLES:
        raise ValueError("Service lock role must be explicitly api or beat")
    return ROLES[role]


def header(role: str) -> str:
    role_paths(role)
    return (
        f"# GENERATED {role.upper()} image / Linux amd64 / CPython 3.12 / Bookworm resolution. DO NOT EDIT.\n"
        f"# Generate: python backend/scripts/backend_service_lock.py --role {role} --generate\n"
        f"# Check:    python backend/scripts/backend_service_lock.py --role {role} --check\n"
        "# Ordinary checks preserve selected versions; --upgrade is an explicit review event.\n"
    )


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


@dataclass(frozen=True)
class Entry:
    version: str
    requirement: str


def read_lock(path: Path, role: str) -> dict[str, Entry]:
    """Accept only this role/target's exact hashed PyPI distribution entries."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith(header(role)):
        raise ValueError("Service lock role/target/header mismatch")
    entries: dict[str, Entry] = {}
    # The current service graph uses PyPI versions, not ambiguous direct URLs.
    version = r"[0-9]+(?:\.[0-9]+)*(?:(?:a|b|rc)[0-9]+)?(?:\.post[0-9]+)?(?:\.dev[0-9]+)?(?:\+[a-z0-9]+(?:[._-][a-z0-9]+)*)?"
    pattern = re.compile(r"([A-Za-z0-9][A-Za-z0-9_.-]*)==(" + version + r")((?:\s+--hash=sha256:[a-f0-9]{64})+)")
    for raw in text.replace("\\\n", " ").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = pattern.fullmatch(line)
        if not match:
            raise ValueError(f"Service target lock requires exact hashed entries without markers/URLs: {line[:160]!r}")
        name, selected, _ = match.groups()
        key = normalize(name)
        if key in entries:
            raise ValueError(f"Duplicate locked distribution: {key}")
        entries[key] = Entry(selected, line)
    if not entries:
        raise ValueError("Empty service lock")
    return entries


def bootstrap_requirements(path: Path, role: str) -> str:
    entries = read_lock(path, role)
    if not BOOTSTRAP.issubset(entries):
        raise ValueError("Service lock is missing packaging/build tools")
    return "\n".join(entries[name].requirement for name in sorted(BOOTSTRAP)) + "\n"


def installed_versions() -> dict[str, str]:
    actual: dict[str, str] = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata["Name"]
        if not name:
            raise ValueError("Installed distribution has no name")
        key = normalize(name)
        if key in actual and actual[key] != distribution.version:
            raise ValueError(f"Ambiguous active distribution versions: {key}")
        actual[key] = distribution.version
    return dict(sorted(actual.items()))


def check_installed(path: Path, role: str) -> dict[str, str]:
    expected = {name: entry.version for name, entry in read_lock(path, role).items()}
    actual = installed_versions()
    differences = [
        f"{name}: locked={expected.get(name)!r}, installed={actual.get(name)!r}"
        for name in sorted(expected.keys() | actual.keys())
        if expected.get(name) != actual.get(name)
    ]
    if differences:
        raise ValueError("Installed environment differs from service lock:\n" + "\n".join(differences))
    print(f"BACKEND_SERVICE_LOCK role={role} ACTIVE_JSON=" + json.dumps(actual, sort_keys=True))
    print(f"Service {role} installed environment exactly matches lock: {len(actual)} unique normalized active distributions")
    return actual


def require_generation_target() -> None:
    if sys.version_info[:2] != (3, 12) or platform.system() != "Linux" or platform.machine() != "x86_64":
        raise ValueError("Generate service locks in Linux amd64 CPython 3.12 (use the quality container)")


def resolver_version(repo: Path) -> str:
    logical = (repo / TOOL).read_text(encoding="utf-8").replace("\\\n", " ")
    lines = [line.strip() for line in logical.splitlines() if line.strip() and not line.startswith("#")]
    if len(lines) != 1:
        raise ValueError("Expected one hashed stable service uv pin")
    match = re.fullmatch(r"uv==([0-9]+\.[0-9]+\.[0-9]+)\s+--hash=sha256:[a-f0-9]{64}", lines[0])
    if not match:
        raise ValueError("Expected one hashed stable service uv pin")
    return match.group(1)


def generate(repo: Path, role: str, uv: Path, output: Path, *, upgrade: bool = False) -> bytes:
    require_generation_target()
    paths = role_paths(role)
    version = resolver_version(repo)
    found = subprocess.check_output([str(uv), "--version"], text=True).strip()
    if not re.fullmatch(r"uv " + re.escape(version) + r"(?: \([^\n]+\))?", found):
        raise ValueError(f"Expected uv {version}, got {found}")
    current = repo / paths.lock
    if current.exists():
        read_lock(current, role)
        # Existing-output version preferences preserve reviewed resolution in CI.
        output.write_text(current.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    env = {key: value for key, value in os.environ.items() if not key.startswith(("UV_", "PIP_"))}
    env.update(UV_PYTHON_DOWNLOADS="never", UV_HTTP_TIMEOUT="120", UV_CONCURRENT_DOWNLOADS="8")
    command = [
        str(uv), "pip", "compile", paths.input, "--python", sys.executable,
        "--python-version", "3.12", "--python-platform", TARGET,
        "--no-python-downloads", "--no-managed-python", "--no-config",
        "--default-index", "https://pypi.org/simple", "--generate-hashes",
        "--no-header", "--no-annotate", "--quiet", "--output-file", str(output),
    ]
    if upgrade:
        command.append("--upgrade")
    subprocess.run(command, cwd=repo, env=env, check=True)
    result = header(role).encode() + output.read_bytes()
    output.write_bytes(result)
    read_lock(output, role)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role", choices=tuple(ROLES), required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--check", action="store_true")
    modes.add_argument("--generate", action="store_true")
    modes.add_argument("--bootstrap-requirements", action="store_true")
    modes.add_argument("--check-installed", action="store_true")
    parser.add_argument("--lock", type=Path, help="Runtime lock location; role/header still validated")
    parser.add_argument("--uv", type=Path, help="Existing resolver, checked against the separate service pin")
    parser.add_argument("--upgrade", action="store_true", help="Explicit reviewed generation event only")
    args = parser.parse_args(argv)
    if args.upgrade and not args.generate:
        parser.error("--upgrade requires --generate; ordinary CI never upgrades")
    if args.lock and (args.check or args.generate):
        parser.error("Generation/freshness use only the governed role-specific lock path")
    lock = args.lock or args.repo / role_paths(args.role).lock
    try:
        if args.bootstrap_requirements:
            print(bootstrap_requirements(lock, args.role), end="")
            return 0
        if args.check_installed:
            check_installed(lock, args.role)
            return 0
        require_generation_target()
        with tempfile.TemporaryDirectory(prefix="noteverse-service-lock-") as directory:
            temporary = Path(directory)
            uv = args.uv
            if uv is None:
                tool_env = temporary / "resolver"
                venv.EnvBuilder(with_pip=True).create(tool_env)
                subprocess.run([
                    str(tool_env / "bin/python"), "-m", "pip", "--isolated", "install", "--require-hashes",
                    "--disable-pip-version-check", "--index-url", "https://pypi.org/simple",
                    "-r", str(args.repo / TOOL),
                ], check=True)
                uv = tool_env / "bin/uv"
            generated = generate(args.repo.resolve(), args.role, uv, temporary / "service.lock", upgrade=args.upgrade)
            if args.check:
                existing = lock.read_bytes()
                if existing != generated:
                    print("".join(difflib.unified_diff(
                        existing.decode().splitlines(keepends=True), generated.decode().splitlines(keepends=True),
                        fromfile="checked-in lock", tofile="regenerated lock",
                    )), file=sys.stderr)
                    raise ValueError(f"Stale {args.role} lock. Run: python backend/scripts/backend_service_lock.py --role {args.role} --generate")
                print(f"Service {args.role} generated lock is fresh (versions preserved; working tree untouched)")
            else:
                lock.write_bytes(generated)
                print(f"Generated {lock}: {len(read_lock(lock, args.role))} unique normalized lock entries")
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Service lock check failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
