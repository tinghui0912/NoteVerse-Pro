"""Content-only compilation and binding-first application reads."""

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from app.modules.storage_objects.persistence import object_from_bytes
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET

import pytest
from app.modules.practice.bundle.compiler import PracticeBundleCompiler
from app.modules.practice.bundle.domain import PracticeBundleRepresentation, PracticeBundleRef
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.score_access.policy import ScoreAction
from app.modules.practice.score.compiler.stable_ids import prepare_musicxml_ids_for_practice
from app.modules.practice.score.compiler.musicxml import compile_practice_score

FIXTURE = Path(__file__).parent / "fixtures/musicxml/bundle-multi-part.musicxml"


def test_content_compilation_uses_exact_prepared_notation_once():
    with (
        patch(
            "app.modules.practice.bundle.compiler.prepare_musicxml_ids_for_practice",
            wraps=prepare_musicxml_ids_for_practice,
        ) as prepare,
        patch(
            "app.modules.practice.bundle.compiler.compile_practice_score",
            wraps=compile_practice_score,
        ) as compile_score,
    ):
        bundle = PracticeBundleCompiler().compile(canonical_musicxml=FIXTURE.read_bytes())
    prepare.assert_called_once()
    compile_score.assert_called_once_with(bundle.prepared_musicxml.data)
    ids = {
        n.attrib["id"]
        for n in ET.fromstring(bundle.prepared_musicxml.data).iter("note")
        if "id" in n.attrib
    }
    assert {n["renderNoteId"] for n in bundle.artifact.value["notes"]} <= ids
    assert not {"scoreId", "revisionId"} & bundle.artifact.value.keys()
    detached = bundle.artifact.value
    detached["notes"].clear()
    assert bundle.artifact.value["notes"]


def test_content_identity_is_deterministic_and_binds_both_exact_representations():
    first = PracticeBundleCompiler().compile(canonical_musicxml=FIXTURE.read_bytes())
    second = PracticeBundleCompiler().compile(canonical_musicxml=FIXTURE.read_bytes())
    assert first == second
    assert first.bundle_id == second.bundle_id
    assert first.artifact.representation.data == second.artifact.representation.data
    changed = replace(
        first,
        prepared_musicxml=PracticeBundleRepresentation(
            first.prepared_musicxml.data + b"\n", first.prepared_musicxml.mime_type
        ),
    )
    assert changed.bundle_id != first.bundle_id
    changed = replace(
        first,
        artifact=replace(
            first.artifact,
            representation=PracticeBundleRepresentation(
                first.artifact.representation.data + b"\n", "application/json"
            ),
        ),
    )
    assert changed.bundle_id != first.bundle_id


def test_bound_revision_reads_without_compiler_canonical_lookup_or_materialization():
    bundle = PracticeBundleCompiler().compile(canonical_musicxml=FIXTURE.read_bytes())
    ref = PracticeBundleRef(1, bundle.bundle_id, bundle.artifact.artifact_id)
    repository = Mock(read_bound=Mock(return_value=(ref, bundle)))
    compiler = Mock()
    storage = Mock()
    assets = Mock(canonical_source=Mock())
    access = SimpleNamespace(
        score=SimpleNamespace(id=10, score_uuid="score-A", display_title="Title"),
        revision=SimpleNamespace(id=20, revision_uuid="rev-A"),
    )
    service = PracticeBundleService(
        repository=repository,
        compiler=compiler,
        storage=storage,
        asset_repository=assets,
        access_policy=Mock(authorize=Mock(return_value=access)),
    )
    db = Mock()
    with patch(
        "app.modules.practice.bundle.service.lock_live_practice_mutation_access",
        Mock(side_effect=AssertionError("Ordinary read must not acquire mutation admission")),
    ):
        read = service.read_bundle(db, "score-A", 1, "rev-A", include_notation=True)
    assert read.binding.model_dump() == {
        "score_id": "score-A",
        "revision_id": "rev-A",
        "bundle_id": bundle.bundle_id,
    }
    service.access_policy.authorize.assert_called_once_with(
        db, "score-A", ScoreAction.PRACTICE, user_id=1, revision_uuid="rev-A"
    )
    repository.read_bound.assert_called_once_with(db, 20)
    repository.read_bound_for_update.assert_not_called()
    db.commit.assert_not_called()
    db.rollback.assert_not_called()
    assert read.artifact.artifactId == bundle.artifact.artifact_id
    compiler.compile.assert_not_called()
    assets.canonical_source.assert_not_called()
    storage.read_bytes.assert_not_called()
    storage.materialize_to_local.assert_not_called()


@pytest.mark.asyncio
async def test_unbound_revision_compiles_once_then_reads_existing_binding():
    bundle = PracticeBundleCompiler().compile(canonical_musicxml=FIXTURE.read_bytes())
    ref = PracticeBundleRef(1, bundle.bundle_id, bundle.artifact.artifact_id)
    repository = Mock(
        read_bound=Mock(side_effect=[None, (ref, bundle)]),
        get_or_create=Mock(return_value=(ref, bundle)),
    )
    compiler = Mock(compile=Mock(return_value=bundle))
    storage = Mock(read_bytes=Mock(return_value=FIXTURE.read_bytes()))
    assets = Mock(
        canonical_source=Mock(
            return_value=SimpleNamespace(
                stored_object=object_from_bytes(
                    object_key="canonical.xml", content=b"xml", content_type="application/xml"
                )
            )
        )
    )
    assets.canonical_source.return_value.stored_object.id = 1
    access = SimpleNamespace(
        score=SimpleNamespace(id=10, score_uuid="score-A", display_title="Title"),
        revision=SimpleNamespace(id=20, revision_uuid="rev-A"),
    )
    service = PracticeBundleService(
        repository=repository,
        compiler=compiler,
        storage=storage,
        asset_repository=assets,
        access_policy=Mock(authorize=Mock(return_value=access)),
    )
    with patch(
        "app.modules.practice.bundle.service.lock_live_practice_mutation_access",
        Mock(return_value=access),
    ) as mutation:

        def bind(db, candidate, *, revision_id, reauthorize):
            assert candidate is bundle and revision_id == 20
            mutation.assert_called_once()
            compiler.compile.assert_called_once()
            # A durable creation-lease commit requires a fresh mutation admission.
            reauthorize()
            return ref, bundle

        repository.get_or_create.side_effect = bind
        service.read_bundle(Mock(), "score-A", 1, "rev-A")
        service.read_bundle(Mock(), "score-A", 1, "rev-A")
    assert mutation.call_count == 2
    assert service.access_policy.authorize.call_count == 2
    compiler.compile.assert_called_once_with(canonical_musicxml=FIXTURE.read_bytes())
    assets.canonical_source.assert_called_once()
    storage.read_bytes.assert_called_once_with("canonical.xml")


def test_unbound_revision_reauthorization_failure_prevents_binding_mutation():
    from app.core.exceptions import UnauthorizedException
    from app.shared.constants import ErrorCode

    bundle = PracticeBundleCompiler().compile(canonical_musicxml=FIXTURE.read_bytes())
    access = SimpleNamespace(
        score=SimpleNamespace(id=10, score_uuid="score-A", display_title="Title"),
        revision=SimpleNamespace(id=20, revision_uuid="rev-A"),
    )
    repository = Mock(read_bound=Mock(return_value=None), get_or_create=Mock())
    compiler = Mock(compile=Mock(return_value=bundle))
    policy = Mock(authorize=Mock(return_value=access))
    service = PracticeBundleService(
        repository=repository,
        compiler=compiler,
        access_policy=policy,
        storage=Mock(read_bytes=Mock(return_value=FIXTURE.read_bytes())),
        asset_repository=Mock(
            canonical_source=Mock(
                return_value=SimpleNamespace(
                    stored_object=object_from_bytes(
                        object_key="canonical.xml", content=b"xml", content_type="application/xml"
                    )
                )
            )
        ),
    )
    service.asset_repository.canonical_source.return_value.stored_object.id = 1
    with patch(
        "app.modules.practice.bundle.service.lock_live_practice_mutation_access",
        Mock(side_effect=UnauthorizedException(ErrorCode.NO_PRACTICE_ACCESS)),
    ):
        with pytest.raises(UnauthorizedException):
            service.read_bundle(Mock(), "score-A", 1, "rev-A")
    compiler.compile.assert_called_once()
    repository.get_or_create.assert_not_called()
