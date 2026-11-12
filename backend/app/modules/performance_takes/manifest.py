"""Immutable admitted saved-performance truth, independent of upload and media lifecycle."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from .schemas import (
    PerformanceTakeManifestRead,
    PerformanceTakeUploadMetadata,
    PerformanceTakeFullScopeSelection,
    PerformanceTakeRangeScopeSelection,
)

from .recording_media_policy import is_supported_capture_mime, normalize_capture_mime

MANIFEST_SCHEMA_VERSION = 1


def _reject_nonfinite_manifest_number(value: str) -> None:
    raise ValueError(f"Nonfinite Manifest number: {value}")


@dataclass(frozen=True)
class TakeManifest:
    take_uuid: str
    user_id: int
    snapshot: PerformanceTakeManifestRead

    def __post_init__(self) -> None:
        if (
            not isinstance(self.take_uuid, str)
            or not self.take_uuid
            or type(self.user_id) is not int
            or self.user_id <= 0
        ):
            raise ValueError("Invalid saved-performance identity")
        media = self.snapshot.capture
        if media.mime_type != normalize_capture_mime(
            media.mime_type
        ) or not is_supported_capture_mime(media.kind, media.mime_type):
            raise ValueError("Manifest requires a canonical admitted media MIME")

    @property
    def canonical_document_json(self) -> str:
        return json.dumps(
            {
                "schemaVersion": MANIFEST_SCHEMA_VERSION,
                "manifest": self.snapshot.model_dump(mode="json"),
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )

    @property
    def document_sha256(self) -> str:
        return hashlib.sha256(self.canonical_document_json.encode("utf-8")).hexdigest()

    @classmethod
    def from_document(cls, take_uuid: str, user_id: int, document_json: str) -> TakeManifest:
        document = json.loads(document_json, parse_constant=_reject_nonfinite_manifest_number)
        if not isinstance(document, dict) or set(document) != {"schemaVersion", "manifest"}:
            raise ValueError("Manifest document requires exact fields")
        if (
            type(document["schemaVersion"]) is not int
            or document["schemaVersion"] != MANIFEST_SCHEMA_VERSION
        ):
            raise ValueError("Unsupported Manifest schemaVersion")
        value = cls(
            take_uuid, user_id, PerformanceTakeManifestRead.model_validate(document["manifest"])
        )
        if value.canonical_document_json != document_json:
            raise ValueError("Manifest document must use its exact canonical representation")
        return value

    @property
    def admitted_upload_metadata(self) -> PerformanceTakeUploadMetadata:
        value = self.snapshot
        scope = value.scope
        return PerformanceTakeUploadMetadata(
            practice_binding=value.practice_binding,
            media=value.capture,
            scope=PerformanceTakeFullScopeSelection(kind="FULL")
            if scope.kind == "FULL"
            else PerformanceTakeRangeScopeSelection(
                kind="RANGE", start_group_id=scope.start_group_id, end_group_id=scope.end_group_id
            ),
            tempo_selection=value.tempo_plan.selection,
            recording_timebase=value.recording_timebase,
        )
