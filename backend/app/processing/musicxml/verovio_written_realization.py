"""Source fidelity boundary for the pinned Verovio written MIDI realization.

This consumer capability is narrower than canonical MusicXML admission. Pitch
facts come from the canonical model; only renderer-specific sound/instrument
structures that it does not model are inspected here. No chronology is inferred.
"""

from enum import StrEnum
import xml.etree.ElementTree as ET

from app.score_semantics.musicxml_score import CanonicalScoreSemanticModel


class VerovioWrittenRealizationReason(StrEnum):
    MICROTONAL_PITCH = "unsupported_verovio_microtonal_pitch"
    MICROTONAL_KEY = "unsupported_verovio_microtonal_key"
    SOUND_DYNAMICS = "unsupported_verovio_sound_dynamics"
    SOUND_STATE = "unsupported_verovio_sound_state"
    INSTRUMENT_ASSIGNMENT = "unsupported_verovio_instrument_assignment"
    INSTRUMENT_STATE = "unsupported_verovio_instrument_state"


class VerovioWrittenRealizationError(ValueError):
    def __init__(self, reason: VerovioWrittenRealizationReason):
        self.reason = reason
        super().__init__(reason.value)


def _name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _name(child) == name]


def _validate_part_instrument(part: ET.Element, definition: ET.Element | None) -> None:
    instruments = _children(definition, "midi-instrument") if definition is not None else []
    identities = _children(definition, "score-instrument") if definition is not None else []
    # The written adapter realizes one static origin instrument per part. Unused
    # additional definitions are metadata, not a request to switch instruments.
    origin = instruments[0] if instruments else identities[0] if identities else None
    origin_id = origin.get("id") if origin is not None else None
    for note in part.iter():
        if _name(note) != "note" or _children(note, "rest"):
            continue
        for assignment in _children(note, "instrument"):
            if assignment.get("id") != origin_id:
                raise VerovioWrittenRealizationError(
                    VerovioWrittenRealizationReason.INSTRUMENT_ASSIGNMENT
                )
    if instruments and any(
        _name(child) in {"midi-bank", "volume", "pan", "elevation"} for child in instruments[0]
    ):
        raise VerovioWrittenRealizationError(VerovioWrittenRealizationReason.INSTRUMENT_STATE)


def validate_verovio_written_realization(
    admitted: bytes, model: CanonicalScoreSemanticModel
) -> None:
    """Reject audible source controls outside the renderer's faithful subset.

    The caller supplies the admitted document and its canonical model. This does
    not restrict storage, written metadata, or the pure performance-plan domain.
    Static part programs, note dynamics, visual dynamics and direction pedal
    notation are supported. Sound-owned instrument updates, play/swing, spatial,
    pedal and pizzicato controls are outside the written-realization contract.
    Browser MIDI-state and local soundfont limits are separate consumer checks.
    """
    if any(note.pitch and note.pitch.alter.denominator != 1 for note in model.notes):
        raise VerovioWrittenRealizationError(VerovioWrittenRealizationReason.MICROTONAL_PITCH)
    if any(alter.alter.denominator != 1 for key in model.keys for alter in key.alterations):
        raise VerovioWrittenRealizationError(VerovioWrittenRealizationReason.MICROTONAL_KEY)

    root = ET.fromstring(admitted)
    for element in root.iter():
        if _name(element) != "sound":
            continue
        if "dynamics" in element.attrib:
            raise VerovioWrittenRealizationError(VerovioWrittenRealizationReason.SOUND_DYNAMICS)
        if _children(element, "midi-instrument"):
            # Even an origin sound update is not equivalent to the part-list
            # instrument that the renderer actually uses. Do not pick an update.
            raise VerovioWrittenRealizationError(
                VerovioWrittenRealizationReason.INSTRUMENT_ASSIGNMENT
            )
        if element.attrib.keys() & {
            "pizzicato",
            "pan",
            "elevation",
            "damper-pedal",
            "soft-pedal",
            "sostenuto-pedal",
        } or any(_name(child) in {"play", "swing"} for child in element):
            raise VerovioWrittenRealizationError(VerovioWrittenRealizationReason.SOUND_STATE)

    definitions = {
        part.get("id"): part
        for listing in _children(root, "part-list")
        for part in _children(listing, "score-part")
    }
    for part in _children(root, "part"):
        _validate_part_instrument(part, definitions.get(part.get("id")))
