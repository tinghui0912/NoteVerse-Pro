"""Rebuild revision metadata projections from canonical MusicXML revision sources."""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db.models import ScoreRevision
from app.db.sync_session import get_worker_db
from app.modules.metadata.service import rebuild_metadata_sync


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision-id", type=int, default=None)
    args = parser.parse_args()

    with get_worker_db() as db:
        statement = select(ScoreRevision.id).order_by(ScoreRevision.id)
        if args.revision_id is not None:
            statement = statement.where(ScoreRevision.id == args.revision_id)
        revision_ids = list(db.execute(statement).scalars().all())
        for revision_id in revision_ids:
            rebuild_metadata_sync(db, revision_id)
    print(f"Rebuilt metadata for {len(revision_ids)} revision(s).")


if __name__ == "__main__":
    main()
