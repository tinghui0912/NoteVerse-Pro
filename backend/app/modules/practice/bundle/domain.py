from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any


def calculate_bundle_id(schema_version: int, musicxml_sha256: str, artifact_sha256: str) -> str:
    """Content identity independent of ownership and physical locators."""
    manifest = {
        "bundleSchemaVersion": 1,
        "artifactSchemaVersion": schema_version,
        "preparedMusicxmlSha256": musicxml_sha256,
        "artifactSha256": artifact_sha256,
    }
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "practice-bundle:" + hashlib.sha256(canonical).hexdigest()


@dataclass(frozen=True)
class PracticeBundleRepresentation:
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
class PracticeBundleArtifact:
    representation: PracticeBundleRepresentation
    artifact_id: str
    schema_version: int

    @property
    def value(self) -> dict[str, Any]:
        # Each consumer receives a detached value; canonical storage is immutable bytes.
        return json.loads(self.representation.data)


@dataclass(frozen=True)
class PracticeBundle:
    prepared_musicxml: PracticeBundleRepresentation
    artifact: PracticeBundleArtifact

    @property
    def bundle_id(self) -> str:
        return calculate_bundle_id(
            self.artifact.schema_version,
            self.prepared_musicxml.sha256,
            self.artifact.representation.sha256,
        )


@dataclass(frozen=True)
class PracticeBundleRef:
    id: int
    bundle_id: str
    artifact_id: str


@dataclass(frozen=True)
class AuthorizedPracticeBundle:
    bundle: PracticeBundle
    bundle_ref: PracticeBundleRef
    score_db_id: int
    revision_db_id: int
    score_title: str
    score_uuid: str
    revision_uuid: str
