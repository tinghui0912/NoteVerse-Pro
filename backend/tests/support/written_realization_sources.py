"""Byte-identical source fixtures shared with the Browser WASM characterization."""

import json
from pathlib import Path

SOURCES: dict[str, str] = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures/verovio-written-realization.json").read_text()
)

PROFILE_SOURCES = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures/verovio-playback-profile.json").read_text()
)

MICROTONAL_KEY = SOURCES["piano"].replace(
    "</divisions>",
    "</divisions><key><key-step>C</key-step><key-alter>0.5</key-alter>"
    "<key-accidental>quarter-sharp</key-accidental></key>",
)
LOSSY_SOURCES = [
    (SOURCES["microtonal"], "unsupported_verovio_microtonal_pitch"),
    (MICROTONAL_KEY, "unsupported_verovio_microtonal_key"),
    (SOURCES["directionDynamics"], "unsupported_verovio_sound_dynamics"),
    (SOURCES["multipleInstruments"], "unsupported_verovio_instrument_assignment"),
]


def with_sound(markup: str) -> str:
    return SOURCES["piano"].replace('<note id="n0"', markup + '<note id="n0"')


def with_origin_instrument_state(markup: str) -> str:
    return SOURCES["piano"].replace("</midi-program>", "</midi-program>" + markup)


LOSSY_SOUND_CONTROLS = [
    '<sound pizzicato="yes"/>',
    '<sound pan="60"/>',
    '<sound elevation="30"/>',
    '<sound damper-pedal="yes"/>',
    '<sound soft-pedal="yes"/>',
    '<sound sostenuto-pedal="yes"/>',
    "<sound><play><mute>on</mute></play></sound>",
]
LOSSY_INSTRUMENT_CONTROLS = [
    "<volume>30</volume>",
    "<pan>60</pan>",
    "<elevation>30</elevation>",
    "<midi-bank>2</midi-bank>",
]

SWING_SOURCE = (
    with_sound(
        "<sound><swing><first>2</first><second>1</second>"
        "<swing-type>eighth</swing-type></swing></sound>"
    )
    .replace("<divisions>1", "<divisions>2")
    .replace("<duration>2", "<duration>1")
    .replace("<type>half", "<type>eighth")
)
