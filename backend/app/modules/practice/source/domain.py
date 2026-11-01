from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any


def calculate_source_id(
    score_id: str,
    revision_id: str,
    artifact_id: str,
    schema_version: int,
    musicxml_sha256: str,
    artifact_sha256: str,
) -> str:
    """Canonical identity of immutable Practice source representations."""
    return hashlib.sha256(
        "|".join(
            (
                score_id,
                revision_id,
                artifact_id,
                str(schema_version),
                musicxml_sha256,
                artifact_sha256,
            )
        ).encode("utf-8")
    ).hexdigest()


@dataclass(frozen=True)
class PracticeSourceRepresentation:
    data: bytes
    mime_type: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()

    @property
    def byte_size(self) -> int:
        return len(self.data)

    @property
    def content(self) -> str:
        return self.data.decode("utf-8")


@dataclass(frozen=True)
class PracticeSourceArtifact:
    representation: PracticeSourceRepresentation
    artifact_id: str
    schema_version: int

    @property
    def value(self) -> dict[str, Any]:
        # Each consumer receives a detached value; canonical storage is immutable bytes.
        return json.loads(self.representation.data)


@dataclass(frozen=True)
class PracticeSource:
    score_id: str
    revision_id: str
    prepared_musicxml: PracticeSourceRepresentation
    artifact: PracticeSourceArtifact

    @property
    def source_id(self) -> str:
        return calculate_source_id(
            self.score_id,
            self.revision_id,
            self.artifact.artifact_id,
            self.artifact.schema_version,
            self.prepared_musicxml.sha256,
            self.artifact.representation.sha256,
        )


@dataclass(frozen=True)
class PracticeSourceRef:
    id: int
    source_id: str
    source_score_uuid: str
    source_revision_uuid: str
    artifact_id: str


@dataclass(frozen=True)
class AuthorizedPracticeSource:
    source: PracticeSource
    source_ref: PracticeSourceRef
    score_db_id: int
    revision_db_id: int
    score_title: str
