"""Diagnose Matchmaker initialization for a pinned score revision or XML file."""
from __future__ import annotations

import argparse
import asyncio
import sys
import traceback
from pathlib import Path

from sqlalchemy import select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.models import Score, ScoreRevision, ScoreRevisionSource  # noqa: E402
from app.db.models.score import RevisionSourceFormat  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.processing.engines.matchmaker_live import build_alignment_engine  # noqa: E402
from app.storage import file_storage  # noqa: E402


async def resolve_revision_xml(score_uuid: str, revision_uuid: str | None) -> str:
    async with AsyncSessionLocal() as db:
        score = (await db.execute(select(Score).where(Score.score_uuid == score_uuid))).scalar_one_or_none()
        if not score:
            raise RuntimeError(f"Score not found: {score_uuid}")
        revision = (
            (await db.execute(select(ScoreRevision).where(ScoreRevision.revision_uuid == revision_uuid))).scalar_one_or_none()
            if revision_uuid
            else await db.get(ScoreRevision, score.head_revision_id)
        )
        if not revision or revision.score_id != score.id:
            raise RuntimeError("Revision does not belong to the score")
        source = (await db.execute(select(ScoreRevisionSource).where(
            ScoreRevisionSource.revision_id == revision.id,
            ScoreRevisionSource.format == RevisionSourceFormat.MUSICXML,
        ))).scalar_one_or_none()
        if not source:
            raise RuntimeError(f"Canonical MusicXML not found for revision: {revision.revision_uuid}")
        return file_storage.materialize_to_local(
            source.storage_key, file_storage.local_path(source.storage_key)
        )


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--score-id")
    parser.add_argument("--revision-id")
    parser.add_argument("--xml-path")
    parser.add_argument("--sample-rate", type=int, default=16000)
    args = parser.parse_args()
    if not args.score_id and not args.xml_path:
        parser.error("Either --score-id or --xml-path is required.")
    try:
        path = str(Path(args.xml_path).expanduser()) if args.xml_path else await resolve_revision_xml(args.score_id, args.revision_id)
        engine = build_alignment_engine(path, args.sample_rate, 1, "pcm_s16le")
        engine.close()
        print("[OK] practice matchmaker engine initialized")
        return 0
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
