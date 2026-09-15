from __future__ import annotations

import inspect
from pathlib import Path
from unittest.mock import patch

from app.processing.engines.practice_alignment.score_timeline import (
    PracticeEntryGroup,
    PracticeScoreEvent,
    PracticeScoreTimeline,
)
from app.processing.engines.practice_alignment.step_microphone_verifier import (
    StepVerifierObservation,
)
from app.processing.engines.practice_alignment.step_practice_engine import StepPracticeEngine
from app.processing.performance.clock import PerformanceClockState
from app.processing.performance.runtime import PerformanceRuntime
from app.processing.realtime.session_runtime import (
    PerformancePracticeSessionRuntime,
    PracticeSessionRuntimeRegistry,
    build_alignment_engine,
)


class RecordingStepVerifier:
    def __init__(self, observations: list[StepVerifierObservation | None] | None = None) -> None:
        self.observations = list(observations or [])
        self.calls = []
        self.reset_count = 0
        self.closed = False

    def observe_audio(self, chunk: bytes, *, target):
        self.calls.append((chunk, target))
        if not self.observations:
            return None
        return self.observations.pop(0)

    def reset(self) -> None:
        self.reset_count += 1

    def close(self) -> None:
        self.closed = True


def _event(
    event_id: str,
    onset: float,
    pitch: str,
    *,
    render_note_id: str,
    staff: str = "1",
    voice: str = "1",
    entry_candidate: bool = True,
) -> PracticeScoreEvent:
    return PracticeScoreEvent(
        event_id=event_id,
        onset_beat=onset,
        duration_beats=1.0,
        pitches=(pitch,),
        render_note_ids=(render_note_id,),
        measure_numbers=("1",),
        staff_ids=(staff,),
        voice_ids=(voice,),
        tie_types=() if entry_candidate else ("stop",),
        playable=True,
        entry_candidate=entry_candidate,
    )


def _group(group_id: str, onset: float, event_ids: tuple[str, ...], render_ids: tuple[str, ...]):
    return PracticeEntryGroup(
        group_id=group_id,
        onset_beat=onset,
        event_ids=event_ids,
        render_note_ids=render_ids,
        entry_candidate=True,
    )


def simple_timeline() -> PracticeScoreTimeline:
    events = (
        _event("event-c1", 1.0, "C4", render_note_id="n1"),
        _event("event-d", 2.0, "D4", render_note_id="n2"),
        _event("event-c2", 3.0, "C4", render_note_id="n3"),
    )
    return PracticeScoreTimeline(
        events=events,
        entry_groups=(
            _group("group-c1", 1.0, ("event-c1",), ("n1",)),
            _group("group-d", 2.0, ("event-d",), ("n2",)),
            _group("group-c2", 3.0, ("event-c2",), ("n3",)),
        ),
        first_playable_event_id="event-c1",
        first_playable_beat=1.0,
        end_beat=4.0,
    )


def mixed_tie_timeline() -> PracticeScoreTimeline:
    events = (
        _event("event-c1", 1.0, "C4", render_note_id="n1"),
        _event("event-e1", 1.0, "E4", render_note_id="n2"),
        _event("event-g1", 1.0, "G4", render_note_id="n3"),
        _event("event-c-tie", 2.0, "C4", render_note_id="n4", entry_candidate=False),
        _event("event-f", 2.0, "F4", render_note_id="n5"),
        _event("event-a", 2.0, "A4", render_note_id="n6"),
    )
    return PracticeScoreTimeline(
        events=events,
        entry_groups=(
            _group("group-ceg", 1.0, ("event-c1", "event-e1", "event-g1"), ("n1", "n2", "n3")),
            _group("group-fa", 2.0, ("event-f", "event-a"), ("n5", "n6")),
        ),
        first_playable_event_id="event-c1",
        first_playable_beat=1.0,
        end_beat=3.0,
    )


def same_pitch_multi_voice_timeline() -> PracticeScoreTimeline:
    events = (
        _event("event-v1", 1.0, "C4", render_note_id="n1", staff="1", voice="1"),
        _event("event-v2", 1.0, "C4", render_note_id="n2", staff="2", voice="2"),
    )
    return PracticeScoreTimeline(
        events=events,
        entry_groups=(_group("group-c", 1.0, ("event-v1", "event-v2"), ("n1", "n2")),),
        first_playable_event_id="event-v1",
        first_playable_beat=1.0,
        end_beat=2.0,
    )


def make_engine(
    *,
    verifier: RecordingStepVerifier | None = None,
    timeline: PracticeScoreTimeline | None = None,
    start_expected_group_id: str | None = None,
    end_expected_group_id: str | None = None,
) -> StepPracticeEngine:
    return StepPracticeEngine(
        score_file_path="score.xml",
        sample_rate=16000,
        channels=1,
        frame_format="pcm_s16le",
        step_microphone_verifier=verifier,
        score_timeline=timeline or simple_timeline(),
        start_expected_group_id=start_expected_group_id,
        end_expected_group_id=end_expected_group_id,
    )


def observation_for_current(engine: StepPracticeEngine, *, confidence: float = 0.93) -> StepVerifierObservation:
    step = engine._follow_policy.current_attack_step
    assert step is not None
    return StepVerifierObservation(
        step_id=step.step_id,
        observed_attack_pitches=tuple(target.pitch for target in step.attack_targets),
        confidence=confidence,
    )


def test_step_engine_module_does_not_import_matchmaker() -> None:
    import app.processing.engines.practice_alignment.step_practice_engine as step_practice_engine

    source = Path(inspect.getsourcefile(step_practice_engine) or "").read_text(encoding="utf-8")

    assert "matchmaker" not in source.lower()


def test_step_by_step_builder_constructs_step_engine_without_matchmaker() -> None:
    with patch(
        "app.processing.engines.practice_alignment.step_practice_engine.practice_score_timeline_from_musicxml",
        return_value=simple_timeline(),
    ):
        engine = build_alignment_engine(
            score_file_path="score.xml",
            sample_rate=16000,
            channels=1,
            frame_format="pcm_s16le",
        )

    assert isinstance(engine, StepPracticeEngine)


def test_runtime_registry_uses_step_engine_for_step_by_step_sessions() -> None:
    registry = PracticeSessionRuntimeRegistry()
    with patch(
        "app.processing.engines.practice_alignment.step_practice_engine.practice_score_timeline_from_musicxml",
        return_value=simple_timeline(),
    ):
        runtime = registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
        )

    assert isinstance(runtime.engine, StepPracticeEngine)
    registry.release("session-1")


def test_continuous_play_runtime_still_uses_performance_runtime() -> None:
    registry = PracticeSessionRuntimeRegistry()
    performance_runtime = PerformanceRuntime(score_timeline=simple_timeline())

    with patch(
        "app.processing.realtime.session_runtime.build_performance_runtime",
        return_value=performance_runtime,
    ) as build_runtime:
        runtime = registry.register(
            session_id="session-1",
            task_id="task-1",
            state="CREATED",
            score_file_path="score.xml",
            progression_mode="CONTINUOUS",
            realtime_guidance="STATUS_ONLY",
            evaluation_profile="PERFORMANCE",
            runtime_kind="FIXED_CLOCK_PERFORMANCE",
        )

    assert isinstance(runtime, PerformancePracticeSessionRuntime)
    assert runtime.start_performance(now_ms=0).state == PerformanceClockState.COUNT_IN
    build_runtime.assert_called_once()
    registry.release("session-1")


def test_accepted_observation_advances_exactly_once_and_next_chunk_gets_next_step() -> None:
    verifier = RecordingStepVerifier()
    engine = make_engine(verifier=verifier)
    first = observation_for_current(engine)
    verifier.observations.append(first)

    update = engine.ingest_audio(b"chunk-1")

    assert update is not None
    assert update["decision"]["action"] == "advance"
    assert engine._follow_policy.current_expected_group.pitches == ("D4",)
    assert len(verifier.calls) == 1
    first_target = verifier.calls[0][1]

    engine.ingest_audio(b"chunk-2")

    assert len(verifier.calls) == 2
    second_target = verifier.calls[1][1]
    assert first_target.step_id == first.step_id
    assert second_target.attack_pitches == ("D4",)
    assert second_target.step_id != first_target.step_id


def test_no_observation_waits_without_advancing() -> None:
    verifier = RecordingStepVerifier()
    engine = make_engine(verifier=verifier)
    current_step = engine._follow_policy.current_attack_step

    update = engine.ingest_audio(b"chunk")

    assert update is None
    assert engine._follow_policy.current_attack_step == current_step
    assert len(verifier.calls) == 1


def test_stale_or_wrong_observation_waits_without_advancing() -> None:
    stale = StepVerifierObservation(
        step_id="old-step",
        observed_attack_pitches=("C4",),
        confidence=1.0,
    )
    stale_verifier = RecordingStepVerifier([stale])
    stale_engine = make_engine(verifier=stale_verifier)
    stale_step = stale_engine._follow_policy.current_attack_step

    assert stale_engine.ingest_audio(b"stale") is None
    assert stale_engine._follow_policy.current_attack_step == stale_step

    wrong_verifier = RecordingStepVerifier()
    wrong_engine = make_engine(verifier=wrong_verifier)
    current_step = wrong_engine._follow_policy.current_attack_step
    assert current_step is not None
    wrong_verifier.observations.append(
        StepVerifierObservation(
            step_id=current_step.step_id,
            observed_attack_pitches=("D4",),
            confidence=1.0,
        )
    )

    assert wrong_engine.ingest_audio(b"wrong") is None
    assert wrong_engine._follow_policy.current_attack_step == current_step


def test_same_chunk_cannot_advance_twice() -> None:
    verifier = RecordingStepVerifier()
    engine = make_engine(verifier=verifier)
    verifier.observations.extend(
        [
            observation_for_current(engine),
            StepVerifierObservation(
                step_id=engine.score_timeline.practice_attack_steps[1].step_id,
                observed_attack_pitches=("D4",),
                confidence=1.0,
            ),
        ]
    )

    engine.ingest_audio(b"chunk-1")

    assert len(verifier.calls) == 1
    assert engine._follow_policy.current_expected_group.pitches == ("D4",)


def test_skip_advances_once_and_reset_restores_scoped_start() -> None:
    verifier = RecordingStepVerifier()
    engine = make_engine(verifier=verifier)

    skip_update = engine.skip_current_expected_group()

    assert skip_update is not None
    assert skip_update["decision"]["action"] == "skip"
    assert engine._follow_policy.current_expected_group.pitches == ("D4",)
    assert verifier.reset_count == 1

    engine.reset_input_buffer()

    assert engine._follow_policy.current_expected_group.pitches == ("C4",)
    assert verifier.reset_count == 2


def test_mixed_tie_continuation_is_not_an_attack_target() -> None:
    verifier = RecordingStepVerifier()
    engine = make_engine(verifier=verifier, timeline=mixed_tie_timeline())
    verifier.observations.append(observation_for_current(engine))
    engine.ingest_audio(b"first")
    engine.ingest_audio(b"second")

    second_target = verifier.calls[-1][1]

    assert set(second_target.attack_pitches) == {"F4", "A4"}
    assert second_target.continuation_pitches == ("C4",)


def test_same_pitch_multi_voice_is_one_physical_attack_target() -> None:
    verifier = RecordingStepVerifier()
    engine = make_engine(verifier=verifier, timeline=same_pitch_multi_voice_timeline())

    engine.ingest_audio(b"chunk")

    target = verifier.calls[0][1]
    assert target.attack_pitches == ("C4",)


def test_no_verifier_does_not_fallback_to_legacy_progression() -> None:
    engine = make_engine(verifier=None)
    current_step = engine._follow_policy.current_attack_step

    update = engine.ingest_audio(b"chunk")

    assert update is None
    assert engine._follow_policy.current_attack_step == current_step
