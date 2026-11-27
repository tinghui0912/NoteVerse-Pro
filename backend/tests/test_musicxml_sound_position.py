from fractions import Fraction
import xml.etree.ElementTree as ET

import pytest

from app.score_semantics.musicxml_sound_position import (
    MusicXMLSoundPositionError,
    resolve_sound_offset_quarters,
)


@pytest.mark.parametrize("namespace", ["", ' xmlns="urn:musicxml"'])
@pytest.mark.parametrize(
    "body, expected",
    [
        ("<offset>1</offset><sound/>", Fraction(0)),
        ('<offset sound="no">1</offset><sound/>', Fraction(0)),
        ('<offset sound="yes">1</offset><sound/>', Fraction(1, 3)),
        ('<offset sound="yes">-1.5</offset><sound/>', Fraction(-1, 2)),
        ('<offset sound="yes">9</offset><sound><offset>1</offset></sound>', Fraction(1, 3)),
        ('<offset sound="no">9</offset><sound><offset>1</offset></sound>', Fraction(1, 3)),
    ],
)
def test_sound_offset_selection_is_exact_namespace_agnostic_and_independent_of_sound_kind(
    namespace, body, expected
):
    assert (
        resolve_sound_offset_quarters(
            ET.fromstring(f"<direction{namespace}>{body}</direction>"), Fraction(3)
        )
        == expected
    )


@pytest.mark.parametrize("attribute", ['tempo="90"', 'dacapo="yes"', 'dalsegno="s"', ""])
def test_standalone_sound_positions_are_reusable_for_any_sound_fact(attribute):
    assert resolve_sound_offset_quarters(
        ET.fromstring(f"<sound {attribute}><offset>1</offset></sound>"), Fraction(3)
    ) == Fraction(1, 3)


@pytest.mark.parametrize("divisions", [None, Fraction(0), Fraction(-1)])
@pytest.mark.parametrize(
    "element",
    [
        '<direction><offset sound="yes">0</offset><sound/></direction>',
        "<sound><offset>1</offset></sound>",
    ],
)
def test_effective_offsets_require_positive_divisions(element, divisions):
    with pytest.raises(MusicXMLSoundPositionError, match="positive divisions"):
        resolve_sound_offset_quarters(ET.fromstring(element), divisions)


@pytest.mark.parametrize("offset", ["", "<offset>bad</offset>", '<offset sound="no">4</offset>'])
def test_visual_only_offsets_do_not_require_divisions(offset):
    assert (
        resolve_sound_offset_quarters(
            ET.fromstring(f"<direction>{offset}<sound/></direction>"), None
        )
        == 0
    )


@pytest.mark.parametrize(
    "element",
    [
        '<direction><offset sound="maybe">1</offset><sound/></direction>',
        '<direction><offset sound="maybe">1</offset><sound><offset>2</offset></sound></direction>',
        '<direction><offset sound="yes">1</offset><offset>2</offset><sound/></direction>',
        "<sound><offset>1</offset><offset>2</offset></sound>",
        "<direction><sound/><sound/></direction>",
        "<note/>",
    ]
    + [
        f"<sound><offset>{value}</offset></sound>"
        for value in ["NaN", "Infinity", "1e2", "1_0", "", "bad"]
    ],
)
def test_invalid_playback_position_fails_closed(element):
    with pytest.raises(MusicXMLSoundPositionError):
        resolve_sound_offset_quarters(ET.fromstring(element), Fraction(3))
