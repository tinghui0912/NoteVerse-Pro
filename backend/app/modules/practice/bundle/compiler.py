from __future__ import annotations

from app.platform.document_admission.musicxml import DocumentAdmissionError
from app.modules.practice.score.piano_key import PracticeScoreInvalidError

from app.modules.practice.score.compiler.stable_ids import prepare_musicxml_ids_for_practice
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from app.modules.practice.score.artifact import (
    canonical_practice_artifact_bytes,
    practice_score_artifact_from_timeline,
)
from .domain import PracticeBundleArtifact, PracticeBundle, PracticeBundleRepresentation


class PracticeBundleCompiler:
    def compile(self, *, canonical_musicxml: bytes) -> PracticeBundle:
        try:
            prepared = prepare_musicxml_ids_for_practice(canonical_musicxml.decode("utf-8")).encode(
                "utf-8"
            )
        except (DocumentAdmissionError, UnicodeError) as cause:
            raise PracticeScoreInvalidError("Invalid Practice MusicXML.") from cause
        compiled = compile_practice_score(prepared)
        timeline = practice_timeline_from_compiled(compiled)
        value = practice_score_artifact_from_timeline(
            timeline,
            score_tempo_segments=compiled.tempo_segments,
        )
        return PracticeBundle(
            PracticeBundleRepresentation(prepared, "application/vnd.recordare.musicxml+xml"),
            PracticeBundleArtifact(
                PracticeBundleRepresentation(
                    canonical_practice_artifact_bytes(value), "application/json"
                ),
                value["artifactId"],
                value["schemaVersion"],
            ),
        )
