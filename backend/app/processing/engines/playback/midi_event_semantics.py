"""Written-realization metadata roles and their supported placement contract."""

from enum import Enum

from .standard_midi import MidiEvent, MidiRepresentationError


class MidiMetaRole(Enum):
    STRUCTURAL = "structural"
    TIMELINE = "timeline"
    CONDUCTOR = "conductor"
    TERMINAL = "terminal"


_STRUCTURAL = frozenset({0x00, 0x02, 0x03, 0x04, 0x08, 0x09, 0x20, 0x21})
_TIMELINE = frozenset({0x01, 0x05, 0x06, 0x07, 0x58, 0x59})
_PAYLOAD_SIZES = {0x00: 2, 0x20: 1, 0x21: 1, 0x58: 4, 0x59: 2, 0x2F: 0}


def classify_meta_event(event: MidiEvent) -> MidiMetaRole:
    kind = event.meta_type
    if event.status != 0xFF or kind not in _STRUCTURAL | _TIMELINE | {0x51, 0x2F}:
        raise MidiRepresentationError("unsupported_midi_meta_event")
    if kind in _PAYLOAD_SIZES and len(event.data) != _PAYLOAD_SIZES[kind]:
        raise MidiRepresentationError("invalid_midi_meta_payload")
    if kind in (0x20, 0x21):
        raise MidiRepresentationError("unsupported_midi_routing_metadata")
    if kind in _STRUCTURAL:
        if event.position != 0:
            raise MidiRepresentationError("unsupported_structural_midi_position")
        return MidiMetaRole.STRUCTURAL
    if kind in _TIMELINE:
        return MidiMetaRole.TIMELINE
    return MidiMetaRole.CONDUCTOR if kind == 0x51 else MidiMetaRole.TERMINAL


def is_note_on(event: MidiEvent) -> bool:
    return event.status & 0xF0 == 0x90 and event.data[1] > 0


def is_note_off(event: MidiEvent) -> bool:
    return event.status & 0xF0 == 0x80 or (event.status & 0xF0 == 0x90 and event.data[1] == 0)
