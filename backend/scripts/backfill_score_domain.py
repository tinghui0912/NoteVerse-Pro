"""Backfill the score domain from legacy task tables before the P4 cleanup migration.

Run without flags for a rollback-only validation pass. Use ``--apply`` only after the
report contains no errors. UUID5 identifiers and content hashes make retries idempotent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import uuid
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text

from app.db.model_utils import require_persisted_id
from app.db.models import (
    AccessOrigin,
    ArtifactKind,
    MetadataStatus,
    ProcessingJob,
    ProcessingJobState,
    Score,
    ScoreArtifact,
    ScoreBookmark,
    ScoreRevision,
    ScoreRevisionMetadata,
    ScoreShareGrant,
    ShareGrantRedemption,
    ShareGrantScope,
    ShareTargetMode,
)
from app.db.models.score import RevisionOrigin, ScoreState
from app.db.worker_session import get_db_session
from app.modules.score_access.policy import hash_share_token
from app.storage import file_storage

NAMESPACE = uuid.UUID("b08693be-5391-4e0c-b804-27f6cbf51cd1")


def stable_uuid(*parts: object) -> str:
    return str(uuid.uuid5(NAMESPACE, ":".join(map(str, parts))))


def enum_value(value: object) -> str:
    return str(getattr(value, "value", value)).upper()


def processing_state(value: object) -> ProcessingJobState:
    normalized = enum_value(value)
    return ProcessingJobState(normalized if normalized in ProcessingJobState.__members__ else "FAILURE")


def read_legacy_rows(db: Any, query: str, params: dict[str, object] | None = None) -> list[Any]:
    return list(db.execute(text(query), params or {}).mappings())


def ensure_job(db: Any, task: Any) -> ProcessingJob:
    job = db.execute(select(ProcessingJob).where(ProcessingJob.job_uuid == task["task_uuid"])).scalar_one_or_none()
    if job:
        return job
    job = ProcessingJob(
        job_uuid=task["task_uuid"],
        user_id=task["user_id"],
        state=processing_state(task["state"]),
        progress=task["progress"] or 0,
        current_step=task["current_step"],
        idempotency_key=task["idempotency_key"],
        code=task["code"],
        error=task["error"],
        error_type=task["error_type"],
        requested_at=task["requested_at"],
        started_at=task["started_at"],
        last_heartbeat_at=task["last_heartbeat_at"],
        finished_at=task["finished_at"],
        created_at=task["created_at"],
        updated_at=task["updated_at"],
    )
    db.add(job)
    db.flush()
    return job


def xml_candidates(db: Any, task_id: int) -> list[tuple[Any, str, bool]]:
    rows = read_legacy_rows(
        db,
        "SELECT kind, storage_backend, storage_key, filename, size_bytes, mime_type, created_at "
        "FROM files WHERE task_id=:task_id AND kind IN ('current_xml','final_xml') "
        "ORDER BY CASE kind WHEN 'current_xml' THEN 1 ELSE 2 END, created_at, id",
        {"task_id": task_id},
    )
    unique: list[tuple[Any, str, bool]] = []
    positions_by_digest: dict[str, int] = {}
    for row in rows:
        content = file_storage.read_bytes(row["storage_key"])
        digest = hashlib.sha256(content).hexdigest()
        is_final = row["kind"] == "final_xml"
        position = positions_by_digest.get(digest)
        if position is None:
            positions_by_digest[digest] = len(unique)
            unique.append((row, digest, is_final))
            continue
        existing_row, existing_digest, existing_is_final = unique[position]
        unique[position] = (existing_row, existing_digest, existing_is_final or is_final)
    return unique


def backfill_task(db: Any, task: Any, counts: Counter[str]) -> Score:
    job = ensure_job(db, task)
    if job.score_id:
        existing = db.get(Score, job.score_id)
        if existing:
            counts["scores_existing"] += 1
            return existing
    candidates = xml_candidates(db, task["id"])
    if not candidates:
        raise ValueError("no current_xml or final_xml artifact")
    score_uuid = stable_uuid("score", task["task_uuid"])
    score = db.execute(select(Score).where(Score.score_uuid == score_uuid)).scalar_one_or_none()
    if not score:
        score = Score(
            score_uuid=score_uuid,
            owner_user_id=task["user_id"],
            title=(task["title"] or "Untitled score").strip(),
            difficulty=task["difficulty"],
            state=ScoreState.IN_REVIEW,
            originating_job_id=require_persisted_id(job.id, entity="job"),
            created_at=task["created_at"],
            updated_at=task["updated_at"],
        )
        db.add(score)
        db.flush()
    parent_id: int | None = None
    final_revision_id: int | None = None
    for number, (legacy_file, digest, has_final_source) in enumerate(candidates, start=1):
        revision_uuid = stable_uuid("revision", task["task_uuid"], digest)
        revision = db.execute(select(ScoreRevision).where(ScoreRevision.revision_uuid == revision_uuid)).scalar_one_or_none()
        if not revision:
            revision = ScoreRevision(
                revision_uuid=revision_uuid,
                score_id=require_persisted_id(score.id, entity="score"),
                revision_number=number,
                parent_revision_id=parent_id,
                content_hash=digest,
                idempotency_key=f"legacy:{task['task_uuid']}:{digest}",
                origin=RevisionOrigin.IMPORT,
                created_by_user_id=task["user_id"],
                created_by_job_id=require_persisted_id(job.id, entity="job"),
                created_at=legacy_file["created_at"],
            )
            db.add(revision)
            db.flush()
            revision_id = require_persisted_id(revision.id, entity="revision")
            db.add(ScoreArtifact(
                artifact_uuid=stable_uuid("artifact", revision_uuid, "musicxml"),
                revision_id=revision_id,
                kind=ArtifactKind.MUSICXML,
                storage_backend=legacy_file["storage_backend"],
                storage_key=legacy_file["storage_key"],
                filename=legacy_file["filename"],
                mime_type=legacy_file["mime_type"] or "application/vnd.recordare.musicxml+xml",
                size_bytes=legacy_file["size_bytes"],
                sha256=digest,
                generator="legacy-backfill",
                generator_version="1",
                created_at=legacy_file["created_at"],
            ))
            db.add(ScoreRevisionMetadata(revision_id=revision_id, status=MetadataStatus.PENDING, extractor_version="pending"))
        parent_id = require_persisted_id(revision.id, entity="revision")
        if has_final_source:
            final_revision_id = parent_id
    score.head_revision_id = parent_id
    score.approved_revision_id = final_revision_id
    score.state = ScoreState.ACTIVE if final_revision_id else ScoreState.IN_REVIEW
    job.score_id = require_persisted_id(score.id, entity="score")
    counts["scores_backfilled"] += 1
    counts["revisions_backfilled"] += len(candidates)
    return score


def migrate_shares(db: Any, score_by_task: dict[int, Score], counts: Counter[str]) -> dict[str, ScoreShareGrant]:
    result: dict[str, ScoreShareGrant] = {}
    for row in read_legacy_rows(db, "SELECT * FROM shares ORDER BY id"):
        score = score_by_task.get(row["task_id"])
        if not score:
            continue
        token_hash = hash_share_token(row["token"])
        grant = db.execute(select(ScoreShareGrant).where(ScoreShareGrant.token_hash == token_hash)).scalar_one_or_none()
        if not grant:
            grant = ScoreShareGrant(
                grant_uuid=stable_uuid("grant", row["id"], token_hash),
                score_id=require_persisted_id(score.id, entity="score"),
                token_hash=token_hash,
                scope=ShareGrantScope.EDIT_INVITE if row["can_edit"] else ShareGrantScope.VIEW,
                target_mode=ShareTargetMode.LATEST,
                allow_download=bool(row["can_download"]),
                allow_practice=True,
                expires_at=row["expires_at"],
                revoked_at=row["revoked_at"],
                created_by_user_id=row["owner_user_id"],
                created_at=row["created_at"],
            )
            db.add(grant)
            db.flush()
            counts["grants_backfilled"] += 1
        result[row["token"]] = grant
    return result


def migrate_bookmarks(db: Any, score_by_task: dict[int, Score], counts: Counter[str]) -> None:
    rows = read_legacy_rows(db, "SELECT ss.user_id, ss.created_at, s.task_id, s.token FROM saved_shares ss JOIN shares s ON s.id=ss.share_id ORDER BY ss.id")
    for row in rows:
        score = score_by_task.get(row["task_id"])
        grant = db.execute(select(ScoreShareGrant).where(ScoreShareGrant.token_hash == hash_share_token(row["token"]))).scalar_one_or_none()
        if not score or not grant:
            continue
        score_id = require_persisted_id(score.id, entity="score")
        if not db.execute(select(ScoreBookmark).where(ScoreBookmark.score_id == score_id, ScoreBookmark.user_id == row["user_id"])).scalar_one_or_none():
            db.add(ScoreBookmark(score_id=score_id, user_id=row["user_id"], created_at=row["created_at"]))
            db.add(ShareGrantRedemption(grant_id=require_persisted_id(grant.id, entity="grant"), user_id=row["user_id"], created_at=row["created_at"]))
            counts["bookmarks_backfilled"] += 1


def migrate_practice(db: Any, score_by_task: dict[int, Score], grants: dict[str, ScoreShareGrant], counts: Counter[str]) -> None:
    for row in read_legacy_rows(db, "SELECT id, task_id, share_token, source_type FROM practice_sessions WHERE revision_id IS NULL ORDER BY id"):
        score = score_by_task.get(row["task_id"])
        if not score:
            raise ValueError(f"practice session {row['id']} has no score")
        revision_id = score.approved_revision_id if enum_value(row["source_type"]) == "FINAL" else score.head_revision_id
        if not revision_id:
            raise ValueError(f"practice session {row['id']} has no resolvable revision")
        grant = grants.get(row["share_token"] or "")
        origin = AccessOrigin.SHARE if grant else AccessOrigin.OWNER
        db.execute(
            text("UPDATE practice_sessions SET score_id=:score_id, revision_id=:revision_id, access_origin=:origin, share_grant_id=:grant_id WHERE id=:id"),
            {"score_id": score.id, "revision_id": revision_id, "origin": origin.value, "grant_id": grant.id if grant else None, "id": row["id"]},
        )
        counts["practice_sessions_backfilled"] += 1


def validate(db: Any) -> dict[str, int]:
    checks = {
        "scores_without_head": "SELECT count(*) FROM scores WHERE head_revision_id IS NULL",
        "revisions_without_musicxml": "SELECT count(*) FROM score_revisions r WHERE NOT EXISTS (SELECT 1 FROM score_artifacts a WHERE a.revision_id=r.id AND a.kind='MUSICXML')",
        "practice_without_revision": "SELECT count(*) FROM practice_sessions WHERE revision_id IS NULL OR score_id IS NULL OR access_origin IS NULL",
        "raw_tokens_in_new_grants": "SELECT count(*) FROM score_share_grants WHERE length(token_hash) != 64",
    }
    return {name: int(db.execute(text(query)).scalar_one()) for name, query in checks.items()}


def run(apply: bool) -> dict[str, object]:
    db = get_db_session()
    counts: Counter[str] = Counter()
    errors: list[dict[str, object]] = []
    try:
        score_by_task: dict[int, Score] = {}
        tasks = read_legacy_rows(db, "SELECT * FROM tasks ORDER BY id")
        for task in tasks:
            try:
                score_by_task[task["id"]] = backfill_task(db, task, counts)
            except Exception as exc:
                errors.append({"task_id": task["task_uuid"], "error": str(exc)})
        grants = migrate_shares(db, score_by_task, counts)
        migrate_bookmarks(db, score_by_task, counts)
        migrate_practice(db, score_by_task, grants, counts)
        db.flush()
        checks = validate(db)
        if apply and not errors and not any(checks.values()):
            db.commit()
        else:
            db.rollback()
        return {
            "mode": "apply" if apply else "dry-run",
            "applied": apply and not errors and not any(checks.values()),
            "counts": dict(counts),
            "checks": checks,
            "errors": errors,
            "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Commit only when every validation check passes.")
    args = parser.parse_args()
    print(json.dumps(run(args.apply), ensure_ascii=False, indent=2, default=str))
