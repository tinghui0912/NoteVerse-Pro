"""Streaming document admission rejects adversarial structure before tree allocation."""

from dataclasses import replace
from pathlib import Path
import pytest
from app.platform.document_admission import musicxml as admission
from app.platform.document_admission.musicxml import (
    MUSICXML_LIMITS,
    AdmissionReason,
    DocumentAdmissionError,
    parse_musicxml,
    parse_musicxml_file,
    read_bounded_bytes,
)


@pytest.mark.parametrize(
    "doctype",
    [
        '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
        '<!DOCTYPE score-partwise [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;">]>',
        '<!DOCTYPE score-partwise [<!ENTITY % p SYSTEM "https://evil.test/dtd">%p;]>',
        '<!DOCTYPE score-partwise [<!NOTATION n SYSTEM "file:///etc/passwd">]>',
        '<!DOCTYPE score-partwise SYSTEM "https://evil.test/dtd">',
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
        '<!DOCTYPE score-timewise SYSTEM "http://www.musicxml.org/dtds/timewise.dtd">',
    ],
)
def test_dtd_and_entity_declarations_cannot_allocate_tree_or_access_external_resources(
    doctype, monkeypatch
):
    def forbidden(*args, **kwargs):
        pytest.fail("No tree/file/network operation is admitted")

    monkeypatch.setattr(admission.ET, "fromstring", forbidden)
    monkeypatch.setattr("builtins.open", forbidden)
    monkeypatch.setattr("socket.create_connection", forbidden)
    with pytest.raises(DocumentAdmissionError) as caught:
        parse_musicxml(doctype + "<score-partwise/>")
    assert caught.value.reason == AdmissionReason.DTD_OR_ENTITY_FORBIDDEN
    assert caught.value.status_code == 422


@pytest.mark.parametrize(
    "content,reason",
    [
        (b"<x>\x00</x>", AdmissionReason.MALFORMED_XML),
        (b"<x>\xff</x>", AdmissionReason.MALFORMED_XML),
        (b"<x>", AdmissionReason.MALFORMED_XML),
        ('<?xml version="1.0" encoding="UTF-16"?><x/>', AdmissionReason.MALFORMED_XML),
        ('<?xml version="1.0" encoding="u-t-f-8"?><x/>', AdmissionReason.MALFORMED_XML),
        ('<?xml version="1.0" encoding="utf--8"?><x/>', AdmissionReason.MALFORMED_XML),
        (
            '<?xml-stylesheet href="https://evil.test/x"?><x/>',
            AdmissionReason.PROCESSING_INSTRUCTION_FORBIDDEN,
        ),
        ("<x>" * 100 + "</x>" * 100, AdmissionReason.DEPTH_EXCEEDED),
        (
            "<x " + " ".join(f'a{i}="1"' for i in range(33)) + "/>",
            AdmissionReason.ATTRIBUTES_EXCEEDED,
        ),
        (
            "<x " + " ".join(f'xmlns:a{i}="urn:{i}"' for i in range(33)) + "/>",
            AdmissionReason.ATTRIBUTES_EXCEEDED,
        ),
        ('<x a="' + "a" * 4097 + '"/>', AdmissionReason.ATTRIBUTE_VALUE_EXCEEDED),
        ("<x>" + "a" * 65537 + "</x>", AdmissionReason.TEXT_EXCEEDED),
        ("<x>" + "<n/>" * 250000 + "</x>", AdmissionReason.ELEMENT_COUNT_EXCEEDED),
    ],
)
def test_structure_fails_before_tree_construction(content, reason, monkeypatch):
    monkeypatch.setattr(
        admission.ET,
        "fromstring",
        lambda *a, **kw: pytest.fail("Tree construction cannot precede structural admission"),
    )
    with pytest.raises(DocumentAdmissionError) as caught:
        parse_musicxml(content)
    assert caught.value.reason == reason


def test_byte_limit_fails_before_dom_and_does_not_consume_remainder(monkeypatch):
    read = []

    def chunks():
        read.append(1)
        yield b"<score-partwise>"
        read.append(2)
        yield b" " * MUSICXML_LIMITS.max_bytes
        read.append(3)
        pytest.fail("Do not consume the remaining stream")

    monkeypatch.setattr(admission.ET, "fromstring", lambda *a, **kw: pytest.fail("No DOM"))
    with pytest.raises(DocumentAdmissionError) as caught:
        admission._validated_bytes(chunks(), MUSICXML_LIMITS)
    assert caught.value.status_code == 413
    assert read == [1, 2]


def test_text_budget_cannot_be_bypassed_by_chunk_boundaries_or_child_tails():
    limits = replace(MUSICXML_LIMITS, max_text_chars_per_node=5)
    with pytest.raises(DocumentAdmissionError, match="TEXT_EXCEEDED"):
        admission._validated_bytes(iter([b"<x>12", b"3<n/>45", b"6</x>"]), limits)
    limits = replace(MUSICXML_LIMITS, max_total_text_chars=5)
    with pytest.raises(DocumentAdmissionError, match="TEXT_EXCEEDED"):
        parse_musicxml("<x><a>123</a><b>456</b></x>", limits=limits)


@pytest.mark.parametrize(
    "path",
    sorted((Path(__file__).parents[1] / "fixtures/musicxml").glob("*.musicxml")),
    ids=lambda p: p.name,
)
def test_repository_musicxml_fixtures_fit_streaming_budgets(path):
    assert parse_musicxml_file(path).getroot() is not None


def test_byte_ceiling_accepts_exact_boundary_and_utf8_chunk_splits():
    content = b"<x>" + b" " * (MUSICXML_LIMITS.max_bytes - 7) + b"</x>"
    limits = replace(MUSICXML_LIMITS, max_text_chars_per_node=MUSICXML_LIMITS.max_bytes)
    assert parse_musicxml(content, limits=limits).tag == "x"
    assert (
        admission._validated_bytes(iter([b"<x>\xe4", b"\xb8\xad</x>"]), MUSICXML_LIMITS)
        == "<x>中</x>".encode()
    )


def test_bounded_read_closes_provider_stream_and_stops_without_full_allocation():
    closed = []

    def chunks():
        try:
            yield b"1234"
            yield b"56"
            pytest.fail("No further provider reads")
        finally:
            closed.append(True)

    with pytest.raises(DocumentAdmissionError, match="SIZE_EXCEEDED"):
        read_bounded_bytes(chunks(), max_bytes=5)
    assert closed == [True]


def test_admitted_storage_read_counts_actual_bytes_even_if_metadata_understates():
    from app.modules.media_storage.reads import read_admitted_bytes, StoredObjectReadTarget

    class Storage:
        def iter_bytes(self, *args, **kwargs):
            yield b"<x>"
            yield b" " * MUSICXML_LIMITS.max_bytes
            pytest.fail("The object cannot be fully read")

        def read_bytes(self, *args):
            pytest.fail("The unbounded provider method cannot be used")

    with pytest.raises(DocumentAdmissionError, match="SIZE_EXCEEDED"):
        read_admitted_bytes(Storage(), StoredObjectReadTarget(1, "key", 3, "application/xml"))
    with pytest.raises(DocumentAdmissionError, match="SIZE_EXCEEDED"):
        read_admitted_bytes(
            Storage(),
            StoredObjectReadTarget(1, "key", MUSICXML_LIMITS.max_bytes + 1, "application/xml"),
        )


def test_file_admission_is_bounded_and_dtd_safe(tmp_path):
    path = tmp_path / "input.xml"
    path.write_bytes(b"<!DOCTYPE x><x/>")
    with pytest.raises(DocumentAdmissionError, match="DTD_OR_ENTITY_FORBIDDEN"):
        parse_musicxml_file(path)
    path.write_bytes(b"<x>" + b" " * MUSICXML_LIMITS.max_bytes + b"</x>")
    with pytest.raises(DocumentAdmissionError, match="SIZE_EXCEEDED"):
        admission.read_musicxml_file(path)


def test_large_multi_part_score_fits_budgets():
    note = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>"
    measure = "<measure>" + note * 4 + "</measure>"
    content = (
        "<score-partwise>"
        + "".join(f'<part id="P{i}">' + measure * 256 + "</part>" for i in range(32))
        + "</score-partwise>"
    ).encode()
    assert 3 * 1024 * 1024 < len(content) < MUSICXML_LIMITS.max_bytes
    root = parse_musicxml(content)
    assert len(root.findall("part")) == 32
    assert len(root.findall(".//measure")) == 8192
    assert sum(1 for _ in root.iter()) < MUSICXML_LIMITS.max_elements


def test_exact_structural_boundaries_and_surrogates():
    assert parse_musicxml("<x>" * 32 + "</x>" * 32).tag == "x"
    assert parse_musicxml("<x " + " ".join(f'a{i}="1"' for i in range(32)) + "/>").tag == "x"
    assert parse_musicxml('<x a="' + "a" * 4096 + '">' + "t" * 65536 + "</x>").tag == "x"
    with pytest.raises(DocumentAdmissionError, match="MALFORMED_XML"):
        parse_musicxml("<x>\ud800</x>")


def test_file_xml_structural_admission_happens_before_dom(tmp_path, monkeypatch):
    path = tmp_path / "input.xml"
    path.write_bytes(b'<!DOCTYPE score-partwise [<!ENTITY a SYSTEM "https://evil.test/a">]>')
    monkeypatch.setattr(admission.ET, "fromstring", lambda *a, **kw: pytest.fail("No DOM"))
    with pytest.raises(DocumentAdmissionError, match="DTD_OR_ENTITY_FORBIDDEN"):
        admission.read_musicxml_file(path)


def test_semantic_parser_preserves_the_document_size_classification():
    from app.score_semantics.musicxml_score import parse_score_semantics

    with pytest.raises(DocumentAdmissionError) as caught:
        parse_score_semantics(b" " * (MUSICXML_LIMITS.max_bytes + 1))
    assert caught.value.status_code == 413


def test_preview_header_processing_rejects_forbidden_xml(tmp_path):
    from app.processing.engines.render.svg_preview_postprocessor import SvgPreviewPostProcessor

    path = tmp_path / "score.xml"
    path.write_text("<score-partwise><work><work-title>Title</work-title></work></score-partwise>")
    with pytest.raises(DocumentAdmissionError, match="DTD_OR_ENTITY_FORBIDDEN"):
        SvgPreviewPostProcessor().process(
            xml_path=str(path),
            page_number=1,
            svg='<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
        )


def test_non_xml_representations_use_their_explicit_admitted_read_budget():
    from app.modules.media_storage.reads import read_admitted_bytes, StoredObjectReadTarget

    size = 6 * 1024 * 1024

    class Storage:
        def iter_bytes(self, *args, **kwargs):
            for _ in range(size // 65536):
                yield b"x" * 65536

    target = StoredObjectReadTarget(1, "artifact.json", size, "application/json")
    assert len(read_admitted_bytes(Storage(), target, max_bytes=size)) == size
    with pytest.raises(DocumentAdmissionError, match="SIZE_EXCEEDED"):
        read_admitted_bytes(Storage(), target)


@pytest.mark.parametrize("root", ["score-partwise", "score-timewise"])
def test_standard_musicxml_public_header_is_not_resolved(root, monkeypatch):
    def no_external_access(*args, **kwargs):
        pytest.fail("External DTDs are never fetched")

    monkeypatch.setattr("builtins.open", no_external_access)
    monkeypatch.setattr("socket.create_connection", no_external_access)
    kind = root.removeprefix("score-")
    header = (
        f'<!DOCTYPE {root} PUBLIC "-//Recordare//DTD MusicXML 3.1 {kind.title()}//EN" '
        f'"http://www.musicxml.org/dtds/{kind}.dtd">'
    )
    assert parse_musicxml(header + f"<{root}/>").tag == root
    with pytest.raises(DocumentAdmissionError, match="DTD_OR_ENTITY_FORBIDDEN"):
        parse_musicxml(header + "<different-root/>")


@pytest.mark.parametrize(
    "public_id,system_id,subset",
    [
        ("-//Recordare//DTD MusicXML 3.1 Partwise//EN", "https://evil.test/partwise.dtd", ""),
        ("unrecognized", "http://www.musicxml.org/dtds/partwise.dtd", ""),
        (
            "-//Recordare//DTD MusicXML 3.1 Partwise//EN",
            "http://www.musicxml.org/dtds/partwise.dtd",
            " []",
        ),
    ],
)
def test_public_header_requires_exact_identity_and_no_internal_subset(public_id, system_id, subset):
    content = (
        f'<!DOCTYPE score-partwise PUBLIC "{public_id}" "{system_id}"{subset}><score-partwise/>'
    )
    with pytest.raises(DocumentAdmissionError, match="DTD_OR_ENTITY_FORBIDDEN"):
        parse_musicxml(content)
