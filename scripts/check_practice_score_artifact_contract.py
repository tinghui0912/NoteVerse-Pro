from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path
from typing import Any
from uuid import uuid4


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
CANONICAL_MUSICXML = BACKEND_ROOT / "tests/fixtures/musicxml/canonical-practice-score.musicxml"
BROWSER_FIXTURE = (
    REPO_ROOT
    / "apps"
    / "customer-web"
    / "src"
    / "lib"
    / "practice"
    / "__fixtures__"
    / "canonical-practice-score-artifact.json"
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare the backend canonical PracticeScoreArtifact with the checked browser fixture."
    )
    parser.add_argument("--fixture-path", "--fixture", type=Path, default=BROWSER_FIXTURE)
    parser.add_argument(
        "--self-test-missing-fixture",
        action="store_true",
        help="Return success only if a missing fixture is rejected.",
    )
    args = parser.parse_args()

    if args.self_test_missing_fixture:
        missing = Path("/tmp") / f"noteverse-contract-missing-{uuid4().hex}.json"
        try:
            compare_fixture(missing)
        except FileNotFoundError:
            return 0
        print("Missing fixture did not fail the contract check.", file=sys.stderr)
        return 1

    compare_fixture(args.fixture_path)
    print(f"canonical PracticeScoreArtifact fixture matches: {args.fixture_path}")
    return 0


def compare_fixture(fixture_path: Path) -> None:
    if not fixture_path.exists():
        raise FileNotFoundError(f"Required browser artifact fixture is missing: {fixture_path}")

    produced = _canonical_artifact()
    expected = json.loads(fixture_path.read_text(encoding="utf-8-sig"))
    produced_normalized = _normalized_json(produced)
    expected_normalized = _normalized_json(expected)
    if produced_normalized != expected_normalized:
        diff = "\n".join(
            difflib.unified_diff(
                expected_normalized.splitlines(),
                produced_normalized.splitlines(),
                fromfile=str(fixture_path),
                tofile="backend canonical producer",
                lineterm="",
            )
        )
        raise AssertionError(f"Canonical PracticeScoreArtifact fixture drifted:\n{diff}")


def _canonical_artifact() -> dict[str, Any]:
    sys.path.insert(0, str(BACKEND_ROOT))
    from app.modules.practice.score.compiler.musicxml import compile_practice_score
    from app.modules.practice.score.timeline import practice_timeline_from_compiled
    from app.modules.practice.score.artifact import practice_score_artifact_from_timeline

    compiled = compile_practice_score(CANONICAL_MUSICXML.read_bytes())
    timeline = practice_timeline_from_compiled(compiled)

    return practice_score_artifact_from_timeline(
        timeline,
        score_id="canonical-local-core-score",
        revision_id="canonical-local-core-revision",
        score_tempo_segments=compiled.tempo_segments,
    )


def _normalized_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
