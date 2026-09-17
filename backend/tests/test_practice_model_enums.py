from __future__ import annotations

from sqlalchemy.dialects import postgresql

from app.db.models.practice import PracticeAttempt, PracticeAttemptResolutionReason


def test_practice_attempt_resolution_reason_persists_enum_value() -> None:
    column_type = PracticeAttempt.__table__.c.resolution_reason.type
    bind_processor = column_type.bind_processor(postgresql.dialect())

    assert bind_processor is not None
    assert (
        bind_processor(PracticeAttemptResolutionReason.LOW_ALIGNMENT_CONFIDENCE)
        == "low_alignment_confidence"
    )
