"""Structured diagnostics for browser PCM input decisions."""

from app.core.logger import logger


def log_audio_gate_diagnostic(adapter, decision: str, rms: float, peak: float) -> None:
    if not adapter.diagnostics_enabled:
        return
    if not (
        decision == "accepted"
        or adapter.total_frames <= adapter.warmup_frames
        or adapter.total_frames % adapter.diagnostic_frame_interval == 0
    ):
        return
    start_rms, start_peak = adapter._effective_start_gates()
    logger.bind(
        event="practice_audio.gate_diagnostic", decision=decision, frame=adapter.total_frames,
        rms=round(rms, 5), peak=round(peak, 5), rms_gate=round(adapter._calibrated_rms_gate, 5),
        peak_gate=round(adapter._calibrated_peak_gate, 5), start_rms_gate=round(adapter.start_rms_gate, 5),
        start_peak_gate=round(adapter.start_peak_gate, 5), effective_start_rms_gate=round(start_rms, 5),
        effective_start_peak_gate=round(start_peak, 5), armed=adapter.armed,
        active_streak=adapter.active_streak, start_streak=adapter.start_streak,
        no_input_streak=adapter.no_input_streak, performance_active=adapter.performance_active,
        tonal=adapter.last_tonal_signal, spectral_flatness=round(adapter.last_spectral_flatness, 5),
        peak_prominence=round(adapter.last_peak_prominence, 2), spectral_flux=round(adapter.last_spectral_flux, 5),
        flux_gate=round(adapter._calibrated_flux_gate, 5), onset=adapter.last_onset_signal,
        accepted=adapter.accepted_frames, rejected=adapter.rejected_frames,
        noise_samples=len(adapter._noise_rms_values), started=adapter.ready_to_start,
        state=adapter.stream_state, frame_class=adapter.last_frame_class,
        gate_reason=adapter.last_gate_reason, start_reason=adapter.last_start_signal_reason,
        runtime_reason=adapter.last_runtime_activity_reason, queue_decision=adapter.last_queue_decision,
        input_weight=round(adapter.last_input_weight, 2),
        input_policy_confidence=round(adapter.last_input_policy_confidence, 2),
        start_feature_confidence=adapter.last_start_feature_confidence,
    ).info("Practice audio gate diagnostic")
