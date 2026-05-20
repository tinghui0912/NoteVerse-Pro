from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.core.config import settings
from app.processing.engines.matchmaker_live import (
    AlignmentEngine,
    AlignmentUpdate,
    build_alignment_engine,
)
from app.processing.realtime.audio_buffer import AudioChunkBuffer


@dataclass
class PracticeSessionRuntime:
    session_id: str
    task_id: str
    state: str
    score_file_path: str
    sample_rate: int
    channels: int
    frame_format: str
    audio_buffer: AudioChunkBuffer
    engine: AlignmentEngine
    websocket: object | None = None
    background_task: object | None = None
    last_alignment: Optional[AlignmentUpdate] = None
    pending_alignment_updates: int = 0
    is_ready_for_performance: bool = False
    pending_ready_notification: bool = False
    last_warning: Optional[str] = None

    def process_audio_chunk(self, chunk: bytes) -> AlignmentUpdate | None:
        self.audio_buffer.append(chunk)
        alignment = self.engine.ingest_audio(chunk)
        if not self.is_ready_for_performance and self.engine.is_ready_for_performance:
            self.is_ready_for_performance = True
            self.pending_ready_notification = True
        if alignment is None:
            return None
        self.last_alignment = alignment
        self.pending_alignment_updates += 1
        self.last_warning = "low_confidence" if alignment["confidence"] < 0.5 else None
        return alignment

    def consume_ready_notification(self) -> bool:
        if not self.pending_ready_notification:
            return False
        self.pending_ready_notification = False
        return True

    def is_score_completed(self) -> bool:
        return bool(self.last_alignment and self.last_alignment["score_completed"])

    def should_persist_alignment(self) -> bool:
        return self.last_alignment is not None and self.pending_alignment_updates >= 5

    def mark_alignment_persisted(self) -> None:
        self.pending_alignment_updates = 0

    def close(self) -> None:
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
    ) -> PracticeSessionRuntime:
        runtime = PracticeSessionRuntime(
            session_id=session_id,
            task_id=task_id,
            state=state,
            score_file_path=score_file_path,
            sample_rate=sample_rate,
            channels=channels,
            frame_format=frame_format,
            audio_buffer=AudioChunkBuffer(),
            engine=build_alignment_engine(
                engine_name=settings.PRACTICE_ALIGNMENT_ENGINE,
                score_file_path=score_file_path,
                sample_rate=sample_rate,
                channels=channels,
                frame_format=frame_format,
            ),
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
