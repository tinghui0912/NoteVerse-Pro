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
BROWSER_FIXTURE = (
    REPO_ROOT
    / "apps"
    / "customer-web"
    / "src"
    / "lib"
    / "practice"
    / "local-core"
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
    import tempfile

    from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline
    from app.processing.performance.timeline import TempoSegment
    from app.processing.practice_score.practice_score_artifact import (
        practice_score_artifact_from_timeline,
    )
    from tests.test_practice_score_artifact import _canonical_musicxml, _canonical_note_array

    with tempfile.TemporaryDirectory() as tmpdir:
        musicxml_path = Path(tmpdir) / "canonical-local-core.musicxml"
        musicxml_path.write_text(_canonical_musicxml(), encoding="utf-8")
        timeline = PracticeScoreTimeline.from_note_array(
            _canonical_note_array(),
            musicxml_path=musicxml_path,
        )

    return practice_score_artifact_from_timeline(
        timeline,
        score_id="canonical-local-core-score",
        revision_id="canonical-local-core-revision",
        tempo_segments=(TempoSegment(0.0, 120.0), TempoSegment(3.0, 90.0)),
    )


def _normalized_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
