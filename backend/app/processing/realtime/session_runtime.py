from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Optional

from app.processing.practice_score.score_loader import practice_score_timeline_from_musicxml
from app.processing.performance.evidence import (
    PerformanceExpectedEventOutcome,
    PerformanceEvidenceRecorder,
    PerformanceObservation,
    PerformanceObservationSource,
)
from app.processing.performance.clock import PerformanceClockState
from app.processing.performance.runtime import PerformanceClockSync, PerformanceRuntime
from app.processing.performance.timeline import PerformanceTimelineProjection, TempoSegment
from app.processing.realtime.audio_buffer import AudioChunkBuffer

if TYPE_CHECKING:
    from app.processing.engines.practice_alignment.contracts import (
        AlignmentEngine,
        AlignmentUpdate,
        InputHealth,
    )
    from app.processing.engines.practice_alignment.attempt_assembler import ResolvedPracticeAttempt


def build_alignment_engine(
    *,
    score_file_path: str,
    sample_rate: int,
    channels: int,
    frame_format: str,
    progression_mode: str = "WAIT_FOR_NOTE",
    realtime_guidance: str = "GUIDED",
    evaluation_profile: str = "LEARNING",
    input_source: str = "MICROPHONE",
    start_expected_group_id: str | None = None,
    end_expected_group_id: str | None = None,
) -> "AlignmentEngine":
    """Create the practice alignment engine without importing heavy runtime deps at module load."""
    if input_source == "MIDI":
        from app.processing.engines.practice_alignment.midi_live import MidiPracticeEngine

        return MidiPracticeEngine(
            score_file_path=score_file_path,
            progression_mode=progression_mode,
            input_source=input_source,
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
        )

    from app.processing.engines.practice_alignment.matchmaker_live import (
        build_alignment_engine as build_matchmaker_engine,
    )

    return build_matchmaker_engine(
        score_file_path=score_file_path,
        sample_rate=sample_rate,
        channels=channels,
        frame_format=frame_format,
        progression_mode=progression_mode,
        realtime_guidance=realtime_guidance,
        evaluation_profile=evaluation_profile,
        input_source=input_source,
        start_expected_group_id=start_expected_group_id,
        end_expected_group_id=end_expected_group_id,
    )


def build_performance_runtime(
    *,
    score_file_path: str,
    start_expected_group_id: str | None = None,
    end_expected_group_id: str | None = None,
    tempo_segments: tuple[TempoSegment, ...] = (),
    speed_ratio: float = 1.0,
    count_in_duration_beats: float | None = None,
    count_in_pulses: float | None = None,
) -> PerformanceRuntime:
    score_timeline = practice_score_timeline_from_musicxml(score_file_path)
    return PerformanceRuntime(
        score_timeline=score_timeline,
        tempo_segments=tempo_segments,
        start_expected_group_id=start_expected_group_id,
        end_expected_group_id=end_expected_group_id,
        speed_ratio=speed_ratio,
        count_in_duration_beats=count_in_duration_beats,
        count_in_pulses=count_in_pulses,
    )


@dataclass
class PracticeSessionRuntime:
    session_id: str
    task_id: str
    state: str
    score_file_path: str
    sample_rate: int
    channels: int
    frame_format: str
    progression_mode: str
    realtime_guidance: str
    evaluation_profile: str
    input_source: str
    audio_buffer: AudioChunkBuffer
    engine: "AlignmentEngine"
    start_expected_group_id: str | None = None
    end_expected_group_id: str | None = None
    runtime_kind: str = "STEP_BY_STEP"
    websocket: object | None = None
    background_task: object | None = None
    last_alignment: Optional[AlignmentUpdate] = None
    pending_alignment_updates: int = 0
    is_ready_for_performance: bool = False
    pending_ready_notification: bool = False

    def process_audio_chunk(self, chunk: bytes) -> AlignmentUpdate | None:
        if self.input_source != "MICROPHONE":
            raise RuntimeError("This practice session does not accept audio input.")
        self.audio_buffer.append(chunk)
        alignment = self.engine.ingest_audio(chunk)
        if not self.is_ready_for_performance and self.engine.is_ready_for_performance:
            self.is_ready_for_performance = True
            self.pending_ready_notification = True
        if alignment is None:
            return None
        self.last_alignment = alignment
        self.pending_alignment_updates += 1
        return alignment

    def process_midi_event(
        self,
        *,
        event_type: Literal["note_on", "note_off"],
        note_number: int,
        velocity: int,
        timestamp_ms: int,
    ) -> AlignmentUpdate | None:
        if self.input_source != "MIDI":
            raise RuntimeError("This practice session does not accept MIDI input.")
        alignment = self.engine.ingest_midi_event(
            event_type=event_type,
            note_number=note_number,
            velocity=velocity,
            timestamp_ms=timestamp_ms,
        )
        if alignment is None:
            return None
        self.last_alignment = alignment
        self.pending_alignment_updates += 1
        return alignment

    def consume_ready_notification(self) -> bool:
        if not self.pending_ready_notification:
            return False
        self.pending_ready_notification = False
        return True

    def drain_resolved_practice_attempts(self) -> list["ResolvedPracticeAttempt"]:
        return self.engine.drain_resolved_practice_attempts()

    def finalize_pending_practice_attempt(
        self,
        *,
        reason: Literal["practice_paused", "practice_finished", "connection_closed"],
    ) -> list["ResolvedPracticeAttempt"]:
        return self.engine.finalize_pending_practice_attempt(reason=reason)

    def reset_input_buffer(self) -> None:
        self.audio_buffer.clear()
        self.engine.reset_input_buffer()

    @property
    def input_health(self) -> "InputHealth":
        return self.engine.input_health

    def is_scope_completed(self) -> bool:
        return bool(self.last_alignment and self.last_alignment["scope_completed"])

    def should_persist_alignment(self) -> bool:
        return self.last_alignment is not None and self.pending_alignment_updates >= 5

    def mark_alignment_persisted(self) -> None:
        self.pending_alignment_updates = 0

    def close(self) -> None:
        self.audio_buffer.clear()
        self.engine.close()


@dataclass
class PerformancePracticeSessionRuntime:
    session_id: str
    task_id: str
    state: str
    score_file_path: str
    sample_rate: int
    channels: int
    frame_format: str
    progression_mode: str
    realtime_guidance: str
    evaluation_profile: str
    input_source: str
    performance_runtime: PerformanceRuntime
    evidence_recorder: PerformanceEvidenceRecorder
    start_expected_group_id: str | None = None
    end_expected_group_id: str | None = None
    runtime_kind: str = "FIXED_CLOCK_PERFORMANCE"
    websocket: object | None = None
    background_task: object | None = None
    resume_count_in_started_at_ms: int | None = None
    resume_count_in_duration_ms: float = 0.0
    resume_count_in_pulses: float = 0.0

    def start_performance(self, *, now_ms: int) -> PerformanceClockSync:
        return self.performance_runtime.start(now_ms=now_ms)

    def pause_performance(self, *, now_ms: int) -> PerformanceClockSync:
        if self.resume_count_in_started_at_ms is not None:
            self.resume_count_in_started_at_ms = None
            self.resume_count_in_duration_ms = 0.0
            self.resume_count_in_pulses = 0.0
            return self.performance_runtime.sync(now_ms=now_ms)
        return self.performance_runtime.pause(now_ms=now_ms)

    def resume_performance(self, *, now_ms: int) -> PerformanceClockSync:
        if not self.performance_runtime.paused_from_running:
            return self.performance_runtime.resume(now_ms=now_ms)

        paused_sync = self.performance_runtime.sync(now_ms=now_ms)
        duration_ms, pulses = self.performance_runtime.count_in_for_beat(paused_sync.musical_beat)
        if duration_ms <= 0 or pulses <= 0:
            return self.performance_runtime.resume(now_ms=now_ms)

        self.resume_count_in_started_at_ms = now_ms
        self.resume_count_in_duration_ms = duration_ms
        self.resume_count_in_pulses = pulses
        return self._resume_count_in_sync(now_ms=now_ms, paused_sync=paused_sync)

    def performance_sync(self, *, now_ms: int) -> PerformanceClockSync:
        if self.resume_count_in_started_at_ms is not None:
            paused_sync = self.performance_runtime.sync(now_ms=now_ms)
            elapsed_ms = max(0.0, now_ms - self.resume_count_in_started_at_ms)
            if elapsed_ms < self.resume_count_in_duration_ms:
                return self._resume_count_in_sync(now_ms=now_ms, paused_sync=paused_sync)
            self.resume_count_in_started_at_ms = None
            self.resume_count_in_duration_ms = 0.0
            self.resume_count_in_pulses = 0.0
            return self.performance_runtime.resume(now_ms=now_ms)
        return self.performance_runtime.sync(now_ms=now_ms)

    def performance_timeline_projection(self) -> PerformanceTimelineProjection:
        return self.performance_runtime.timeline_projection()

    @property
    def performance_observations(self) -> tuple[PerformanceObservation, ...]:
        return self.evidence_recorder.observations

    def process_audio_chunk(self, chunk: bytes, *, now_ms: int) -> PerformanceObservation | None:
        if self.input_source != "MICROPHONE":
            raise RuntimeError("This performance session does not accept audio input.")
        sync = self.performance_sync(now_ms=now_ms)
        if sync.state != PerformanceClockState.RUNNING:
            return None
        return self.evidence_recorder.record_audio_chunk(
            chunk,
            session_time_ms=now_ms,
            performance_time_ms=sync.performance_time_ms,
        )

    def process_midi_event(
        self,
        *,
        event_type: Literal["note_on", "note_off"],
        note_number: int,
        velocity: int,
        input_session_time_ms: int,
    ) -> PerformanceObservation | None:
        if self.input_source != "MIDI":
            raise RuntimeError("This performance session does not accept MIDI input.")
        sync = self.performance_sync(now_ms=input_session_time_ms)
        if sync.state != PerformanceClockState.RUNNING:
            return None
        return self.evidence_recorder.record_midi_event(
            event_type=event_type,
            note_number=note_number,
            velocity=velocity,
            session_time_ms=input_session_time_ms,
            performance_time_ms=sync.performance_time_ms,
        )

    def finalize_performance_observations(self, *, now_ms: int) -> tuple[PerformanceObservation, ...]:
        sync = self.performance_sync(now_ms=now_ms)
        return self.evidence_recorder.finish_open_midi_notes(
            session_time_ms=now_ms,
            performance_time_ms=sync.performance_time_ms,
        )

    def evaluate_expected_event_outcomes(self) -> tuple[PerformanceExpectedEventOutcome, ...]:
        return self.performance_runtime.evaluate_expected_event_outcomes(
            source=PerformanceObservationSource(self.input_source),
            observations=self.performance_observations,
        )

    def _resume_count_in_sync(
        self,
        *,
        now_ms: int,
        paused_sync: PerformanceClockSync,
    ) -> PerformanceClockSync:
        elapsed_ms = (
            0.0
            if self.resume_count_in_started_at_ms is None
            else max(0.0, now_ms - self.resume_count_in_started_at_ms)
        )
        remaining_ms = max(0.0, self.resume_count_in_duration_ms - elapsed_ms)
        remaining_pulses = (
            0.0
            if self.resume_count_in_duration_ms <= 0
            else self.resume_count_in_pulses * remaining_ms / self.resume_count_in_duration_ms
        )
        return PerformanceClockSync(
            state=PerformanceClockState.COUNT_IN,
            musical_beat=paused_sync.musical_beat,
            performance_time_ms=paused_sync.performance_time_ms,
            count_in_remaining_ms=remaining_ms,
            count_in_remaining_pulses=remaining_pulses,
            scope_completed=False,
            scope_start_group_id=paused_sync.scope_start_group_id,
            scope_end_group_id=paused_sync.scope_end_group_id,
            scope_start_beat=paused_sync.scope_start_beat,
            scope_terminal_beat=paused_sync.scope_terminal_beat,
            nominal_scope_duration_ms=paused_sync.nominal_scope_duration_ms,
            speed_ratio=paused_sync.speed_ratio,
        )

    def close(self) -> None:
        return None


PracticeRuntime = PracticeSessionRuntime | PerformancePracticeSessionRuntime


class PracticeSessionRuntimeRegistry:
    """In-memory registry for active practice sessions."""

    def __init__(self) -> None:
        self._runtimes: dict[str, PracticeRuntime] = {}

    def register(
        self,
        session_id: str,
        task_id: str,
        state: str,
        score_file_path: str,
        sample_rate: int = 16000,
        channels: int = 1,
        frame_format: str = "pcm_s16le",
        progression_mode: str = "WAIT_FOR_NOTE",
        realtime_guidance: str = "GUIDED",
        evaluation_profile: str = "LEARNING",
        input_source: str = "MICROPHONE",
        start_expected_group_id: str | None = None,
        end_expected_group_id: str | None = None,
        runtime_kind: str = "STEP_BY_STEP",
    ) -> PracticeRuntime:
        if runtime_kind == "FIXED_CLOCK_PERFORMANCE":
            if (
                progression_mode != "CONTINUOUS"
                or realtime_guidance != "STATUS_ONLY"
                or evaluation_profile != "PERFORMANCE"
            ):
                raise RuntimeError("Fixed-clock performance runtime requires canonical Performance config.")
            runtime: PracticeRuntime = PerformancePracticeSessionRuntime(
                session_id=session_id,
                task_id=task_id,
                state=state,
                score_file_path=score_file_path,
                sample_rate=sample_rate,
                channels=channels,
                frame_format=frame_format,
                progression_mode=progression_mode,
                realtime_guidance=realtime_guidance,
                evaluation_profile=evaluation_profile,
                input_source=input_source,
                runtime_kind=runtime_kind,
                start_expected_group_id=start_expected_group_id,
                end_expected_group_id=end_expected_group_id,
                performance_runtime=build_performance_runtime(
                    score_file_path=score_file_path,
                    start_expected_group_id=start_expected_group_id,
                    end_expected_group_id=end_expected_group_id,
                ),
                evidence_recorder=PerformanceEvidenceRecorder(
                    source=PerformanceObservationSource(input_source),
                    sample_rate=sample_rate,
                    channels=channels,
                ),
            )
            self._runtimes[session_id] = runtime
            return runtime

        if runtime_kind != "STEP_BY_STEP":
            raise RuntimeError(f"Unsupported practice runtime kind: {runtime_kind}")
        if (
            progression_mode != "WAIT_FOR_NOTE"
            or realtime_guidance != "GUIDED"
            or evaluation_profile != "LEARNING"
        ):
            raise RuntimeError("Step-by-step runtime requires canonical learning config.")

        runtime = PracticeSessionRuntime(
            session_id=session_id,
            task_id=task_id,
            state=state,
            score_file_path=score_file_path,
            sample_rate=sample_rate,
            channels=channels,
            frame_format=frame_format,
            progression_mode=progression_mode,
            realtime_guidance=realtime_guidance,
            evaluation_profile=evaluation_profile,
            input_source=input_source,
            runtime_kind=runtime_kind,
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
            audio_buffer=AudioChunkBuffer(),
            engine=build_alignment_engine(
                score_file_path=score_file_path,
                sample_rate=sample_rate,
                channels=channels,
                frame_format=frame_format,
                progression_mode=progression_mode,
                realtime_guidance=realtime_guidance,
                evaluation_profile=evaluation_profile,
                input_source=input_source,
                start_expected_group_id=start_expected_group_id,
                end_expected_group_id=end_expected_group_id,
            ),
            is_ready_for_performance=input_source == "MIDI",
            pending_ready_notification=input_source == "MIDI",
        )
        self._runtimes[session_id] = runtime
        return runtime

    def get(self, session_id: str) -> PracticeRuntime | None:
        return self._runtimes.get(session_id)

    def release(self, session_id: str) -> PracticeRuntime | None:
        runtime = self._runtimes.pop(session_id, None)
        if runtime is not None:
            runtime.close()
        return runtime

    def clear(self) -> None:
        for runtime in self._runtimes.values():
            runtime.close()
        self._runtimes.clear()


practice_runtime_registry = PracticeSessionRuntimeRegistry()
