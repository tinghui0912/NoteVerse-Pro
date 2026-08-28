from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Optional

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
    progression_mode: str = "CONTINUOUS",
    realtime_guidance: str = "STATUS_ONLY",
    evaluation_profile: str = "PERFORMANCE",
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


class PracticeSessionRuntimeRegistry:
    """In-memory registry for active practice sessions."""

    def __init__(self) -> None:
        self._runtimes: dict[str, PracticeSessionRuntime] = {}

    def register(
        self,
        session_id: str,
        task_id: str,
        state: str,
        score_file_path: str,
        sample_rate: int = 16000,
        channels: int = 1,
        frame_format: str = "pcm_s16le",
        progression_mode: str = "CONTINUOUS",
        realtime_guidance: str = "STATUS_ONLY",
        evaluation_profile: str = "PERFORMANCE",
        input_source: str = "MICROPHONE",
        start_expected_group_id: str | None = None,
        end_expected_group_id: str | None = None,
    ) -> PracticeSessionRuntime:
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

    def get(self, session_id: str) -> PracticeSessionRuntime | None:
        return self._runtimes.get(session_id)

    def release(self, session_id: str) -> PracticeSessionRuntime | None:
        runtime = self._runtimes.pop(session_id, None)
        if runtime is not None:
            runtime.close()
        return runtime

    def clear(self) -> None:
        for runtime in self._runtimes.values():
            runtime.close()
        self._runtimes.clear()


practice_runtime_registry = PracticeSessionRuntimeRegistry()
