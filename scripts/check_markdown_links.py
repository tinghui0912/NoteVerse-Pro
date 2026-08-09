"""Validate local Markdown links in tracked repository documentation.

External URLs and mail links are intentionally out of scope. This check catches
repository-relative links that point at missing files or directories, including
links that escape the repository root.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
LINK_OPEN_PATTERN = re.compile(r"\]\(\s*")


def tracked_markdown_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [REPOSITORY_ROOT / entry for entry in result.stdout.splitlines() if entry]


def local_target(raw_target: str) -> str | None:
    target = raw_target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc:
        return None
    return unquote(parsed.path)


def markdown_link_targets(content: str):
    """Yield Markdown link targets while accepting parentheses in local paths."""

    for match in LINK_OPEN_PATTERN.finditer(content):
        start = match.end()
        depth = 1
        index = start
        while index < len(content):
            character = content[index]
            if character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
                if depth == 0:
                    yield match.start(), content[start:index]
                    break
            index += 1


def is_inside_repository(path: Path) -> bool:
    try:
        path.relative_to(REPOSITORY_ROOT)
    except ValueError:
        return False
    return True


def main() -> int:
    errors: list[str] = []
    for markdown_file in tracked_markdown_files():
        content = markdown_file.read_text(encoding="utf-8")
        for position, raw_target in markdown_link_targets(content):
            target = local_target(raw_target)
            if not target:
                continue
            candidate = (markdown_file.parent / target).resolve()
            line = content.count("\n", 0, position) + 1
            if not is_inside_repository(candidate):
                message = f"{markdown_file.relative_to(REPOSITORY_ROOT)}:{line}"
                errors.append(f"{message}: link escapes repository: {target}")
            elif not candidate.exists():
                errors.append(
                    f"{markdown_file.relative_to(REPOSITORY_ROOT)}:{line}: missing target: {target}"
                )

    if errors:
        print("Markdown link validation failed:", file=sys.stderr)
        print("\n".join(errors), file=sys.stderr)
        return 1

    print("Markdown links are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
