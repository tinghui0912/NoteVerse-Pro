from __future__ import annotations

import xml.etree.ElementTree as ET
from app.modules.practice.score.piano_key import PracticeScoreInvalidError

from app.modules.practice.score.compiler.stable_ids import prepare_musicxml_ids_for_practice
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from app.modules.practice.score.artifact import (
    canonical_practice_artifact_bytes,
    practice_score_artifact_from_timeline,
)
from .domain import PracticeSourceArtifact, PracticeSource, PracticeSourceRepresentation


class PracticeSourceBuilder:
    def build(
        self, *, score_id: str, revision_id: str, canonical_musicxml: bytes
    ) -> PracticeSource:
        try:
            prepared = prepare_musicxml_ids_for_practice(canonical_musicxml.decode("utf-8")).encode(
                "utf-8"
            )
        except (ET.ParseError, UnicodeError) as cause:
            raise PracticeScoreInvalidError("Invalid Practice MusicXML.") from cause
        compiled = compile_practice_score(prepared)
        timeline = practice_timeline_from_compiled(compiled)
        value = practice_score_artifact_from_timeline(
            timeline,
            score_id=score_id,
            revision_id=revision_id,
            score_tempo_segments=compiled.tempo_segments,
        )
        return PracticeSource(
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
