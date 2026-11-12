"""Persistence mapping and canonical-document integrity for admitted Take Manifests."""

import re
from app.db.models.performance_take_manifest import PerformanceTakeManifest
from .manifest import TakeManifest


def manifest_to_row(value: TakeManifest) -> PerformanceTakeManifest:
    return PerformanceTakeManifest(
        take_uuid=value.take_uuid,
        user_id=value.user_id,
        manifest_json=value.canonical_document_json,
        manifest_sha256=value.document_sha256,
    )


def manifest_from_row(row: PerformanceTakeManifest) -> TakeManifest:
    from app.core.exceptions import ValidationException
    from app.shared.constants import ErrorCode

    try:
        if not isinstance(row.manifest_sha256, str) or not re.fullmatch(
            r"[0-9a-f]{64}", row.manifest_sha256
        ):
            raise ValueError("Invalid Manifest digest representation")
        value = TakeManifest.from_document(row.take_uuid, row.user_id, row.manifest_json)
        if value.document_sha256 != row.manifest_sha256:
            raise ValueError("Manifest document and digest disagree")
        return value
    except (ValueError, TypeError, KeyError) as error:
        raise ValidationException(
            ErrorCode.VALIDATION_ERROR, field="manifest", details={"reason": "invalid_manifest"}
        ) from error
