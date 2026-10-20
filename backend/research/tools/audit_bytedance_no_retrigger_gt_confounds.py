"""Post-hoc GT audit for ByteDance no-retrigger rolling STEP cases.

This research-only audit checks whether reported held/pedal false second
advances actually align with a real same-pitch physical note-on inside the
exported clip. It reads existing manifests and rolling benchmark JSON only; it
does not run any model inference or modify production code.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path
from typing import Any


NO_RETRIGGER_CASE_KINDS = {
    "long_held_note_without_retrigger",
    "pedal_sustain_tail_without_retrigger",
}
EVENT_RULES = ("temporally_bound", "model_native_event_stream")
COMPATIBLE_MIN_DELTA_SECONDS = -0.120
COMPATIBLE_MAX_DELTA_SECONDS = 0.050


def main() -> int:
    args = parse_args()
    cases = _load_cases(args.case_manifest)
    rolling = json.loads(args.rolling_report.read_text(encoding="utf-8"))
    evaluations = rolling.get("evaluations", ())

    case_audits = []
    for evaluation in evaluations:
        case_kind = str(evaluation.get("case_kind"))
        if case_kind not in NO_RETRIGGER_CASE_KINDS:
            continue
        key = _case_key_from_evaluation(evaluation)
        case = cases.get(key)
        if case is None:
            raise KeyError(f"case not found for evaluation key {key}")
        case_audits.append(_audit_case(case, evaluation))

    report = {
        "scope": "post_hoc_bytedance_no_retrigger_gt_confound_audit",
        "model_rerun": False,
        "threshold_changed": False,
        "cadence_changed": False,
        "frozen_evaluation_used": False,
        "classification_rule": {
            "real_retrigger_aligned": (
                "A reported second event is REAL_RETRIGGER_ALIGNED when a same-pitch "
                "physical note-on in the exported clip satisfies "
                "-120ms <= event_time - note_on_time <= +50ms."
            ),
            "compatible_min_ms": int(COMPATIBLE_MIN_DELTA_SECONDS * 1000),
            "compatible_max_ms": int(COMPATIBLE_MAX_DELTA_SECONDS * 1000),
        },
        "summary_by_event_rule": {
            rule: _summary(case_audits, rule_name=rule)
            for rule in EVENT_RULES
        },
        "paired_false_under_both": _paired_false_under_both(case_audits),
        "cases": case_audits,
    }

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--rolling-report", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def _load_cases(paths: list[Path]) -> dict[tuple[str, str], dict[str, Any]]:
    cases: dict[tuple[str, str], dict[str, Any]] = {}
    for path in paths:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        for case in manifest.get("cases", ()):
            if case.get("case_kind") not in NO_RETRIGGER_CASE_KINDS:
                continue
            key = _case_key(case)
            if key in cases:
                raise ValueError(f"duplicate no-retrigger case key {key}")
            cases[key] = case
    return cases


def _case_key(case: dict[str, Any]) -> tuple[str, str]:
    source_recording_id = str(case.get("source_audio_sha256") or case.get("source_file") or "")
    return source_recording_id, str(case.get("case_id"))


def _case_key_from_evaluation(evaluation: dict[str, Any]) -> tuple[str, str]:
    source = evaluation.get("source_identity") or {}
    return str(source.get("source_recording_id")), str(evaluation.get("case_id"))


def _audit_case(case: dict[str, Any], evaluation: dict[str, Any]) -> dict[str, Any]:
    source_start, source_end = (float(value) for value in case["source_time_range_seconds"])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    if not target_seconds:
        raise ValueError(f"missing first target time for {case.get('case_id')}")
    first_target_abs = target_seconds[0]
    first_target_rel = first_target_abs - source_start
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    if len(expected_groups) < 2:
        raise ValueError(f"expected no-retrigger case to have a second group: {case.get('case_id')}")
    second_expected_pitches = tuple(str(pitch) for pitch in expected_groups[1])

    note_events = [
        event
        for event in case.get("ground_truth_note_events", ()) or ()
        if _is_physical_note_on_in_clip(event, source_start=source_start, source_end=source_end)
    ]
    same_pitch_note_ons = [
        _note_row(event, source_start=source_start)
        for event in note_events
        if str(event.get("pitch")) in second_expected_pitches
        and float(event["start_seconds"]) > first_target_abs + 1e-9
    ]
    all_note_ons_after_first = [
        _note_row(event, source_start=source_start)
        for event in note_events
        if float(event["start_seconds"]) > first_target_abs + 1e-9
    ]

    per_rule = {}
    for rule in EVENT_RULES:
        result = (evaluation.get("rolling_results") or {}).get(rule) or {}
        match = result.get("false_second_match")
        event = _single_match_event(match)
        per_rule[rule] = _classify_rule_event(
            event,
            same_pitch_note_ons=same_pitch_note_ons,
            all_note_ons_after_first=all_note_ons_after_first,
        )

    return {
        "case_id": case.get("case_id"),
        "case_kind": case.get("case_kind"),
        "source_recording_id": evaluation.get("source_identity", {}).get("source_recording_id"),
        "second_expected_pitches": second_expected_pitches,
        "first_target_source_time": round(first_target_abs, 6),
        "first_target_clip_time": round(first_target_rel, 6),
        "clip_source_time_range_seconds": [round(source_start, 6), round(source_end, 6)],
        "same_pitch_physical_note_ons_after_first_target": same_pitch_note_ons,
        "all_physical_note_ons_after_first_target": all_note_ons_after_first,
        "rules": per_rule,
    }


def _is_physical_note_on_in_clip(
    event: dict[str, Any],
    *,
    source_start: float,
    source_end: float,
) -> bool:
    start = event.get("start_seconds")
    return isinstance(start, (int, float)) and source_start <= float(start) < source_end


def _note_row(event: dict[str, Any], *, source_start: float) -> dict[str, Any]:
    start = float(event["start_seconds"])
    return {
        "pitch": event.get("pitch"),
        "midi_note": event.get("midi_note"),
        "source_time": round(start, 6),
        "clip_time": round(start - source_start, 6),
        "velocity": event.get("velocity"),
    }


def _single_match_event(match: Any) -> dict[str, Any] | None:
    if not isinstance(match, dict):
        return None
    events = match.get("events") or ()
    if len(events) != 1:
        return None
    event = events[0]
    if not isinstance(event, dict):
        return None
    return event


def _classify_rule_event(
    event: dict[str, Any] | None,
    *,
    same_pitch_note_ons: list[dict[str, Any]],
    all_note_ons_after_first: list[dict[str, Any]],
) -> dict[str, Any]:
    if event is None:
        return {
            "reported_false_second": False,
            "classification": None,
            "event": None,
            "compatible_same_pitch_note_on": None,
            "nearest_same_pitch_note_on": None,
            "nearest_any_pitch_note_on": None,
        }
    event_time = float(event["event_time"])
    compatible = [
        {
            **note,
            "event_minus_note_on_ms": round((event_time - float(note["clip_time"])) * 1000.0, 3),
        }
        for note in same_pitch_note_ons
        if COMPATIBLE_MIN_DELTA_SECONDS - 1e-9
        <= event_time - float(note["clip_time"])
        <= COMPATIBLE_MAX_DELTA_SECONDS + 1e-9
    ]
    nearest_same = _nearest_note(event_time, same_pitch_note_ons)
    nearest_any = _nearest_note(event_time, all_note_ons_after_first)
    if compatible:
        classification = "REAL_RETRIGGER_ALIGNED"
        compatible_note = min(compatible, key=lambda row: abs(float(row["event_minus_note_on_ms"])))
    elif same_pitch_note_ons:
        classification = "NO_PHYSICAL_RETRIGGER"
        compatible_note = None
    else:
        classification = "NO_PHYSICAL_RETRIGGER"
        compatible_note = None
    return {
        "reported_false_second": True,
        "classification": classification,
        "event": {
            "pitch": event.get("pitch"),
            "event_time": round(event_time, 6),
            "onset_peak_score": event.get("onset_peak_score"),
            "frame_score_at_onset_peak": event.get("frame_score_at_onset_peak"),
            "official_peak_frame_index": event.get("official_peak_frame_index"),
            "reg_onset_neighbourhood": event.get("reg_onset_neighbourhood"),
        },
        "compatible_same_pitch_note_on": compatible_note,
        "nearest_same_pitch_note_on": nearest_same,
        "nearest_any_pitch_note_on": nearest_any,
    }


def _nearest_note(event_time: float, notes: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not notes:
        return None
    nearest = min(notes, key=lambda note: abs(event_time - float(note["clip_time"])))
    return {
        **nearest,
        "event_minus_note_on_ms": round((event_time - float(nearest["clip_time"])) * 1000.0, 3),
        "abs_delta_ms": round(abs(event_time - float(nearest["clip_time"])) * 1000.0, 3),
    }


def _summary(case_audits: list[dict[str, Any]], *, rule_name: str) -> dict[str, Any]:
    counts: dict[str, int] = defaultdict(int)
    rows = []
    for item in case_audits:
        rule = item["rules"][rule_name]
        if not rule["reported_false_second"]:
            continue
        classification = str(rule["classification"])
        counts[classification] += 1
        rows.append(
            {
                "case_id": item["case_id"],
                "case_kind": item["case_kind"],
                "second_expected_pitches": item["second_expected_pitches"],
                "classification": classification,
                "event": rule["event"],
                "compatible_same_pitch_note_on": rule["compatible_same_pitch_note_on"],
                "nearest_same_pitch_note_on": rule["nearest_same_pitch_note_on"],
                "nearest_any_pitch_note_on": rule["nearest_any_pitch_note_on"],
            }
        )
    return {
        "reported_held_pedal_false_seconds": len(rows),
        "REAL_RETRIGGER_ALIGNED": counts.get("REAL_RETRIGGER_ALIGNED", 0),
        "NO_PHYSICAL_RETRIGGER": counts.get("NO_PHYSICAL_RETRIGGER", 0),
        "AMBIGUOUS": counts.get("AMBIGUOUS", 0),
        "rows": rows,
    }


def _paired_false_under_both(case_audits: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    counts: dict[str, int] = defaultdict(int)
    for item in case_audits:
        a = item["rules"]["temporally_bound"]
        b = item["rules"]["model_native_event_stream"]
        if not (a["reported_false_second"] and b["reported_false_second"]):
            continue
        if a["classification"] == b["classification"]:
            paired_classification = str(a["classification"])
        else:
            paired_classification = "AMBIGUOUS"
        counts[paired_classification] += 1
        rows.append(
            {
                "case_id": item["case_id"],
                "case_kind": item["case_kind"],
                "second_expected_pitches": item["second_expected_pitches"],
                "paired_classification": paired_classification,
                "temporally_bound": a,
                "model_native_event_stream": b,
            }
        )
    return {
        "false_under_both": len(rows),
        "REAL_RETRIGGER_ALIGNED": counts.get("REAL_RETRIGGER_ALIGNED", 0),
        "NO_PHYSICAL_RETRIGGER": counts.get("NO_PHYSICAL_RETRIGGER", 0),
        "AMBIGUOUS": counts.get("AMBIGUOUS", 0),
        "rows": rows,
    }


if __name__ == "__main__":
    raise SystemExit(main())
