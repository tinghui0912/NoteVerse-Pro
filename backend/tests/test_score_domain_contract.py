from __future__ import annotations

import json
from pathlib import Path
from xml.etree import ElementTree


BACKEND_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = BACKEND_ROOT / "docs" / "contracts" / "score-domain-v1.json"
FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "musicxml"


def load_contract() -> dict[str, object]:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def test_score_domain_contract_freezes_identity_and_revision_invariants() -> None:
    contract = load_contract()
    identities = contract["identities"]
    invariants = contract["invariants"]

    assert identities == {
        "submission_and_polling": "job_id",
        "review": "job_id",
        "results_editor_history_sharing": "score_id",
        "practice_and_publication_snapshot": "revision_id",
    }
    assert invariants["revision_is_immutable"] is True
    assert invariants["revision_history_is_linear"] is True
    assert invariants["revision_save_requires_base_revision"] is True
    assert invariants["one_canonical_musicxml_per_revision"] is True
    assert invariants["publication_pins_revision"] is True
    assert invariants["practice_pins_revision"] is True


def test_score_domain_contract_freezes_access_and_error_vocabulary() -> None:
    contract = load_contract()

    assert contract["enums"]["membership_role"] == ["EDITOR", "VIEWER"]
    assert contract["invariants"]["anonymous_edit_is_forbidden"] is True
    assert contract["invariants"]["bookmark_grants_access"] is False
    assert contract["invariants"]["raw_share_token_is_persisted"] is False
    assert set(contract["capabilities"]) == set(contract["examples"]["score_capabilities"])
    assert {
        "score_not_found",
        "revision_not_found",
        "revision_conflict",
        "artifact_not_found",
        "metadata_not_ready",
        "share_grant_login_required",
        "publication_revision_invalid",
        "score_access_denied",
    }.issubset(contract["error_codes"])


def test_metadata_fixture_characterizes_logical_measures_and_changes() -> None:
    root = ElementTree.parse(FIXTURE_ROOT / "score-domain-metadata.musicxml").getroot()
    parts = root.findall("./part")
    reference_measures = parts[0].findall("./measure")

    assert len(parts) == 2
    assert len(reference_measures) == 4
    assert sum(len(part.findall("./measure")) for part in parts) == 8
    assert [node.text for node in root.findall(".//key/fifths")] == ["0", "1", "0", "1"]
    assert [(node.findtext("beats"), node.findtext("beat-type")) for node in root.findall(".//time")] == [
        ("4", "4"),
        ("3", "4"),
        ("4", "4"),
        ("3", "4"),
    ]
    assert [node.get("tempo") for node in root.findall(".//sound[@tempo]")] == ["120", "90"]
    assert [node.get("direction") for node in root.findall(".//repeat")] == [
        "forward",
        "backward",
    ]


def test_invalid_metadata_fixture_is_well_formed_but_semantically_invalid() -> None:
    root = ElementTree.parse(
        FIXTURE_ROOT / "score-domain-invalid-metadata.musicxml"
    ).getroot()

    assert root.findtext(".//key/fifths") == "invalid"
    assert root.findtext(".//time/beats") == "common"
    assert root.findtext(".//time/beat-type") == "0"
    assert root.find(".//sound").get("tempo") == "-10"
