"""Hash the exact, recursive Worker requirement closure without installing it."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shlex

DEFAULT_ROOTS = (
    "backend/requirements/worker-app.txt",
    "backend/requirements/ocr.txt",
)


def _included_path(line: str) -> str | None:
    stripped = line.lstrip()
    if not stripped.startswith(("-r", "--requirement", "-c", "--constraint")):
        return None
    try:
        tokens = shlex.split(stripped, comments=True)
    except ValueError as exc:
        raise ValueError(f"Malformed requirement include: {line!r}") from exc
    if len(tokens) == 2 and tokens[0] in ("-r", "--requirement"):
        value = tokens[1]
    elif len(tokens) == 1 and tokens[0].startswith("--requirement="):
        value = tokens[0].partition("=")[2]
    else:
        raise ValueError(f"Unsupported or malformed requirement include: {line!r}")
    if not value or any(c in value for c in ":$%*?[]\\"):
        raise ValueError(f"Non-local or ambiguous requirement include: {value!r}")
    return value


def resolve_closure(repo_root: Path, roots: tuple[str, ...] = DEFAULT_ROOTS) -> tuple[str, ...]:
    """Return sorted repository-relative paths; reject cycles and escaped includes."""
    repo_root = repo_root.resolve()
    requirements_root = (repo_root / "backend/requirements").resolve()
    visited: set[Path] = set()
    active: list[Path] = []

    def visit(path: Path) -> None:
        path = path.resolve()
        if not path.is_relative_to(requirements_root):
            raise ValueError(f"Requirement path escapes requirements root: {path}")
        if not path.is_file():
            raise ValueError(f"Missing requirement file: {path}")
        if path in active:
            cycle = active[active.index(path):] + [path]
            names = " -> ".join(p.relative_to(repo_root).as_posix() for p in cycle)
            raise ValueError(f"Requirement include cycle: {names}")
        if path in visited:
            return
        active.append(path)
        for line in path.read_text(encoding="utf-8").splitlines():
            included = _included_path(line)
            if included is not None:
                if Path(included).is_absolute():
                    raise ValueError(f"Absolute requirement include is not portable: {included}")
                visit(path.parent / included)
        active.pop()
        visited.add(path)

    for root in roots:
        visit(repo_root / root)
    return tuple(sorted(path.relative_to(repo_root).as_posix() for path in visited))


def requirements_digest(repo_root: Path, roots: tuple[str, ...] = DEFAULT_ROOTS) -> str:
    """SHA-256 of length-framed path identities and unmodified file bytes."""
    digest = hashlib.sha256(b"noteverse-worker-requirements-v1\0")
    for relative_path in resolve_closure(repo_root, roots):
        for value in (relative_path.encode("utf-8"), (repo_root / relative_path).read_bytes()):
            digest.update(len(value).to_bytes(8, "big"))
            digest.update(value)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="List the recursive requirement paths")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    try:
        if args.list:
            print("\n".join(resolve_closure(repo_root)))
        else:
            print(requirements_digest(repo_root))
    except (ValueError, OSError, UnicodeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
