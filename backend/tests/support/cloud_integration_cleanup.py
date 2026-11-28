"""Exact-locator cloud teardown for the isolated cross-end test database."""

import os
from uuid import UUID, uuid5
from sqlalchemy import select
from sqlalchemy.engine import make_url
from app.db.models import ObjectWriteIntent, Score, StoredObject, UploadSession
from app.storage.s3_compatible import S3CompatibleObjectStorage
from app.modules.media_storage.domain import ObjectWriteIntentStatus
from app.shared.time import utc_now
import time
from app.runtime.customer_api.context import get_context
from app.platform.config.storage import ObjectStorageConfig

settings = get_context().settings


def registered_keys(db, run_id: str) -> set[str]:
    namespace = UUID(run_id)
    score_uuid = str(uuid5(namespace, "score"))
    revision_uuid = str(uuid5(namespace, "revision"))
    if any(value != score_uuid for value in db.scalars(select(Score.score_uuid))):
        raise RuntimeError("Unexpected Score ownership in integration database")
    intents = list(db.scalars(select(ObjectWriteIntent)))
    if any(
        row.status in (ObjectWriteIntentStatus.WRITING, ObjectWriteIntentStatus.WRITE_UNKNOWN)
        for row in intents
    ):
        raise RuntimeError("Unknown write IO retains integration cleanup responsibility")
    allowed = {f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"}
    transfer_keys: set[str] = set()
    for session in db.scalars(select(UploadSession)):
        if session.operation_unknown:
            raise RuntimeError("Unknown transfer IO retains integration cleanup responsibility")
        if session.purpose.value != "SCORE_IMPORT":
            raise RuntimeError("Unexpected transfer purpose in integration database")
        transfer_keys.update((session.object_key, session.final_object_key))
        allowed.update(transfer_keys)
    registered = set(db.scalars(select(StoredObject.object_key))) | set(
        db.scalars(select(ObjectWriteIntent.object_key))
    )
    if not registered <= allowed:
        raise RuntimeError("Unrecognized physical responsibility; preserve integration database")
    return registered | transfer_keys


def main() -> int:
    url = make_url(settings.DATABASE_URL)
    if url.database != "noteverse_test_integration" or url.host != "postgres":
        raise RuntimeError("Cloud teardown requires the isolated integration database")
    with get_context().sessions() as db:
        keys = registered_keys(db, os.environ["NOTEVERSE_INTEGRATION_RUN_ID"])
        capabilities = [
            row.capability_expires_at
            for row in db.scalars(select(UploadSession))
            if row.capability_expires_at is not None
        ]
    remaining = max(((value - utc_now()).total_seconds() for value in capabilities), default=0)
    if remaining > 180:
        raise RuntimeError("Live upload capabilities retain integration cleanup responsibility")
    if remaining > 0:
        print(
            f"Cloud teardown waits for issued upload capabilities: {int(remaining) + 1} seconds",
            flush=True,
        )
        deadline = max(capabilities)
        while (remaining := (deadline - utc_now()).total_seconds()) > 0:
            time.sleep(min(5, remaining))
    storage = S3CompatibleObjectStorage(
        config=ObjectStorageConfig.model_validate(get_context().settings.model_dump())
    )
    failures = []
    for key in sorted(keys):
        try:
            for upload_id in storage.list_multipart_uploads(key):
                storage.abort_multipart_upload(key, upload_id)
            storage.delete(key)
            for page in storage.client.get_paginator("list_object_versions").paginate(
                Bucket=storage.bucket, Prefix=key
            ):
                for item in [*page.get("Versions", []), *page.get("DeleteMarkers", [])]:
                    if item["Key"] == key:
                        storage.client.delete_object(
                            Bucket=storage.bucket, Key=key, VersionId=item["VersionId"]
                        )
            if storage.exists(key) or storage.list_multipart_uploads(key):
                raise RuntimeError("Physical responsibility remains")
            for page in storage.client.get_paginator("list_object_versions").paginate(
                Bucket=storage.bucket, Prefix=key
            ):
                if any(
                    item["Key"] == key
                    for item in [*page.get("Versions", []), *page.get("DeleteMarkers", [])]
                ):
                    raise RuntimeError("Object version responsibility remains")
        except Exception as error:
            failures.append(type(error).__name__)
    print(
        f"Integration cloud cleanup: {len(keys)} exact locators checked; {len(failures)} unsettled"
    )
    if failures:
        print("Preserve integration database; safe failure types: " + ", ".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
