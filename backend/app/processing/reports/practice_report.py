from __future__ import annotations

from typing import TypedDict

from app.db.models import PracticeSession


class PracticeReportPayload(TypedDict):
    summary: str
    metrics: dict[str, int | float | str | None]
    recommendations: list[str]


class PracticeReportBuilder:
    """Build a lightweight MVP report from persisted session metadata."""

    def build(self, session: PracticeSession) -> PracticeReportPayload:
        confidence_label = self._confidence_label(session.last_confidence)
        duration_seconds = self._duration_seconds(session)

        return {
            "summary": (
                "Practice session completed with "
                f"{confidence_label.lower()} alignment confidence."
            ),
            "metrics": {
                "state": session.state.value,
                "source": session.source_type.value,
                "duration_seconds": duration_seconds,
                "last_beat_position": session.last_beat_position,
                "last_confidence": session.last_confidence,
                "confidence_label": confidence_label,
            },
            "recommendations": self._build_recommendations(session, confidence_label),
        }

    @staticmethod
    def _duration_seconds(session: PracticeSession) -> float | None:
        if session.started_at is None or session.finished_at is None:
            return None
        duration = (session.finished_at - session.started_at).total_seconds()
        return round(max(duration, 0.0), 2)

    @staticmethod
    def _confidence_label(confidence: float | None) -> str:
        if confidence is None:
            return "Unknown"
        if confidence >= 0.85:
            return "Strong"
        if confidence >= 0.6:
            return "Stable"
        return "Needs Review"

    def _build_recommendations(
        self,
        session: PracticeSession,
        confidence_label: str,
    ) -> list[str]:
        recommendations: list[str] = []
        if session.last_confidence is None:
            recommendations.append(
                "Record another full run so the practice engine can build a clearer alignment trail."
            )
        elif session.last_confidence < 0.6:
            recommendations.append(
                "Slow the tempo slightly and keep the pulse steadier to improve alignment stability."
            )
        else:
            recommendations.append(
                "Keep the same pacing and focus on phrasing while timing remains stable."
            )

        if session.last_beat_position is not None and session.last_beat_position <= 4:
            recommendations.append(
                "Try to play further into the score so the report can cover more of the piece."
            )

        if confidence_label == "Strong":
            recommendations.append(
                "Use the next pass to target articulation and dynamics instead of raw note accuracy."
            )

        return recommendations


practice_report_builder = PracticeReportBuilder()
