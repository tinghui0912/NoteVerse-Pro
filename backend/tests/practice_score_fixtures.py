"""Synthetic compiled-note values for pure timeline projection tests."""

from dataclasses import replace
from app.modules.practice.score.compiler.musicxml import compile_practice_score
from app.modules.practice.score.timeline import practice_timeline_from_compiled
from app.modules.practice.score.domain import canonical_beat


def timeline_from_notes(note_array, *, musicxml_path):
    compiled = compile_practice_score(musicxml_path.read_bytes())
    notation = {n.render_note_id: n for n in compiled.notes}
    notes = tuple(
        replace(
            notation[str(row["id"])],
            onset_beat=canonical_beat(row["onset_beat"]),
            duration_beats=canonical_beat(row["duration_beat"]),
            piano_key=int(row["pitch"]),
        )
        for row in note_array
    )
    return practice_timeline_from_compiled(replace(compiled, notes=notes))
