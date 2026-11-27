"""Rebuild revision metadata projections from canonical MusicXML revision sources."""

from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db.models import RevisionMetadataOutbox
from app.db.session import SessionLocal
from app.modules.revisions.metadata_delivery import metadata_delivery
from app.modules.revisions.metadata_dispatch import dispatch_revision_metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision-id", type=int, default=None)
    args = parser.parse_args()

    with SessionLocal() as db:
        statement = select(RevisionMetadataOutbox.outbox_uuid).order_by(RevisionMetadataOutbox.id)
        if args.revision_id is not None:
            statement = statement.where(RevisionMetadataOutbox.revision_id == args.revision_id)
        identities = list(db.execute(statement).scalars().all())
        for uuid in identities:
            metadata_delivery.rearm(db, uuid)
        db.commit()
    for uuid in identities:
        dispatch_revision_metadata(uuid)
    print(f"Admitted metadata rebuild for {len(identities)} revision(s).")


if __name__ == "__main__":
    main()
