"""Practice support validation and artifact projection of canonical written facts."""

from __future__ import annotations

from fractions import Fraction
from itertools import groupby
import math
from typing import NoReturn

from app.score_semantics.musicxml_score import (
    CanonicalScoreSemanticModel,
    MusicXMLSemanticError,
    parse_score_semantics,
)
from ..domain import (
    CompiledPracticeScore,
    CompiledPracticeNote,
    CompiledPracticeMeasure,
    PracticeMeterSegment,
    PracticeTempoSegment,
)
from ..time import PracticeScoreTimebase
from ..piano_key import PracticeScoreInvalidError, practice_piano_key

PITCH_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def compile_practice_score(prepared_musicxml: bytes | str) -> CompiledPracticeScore:
    try:
        model = parse_score_semantics(prepared_musicxml)
    except MusicXMLSemanticError as error:
        raise PracticeScoreInvalidError(str(error)) from error
    return project_practice_score(model)


def project_practice_score(model: CanonicalScoreSemanticModel) -> CompiledPracticeScore:
    if any(tempo.time_only is not None for tempo in model.tempos):
        invalid("Practice does not support pass-gated tempo.")
    if len({len(p.measure_numbers) for p in model.parts}) != 1:
        invalid("Practice requires aligned part measure sequences.")
    if model.transpositions:
        invalid("Transposing notation is unsupported for Practice.")
    if any(n.is_grace for n in model.notes):
        invalid("Zero-time grace notation is unsupported for Practice.")
    meters: dict[Fraction, tuple[int, int]] = {}
    active_parts: dict[int, tuple[int, int]] = {}
    for position, facts in groupby(
        sorted(model.meters, key=lambda m: m.position), key=lambda m: m.position
    ):
        for meter in facts:
            if (
                meter.staff_number is not None
                or meter.position != model.measures[meter.measure_index].start
                or len(meter.groups) != 1
                or len(meter.groups[0][0]) != 1
            ):
                invalid("Unsupported Practice meter scope, placement or grouping.")
            beats, denominator = meter.groups[0]
            active_parts[meter.part_index] = (beats[0], denominator)
        compatible = set(active_parts.values())
        if len(compatible) != 1:
            invalid("Practice requires one compatible score-wide meter timeline.")
        meters[position] = compatible.pop()
    if not meters or min(meters) != 0:
        invalid("Practice requires explicit initial meter timing.")
    required = [model.end]
    required.extend(value for m in model.measures for value in (m.start, m.end))
    required.extend(
        value
        for n in model.notes
        if not n.is_rest
        for value in (n.position, n.duration, n.position + n.duration)
    )
    required.extend(t.position for t in model.tempos)
    for position, (numerator, denominator) in meters.items():
        required.extend((position, Fraction(numerator * 4, denominator), Fraction(4, denominator)))
    timebase = PracticeScoreTimebase.derive(required)
    tick = timebase.to_tick
    meter_segments = tuple(
        PracticeMeterSegment(tick(position), *value) for position, value in sorted(meters.items())
    )
    for meter_segment in meter_segments:
        meter_segment.measure_duration_ticks(timebase.ticks_per_quarter)

    notes: list[CompiledPracticeNote] = []
    used_ids: set[str] = set()
    for note in model.notes:
        if note.is_rest:
            continue
        pitch = note.pitch
        if pitch is None:
            invalid("Practice requires explicit pitched notes.")
        if pitch.alter.denominator != 1:
            invalid("Practice requires integer physical piano keys.")
        key = practice_piano_key(
            12 * (pitch.octave + 1) + PITCH_STEPS[pitch.step] + int(pitch.alter)
        )
        if not note.source_id or note.source_id in used_ids:
            invalid("Prepared notation requires unique note identities.")
        used_ids.add(note.source_id)
        if len(set(note.ties)) != len(note.ties) or any(
            t not in {"start", "stop"} for t in note.ties
        ):
            invalid("Unsupported Practice tie facts.")
        onset = tick(note.position)
        duration = tick(note.duration)
        if duration <= 0:
            invalid("Practice requires positive note duration.")
        notes.append(
            CompiledPracticeNote(
                note.source_id,
                onset,
                duration,
                key,
                note.measure_number,
                note.staff
                if len(model.parts) == 1
                else f"p{note.part_index + 1}:s:{note.staff or '1'}",
                note.voice,
                f"p{note.part_index + 1}-m{note.measure_index + 1}-e{note.sequence}",
                note.ties,
            )
        )
    tempos = {t.position: t.quarter_bpm for t in model.tempos}
    tempo_segments = tuple(
        PracticeTempoSegment(tick(position), finite_float(bpm))
        for position, bpm in sorted(tempos.items())
    )
    measures = tuple(
        CompiledPracticeMeasure(m.index, tick(m.start), tick(m.end), m.uses_meter_duration)
        for m in model.measures
    )
    return CompiledPracticeScore(
        tuple(notes), meter_segments, tempo_segments, measures, timebase, tick(model.end)
    )


def finite_float(value: Fraction) -> float:
    try:
        result = float(value)
    except OverflowError as cause:
        raise PracticeScoreInvalidError("Unrepresentable Practice timing.") from cause
    if not math.isfinite(result):
        invalid("Nonfinite Practice timing.")
    return result


def invalid(message: str) -> NoReturn:
    raise PracticeScoreInvalidError(message)
