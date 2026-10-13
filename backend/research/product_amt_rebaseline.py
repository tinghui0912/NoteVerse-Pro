from __future__ import annotations

from dataclasses import dataclass
from math import cos, pi, sin
from statistics import median
from time import perf_counter, sleep
from typing import Iterable, Literal


Pitch = int
StrikeState = Literal["PENDING", "correct", "missing", "wrong", "incomplete_chord"]
ObservationDisposition = Literal[
    "assigned_expected",
    "wrong_evidence",
    "extra",
    "duplicate_retrigger_suppressed",
    "unresolved",
    "NOT_YET_VISIBLE",
]
SYNTHETIC_CONTRACT_STATUS = "SYNTHETIC_CONTRACT_TEST_ONLY"


@dataclass(frozen=True)
class OnlineAmtToyState:
    """Small deterministic state machine that mirrors Online-AMT ownership rules.

    It is not a neural model. It exists to test the K-hop unrolling contract:
    every 512-sample recurrent transition must occur and each chosen state must
    feed the next step.
    """

    audio_tail: tuple[float, ...]
    mel_accumulator: float
    cache0: tuple[float, ...]
    cache1: tuple[float, ...]
    h: tuple[float, ...]
    c: tuple[float, ...]
    prev_output: tuple[int, ...]


@dataclass(frozen=True)
class OnlineAmtToyHop:
    hop_index: int
    chosen_states: tuple[int, ...]
    probabilities: tuple[tuple[float, ...], ...]
    state: OnlineAmtToyState


def initial_online_amt_toy_state(pitch_count: int = 4) -> OnlineAmtToyState:
    return OnlineAmtToyState(
        audio_tail=(0.0,) * 8,
        mel_accumulator=0.0,
        cache0=(0.0, 0.0, 0.0),
        cache1=(0.0, 0.0),
        h=(0.0,) * pitch_count,
        c=(0.0,) * pitch_count,
        prev_output=(0,) * pitch_count,
    )


def online_amt_original_transition(state: OnlineAmtToyState, hop: Iterable[float], hop_index: int) -> OnlineAmtToyHop:
    samples = tuple(float(value) for value in hop)
    if not samples:
        raise ValueError("hop must not be empty")
    energy = sum(abs(value) for value in samples) / len(samples)
    audio_tail = (state.audio_tail + samples)[-8:]
    mel = 0.82 * state.mel_accumulator + energy
    cache0 = (
        0.70 * state.cache0[1] + mel * 0.11,
        0.70 * state.cache0[2] + mel * 0.07,
        mel,
    )
    cache1 = (
        0.65 * state.cache1[1] + cache0[0] * 0.09,
        cache0[1],
    )
    h_values: list[float] = []
    c_values: list[float] = []
    chosen: list[int] = []
    probabilities: list[tuple[float, ...]] = []
    for pitch, previous in enumerate(state.prev_output):
        drive = mel * (pitch + 1) + cache1[0] - previous * 0.17 + hop_index * 0.013
        c_value = 0.73 * state.c[pitch] + drive
        h_value = 0.61 * state.h[pitch] + c_value * 0.19
        logits = tuple(h_value + state_index * 0.31 - abs(state_index - previous) * 0.07 for state_index in range(5))
        best = max(range(5), key=lambda state_index: logits[state_index])
        total = sum(abs(value) for value in logits) or 1.0
        probabilities.append(tuple(abs(value) / total for value in logits))
        chosen.append(best)
        h_values.append(h_value)
        c_values.append(c_value)
    next_state = OnlineAmtToyState(
        audio_tail=audio_tail,
        mel_accumulator=mel,
        cache0=cache0,
        cache1=cache1,
        h=tuple(h_values),
        c=tuple(c_values),
        prev_output=tuple(chosen),
    )
    return OnlineAmtToyHop(hop_index=hop_index, chosen_states=tuple(chosen), probabilities=tuple(probabilities), state=next_state)


def run_online_amt_sequential(state: OnlineAmtToyState, hops: list[Iterable[float]]) -> list[OnlineAmtToyHop]:
    rows: list[OnlineAmtToyHop] = []
    current = state
    for index, hop in enumerate(hops):
        row = online_amt_original_transition(current, hop, index)
        rows.append(row)
        current = row.state
    return rows


def run_online_amt_grouped(state: OnlineAmtToyState, hops: list[Iterable[float]], k: int) -> list[OnlineAmtToyHop]:
    if k not in {1, 2, 4, 8}:
        raise ValueError("k must be one of 1, 2, 4, 8")
    rows: list[OnlineAmtToyHop] = []
    current = state
    for group_start in range(0, len(hops), k):
        for offset, hop in enumerate(hops[group_start:group_start + k]):
            row = online_amt_original_transition(current, hop, group_start + offset)
            rows.append(row)
            current = row.state
    return rows


def run_online_amt_bad_skip_intermediate(state: OnlineAmtToyState, hops: list[Iterable[float]], k: int) -> list[OnlineAmtToyHop]:
    rows: list[OnlineAmtToyHop] = []
    current = state
    for group_start in range(0, len(hops), k):
        merged = [value for hop in hops[group_start:group_start + k] for value in hop]
        row = online_amt_original_transition(current, merged, group_start)
        rows.append(row)
        current = row.state
    return rows


def chosen_state_mismatch_count(left: list[OnlineAmtToyHop], right: list[OnlineAmtToyHop]) -> int:
    count = 0
    for left_row, right_row in zip(left, right):
        count += sum(1 for a, b in zip(left_row.chosen_states, right_row.chosen_states) if a != b)
    count += abs(len(left) - len(right)) * (len(left[0].chosen_states) if left else 0)
    return count


def summarize_ms(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"p50": None, "p95": None, "max": None}
    ordered = sorted(values)
    return {"p50": median(ordered), "p95": percentile(ordered, 0.95), "max": ordered[-1]}


def percentile(ordered: list[float], fraction: float) -> float:
    if len(ordered) == 1:
        return ordered[0]
    index = (len(ordered) - 1) * fraction
    low = int(index)
    high = min(low + 1, len(ordered) - 1)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def classify_realtime_queue(service_times_ms: list[float], arrival_interval_ms: float) -> dict[str, object]:
    rows = []
    available_at = 0.0
    max_depth = 0
    queue_delays: list[float] = []
    for index, service_time in enumerate(service_times_ms):
        scheduled = index * arrival_interval_ms
        start = max(scheduled, available_at)
        finish = start + service_time
        queue_delay = start - scheduled
        available_at = finish
        pending = max(0, int((finish - scheduled) // arrival_interval_ms))
        max_depth = max(max_depth, pending)
        queue_delays.append(queue_delay)
        rows.append({
            "index": index,
            "scheduledArrivalMs": scheduled,
            "inferenceStartMs": start,
            "inferenceFinishMs": finish,
            "queueDelayMs": queue_delay,
            "queueDepth": pending,
            "serviceTimeMs": service_time,
        })
    tail = queue_delays[-min(8, len(queue_delays)):] if queue_delays else []
    grows = len(tail) >= 2 and tail[-1] > tail[0]
    p95 = summarize_ms(service_times_ms)["p95"]
    return {
        "rows": rows,
        "serviceMs": summarize_ms(service_times_ms),
        "queueDelayMs": summarize_ms(queue_delays),
        "finalQueueDelayMs": queue_delays[-1] if queue_delays else 0,
        "maximumQueueDepth": max_depth,
        "classification": "SUSTAINED_BACKLOG" if grows or (queue_delays and queue_delays[-1] > arrival_interval_ms) else "NO_SUSTAINED_BACKLOG",
        "twentyPercentHeadroomPass": bool(p95 is not None and p95 <= 0.8 * arrival_interval_ms),
    }


def run_timer_feeder(service_times_ms: list[float], arrival_interval_ms: float) -> dict[str, object]:
    """Run a small real timer-driven feeder and record wall-clock arrivals.

    This is intentionally generic so tests can use millisecond-scale fixtures
    without waiting for a full browser model run.
    """

    start_time = perf_counter()
    rows = []
    worker_available = start_time
    queue_delays = []
    for index, service_time in enumerate(service_times_ms):
        scheduled_at = start_time + (arrival_interval_ms / 1000.0) * index
        while perf_counter() < scheduled_at:
            sleep(min(0.001, scheduled_at - perf_counter()))
        actual_arrival = perf_counter()
        worker_start = max(actual_arrival, worker_available)
        if worker_start > perf_counter():
            sleep(worker_start - perf_counter())
        queue_delay = max(0.0, worker_start - actual_arrival) * 1000.0
        sleep(service_time / 1000.0)
        finish = perf_counter()
        worker_available = finish
        queue_delays.append(queue_delay)
        rows.append({
            "index": index,
            "scheduledArrivalMs": (scheduled_at - start_time) * 1000.0,
            "actualArrivalMs": (actual_arrival - start_time) * 1000.0,
            "workerReceiveMs": (actual_arrival - start_time) * 1000.0,
            "inferenceStartMs": (worker_start - start_time) * 1000.0,
            "inferenceFinishMs": (finish - start_time) * 1000.0,
            "publicationTimeMs": (finish - start_time) * 1000.0,
            "queueDelayMs": queue_delay,
            "groupProcessingTimeMs": service_time,
        })
    return {
        "rows": rows,
        "queueDelayMs": summarize_ms(queue_delays),
        "actualTimerDriven": True,
        "evidenceStatus": SYNTHETIC_CONTRACT_STATUS,
    }


def linear_resample(samples: list[float], output_count: int) -> list[float]:
    if output_count <= 0:
        raise ValueError("output_count must be positive")
    if len(samples) == 1:
        return [samples[0]] * output_count
    result = []
    for output_index in range(output_count):
        pos = output_index * len(samples) / output_count
        left = min(int(pos), len(samples) - 1)
        right = min(left + 1, len(samples) - 1)
        frac = pos - left
        result.append(samples[left] * (1 - frac) + samples[right] * frac)
    return result


def toy_windowed_sinc_resample_contract(samples: list[float], output_count: int, radius: int = 4) -> list[float]:
    if output_count <= 0:
        raise ValueError("output_count must be positive")
    ratio = len(samples) / output_count
    result = []
    for output_index in range(output_count):
        center = output_index * ratio
        acc = 0.0
        weight_sum = 0.0
        for source_index in range(max(0, int(center) - radius), min(len(samples), int(center) + radius + 1)):
            x = center - source_index
            sinc = 1.0 if x == 0 else sin(pi * x) / (pi * x)
            window = 0.5 + 0.5 * cos(pi * x / (radius + 1))
            weight = sinc * window
            acc += samples[source_index] * weight
            weight_sum += weight
        result.append(acc / weight_sum if weight_sum else 0.0)
    return result


@dataclass(frozen=True)
class DecoderEvent:
    pitch: int
    frame: int
    onset_time_ms: float
    confidence: float


def decode_contiguous_peak(onset: list[float], frame: list[float], threshold: float, frame_threshold: float) -> list[DecoderEvent]:
    events: list[DecoderEvent] = []
    index = 0
    while index < len(onset):
        while index < len(onset) and onset[index] < threshold:
            index += 1
        if index >= len(onset):
            break
        peak = index
        while index + 1 < len(onset) and onset[index + 1] >= threshold:
            index += 1
            if onset[index] > onset[peak]:
                peak = index
        if frame[peak] >= frame_threshold:
            events.append(DecoderEvent(pitch=60, frame=peak, onset_time_ms=peak * 10.0, confidence=min(onset[peak], frame[peak])))
        index += 1
    return events


def decode_toy_regressed_local_peak(onset: list[float], frame: list[float], regression: list[float], threshold: float, frame_threshold: float) -> list[DecoderEvent]:
    events = []
    for index in range(1, len(onset) - 1):
        is_peak = onset[index] >= threshold and onset[index] >= onset[index - 1] and onset[index] > onset[index + 1]
        if is_peak and frame[index] >= frame_threshold:
            events.append(DecoderEvent(pitch=60, frame=index, onset_time_ms=(index + regression[index]) * 10.0, confidence=min(onset[index], frame[index])))
    return events


def decode_conservative_hybrid(onset: list[float], frame: list[float], regression: list[float], threshold: float, frame_threshold: float, refractory_frames: int = 2) -> list[DecoderEvent]:
    events = decode_toy_regressed_local_peak(onset, frame, regression, threshold, frame_threshold)
    kept: list[DecoderEvent] = []
    for event in events:
        if kept and event.frame - kept[-1].frame <= refractory_frames:
            if event.confidence > kept[-1].confidence:
                kept[-1] = event
            continue
        kept.append(event)
    return kept


@dataclass(frozen=True)
class ExpectedStrike:
    strike_id: str
    pitches: frozenset[Pitch]
    time_ms: float
    deadline_ms: float


@dataclass(frozen=True)
class AcousticObservation:
    observation_id: str
    pitch: Pitch
    time_ms: float
    confidence: float = 1.0


@dataclass(frozen=True)
class ObservationRole:
    observation_id: str
    disposition: ObservationDisposition
    strike_id: str | None = None
    pitch: Pitch | None = None


def finalize_observations(
    expected: list[ExpectedStrike],
    observations: list[AcousticObservation],
    window_ms: float,
    analyzed_through_ms: float,
    duplicate_window_ms: float = 25.0,
) -> dict[str, object]:
    """Deterministic time-aware product finalizer for acoustic observations.

    The acoustic model remains audio-only; score structure is used only here.
    Every observation receives at most one semantic role.
    """

    visible_observations = [obs for obs in observations if obs.time_ms <= analyzed_through_ms]
    future_observations = [obs for obs in observations if obs.time_ms > analyzed_through_ms]
    assignments = assign_expected_pitch_matches(expected, visible_observations, window_ms)
    consumed = {obs_id for obs_id in assignments}
    strike_results: dict[str, dict[str, object]] = {
        strike.strike_id: {
            "state": "PENDING",
            "matchedObservationIds": [],
            "wrongObservationIds": [],
            "deadlineMs": strike.deadline_ms,
        }
        for strike in expected
    }

    matched_by_strike: dict[str, list[AcousticObservation]] = {strike.strike_id: [] for strike in expected}
    for obs_id, strike_id in assignments.items():
        obs = next(obs for obs in visible_observations if obs.observation_id == obs_id)
        matched_by_strike[strike_id].append(obs)

    for strike in expected:
        matched = matched_by_strike[strike.strike_id]
        matched_pitches = {obs.pitch for obs in matched}
        strike_results[strike.strike_id]["matchedObservationIds"] = [obs.observation_id for obs in matched]
        if matched_pitches == strike.pitches:
            strike_results[strike.strike_id]["state"] = "correct"
        elif analyzed_through_ms < strike.deadline_ms:
            strike_results[strike.strike_id]["state"] = "PENDING"
        elif matched_pitches:
            strike_results[strike.strike_id]["state"] = "incomplete_chord"

    wrong_assignments = assign_wrong_observations(
        expected,
        visible_observations,
        window_ms,
        consumed,
        matched_by_strike,
        strike_results,
        analyzed_through_ms,
    )
    consumed.update(wrong_assignments.keys())
    for obs_id, strike_id in wrong_assignments.items():
        result = strike_results[strike_id]
        if result["state"] == "PENDING" and analyzed_through_ms >= result["deadlineMs"]:
            result["state"] = "wrong"
        result["wrongObservationIds"].append(obs_id)

    for strike in expected:
        result = strike_results[strike.strike_id]
        if result["state"] == "PENDING" and analyzed_through_ms >= strike.deadline_ms:
            result["state"] = "missing"

    observation_by_id = {obs.observation_id: obs for obs in visible_observations}
    roles = [
        ObservationRole(obs_id, "assigned_expected", strike_id, observation_by_id[obs_id].pitch)
        for obs_id, strike_id in sorted(assignments.items())
    ]
    roles.extend(ObservationRole(obs_id, "wrong_evidence", strike_id) for obs_id, strike_id in sorted(wrong_assignments.items()))
    residual = [obs for obs in visible_observations if obs.observation_id not in consumed]
    duplicate_suppressed = duplicate_residual_observation_ids(
        residual,
        visible_observations,
        consumed,
        duplicate_window_ms,
    )
    roles.extend(ObservationRole(obs_id, "duplicate_retrigger_suppressed") for obs_id in sorted(duplicate_suppressed))
    residual_after_duplicates = [obs for obs in residual if obs.observation_id not in duplicate_suppressed]
    extras = []
    unresolved = []
    for obs in sorted(residual_after_duplicates, key=lambda item: (item.time_ms, item.pitch, item.observation_id)):
        if residual_observation_has_pending_claim(obs, expected, window_ms, analyzed_through_ms):
            unresolved.append(obs)
        else:
            extras.append(obs)
    roles.extend(ObservationRole(obs.observation_id, "unresolved") for obs in unresolved)
    roles.extend(ObservationRole(obs.observation_id, "extra") for obs in extras)
    roles.extend(ObservationRole(obs.observation_id, "NOT_YET_VISIBLE") for obs in sorted(future_observations, key=lambda item: item.observation_id))

    return {
        "strikes": strike_results,
        "extras": [obs.observation_id for obs in sorted(extras, key=lambda item: item.observation_id)],
        "observationRoles": [role.__dict__ for role in roles],
        "consumedObservationIds": sorted(consumed),
        "duplicateSuppressedObservationIds": sorted(duplicate_suppressed),
    }


def duplicate_residual_observation_ids(
    residual_observations: list[AcousticObservation],
    all_visible_observations: list[AcousticObservation],
    consumed_observation_ids: set[str],
    duplicate_window_ms: float,
) -> set[str]:
    suppressed: set[str] = set()
    accepted_by_pitch: dict[Pitch, list[AcousticObservation]] = {}
    for obs in all_visible_observations:
        if obs.observation_id in consumed_observation_ids:
            accepted_by_pitch.setdefault(obs.pitch, []).append(obs)
    residual_by_pitch: dict[Pitch, list[AcousticObservation]] = {}
    for obs in residual_observations:
        residual_by_pitch.setdefault(obs.pitch, []).append(obs)

    for pitch, pitch_observations in residual_by_pitch.items():
        kept: list[AcousticObservation] = sorted(accepted_by_pitch.get(pitch, []), key=lambda item: (item.time_ms, item.observation_id))
        for obs in sorted(pitch_observations, key=lambda item: (item.time_ms, -item.confidence, item.observation_id)):
            duplicate_of = next((kept_obs for kept_obs in kept if abs(obs.time_ms - kept_obs.time_ms) <= duplicate_window_ms), None)
            if duplicate_of is None:
                kept.append(obs)
                continue
            if duplicate_of.observation_id in consumed_observation_ids:
                suppressed.add(obs.observation_id)
                continue
            if obs.confidence > duplicate_of.confidence:
                suppressed.add(duplicate_of.observation_id)
                kept.remove(duplicate_of)
                kept.append(obs)
            else:
                suppressed.add(obs.observation_id)
    return suppressed


def assign_expected_pitch_matches(expected: list[ExpectedStrike], observations: list[AcousticObservation], window_ms: float) -> dict[str, str]:
    assignments: dict[str, str] = {}
    pitches = sorted({pitch for strike in expected for pitch in strike.pitches})
    for pitch in pitches:
        slots = sorted(
            (
                (strike.time_ms, strike.strike_id, pitch, strike.deadline_ms)
                for strike in expected
                if pitch in strike.pitches
            ),
            key=lambda item: (item[0], item[1], item[2]),
        )
        pitch_observations = sorted(
            [obs for obs in observations if obs.pitch == pitch],
            key=lambda item: (item.time_ms, item.observation_id),
        )
        pitch_assignments = match_pitch_slots(slots, pitch_observations, window_ms)
        assignments.update(pitch_assignments)
    return assignments


def match_pitch_slots(
    slots: list[tuple[float, str, Pitch, float]],
    observations: list[AcousticObservation],
    window_ms: float,
) -> dict[str, str]:
    from functools import lru_cache

    @lru_cache(maxsize=None)
    def solve(slot_index: int, obs_index: int) -> tuple[int, float, tuple[tuple[str, str], ...]]:
        if slot_index >= len(slots) or obs_index >= len(observations):
            return (0, 0.0, ())
        best = solve(slot_index + 1, obs_index)
        skip_obs = solve(slot_index, obs_index + 1)
        best = better_match_result(best, skip_obs)
        slot_time, strike_id, _pitch, deadline_ms = slots[slot_index]
        obs = observations[obs_index]
        if abs(obs.time_ms - slot_time) <= window_ms and obs.time_ms <= deadline_ms:
            count, cost, pairs = solve(slot_index + 1, obs_index + 1)
            candidate = (
                count + 1,
                cost + abs(obs.time_ms - slot_time),
                ((obs.observation_id, strike_id),) + pairs,
            )
            best = better_match_result(best, candidate)
        return best

    return dict(solve(0, 0)[2])


def better_match_result(
    left: tuple[int, float, tuple[tuple[str, str], ...]],
    right: tuple[int, float, tuple[tuple[str, str], ...]],
) -> tuple[int, float, tuple[tuple[str, str], ...]]:
    if right[0] != left[0]:
        return right if right[0] > left[0] else left
    if right[1] != left[1]:
        return right if right[1] < left[1] else left
    return right if right[2] < left[2] else left


def residual_observation_has_pending_claim(
    obs: AcousticObservation,
    expected: list[ExpectedStrike],
    window_ms: float,
    analyzed_through_ms: float,
) -> bool:
    for strike in expected:
        if analyzed_through_ms >= strike.deadline_ms:
            continue
        if abs(obs.time_ms - strike.time_ms) > window_ms:
            continue
        if obs.pitch in strike.pitches:
            return True
        return True
    return False


def assign_wrong_observations(
    expected: list[ExpectedStrike],
    observations: list[AcousticObservation],
    window_ms: float,
    consumed: set[str],
    matched_by_strike: dict[str, list[AcousticObservation]],
    strike_results: dict[str, dict[str, object]],
    analyzed_through_ms: float,
) -> dict[str, str]:
    candidates: list[tuple[float, str, str]] = []
    for strike in expected:
        if analyzed_through_ms < strike.deadline_ms:
            continue
        if matched_by_strike[strike.strike_id]:
            continue
        if strike_results[strike.strike_id]["state"] != "PENDING":
            continue
        for obs in observations:
            if obs.observation_id in consumed or obs.pitch in strike.pitches:
                continue
            if abs(obs.time_ms - strike.time_ms) <= window_ms:
                candidates.append((abs(obs.time_ms - strike.time_ms), strike.strike_id, obs.observation_id))
    assignments: dict[str, str] = {}
    assigned_strikes: set[str] = set()
    for _error, strike_id, obs_id in sorted(candidates, key=lambda item: (item[0], item[1], item[2])):
        if obs_id in assignments or strike_id in assigned_strikes:
            continue
        assignments[obs_id] = strike_id
        assigned_strikes.add(strike_id)
    return assignments


def validate_audio_only_candidate_input(candidate_input: dict[str, object]) -> None:
    forbidden = {
        "expectedPitch",
        "expectedPitches",
        "scoreNote",
        "scoreNotes",
        "truthMidi",
        "targetTimestamp",
        "correctnessLabel",
        "scenarioCategory",
        "expected pitch",
        "truth MIDI",
    }
    found = sorted(key for key in candidate_input if key in forbidden)
    if found:
        raise ValueError(f"SCORE_TRUTH_FIELD_FORBIDDEN_IN_ACOUSTIC_ADAPTER_INPUT:{','.join(found)}")


def latency_by_verdict(samples: dict[str, list[float]]) -> dict[str, dict[str, object]]:
    beat_bpms = [60, 90, 120, 160]
    out: dict[str, dict[str, object]] = {}
    for verdict, values in samples.items():
        summary = summarize_ms(values)
        out[verdict] = {
            "ms": summary,
            "beats": {
                str(bpm): {
                    "p50": None if summary["p50"] is None else summary["p50"] / (60000 / bpm),
                    "p95": None if summary["p95"] is None else summary["p95"] / (60000 / bpm),
                }
                for bpm in beat_bpms
            },
        }
    return out
