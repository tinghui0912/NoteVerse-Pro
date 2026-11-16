"""Verify and materialize the exact durable representations of a READY bundle."""

import json

from app.core.exceptions import ValidationException
from app.db.models.practice_bundle import PracticeBundleRecord
from app.modules.storage_objects.persistence import object_from_row
from app.modules.storage_objects.reads import StoredObjectReadTarget, read_admitted_bytes
from app.modules.practice.score.artifact import (
    canonical_practice_artifact_bytes,
    practice_artifact_id,
)
from app.modules.practice.score.generated.artifact_transport import PracticeScoreArtifactRead
from app.modules.practice.score.artifact_validation import validate_practice_score_artifact
from app.shared.error_codes import CustomerErrorCode
from app.storage.base import ObjectStorage
from .domain import PracticeBundleArtifact, PracticeBundle, PracticeBundleRepresentation


def read_verified_bundle(storage: ObjectStorage, row: PracticeBundleRecord) -> PracticeBundle:
    if row.prepared_musicxml_object is None or row.artifact_object is None:
        raise ValueError("READY Bundle requires both physical representations")
    xml_facts = object_from_row(row.prepared_musicxml_object)
    artifact_facts = object_from_row(row.artifact_object)
    if (
        xml_facts.content_type != "application/vnd.recordare.musicxml+xml"
        or artifact_facts.content_type != "application/json"
    ):
        raise ValidationException(
            CustomerErrorCode.VALIDATION_ERROR,
            field="practice_bundle",
            details={"reason": "representation_type_mismatch"},
        )
    xml = PracticeBundleRepresentation(
        read_admitted_bytes(
            storage, StoredObjectReadTarget.from_object(row.prepared_musicxml_object)
        ),
        "application/vnd.recordare.musicxml+xml",
    )
    data = PracticeBundleRepresentation(
        read_admitted_bytes(storage, StoredObjectReadTarget.from_object(row.artifact_object)),
        "application/json",
    )
    for representation, expected_sha, expected_size, reason in [
        (
            xml,
            row.prepared_musicxml_object.sha256,
            row.prepared_musicxml_object.byte_size,
            "prepared_musicxml_checksum_mismatch",
        ),
        (
            data,
            row.artifact_object.sha256,
            row.artifact_object.byte_size,
            "artifact_checksum_mismatch",
        ),
    ]:
        if representation.sha256 != expected_sha or representation.byte_size != expected_size:
            raise ValidationException(
                CustomerErrorCode.VALIDATION_ERROR,
                field="practice_bundle",
                details={"reason": reason},
            )
    artifact = PracticeScoreArtifactRead.model_validate_json(data.data)
    validate_practice_score_artifact(artifact.model_dump())
    if (
        artifact.artifactId != practice_artifact_id(json.loads(data.data))
        or artifact.artifactId != row.artifact_id
        or artifact.schemaVersion != row.artifact_schema_version
        or canonical_practice_artifact_bytes(json.loads(data.data)) != data.data
    ):
        raise ValidationException(
            CustomerErrorCode.VALIDATION_ERROR,
            field="practice_bundle",
            details={"reason": "artifact_identity_mismatch"},
        )
    bundle = PracticeBundle(
        xml,
        PracticeBundleArtifact(data, artifact.artifactId, artifact.schemaVersion),
    )
    if bundle.bundle_id != row.bundle_id:
        raise ValidationException(
            CustomerErrorCode.VALIDATION_ERROR,
            field="practice_bundle",
            details={"reason": "bundle_identity_mismatch"},
        )
    return bundle
