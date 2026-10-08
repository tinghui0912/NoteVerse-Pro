"""Generate NoteVerse PracticeScoreArtifact files for Vienna 4x22 scores.

Research-only helper. It uses the existing backend Practice score pipeline and
does not implement a second MusicXML interpretation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any


def _seed_minimal_backend_env() -> None:
    defaults = {
        "SECRET_KEY": "research-only-secret-key-000000000000",
        "AUTH_COOKIE_NAME": "auth",
        "REFRESH_COOKIE_NAME": "refresh",
        "CSRF_COOKIE_NAME": "csrf",
        "CSRF_HEADER_NAME": "x-csrf",
        "AUTH_COOKIE_SECURE": "false",
        "AUTH_COOKIE_SAMESITE": "lax",
        "LOG_FORMAT": "console",
        "FRONTEND_BASE_URL": "http://localhost:3000",
        "PRACTICE_SOUNDFONT_PATH": "",
        "PLAYBACK_SOUNDFONT_PATH": "",
        "REALTIME_EVENT_CLEANUP_INTERVAL_SECONDS": "60",
        "REALTIME_EVENT_RETENTION_DAYS": "1",
        "HF_MODEL_REPOSITORIES": "{}",
        "BACKEND_CORS_ORIGINS": '["http://localhost:3000"]',
        "TRUSTED_PROXY_CIDRS": "[]",
        "DATABASE_URL": "postgresql+asyncpg://user:password@localhost/noteverse",
        "SYNC_DATABASE_URL": "postgresql+psycopg://user:password@localhost/noteverse",
        "SCHEDULER_LOCK_DATABASE_URL": "postgresql+psycopg://user:password@localhost/noteverse",
        "REDIS_URL": "redis://localhost:6379/0",
        "CELERY_BROKER_URL": "redis://localhost:6379/0",
        "CELERY_RESULT_BACKEND": "redis://localhost:6379/1",
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--musicxml-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--metadata-commit", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()

    _seed_minimal_backend_env()

    from app.processing.practice_score.practice_score_artifact import (
        practice_score_artifact_from_timeline,
    )
    from app.processing.practice_score.score_loader import (
        practice_score_timeline_from_musicxml,
    )
    from app.processing.practice_score.tempo import (
        practice_tempo_segments_from_musicxml,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "artifact": "vienna_practice_score_artifact_generation_receipt",
        "metadataCommit": args.metadata_commit,
        "pieces": [],
    }
    for musicxml_path in sorted(args.musicxml_root.glob("*.musicxml")):
        piece_id = musicxml_path.stem
        timeline = practice_score_timeline_from_musicxml(musicxml_path)
        tempo_segments = practice_tempo_segments_from_musicxml(musicxml_path)
        artifact = practice_score_artifact_from_timeline(
            timeline,
            score_id=f"vienna-4x22:{piece_id}",
            revision_id=f"{args.metadata_commit}:{sha256_file(musicxml_path)[:16]}",
            score_tempo_segments=tempo_segments,
        )
        output_path = args.output_dir / f"{piece_id}.practice-score-artifact.json"
        output_path.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        receipt["pieces"].append({
            "pieceId": piece_id,
            "musicXmlPath": str(musicxml_path).replace("\\", "/"),
            "musicXmlSha256": sha256_file(musicxml_path),
            "practiceScoreArtifactPath": str(output_path).replace("\\", "/"),
            "practiceScoreArtifactSha256": sha256_file(output_path),
            "artifactId": artifact["artifactId"],
            "expectedPracticeGroupCount": len(artifact["expectedPracticeGroups"]),
        })
    args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(args.receipt)
    return 0


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
