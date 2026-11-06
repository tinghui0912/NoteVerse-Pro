"""Canonical hydration and serialization boundary for saved-performance manifests."""

import json
from app.db.models.performance_take_manifest import PerformanceTakeManifest
from .manifest import TakeManifest
from .schemas import PerformanceTakeManifestRead

MAX_MANIFEST_JSON_BYTES = 64 * 1024


def canonical_manifest_json(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > MAX_MANIFEST_JSON_BYTES:
        from app.core.exceptions import ValidationException
        from app.shared.constants import ErrorCode

        raise ValidationException(ErrorCode.VALIDATION_ERROR, field="metadata_size")
    return encoded


def _hydrate_manifest(row: PerformanceTakeManifest) -> TakeManifest:
    scope = {
        "kind": row.scope_type,
        "start_tick": row.scope_start_tick,
        "terminal_tick": row.scope_terminal_tick,
    }
    if row.scope_type == "RANGE":
        scope.update(start_group_id=row.scope_start_group_id, end_group_id=row.scope_end_group_id)
    elif row.scope_start_group_id is not None or row.scope_end_group_id is not None:
        raise ValueError("FULL manifest cannot contain range selection")
    snapshot = PerformanceTakeManifestRead.model_validate(
        {
            "practice_binding": {
                "score_id": row.practice_score_uuid,
                "revision_id": row.practice_revision_uuid,
                "bundle_id": row.practice_bundle_id,
            },
            "artifact_id": row.practice_artifact_id,
            "score_title_snapshot": row.score_title_snapshot,
            "media": {
                "kind": row.media_kind,
                "mime_type": row.media_mime_type,
                "byte_size": row.media_byte_size,
            },
            "score_timebase": {"ticks_per_quarter": row.ticks_per_quarter},
            "scope": scope,
            "tempo_plan": json.loads(row.tempo_plan),
            "recording_timebase": json.loads(row.recording_timebase),
        }
    )
    return TakeManifest(row.take_uuid, row.user_id, snapshot)


def manifest_to_row(value: TakeManifest) -> PerformanceTakeManifest:
    snapshot = value.snapshot
    return PerformanceTakeManifest(
        take_uuid=value.take_uuid,
        user_id=value.user_id,
        practice_bundle_id=snapshot.practice_binding.bundle_id,
        practice_score_uuid=snapshot.practice_binding.score_id,
        practice_revision_uuid=snapshot.practice_binding.revision_id,
        practice_artifact_id=snapshot.artifact_id,
        score_title_snapshot=snapshot.score_title_snapshot,
        media_kind=snapshot.media.kind,
        media_mime_type=snapshot.media.mime_type,
        media_byte_size=snapshot.media.byte_size,
        ticks_per_quarter=snapshot.score_timebase.ticks_per_quarter,
        scope_type=snapshot.scope.kind,
        scope_start_tick=snapshot.scope.start_tick,
        scope_terminal_tick=snapshot.scope.terminal_tick,
        scope_start_group_id=snapshot.scope.start_group_id
        if snapshot.scope.kind == "RANGE"
        else None,
        scope_end_group_id=snapshot.scope.end_group_id if snapshot.scope.kind == "RANGE" else None,
        tempo_plan=canonical_manifest_json(snapshot.tempo_plan.model_dump(mode="json")),
        recording_timebase=canonical_manifest_json(
            snapshot.recording_timebase.model_dump(mode="json")
        ),
    )


def manifest_from_row(row: PerformanceTakeManifest) -> TakeManifest:
    from app.core.exceptions import ValidationException
    from app.shared.constants import ErrorCode

    try:
        return _hydrate_manifest(row)
    except (ValueError, TypeError, KeyError) as error:
        raise ValidationException(
            ErrorCode.VALIDATION_ERROR, field="manifest", details={"reason": "invalid_manifest"}
        ) from error
