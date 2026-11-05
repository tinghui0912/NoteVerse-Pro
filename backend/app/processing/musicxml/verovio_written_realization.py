"""Closed NoteVerse playback source profile for pinned Verovio written realization.

Canonical admission is broader. This module classifies renderer-facing source
surfaces, not navigation or chronology. Presentation subtrees are descriptive;
unknown fields on managed structural/playback surfaces fail closed. Instrument
and transpose inspection supplies only facts absent from the canonical model.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import StrEnum
import xml.etree.ElementTree as ET

from app.score_semantics.musicxml_score import CanonicalScoreSemanticModel


class VerovioWrittenRealizationReason(StrEnum):
    PROFILE = "unsupported_verovio_playback_profile"
    MICROTONAL_PITCH = "unsupported_verovio_microtonal_pitch"
    MICROTONAL_KEY = "unsupported_verovio_microtonal_key"
    SOUND_DYNAMICS = "unsupported_verovio_sound_dynamics"
    SOUND_STATE = "unsupported_verovio_sound_state"
    INSTRUMENT_ASSIGNMENT = "unsupported_verovio_instrument_assignment"
    INSTRUMENT_STATE = "unsupported_verovio_instrument_state"
    TRANSPOSITION = "unsupported_verovio_transposition"
    UNPITCHED = "unsupported_verovio_unpitched_realization"
    GRACE = "unsupported_verovio_grace_realization"


class VerovioWrittenRealizationError(ValueError):
    def __init__(self, reason: VerovioWrittenRealizationReason):
        self.reason = reason
        super().__init__(reason.value)


class _Disposition(StrEnum):
    SUPPORTED = "SUPPORTED"
    PRESENTATION_ONLY = "PRESENTATION_ONLY"
    UNSUPPORTED_PLAYBACK = "UNSUPPORTED_PLAYBACK"


@dataclass(frozen=True)
class _Rule:
    disposition: _Disposition
    reason: VerovioWrittenRealizationReason = VerovioWrittenRealizationReason.PROFILE


@dataclass(frozen=True)
class _Surface:
    attributes: dict[str, _Rule]
    children: dict[str, _Rule]


def _fields(
    supported: str = "",
    presentation: str = "",
    unsupported: str = "",
    reason: VerovioWrittenRealizationReason = VerovioWrittenRealizationReason.PROFILE,
) -> dict[str, _Rule]:
    result: dict[str, _Rule] = {}
    for names, category in (
        (supported, _Disposition.SUPPORTED),
        (presentation, _Disposition.PRESENTATION_ONLY),
        (unsupported, _Disposition.UNSUPPORTED_PLAYBACK),
    ):
        for name in names.split():
            if name in result:
                raise AssertionError(f"Duplicate profile field: {name}")
            result[name] = _Rule(category, reason)
    return result


_R = VerovioWrittenRealizationReason
_STYLE = "id default-x default-y relative-x relative-y font-family font-style font-size font-weight color print-object"
_EDITORIAL = "footnote level"
_SOURCE_VERSIONS = frozenset({None, "1.0", "1.1", "2.0", "3.0", "3.1", "4.0"})

# Presentation is an explicit vocabulary too: text/layout subtrees cannot carry
# arbitrary extensions or conceal a sound/playing instruction. These fields have
# no product audio interpretation; no wildcard XML namespace or attribute exists.
_PRESENTATION_ATTRIBUTES = frozenset(
    (
        _STYLE + " type number name placement halign valign justify size symbol separator "
        "orientation line-type line-shape dash-length space-length bezier-x bezier-y "
        "bezier-x2 bezier-y2 bezier-offset bezier-offset2 substitution alternate "
        "parentheses bracket cautionary editorial smufl filled repeater fan start-note trill-step "
        "accelerate beats second-beat last-beat show-number show-type reference "
        "new-system new-page blank-page page-number page system-layout staff-layout "
        "print-dot print-spacing print-lyric length spread niente relative-y "
        "enclosure letter-spacing line-height text-decoration text-rotation underline "
        "overline line-through rotation default-line-height language use-symbols "
        "element attribute value start-stop supports dir bottom-staff top-staff additional "
        "after-barline line width scaling end-length line-end height source "
        "multiple-rest-always multiple-rest-range staff system position staff-spacing member-of"
    ).split()
) | {
    "{http://www.w3.org/XML/1998/namespace}lang",
    "{http://www.w3.org/XML/1998/namespace}space",
    *{
        f"{{http://www.w3.org/1999/xlink}}{name}"
        for name in ("href", "type", "role", "title", "show", "actuate")
    },
}
_PRESENTATION_CHILDREN = frozenset(
    (
        "work-number work-title opus creator rights encoding source relation miscellaneous "
        "miscellaneous-field software encoding-date encoder encoding-description supports "
        "credit-type credit-words credit-image link bookmark display-text accidental-text "
        "scaling millimeters tenths appearance line-width note-size distance glyph "
        "music-font word-font lyric-font lyric-language page-layout page-height page-width "
        "page-margins left-margin right-margin top-margin bottom-margin system-layout "
        "system-margins system-distance top-system-distance system-dividers left-divider "
        "right-divider staff-layout staff-distance measure-layout measure-distance "
        "measure-numbering part-name-display part-abbreviation-display display-step display-octave "
        "sign line group-name group-name-display group-abbreviation "
        "group-abbreviation-display group-symbol group-barline group-time "
        "syllabic text elision extend end-line end-paragraph laughing humming "
        "tuplet-actual tuplet-normal tuplet-number tuplet-type tuplet-dot "
        "p pp ppp pppp ppppp pppppp f ff fff ffff fffff ffffff mp mf sf sfp sfpp fp "
        "rf rfz sfz sffz fz n pf sfzp other-dynamics virtual-library virtual-name"
    ).split()
)

# MusicXML 4.0 sound surface. Divisions is a destination-resolution hint, not a
# replacement for attributes/divisions or the canonical WrittenPoint grid.
_SOUND_ATTRIBUTES = (
    _fields("tempo dacapo segno dalsegno coda tocoda divisions forward-repeat fine time-only", "id")
    | _fields(unsupported="dynamics", reason=_R.SOUND_DYNAMICS)
    | _fields(
        unsupported="pizzicato pan elevation damper-pedal soft-pedal sostenuto-pedal",
        reason=_R.SOUND_STATE,
    )
)
_SOUND_CHILDREN = (
    _fields("offset", unsupported="midi-device")
    | _fields(unsupported="instrument-change midi-instrument", reason=_R.INSTRUMENT_ASSIGNMENT)
    | _fields(unsupported="play swing", reason=_R.SOUND_STATE)
)
_MIDI_INSTRUMENT_CHILDREN = _fields(
    "midi-channel midi-program",
    unsupported="midi-name midi-bank volume pan elevation",
    reason=_R.INSTRUMENT_STATE,
) | _fields(unsupported="midi-unpitched", reason=_R.UNPITCHED)
_SCORE_INSTRUMENT_CHILDREN = _fields(
    presentation="instrument-name instrument-abbreviation instrument-sound solo ensemble",
    unsupported="virtual-instrument",
    reason=_R.INSTRUMENT_ASSIGNMENT,
)

# Expressive performance is not supplied by the current profile. Notated ties
# accompany canonical sound ties; tuplet/type/dot information describes the exact
# duration already owned by canonical written chronology. Visual dynamics/text
# request no audible state; sound/note playback controls are classified separately.
_SURFACES = {
    "score-partwise": _Surface(
        _fields("version"),
        _fields(
            "part-list part", "work movement-number movement-title identification defaults credit"
        ),
    ),
    "part-list": _Surface(_fields(), _fields("score-part", "part-group")),
    "score-part": _Surface(
        _fields("id"),
        _fields(
            "score-instrument midi-instrument",
            "identification part-link part-name part-name-display part-abbreviation part-abbreviation-display group player",
            "midi-device",
        ),
    ),
    "score-instrument": _Surface(_fields("id"), _SCORE_INSTRUMENT_CHILDREN),
    "midi-instrument": _Surface(_fields("id"), _MIDI_INSTRUMENT_CHILDREN),
    "part": _Surface(_fields("id"), _fields("measure")),
    "measure": _Surface(
        _fields("number implicit non-controlling", "id width text"),
        _fields(
            "attributes note backup forward direction sound barline",
            "print grouping link bookmark",
            "harmony figured-bass listening",
        ),
    ),
    "attributes": _Surface(
        _fields(presentation=_STYLE + " {http://www.w3.org/XML/1998/namespace}lang"),
        _fields(
            "divisions key time transpose staff-details measure-style clef",
            _EDITORIAL + " staves part-symbol instruments directive",
            "for-part",
        ),
    ),
    "sound": _Surface(_SOUND_ATTRIBUTES, _SOUND_CHILDREN),
    "direction": _Surface(
        _fields("", "id placement directive system only-top-staff"),
        _fields("direction-type offset sound voice staff", _EDITORIAL, "listening"),
    ),
    "direction-type": _Surface(
        _fields(presentation="id"),
        _fields(
            "metronome pedal",
            "rehearsal segno coda words symbol wedge dynamics dashes bracket eyeglasses image principal-voice percussion accordion-registration staff-divide",
            "octave-shift harp-pedals damp damp-all string-mute scordatura other-direction",
        ),
    ),
    "note": _Surface(
        _fields(
            "dynamics",
            _STYLE + " print-leger print-dot print-spacing print-lyric",
            "end-dynamics attack release time-only pizzicato",
        ),
        _fields(
            "pitch rest chord duration tie instrument voice staff time-modification notations lyric",
            _EDITORIAL + " type dot accidental stem notehead notehead-text beam",
            "cue play listen",
        )
        | _fields(unsupported="unpitched", reason=_R.UNPITCHED)
        | _fields(unsupported="grace", reason=_R.GRACE),
    ),
    "pitch": _Surface(_fields(), _fields("step alter octave")),
    "lyric": _Surface(
        _fields(presentation=_STYLE + " number name justify placement", unsupported="time-only"),
        _fields(
            presentation=_EDITORIAL
            + " syllabic text elision extend end-line end-paragraph laughing humming"
        ),
    ),
    "rest": _Surface(_fields("measure"), _fields(presentation="display-step display-octave")),
    "tie": _Surface(_fields("type", unsupported="time-only"), _fields()),
    "instrument": _Surface(_fields("id"), _fields()),
    "backup": _Surface(_fields(), _fields("duration", _EDITORIAL)),
    "forward": _Surface(_fields(), _fields("duration voice staff", _EDITORIAL)),
    "time-modification": _Surface(
        _fields(), _fields("actual-notes normal-notes", "normal-type normal-dot")
    ),
    "notations": _Surface(
        _fields(presentation="id print-object"),
        _fields(
            supported="technical",
            presentation=_EDITORIAL + " tied tuplet accidental-mark dynamics",
            unsupported="slur glissando slide ornaments articulations fermata arpeggiate non-arpeggiate other-notation",
        ),
    ),
    "technical": _Surface(
        _fields(presentation="id"),
        _fields(
            presentation="fingering fret string heel toe",
            unsupported="up-bow down-bow harmonic open-string thumb-position pluck double-tongue triple-tongue stopped snap-pizzicato hammer-on pull-off bend tap fingernails hole arrow handbell brass-bend flip smear open half-muted harmon-mute golpe other-technical",
        ),
    ),
    "key": _Surface(
        _fields("number", _STYLE),
        _fields("cancel fifths mode key-step key-alter key-accidental", unsupported="key-octave"),
    ),
    "time": _Surface(
        _fields("number", _STYLE + " symbol separator halign valign"),
        _fields("beats beat-type senza-misura", unsupported="interchangeable"),
    ),
    "transpose": _Surface(
        _fields(presentation="id", unsupported="number", reason=_R.TRANSPOSITION),
        _fields("diatonic chromatic octave-change", unsupported="double", reason=_R.TRANSPOSITION),
    ),
    "staff-details": _Surface(
        _fields(presentation="number show-frets print-object print-spacing"),
        _fields(
            presentation="staff-type staff-lines line-detail staff-size",
            unsupported="staff-tuning capo",
        ),
    ),
    "clef": _Surface(
        _fields(presentation=_STYLE + " number additional size after-barline"),
        _fields(presentation="sign line", unsupported="clef-octave-change"),
    ),
    "measure-style": _Surface(
        _fields(presentation=_STYLE + " number"),
        _fields(presentation="multiple-rest", unsupported="measure-repeat beat-repeat slash"),
    ),
    "metronome": _Surface(
        _fields(presentation=_STYLE + " halign valign justify parentheses"),
        _fields(
            "beat-unit beat-unit-dot per-minute",
            unsupported="beat-unit-tied metronome-arrows metronome-note metronome-relation",
        ),
    ),
    "pedal": _Surface(
        _fields("type", _STYLE + " number line sign abbreviated halign valign"), _fields()
    ),
    "barline": _Surface(
        _fields("location segno coda divisions", "id"),
        _fields("repeat ending", _EDITORIAL + " bar-style segno coda", "wavy-line fermata"),
    ),
    "repeat": _Surface(_fields("direction times after-jump", "winged"), _fields()),
    "ending": _Surface(
        _fields("number type", _STYLE + " system only-top-staff end-length text-x text-y"),
        _fields(),
    ),
    "offset": _Surface(_fields("sound", "id"), _fields()),
    "per-minute": _Surface(_fields(presentation=_STYLE), _fields()),
}
# Canonical scalar fields have no nested playback extension points.
_LEAF = _Surface(_fields(), _fields())
for _tag in "divisions duration chord voice staff step alter octave actual-notes normal-notes cancel fifths mode key-step key-alter key-accidental beats beat-type senza-misura diatonic chromatic octave-change beat-unit beat-unit-dot midi-channel midi-program".split():
    _SURFACES[_tag] = _LEAF


def _name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _name(child) == name]


def _rule(fields: dict[str, _Rule], name: str, audible: bool) -> _Rule:
    rule = fields.get(name)
    if rule is None:
        raise VerovioWrittenRealizationError(_R.PROFILE)
    if audible and rule.disposition is _Disposition.UNSUPPORTED_PLAYBACK:
        raise VerovioWrittenRealizationError(rule.reason)
    return rule


def _presentation(element: ET.Element, namespace: str) -> None:
    if (
        element.tag != namespace + _name(element)
        or element.attrib.keys() - _PRESENTATION_ATTRIBUTES
    ):
        raise VerovioWrittenRealizationError(_R.PROFILE)
    for child in element:
        if _name(child) not in _PRESENTATION_CHILDREN:
            raise VerovioWrittenRealizationError(_R.PROFILE)
        _presentation(child, namespace)


def _walk(element: ET.Element, namespace: str, *, audible: bool = True) -> None:
    if element.tag != namespace + _name(element):
        raise VerovioWrittenRealizationError(_R.PROFILE)
    surface = _SURFACES.get(_name(element))
    if surface is None:
        raise VerovioWrittenRealizationError(_R.PROFILE)
    for attribute in element.attrib:
        _rule(surface.attributes, attribute, audible)
    for child in element:
        if child.tag != namespace + _name(child):
            raise VerovioWrittenRealizationError(_R.PROFILE)
        rule = _rule(surface.children, _name(child), audible)
        if _name(element) == "score-part" and _name(child) in {
            "score-instrument",
            "midi-instrument",
        }:
            continue  # Checked with its effective assignment, including unused definitions.
        if rule.disposition is _Disposition.SUPPORTED:
            _walk(child, namespace, audible=audible)
        elif rule.disposition is _Disposition.PRESENTATION_ONLY or not audible:
            _presentation(child, namespace)
    if (
        _name(element) == "note"
        and len(_children(element, "pitch") + _children(element, "rest")) != 1
    ):
        raise VerovioWrittenRealizationError(_R.PROFILE)
    if _name(element) == "sound" and "divisions" in element.attrib:
        if not (element.get("segno") or element.get("coda")):
            raise VerovioWrittenRealizationError(_R.PROFILE)
        # This hint is a positive decimal in the source datatype; it does not
        # change the canonical score grid or reinterpret a sound-owned offset.
        try:
            hint = Decimal(element.attrib["divisions"])
            if not hint.is_finite() or hint <= 0:
                raise VerovioWrittenRealizationError(_R.PROFILE)
        except InvalidOperation as error:
            raise VerovioWrittenRealizationError(_R.PROFILE) from error
    if _name(element) == "pedal" and (
        element.get("type") not in {"start", "stop"} or element.get("number", "1") != "1"
    ):
        raise VerovioWrittenRealizationError(_R.PROFILE)


def _integer(element: ET.Element, reason: VerovioWrittenRealizationReason) -> int:
    try:
        return int(element.text or "")
    except ValueError as error:
        raise VerovioWrittenRealizationError(reason) from error


def _validate_part_instrument(
    part: ET.Element, definition: ET.Element | None, namespace: str
) -> None:
    instruments = _children(definition, "midi-instrument") if definition is not None else []
    identities = _children(definition, "score-instrument") if definition is not None else []
    for declarations in (instruments, identities):
        ids = [element.get("id") for element in declarations]
        if any(not identity for identity in ids) or len(ids) != len(set(ids)):
            raise VerovioWrittenRealizationError(_R.INSTRUMENT_ASSIGNMENT)
    if instruments and not identities:
        raise VerovioWrittenRealizationError(_R.INSTRUMENT_ASSIGNMENT)
    if instruments and identities:
        identity_ids = {element.get("id") for element in identities}
        if instruments[0].get("id") != identities[0].get("id") or any(
            instrument.get("id") not in identity_ids for instrument in instruments
        ):
            raise VerovioWrittenRealizationError(_R.INSTRUMENT_ASSIGNMENT)
    origin = instruments[0] if instruments else identities[0] if identities else None
    origin_id = origin.get("id") if origin is not None else None
    for note in part.iter():
        if _name(note) != "note" or _children(note, "rest"):
            continue
        if any(assignment.get("id") != origin_id for assignment in _children(note, "instrument")):
            raise VerovioWrittenRealizationError(_R.INSTRUMENT_ASSIGNMENT)
    for instrument in instruments:
        active = instrument is origin
        _walk(instrument, namespace, audible=active)
        if active:
            for name, maximum in (("midi-channel", 16), ("midi-program", 128)):
                values = _children(instrument, name)
                if len(values) > 1 or any(
                    not 1 <= _integer(value, _R.INSTRUMENT_STATE) <= maximum for value in values
                ):
                    raise VerovioWrittenRealizationError(_R.INSTRUMENT_STATE)
    explicit_program = origin is not None and bool(_children(origin, "midi-program"))
    for identity in identities:
        active = identity.get("id") == origin_id
        _walk(identity, namespace, audible=active)
        # Descriptive sound taxonomy does not override an explicit GM program.
        # Without that program there is no faithful mapping contract for the name.
        if active and _children(identity, "instrument-sound") and not explicit_program:
            raise VerovioWrittenRealizationError(_R.INSTRUMENT_ASSIGNMENT)


def _validate_transpositions(
    root: ET.Element, model: CanonicalScoreSemanticModel
) -> dict[int, int]:
    offsets: dict[int, int] = {}
    for fact in model.transpositions:
        if (
            fact.part_index in offsets
            or fact.measure_index != 0
            or fact.position != model.measures[0].start
        ):
            raise VerovioWrittenRealizationError(_R.TRANSPOSITION)
        offsets[fact.part_index] = 0
    for index, part in enumerate(_children(root, "part")):
        for transpose in (e for e in part.iter() if _name(e) == "transpose"):
            chromatic = _children(transpose, "chromatic")
            if len(chromatic) != 1:
                raise VerovioWrittenRealizationError(_R.TRANSPOSITION)
            if any(len(_children(transpose, name)) > 1 for name in ("diatonic", "octave-change")):
                raise VerovioWrittenRealizationError(_R.TRANSPOSITION)
            values = {_name(e): _integer(e, _R.TRANSPOSITION) for e in transpose}
            offsets[index] = values["chromatic"] + 12 * values.get("octave-change", 0)
    return offsets


def _validate_notated_ties(root: ET.Element, model: CanonicalScoreSemanticModel) -> None:
    # Associate source notation with existing canonical facts by their source
    # sequence. No written clock or sound-tie semantics are parsed here.
    elements = {
        (p, m, sequence): element
        for p, part in enumerate(_children(root, "part"))
        for m, measure in enumerate(_children(part, "measure"))
        for sequence, element in enumerate(
            (e for e in measure if _name(e) in {"note", "forward"}), start=1
        )
    }
    for fact in model.notes:
        source = elements[(fact.part_index, fact.measure_index, fact.sequence)]
        for notations in _children(source, "notations"):
            for tied in _children(notations, "tied"):
                kind = tied.get("type")
                if kind not in {"start", "stop"} or kind not in fact.ties:
                    raise VerovioWrittenRealizationError(_R.PROFILE)


def validate_verovio_written_realization(
    admitted: bytes, model: CanonicalScoreSemanticModel
) -> None:
    """Validate the closed renderer-faithful source profile for a playback consumer.

    Pure canonical plan construction, storage and metadata remain renderer-free.
    Browser MIDI state and local audio assets are narrower independent checks.
    """
    if any(note.pitch and note.pitch.alter.denominator != 1 for note in model.notes):
        raise VerovioWrittenRealizationError(_R.MICROTONAL_PITCH)
    if any(alter.alter.denominator != 1 for key in model.keys for alter in key.alterations):
        raise VerovioWrittenRealizationError(_R.MICROTONAL_KEY)
    if any(note.is_grace for note in model.notes):
        raise VerovioWrittenRealizationError(_R.GRACE)
    root = ET.fromstring(admitted)
    if _name(root) != "score-partwise" or root.get("version") not in _SOURCE_VERSIONS:
        raise VerovioWrittenRealizationError(_R.PROFILE)
    namespace = root.tag.removesuffix("score-partwise")
    _walk(root, namespace)
    _validate_notated_ties(root, model)
    offsets = _validate_transpositions(root, model)
    steps = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    for note in model.notes:
        if note.pitch is not None:
            pitch = note.pitch
            sounding = (
                (pitch.octave + 1) * 12
                + steps[pitch.step]
                + pitch.alter
                + offsets.get(note.part_index, 0)
            )
            if not 0 <= sounding <= 127:
                raise VerovioWrittenRealizationError(
                    _R.TRANSPOSITION if note.part_index in offsets else _R.PROFILE
                )
    declarations = [
        p for listing in _children(root, "part-list") for p in _children(listing, "score-part")
    ]
    ids = [declaration.get("id") for declaration in declarations]
    if any(not identity for identity in ids) or len(ids) != len(set(ids)):
        raise VerovioWrittenRealizationError(_R.INSTRUMENT_ASSIGNMENT)
    # Unreferenced declarations remain metadata, but not unchecked XML extension
    # points. Check their vocabulary even when no part body references them.
    for declaration in declarations:
        for child in declaration:
            if _name(child) in {"score-instrument", "midi-instrument"}:
                _walk(child, namespace, audible=False)
    definitions = {p.get("id"): p for p in declarations}
    for part in _children(root, "part"):
        _validate_part_instrument(part, definitions.get(part.get("id")), namespace)
