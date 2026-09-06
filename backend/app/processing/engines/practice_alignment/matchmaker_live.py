from __future__ import annotations

import queue
from pathlib import Path
from typing import Literal

from app.core.settings.practice_runtime import get_practice_runtime_settings
from app.processing.engines.practice_alignment.alignment_metrics import (
    beat_velocity,
    continuity_state,
)
from app.processing.resources import ensure_partitura_default_soundfont
from app.processing.engines.practice_alignment.audio_features import feature_matrix
from app.processing.engines.practice_alignment.acoustic_event_observation import AcousticEventObserver
from app.processing.engines.practice_alignment.attempt_assembler import (
    PracticeAttemptAssembler,
    ResolvedPracticeAttempt,
    ResolvedPracticeAttemptBuffer,
    attach_attempt_outcome,
)
from app.processing.engines.practice_alignment.browser_audio_stream import BrowserAudioStreamAdapter
from app.processing.engines.practice_alignment.contracts import (
    AlignmentEngine,
    AlignmentUpdate,
    InputHealth,
)
from app.processing.engines.practice_alignment.expected_event_evaluator import EvaluatorEvidence
from app.processing.engines.practice_alignment.expected_group_attempt_accumulator import (
    ExpectedGroupAttemptAccumulator,
)
from app.processing.engines.practice_alignment.follow_policy import (
    follow_policy_for_progression,
)
from app.processing.engines.practice_alignment.musicxml_stable_ids import (
    prepared_musicxml_path_for_practice,
)
from app.processing.engines.practice_alignment.profile import (
    DEFAULT_PRACTICE_AUDIO_PROFILE,
    PRACTICE_ALIGNMENT_RUNTIME_PROFILE_ID,
)
from app.processing.engines.practice_alignment.reference_runtime import (
    build_audio_processor,
    generate_score_audio,
    normalize_audio_waveform,
)
from app.processing.engines.practice_alignment.reference_features import (
    slice_reference_timeline,
)
from app.processing.engines.practice_alignment.score_timeline import PracticeScoreTimeline

DEFAULT_TEMPO_BPM = 120
WAIT_FOR_NOTE_AUDIO_WINDOW_SECONDS = 0.5
WAIT_FOR_NOTE_COLLECTION_FRAMES = 3
WAIT_FOR_NOTE_RELEASE_FRAME_THRESHOLD = 2
START_FEATURE_CONFIDENCE_THRESHOLD = 0.7
WAIT_FOR_NOTE_MATCHED_CONFIDENCE_THRESHOLD = 0.75
FEATURE_SIMILARITY_FLOOR = 0.72
FEATURE_SIMILARITY_FULL_MATCH_SPAN = 0.18

class MatchmakerLiveEngine:
    """Matchmaker-backed live engine for browser WebSocket PCM streams."""

    def __init__(
        self,
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
    ) -> None:
        if input_source != "MICROPHONE":
            raise RuntimeError(
                "Matchmaker live practice sessions currently require MICROPHONE input."
            )
        if channels != 1:
            raise RuntimeError("Matchmaker practice sessions require mono audio.")
        if frame_format != "pcm_s16le":
            raise RuntimeError("Matchmaker practice sessions require pcm_s16le audio.")
        if progression_mode != "WAIT_FOR_NOTE":
            raise RuntimeError(
                "Live microphone practice currently supports WAIT_FOR_NOTE only. "
                "Continuous performance will use a fixed-clock engine, not Matchmaker score following."
            )

        ensure_partitura_default_soundfont(get_practice_runtime_settings().PRACTICE_SOUNDFONT_PATH)
        try:
            import numpy as np
            import partitura
            from matchmaker.base import STREAM_END
            from matchmaker.features.audio import ChromagramProcessor
            from partitura.io.exportmidi import get_ppq
        except ImportError as exc:
            missing_module = getattr(exc, "name", None) or "unknown"
            raise RuntimeError(
                "Missing practice alignment dependency "
                f"'{missing_module}'. Install pymatchmaker and its runtime "
                f"dependencies before starting live practice sessions. Original error: {exc}"
            ) from exc
        score_audio_generator = None
        if not get_practice_runtime_settings().PRACTICE_SOUNDFONT_PATH:
            try:
                from matchmaker.utils import misc as matchmaker_misc

                score_audio_generator = matchmaker_misc.generate_score_audio
            except ImportError as exc:
                missing_module = getattr(exc, "name", None) or "unknown"
                raise RuntimeError(
                    "Missing practice alignment dependency "
                    f"'{missing_module}'. Install pymatchmaker and its runtime "
                    "dependencies before starting live practice sessions. "
                    f"Original error: {exc}"
                ) from exc

        self.score_file_path = str(Path(score_file_path))
        self.sample_rate = sample_rate
        self.channels = channels
        self.frame_format = frame_format
        self.progression_mode = progression_mode
        self.realtime_guidance = realtime_guidance
        self.evaluation_profile = evaluation_profile
        self.input_source = input_source
        self.total_bytes = 0
        self._last_beat_position: float | None = None
        self._last_alignment_timestamp_ms: int | None = None
        self._np = np
        self._get_ppq = get_ppq
        self._stream_end_marker = STREAM_END
        self._error: Exception | None = None
        self._alignment_decision_log_count = 0
        self._pending_audio = np.array([], dtype=np.float32)
        self._acoustic_observer = AcousticEventObserver()
        self._wait_for_note_attempt_assembler = PracticeAttemptAssembler()
        self._resolved_practice_attempts = ResolvedPracticeAttemptBuffer()
        self._wait_for_note_attempt = ExpectedGroupAttemptAccumulator(
            observer=self._acoustic_observer,
            lifecycle=self._wait_for_note_attempt_assembler.lifecycle,
            sample_rate=sample_rate,
            np_module=np,
            window_samples=int(sample_rate * WAIT_FOR_NOTE_AUDIO_WINDOW_SECONDS),
            collection_frames=WAIT_FOR_NOTE_COLLECTION_FRAMES,
            release_frame_threshold=WAIT_FOR_NOTE_RELEASE_FRAME_THRESHOLD,
        )

        profile = DEFAULT_PRACTICE_AUDIO_PROFILE
        with prepared_musicxml_path_for_practice(self.score_file_path) as prepared_path:
            self.score_part = partitura.load_score_as_part(str(prepared_path))
            self._note_array = self.score_part.note_array()
            self.score_timeline = PracticeScoreTimeline.from_note_array(
                self._note_array,
                musicxml_path=prepared_path,
            )
        if self.score_timeline.first_playable_beat is None:
            raise RuntimeError("Practice score timeline contains no playable events.")
        self._follow_policy = follow_policy_for_progression(
            self.score_timeline,
            progression_mode=progression_mode,
            input_source=input_source,
            start_expected_group_id=start_expected_group_id,
            end_expected_group_id=end_expected_group_id,
        )
        self._scope_start_beat = getattr(self._follow_policy, "scope_start_beat", None)
        self._scope_end_beat = getattr(self._follow_policy, "scope_end_beat", None)
        self._score_start_beat = (
            self._scope_start_beat
            if self._scope_start_beat is not None
            else self.score_timeline.first_playable_beat
        )
        self._score_end_beat = (
            self._scope_end_beat
            if self._scope_end_beat is not None
            else self.score_timeline.end_beat
        )
        self._scope_reference_end_beat = self._resolve_scope_reference_end_beat(
            end_expected_group_id
        )
        self._startup_entry_beats = self._initial_entry_region_beats(
            width_beats=profile.startup_entry_region_beats,
        )
        self._pending_start_anchor_beat: float | None = None
        self.tempo = DEFAULT_TEMPO_BPM
        self.frame_rate = profile.frame_rate
        self.hop_length = max(int(sample_rate / self.frame_rate), 1)
        self._queue: queue.Queue[object] = queue.Queue()
        self._processor = build_audio_processor(
            sample_rate=sample_rate,
            hop_length=self.hop_length,
            chroma_processor=ChromagramProcessor,
        )
        settings = get_practice_runtime_settings()
        self._stream = BrowserAudioStreamAdapter(
            processor=self._processor,
            feature_queue=self._queue,
            np=np,
            hop_length=self.hop_length,
            rms_gate=profile.rms_gate,
            peak_gate=profile.peak_gate,
            start_rms_gate=profile.start_rms_gate,
            start_peak_gate=profile.start_peak_gate,
            min_active_frames=profile.min_active_frames,
            warmup_frames=profile.warmup_frames,
            rms_noise_multiplier=profile.rms_noise_multiplier,
            peak_noise_multiplier=profile.peak_noise_multiplier,
            diagnostics_enabled=settings.PRACTICE_AUDIO_DIAGNOSTICS,
            no_input_frames=profile.no_input_frames,
            tonal_gate_enabled=profile.tonal_gate_enabled,
            max_spectral_flatness=profile.max_spectral_flatness,
            min_peak_prominence=profile.min_peak_prominence,
            onset_flux_gate=profile.onset_flux_gate,
            onset_hold_frames=profile.onset_hold_frames,
            start_feature_window_frames=profile.startup_feature_window_frames,
            diagnostic_frame_interval=settings.PRACTICE_AUDIO_DIAGNOSTIC_FRAME_INTERVAL,
        )

        raw_score_audio = generate_score_audio(
            score=self.score_part,
            bpm=self.tempo,
            sample_rate=sample_rate,
            np=np,
            partitura=partitura,
            generate_score_audio=score_audio_generator,
        )
        score_audio = normalize_audio_waveform(raw_score_audio, np).astype(np.float32)
        reference_features = feature_matrix(self._processor((score_audio, 0.0)))
        if reference_features is None:
            raise RuntimeError("Score feature extraction returned no features.")
        if hasattr(self._processor, "reset"):
            self._processor.reset()
        ref_frame_to_beat = self._build_ref_frame_to_beat(reference_features)
        self._reference_slice = slice_reference_timeline(
            reference_features,
            ref_frame_to_beat,
            score_start_beat=self._score_start_beat,
            scope_start_beat=self._scope_start_beat,
            scope_end_beat=self._scope_reference_end_beat,
            np=self._np,
        )
        self._reference_features = self._reference_slice.features
        self._ref_frame_to_beat = self._reference_slice.frame_to_beat
        if self._ref_frame_to_beat.size == 0:
            raise RuntimeError("Selected practice range contains no reference frames.")
        self._stream.start_feature_validator = self._is_valid_start_feature
        self._stream.start_feature_scorer = self._score_start_feature

    def ingest_audio(self, chunk: bytes) -> AlignmentUpdate | None:
        if self._error is not None:
            raise RuntimeError(str(self._error)) from self._error
        if not chunk:
            return None

        self.total_bytes += len(chunk)
        audio = self._pcm_s16le_to_float32(chunk)
        if audio.size == 0:
            return None
        if not hasattr(self, "_pending_audio"):
            self._pending_audio = audio[:0]
        if self._pending_audio.size:
            self._pending_audio = self._np.concatenate((self._pending_audio, audio))
        else:
            self._pending_audio = audio

        latest_update: AlignmentUpdate | None = None
        hop_length = int(getattr(self, "hop_length", audio.size))
        while self._pending_audio.size >= hop_length:
            audio_frame = self._pending_audio[:hop_length]
            self._pending_audio = self._pending_audio[hop_length:]
            update = self._ingest_audio_frame(audio_frame)
            if update is not None:
                latest_update = update
        return latest_update

    def ingest_midi_event(
        self,
        *,
        event_type: Literal["note_on", "note_off"],
        note_number: int,
        velocity: int,
        timestamp_ms: int,
    ) -> AlignmentUpdate | None:
        _ = (event_type, note_number, velocity, timestamp_ms)
        raise RuntimeError("Microphone practice sessions do not accept MIDI events.")

    def reset_input_buffer(self) -> None:
        self._pending_audio = self._np.array([], dtype=self._np.float32)
        attempt = getattr(self, "_wait_for_note_attempt", None)
        if attempt is not None:
            attempt.reset()

    def _ingest_audio_frame(self, audio_frame) -> AlignmentUpdate | None:
        if self.progression_mode == "WAIT_FOR_NOTE":
            self._stream.ingest(audio_frame)
            if not self._stream.armed:
                return None
            update = self._wait_for_note_update(audio_frame)
            if update is None or update["decision"]["reason"] == "insufficient_input":
                return None
            return update

        raise RuntimeError(
            "Unsupported live practice progression mode. "
            "Only WAIT_FOR_NOTE is enabled until fixed-clock Performance is implemented."
        )

    def _wait_for_note_update(
        self,
        audio_frame,
    ) -> AlignmentUpdate | None:
        follow_policy = getattr(self, "_follow_policy", None)
        if follow_policy is None:
            return None

        current_group = follow_policy.current_expected_group
        if current_group is None:
            decision = follow_policy.decide(self._wait_for_note_base_update(self._score_end_beat))
            return self._wait_for_note_alignment_update(
                beat_position=self._score_end_beat,
                confidence=1.0,
                scope_completed=True,
                decision=decision,
            )

        observation = self._wait_for_note_attempt.observe_frame(
            audio_frame,
            candidate_signal=self._wait_for_note_candidate_signal(),
            onset_beat=current_group.onset_beat,
            expected_group_id=current_group.group_id,
            timestamp_ms=self._timestamp_ms(),
        )
        if observation is None:
            decision = follow_policy.decide(self._wait_for_note_base_update(current_group.onset_beat))
            return self._wait_for_note_alignment_update(
                beat_position=current_group.onset_beat,
                confidence=0.0,
                scope_completed=False,
                decision=decision,
            )

        evidence = EvaluatorEvidence.from_audio(observation)
        evaluation = follow_policy.evaluate_evidence(evidence)
        outcome = None
        if self._wait_for_note_attempt.last_resolved_attempt is not None:
            outcome = self._wait_for_note_attempt_assembler.resolve(
                evaluation,
                timestamp_ms=self._wait_for_note_attempt.last_resolved_attempt.resolved_at_ms or self._timestamp_ms(),
            )
        decision = follow_policy.decide_evaluation(evidence=evidence, evaluation=evaluation)
        attach_attempt_outcome(decision, outcome)
        display_anchor = decision["display_anchor"]
        beat_position = current_group.onset_beat if display_anchor is None else float(display_anchor["beat"])
        update = self._wait_for_note_alignment_update(
            beat_position=beat_position,
            confidence=observation.confidence,
            scope_completed=follow_policy.current_expected_group is None,
            decision=decision,
        )
        self._resolved_practice_attempts.append_for_expected_group(
            outcome=outcome,
            action=decision["action"],
            resolution_reason=decision["reason"],
            experience_state=decision["experience_state"],
            expected_group=current_group,
            update_confidence=update["confidence"],
            update_timestamp_ms=update["timestamp_ms"],
            validation_confidence=update.get("validation_confidence"),
            input_policy_confidence=update.get("input_policy_confidence"),
        )
        return update

    def drain_resolved_practice_attempts(self) -> list[ResolvedPracticeAttempt]:
        return self._resolved_practice_attempts.drain()

    def finalize_pending_practice_attempt(
        self,
        *,
        reason: Literal["practice_paused", "practice_finished", "connection_closed"],
    ) -> list[ResolvedPracticeAttempt]:
        follow_policy = getattr(self, "_follow_policy", None)
        if follow_policy is None or not hasattr(follow_policy, "current_expected_group"):
            self.reset_input_buffer()
            return self.drain_resolved_practice_attempts()

        current_group = follow_policy.current_expected_group
        if current_group is None:
            self.reset_input_buffer()
            return self.drain_resolved_practice_attempts()

        timestamp_ms = self._timestamp_ms()
        observation = self._wait_for_note_attempt.finalize_pending(
            onset_beat=current_group.onset_beat,
            timestamp_ms=timestamp_ms,
        )
        if observation is None:
            self.reset_input_buffer()
            return self.drain_resolved_practice_attempts()

        evidence = EvaluatorEvidence.from_audio(observation)
        evaluation = follow_policy.evaluate_evidence(evidence)
        outcome = self._wait_for_note_attempt_assembler.resolve(
            evaluation,
            timestamp_ms=timestamp_ms,
        )
        update = self._wait_for_note_alignment_update(
            beat_position=current_group.onset_beat,
            confidence=observation.confidence,
            scope_completed=False,
            decision=follow_policy.decide(self._wait_for_note_base_update(current_group.onset_beat)),
        )
        self._resolved_practice_attempts.append_for_expected_group(
            outcome=outcome,
            action="hold",
            resolution_reason=reason,
            experience_state="paused",
            expected_group=current_group,
            update_confidence=update["confidence"],
            update_timestamp_ms=update["timestamp_ms"],
            validation_confidence=update.get("validation_confidence"),
            input_policy_confidence=update.get("input_policy_confidence"),
        )
        self.reset_input_buffer()
        return self.drain_resolved_practice_attempts()

    def _reset_wait_for_note_event(self) -> None:
        self._wait_for_note_attempt.reset()

    def _clear_wait_for_note_audio(self) -> None:
        self._wait_for_note_attempt.clear_audio()

    def _wait_for_note_candidate_signal(self) -> bool:
        if getattr(self._stream, "last_onset_signal", False):
            return True

        gate_config = self._stream.audio_gate.config
        rms_gate = min(
            self._stream.start_rms_gate * gate_config.start_rms_ratio,
            self._stream.rms_gate * gate_config.start_rms_fallback_ratio,
        )
        peak_gate = min(
            self._stream.start_peak_gate * gate_config.start_peak_ratio,
            self._stream.peak_gate * gate_config.start_peak_fallback_ratio,
        )
        return (
            getattr(self._stream, "last_rms", 0.0) >= rms_gate
            or getattr(self._stream, "last_peak", 0.0) >= peak_gate
        )

    def _wait_for_note_base_update(self, beat_position: float) -> AlignmentUpdate:
        return {
            "beat_position": round(beat_position, 3),
            "confidence": 0.0,
            "alignment_confidence": 0.0,
            "audio_confidence": 0.0,
            "continuity_confidence": 1.0,
            "visual_confidence": 0.0,
            "timestamp_ms": self._timestamp_ms(),
            "scope_completed": False,
            "completion_reason": None,
            "audio_active": self._stream.last_audio_active,
            "input_rms": round(self._stream.last_rms, 5),
            "input_peak": round(self._stream.last_peak, 5),
            "input_health": self._stream.input_health,
            "match_state": "matched" if self._stream.last_audio_active else "no_input",
        }

    def _wait_for_note_alignment_update(
        self,
        *,
        beat_position: float,
        confidence: float,
        scope_completed: bool,
        decision,
    ) -> AlignmentUpdate:
        previous_beat_position = self._last_beat_position
        previous_timestamp_ms = getattr(self, "_last_alignment_timestamp_ms", None)
        timestamp_ms = self._timestamp_ms()
        beat_delta = (
            None
            if previous_beat_position is None
            else round(beat_position - previous_beat_position, 3)
        )
        self._last_beat_position = beat_position
        self._last_alignment_timestamp_ms = timestamp_ms
        confidence = round(confidence, 3)
        match_state = "matched" if self._stream.last_audio_active else "no_input"
        return {
            "beat_position": round(beat_position, 3),
            "confidence": confidence,
            "alignment_confidence": confidence,
            "audio_confidence": confidence,
            "continuity_confidence": 1.0,
            "visual_confidence": confidence,
            "timestamp_ms": timestamp_ms,
            "scope_completed": scope_completed,
            "completion_reason": (
                "FINAL_EXPECTED_GROUP_MATCHED" if scope_completed else None
            ),
            "audio_active": self._stream.last_audio_active,
            "input_rms": round(self._stream.last_rms, 5),
            "input_peak": round(self._stream.last_peak, 5),
            "input_health": self._stream.input_health,
            "match_state": match_state,
            "feature_confidence": confidence,
            "beat_delta": beat_delta,
            "continuity_state": continuity_state(beat_delta),
            "beat_velocity": beat_velocity(
                beat_delta=beat_delta,
                timestamp_ms=timestamp_ms,
                previous_timestamp_ms=previous_timestamp_ms,
            ),
            "stream_state": self._stream.stream_state,
            "frame_class": getattr(self._stream, "last_frame_class", "unknown"),
            "gate_reason": getattr(self._stream, "last_gate_reason", "unknown"),
            "queue_decision": getattr(self._stream, "last_queue_decision", "unknown"),
            "tonal_signal": getattr(self._stream, "last_tonal_signal", False),
            "onset_signal": getattr(self._stream, "last_onset_signal", False),
            "spectral_flatness": round(getattr(self._stream, "last_spectral_flatness", 1.0), 5),
            "peak_prominence": round(getattr(self._stream, "last_peak_prominence", 0.0), 2),
            "spectral_flux": round(getattr(self._stream, "last_spectral_flux", 0.0), 5),
            "alignment_state": (
                "matched"
                if confidence >= WAIT_FOR_NOTE_MATCHED_CONFIDENCE_THRESHOLD
                else "uncertain"
            ),
            "validation_confidence": confidence,
            "input_weight": round(getattr(self._stream, "last_input_weight", 0.0), 3),
            "input_policy_confidence": round(getattr(self._stream, "last_input_policy_confidence", confidence), 3),
            "decision": decision,
        }

    @property
    def is_ready_for_performance(self) -> bool:
        return self._stream.armed

    @property
    def input_health(self) -> InputHealth:
        return self._stream.input_health

    @property
    def runtime_profile_id(self) -> str:
        return PRACTICE_ALIGNMENT_RUNTIME_PROFILE_ID

    def close(self) -> None:
        self._queue.put(self._stream_end_marker)

    def _pcm_s16le_to_float32(self, chunk: bytes):
        samples = self._np.frombuffer(chunk, dtype=self._np.int16)
        return (samples.astype(self._np.float32) / 32768.0).copy()

    def _build_ref_frame_to_beat(self, reference_features):
        frame_count = int(reference_features.shape[0])
        return self._np.array(
            [self._frame_to_beat(frame_index) for frame_index in range(frame_count)],
            dtype=self._np.float32,
        )

    def _resolve_scope_reference_end_beat(
        self,
        end_expected_group_id: str | None,
    ) -> float | None:
        if end_expected_group_id is None:
            return None
        end_beat = self.score_timeline.entry_group_end_beat(end_expected_group_id)
        if end_beat is None:
            return None
        return end_beat

    def _frame_to_beat(self, current_frame: int) -> float:
        tick = self._get_ppq(self.score_part)
        timeline_time = (current_frame / self.frame_rate) * tick * (self.tempo / 60)
        return float(self._np.round(self.score_part.beat_map(timeline_time), decimals=2))

    def _should_log_alignment_decision(self) -> bool:
        settings = get_practice_runtime_settings()
        if not settings.PRACTICE_AUDIO_DIAGNOSTICS:
            return False
        decision_count = getattr(self, "_alignment_decision_log_count", 0) + 1
        self._alignment_decision_log_count = decision_count
        interval = max(settings.PRACTICE_ALIGNMENT_DIAGNOSTIC_UPDATE_INTERVAL, 1)
        return decision_count == 1 or decision_count % interval == 0

    def _is_valid_start_feature(self, feature_vector) -> bool:
        return self._score_start_feature(feature_vector) >= START_FEATURE_CONFIDENCE_THRESHOLD

    def _score_start_feature(self, feature_vector) -> float:
        score = self._feature_confidence_for_beat(
            self._score_start_beat,
            current_feature=feature_vector,
            missing_confidence=0.0,
        )
        self._pending_start_anchor_beat = (
            self._score_start_beat
            if score >= START_FEATURE_CONFIDENCE_THRESHOLD
            else None
        )
        return score

    def _feature_confidence_for_beat(
        self,
        beat_position: float,
        *,
        current_feature=None,
        missing_confidence: float = 1.0,
    ) -> float:
        if current_feature is None:
            current_feature = getattr(self._stream, "last_feature_vector", None)
        reference_features = getattr(self, "_reference_features", None)
        ref_frame_to_beat = getattr(self, "_ref_frame_to_beat", None)
        if current_feature is None or reference_features is None or ref_frame_to_beat is None:
            return missing_confidence

        reference_array = self._np.asarray(reference_features, dtype=float)
        beat_array = self._np.asarray(ref_frame_to_beat, dtype=float)
        if reference_array.size == 0 or beat_array.size == 0:
            return 1.0

        ref_index = int(self._np.argmin(self._np.abs(beat_array - beat_position)))
        reference_feature = reference_array[min(ref_index, reference_array.shape[0] - 1)]
        current = self._np.ravel(self._np.asarray(current_feature, dtype=float))
        reference = self._np.ravel(reference_feature)
        if current.size == 0 or reference.size == 0:
            return 1.0

        size = min(current.size, reference.size)
        current = current[:size]
        reference = reference[:size]
        if not self._np.isfinite(current).all() or not self._np.isfinite(reference).all():
            return 0.0
        current_norm = float(self._np.linalg.norm(current))
        reference_norm = float(self._np.linalg.norm(reference))
        if current_norm <= 1e-9 or reference_norm <= 1e-9:
            return 0.0

        similarity = float(self._np.dot(current, reference) / (current_norm * reference_norm))
        if not self._np.isfinite(similarity):
            return 0.0
        similarity = max(0.0, min(1.0, similarity))
        return max(
            0.0,
            min(
                1.0,
                (similarity - FEATURE_SIMILARITY_FLOOR)
                / FEATURE_SIMILARITY_FULL_MATCH_SPAN,
            ),
        )

    def _initial_entry_region_beats(self, *, width_beats: float) -> tuple[float, ...]:
        entry_beats = tuple(
            beat
            for beat in self.score_timeline.playable_onset_beats
            if self._score_start_beat <= beat <= self._score_start_beat + width_beats
        )
        return entry_beats or (self._score_start_beat,)

    @staticmethod
    def _calculate_score_start_beat(note_array) -> float:
        names = note_array.dtype.names or ()
        if "onset_beat" not in names or len(note_array) == 0:
            return 0.0
        return float(note_array["onset_beat"].min())

    @staticmethod
    def _calculate_score_end_beat(note_array) -> float:
        names = note_array.dtype.names or ()
        if "onset_beat" not in names or len(note_array) == 0:
            return 0.0

        onset_beats = note_array["onset_beat"]
        if "duration_beat" in names:
            end_beats = onset_beats + note_array["duration_beat"]
        else:
            end_beats = onset_beats
        return float(end_beats.max())

    def _timestamp_ms(self) -> int:
        bytes_per_sample = 2
        frame_width = max(self.channels * bytes_per_sample, 1)
        total_samples = self.total_bytes / frame_width
        return int((total_samples / max(self.sample_rate, 1)) * 1000)


def build_alignment_engine(
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
) -> AlignmentEngine:
    return MatchmakerLiveEngine(
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
