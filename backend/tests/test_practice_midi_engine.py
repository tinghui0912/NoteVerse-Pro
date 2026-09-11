from __future__ import annotations

from typing import cast

from app.processing.engines.practice_alignment.attempt_assembler import (
    PracticeAttemptAssembler,
    ResolvedPracticeAttemptBuffer,
)
from app.processing.engines.practice_alignment.follow_policy import WaitForNoteFollowPolicy, follow_policy_for_progression
from app.processing.engines.practice_alignment.midi_live import MidiPracticeEngine
from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreEvent,
    PracticeScoreTimeline,
)


def make_midi_engine() -> MidiPracticeEngine:
    engine = MidiPracticeEngine.__new__(MidiPracticeEngine)
    engine.score_file_path = "score.musicxml"
    engine.progression_mode = "WAIT_FOR_NOTE"
    engine.input_source = "MIDI"
    engine.score_timeline = wait_for_note_timeline()
    engine._score_end_beat = 5.0
    engine._follow_policy = cast(
        WaitForNoteFollowPolicy,
        follow_policy_for_progression(
            engine.score_timeline,
            progression_mode="WAIT_FOR_NOTE",
            input_source="MIDI",
        ),
    )
    engine._active_notes = set()
    engine._attempt_assembler = PracticeAttemptAssembler()
    engine._pending_attempt_outcome = None
    engine._pending_attempt_update = None
    engine._resolved_practice_attempts = ResolvedPracticeAttemptBuffer()
    engine._last_alignment = None
    engine._last_timestamp_ms = 0
    engine._closed = False
    return engine


def test_midi_engine_advances_single_note_target() -> None:
    engine = make_midi_engine()

    update = engine.ingest_midi_event(
        event_type="note_on",
        note_number=60,
        velocity=96,
        timestamp_ms=10,
    )

    assert update is not None
    assert update["decision"]["action"] == "advance"
    assert update["decision"]["reason"] == "stable_match"
    assert update["decision"]["display_anchor"] is not None
    assert update["decision"]["display_anchor"]["beat"] == 4.0


def test_midi_engine_waits_on_partial_chord_then_advances_when_complete() -> None:
    engine = make_midi_engine()
    engine.ingest_midi_event(event_type="note_on", note_number=60, velocity=96, timestamp_ms=10)
    engine.drain_resolved_practice_attempts()

    partial = engine.ingest_midi_event(
        event_type="note_on",
        note_number=64,
        velocity=90,
        timestamp_ms=20,
    )
    next_partial = engine.ingest_midi_event(
        event_type="note_on",
        note_number=67,
        velocity=89,
        timestamp_ms=30,
    )
    complete = engine.ingest_midi_event(
        event_type="note_on",
        note_number=71,
        velocity=88,
        timestamp_ms=40,
    )

    assert partial is not None
    assert partial["decision"]["action"] == "wait"
    assert partial["decision"]["reason"] == "partial_match"
    assert partial["decision"]["attempt_state"] == "pending"
    assert partial["scope_completed"] is False
    assert next_partial is not None
    assert next_partial["decision"]["action"] == "wait"
    assert complete is not None
    assert complete["decision"]["action"] == "advance"
    assert complete["decision"]["attempt_state"] == "resolved"
    assert complete["scope_completed"] is True
    attempts = engine.drain_resolved_practice_attempts()
    assert len(attempts) == 1
    assert attempts[0].outcome.evaluation.result == "MATCH"
    assert attempts[0].outcome.snapshot.started_at_ms == 20
    assert attempts[0].outcome.snapshot.resolved_at_ms == 40


def test_midi_engine_records_replayed_partial_as_distinct_attempt_after_release() -> None:
    engine = make_midi_engine()
    engine.ingest_midi_event(event_type="note_on", note_number=60, velocity=96, timestamp_ms=10)
    engine.drain_resolved_practice_attempts()

    engine.ingest_midi_event(event_type="note_on", note_number=64, velocity=90, timestamp_ms=20)
    first_release = engine.ingest_midi_event(event_type="note_off", note_number=64, velocity=0, timestamp_ms=30)
    engine.ingest_midi_event(event_type="note_on", note_number=64, velocity=90, timestamp_ms=60)
    second_release = engine.ingest_midi_event(event_type="note_off", note_number=64, velocity=0, timestamp_ms=70)

    assert first_release is not None
    assert second_release is not None
    attempts = engine.drain_resolved_practice_attempts()
    assert len(attempts) == 2
    assert [attempt.outcome.evaluation.result for attempt in attempts] == ["PARTIAL", "PARTIAL"]
    assert [attempt.outcome.snapshot.attempt_sequence for attempt in attempts] == [2, 3]


def test_midi_engine_allows_replaying_incomplete_chord_before_advancing() -> None:
    engine = make_midi_engine()
    engine.ingest_midi_event(event_type="note_on", note_number=60, velocity=96, timestamp_ms=10)
    initial_attempts = engine.drain_resolved_practice_attempts()
    assert len(initial_attempts) == 1
    initial_resolved_attempt = initial_attempts[0]
    assert initial_resolved_attempt.display_anchor["group_id"] == "entry-0"

    first_partial = engine.ingest_midi_event(
        event_type="note_on",
        note_number=64,
        velocity=90,
        timestamp_ms=20,
    )
    second_partial = engine.ingest_midi_event(
        event_type="note_on",
        note_number=67,
        velocity=88,
        timestamp_ms=30,
    )
    first_release = engine.ingest_midi_event(event_type="note_off", note_number=64, velocity=0, timestamp_ms=40)
    final_release = engine.ingest_midi_event(event_type="note_off", note_number=67, velocity=0, timestamp_ms=45)
    replay_first = engine.ingest_midi_event(
        event_type="note_on",
        note_number=64,
        velocity=90,
        timestamp_ms=60,
    )
    replay_second = engine.ingest_midi_event(
        event_type="note_on",
        note_number=67,
        velocity=88,
        timestamp_ms=61,
    )
    complete = engine.ingest_midi_event(
        event_type="note_on",
        note_number=71,
        velocity=86,
        timestamp_ms=62,
    )

    assert first_partial is not None
    assert first_partial["decision"]["action"] == "wait"
    assert first_partial["decision"]["attempt_state"] == "pending"
    assert second_partial is not None
    assert second_partial["decision"]["action"] == "wait"
    assert second_partial["decision"]["attempt_state"] == "pending"
    assert first_release is None
    assert final_release is not None
    assert final_release["decision"]["action"] == "wait"
    assert final_release["decision"]["attempt_state"] == "resolved"
    assert final_release["decision"]["attempt_sequence"] == 2
    assert final_release["decision"]["attempt_started_at_ms"] == 20
    assert final_release["decision"]["attempt_resolved_at_ms"] == 45
    assert replay_first is not None
    assert replay_first["decision"]["action"] == "wait"
    assert replay_first["decision"]["attempt_state"] == "pending"
    assert replay_first["decision"]["attempt_sequence"] == 3
    assert replay_second is not None
    assert replay_second["decision"]["action"] == "wait"
    assert replay_second["decision"]["attempt_state"] == "pending"
    assert replay_second["decision"]["attempt_sequence"] == 3
    assert complete is not None
    assert complete["decision"]["action"] == "advance"
    assert complete["decision"]["attempt_state"] == "resolved"
    assert complete["decision"]["attempt_sequence"] == 3
    assert complete["decision"]["attempt_started_at_ms"] == 60
    assert complete["decision"]["attempt_resolved_at_ms"] == 62
    assert complete["decision"]["display_anchor"] is not None
    assert complete["decision"]["display_anchor"]["render_note_ids"] == ["n2", "n3", "n4"]
    attempts = engine.drain_resolved_practice_attempts()
    assert len(attempts) == 2
    resolved_attempt = attempts[0]
    assert resolved_attempt.display_anchor["group_id"] == "entry-1"
    assert resolved_attempt.beat_position == 4.0
    assert resolved_attempt.outcome.evaluation.result == "PARTIAL"
    final_resolved_attempt = attempts[1]
    assert final_resolved_attempt.display_anchor["group_id"] == "entry-1"
    assert final_resolved_attempt.beat_position == 4.0
    assert final_resolved_attempt.outcome.evaluation.result == "MATCH"
    assert engine.drain_resolved_practice_attempts() == []


def test_midi_engine_skip_advances_one_current_expected_group_neutrally() -> None:
    engine = make_midi_engine()
    engine.ingest_midi_event(event_type="note_on", note_number=60, velocity=96, timestamp_ms=10)
    engine.drain_resolved_practice_attempts()

    update = engine.skip_current_expected_group()

    assert update is not None
    assert update["decision"]["action"] == "skip"
    assert update["decision"]["reason"] == "user_skipped"
    assert update["decision"]["experience_state"] == "skipped"
    assert update["decision"]["attempt_state"] == "resolved"
    assert update["scope_completed"] is True
    assert update["completion_reason"] == "FINAL_EXPECTED_GROUP_MATCHED"
    assert update["decision"]["display_anchor"] is not None
    assert update["decision"]["display_anchor"]["group_id"] == "entry-1"
    attempts = engine.drain_resolved_practice_attempts()
    assert len(attempts) == 1
    skipped = attempts[0]
    assert skipped.outcome.snapshot.expected_group_id == "entry-1"
    assert skipped.action == "skip"
    assert skipped.resolution_reason == "user_skipped"
    assert skipped.experience_state == "skipped"
    assert skipped.outcome.evaluation.result == "SKIPPED"
    assert skipped.outcome.evaluation.missing_pitches == ("E4", "G4", "B4")


def test_midi_engine_records_extra_note_mismatch_before_recovery() -> None:
    engine = make_midi_engine()
    engine.ingest_midi_event(event_type="note_on", note_number=60, velocity=96, timestamp_ms=10)
    engine.drain_resolved_practice_attempts()

    wrong = engine.ingest_midi_event(
        event_type="note_on",
        note_number=65,
        velocity=90,
        timestamp_ms=20,
    )
    release = engine.ingest_midi_event(
        event_type="note_off",
        note_number=65,
        velocity=0,
        timestamp_ms=30,
    )
    replay_first = engine.ingest_midi_event(
        event_type="note_on",
        note_number=64,
        velocity=90,
        timestamp_ms=60,
    )
    replay_second = engine.ingest_midi_event(
        event_type="note_on",
        note_number=67,
        velocity=88,
        timestamp_ms=61,
    )
    complete = engine.ingest_midi_event(
        event_type="note_on",
        note_number=71,
        velocity=86,
        timestamp_ms=62,
    )

    assert wrong is not None
    assert wrong["decision"]["action"] == "hold"
    assert wrong["decision"]["reason"] == "entry_mismatch"
    assert release is not None
    assert release["decision"]["attempt_state"] == "resolved"
    assert replay_first is not None
    assert replay_first["decision"]["action"] == "wait"
    assert replay_second is not None
    assert replay_second["decision"]["action"] == "wait"
    assert complete is not None
    assert complete["decision"]["action"] == "advance"
    attempts = engine.drain_resolved_practice_attempts()
    assert [attempt.outcome.evaluation.result for attempt in attempts] == ["MISMATCH", "MATCH"]
    assert attempts[0].outcome.evaluation.extra_pitches == ("F4",)


def test_midi_engine_finalizes_held_partial_on_practice_pause() -> None:
    engine = make_midi_engine()
    engine.ingest_midi_event(event_type="note_on", note_number=60, velocity=96, timestamp_ms=10)
    engine.drain_resolved_practice_attempts()
    engine.ingest_midi_event(event_type="note_on", note_number=64, velocity=90, timestamp_ms=20)

    attempts = engine.finalize_pending_practice_attempt(reason="practice_paused")

    assert len(attempts) == 1
    assert attempts[0].resolution_reason == "practice_paused"
    assert attempts[0].action == "hold"
    assert attempts[0].experience_state == "partially_matched"
    assert attempts[0].outcome.evaluation.result == "PARTIAL"
    assert engine.drain_resolved_practice_attempts() == []


def test_midi_engine_ignores_note_off_for_progression() -> None:
    engine = make_midi_engine()

    update = engine.ingest_midi_event(
        event_type="note_off",
        note_number=60,
        velocity=0,
        timestamp_ms=10,
    )

    assert update is None


def wait_for_note_timeline() -> PracticeScoreTimeline:
    return PracticeScoreTimeline(
        events=(
            PracticeScoreEvent(
                event_id="event-3",
                onset_beat=3.0,
                duration_beats=1.0,
                pitches=("C4",),
                render_note_ids=("n1",),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
            PracticeScoreEvent(
                event_id="event-4",
                onset_beat=4.0,
                duration_beats=1.0,
                pitches=("E4", "G4", "B4"),
                render_note_ids=("n2", "n3", "n4"),
                measure_numbers=("1",),
                staff_ids=("1",),
                voice_ids=("1",),
                tie_types=(),
                playable=True,
                entry_candidate=True,
            ),
        ),
        entry_groups=(
            PracticeEntryGroup(
                group_id="entry-0",
                onset_beat=3.0,
                event_ids=("event-3",),
                render_note_ids=("n1",),
                entry_candidate=True,
            ),
            PracticeEntryGroup(
                group_id="entry-1",
                onset_beat=4.0,
                event_ids=("event-4",),
                render_note_ids=("n2", "n3", "n4"),
                entry_candidate=True,
            ),
        ),
        first_playable_event_id="event-3",
        first_playable_beat=3.0,
        end_beat=5.0,
    )
