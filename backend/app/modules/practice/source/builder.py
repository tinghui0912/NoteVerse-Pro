from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from app.processing.practice_score.musicxml_stable_ids import prepare_musicxml_ids_for_practice
from app.processing.practice_score.practice_score_artifact import (
    canonical_practice_artifact_bytes,
    practice_score_artifact_from_timeline,
)
from app.processing.practice_score.score_loader import (
    practice_score_timeline_from_prepared_musicxml,
)
from app.processing.practice_score.tempo import practice_tempo_segments_from_musicxml
from .domain import PracticeSourceArtifact, PracticeSourceBundle, PracticeSourceRepresentation


class PracticeSourceBuilder:
    def build(
        self, *, score_id: str, revision_id: str, canonical_musicxml: bytes
    ) -> PracticeSourceBundle:
        prepared = prepare_musicxml_ids_for_practice(canonical_musicxml.decode("utf-8")).encode(
            "utf-8"
        )
        with TemporaryDirectory() as directory:
            prepared_path = Path(directory) / "score.musicxml"
            prepared_path.write_bytes(prepared)
            timeline = practice_score_timeline_from_prepared_musicxml(prepared_path)
            tempo = practice_tempo_segments_from_musicxml(prepared_path)
            value = practice_score_artifact_from_timeline(
                timeline, score_id=score_id, revision_id=revision_id, score_tempo_segments=tempo
            )
        return PracticeSourceBundle(
            score_id,
            revision_id,
            PracticeSourceRepresentation(prepared, "application/vnd.recordare.musicxml+xml"),
            PracticeSourceArtifact(
                PracticeSourceRepresentation(
                    canonical_practice_artifact_bytes(value), "application/json"
                ),
                value["artifactId"],
                value["schemaVersion"],
            ),
        )
