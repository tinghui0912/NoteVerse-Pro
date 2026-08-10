from sqlmodel import SQLModel, Session, create_engine, select

from app.db.execution_manifests import get_or_create_execution_manifest, manifest_sha256
from app.db.models import ExecutionManifest
from app.modules.score_assets.render_execution_manifest import build_render_execution_manifest


def test_render_execution_manifest_is_stable_and_content_addressed() -> None:
    manifest = build_render_execution_manifest()

    assert manifest["kind"] == "render"
    assert manifest["engine"] == "verovio"
    assert manifest_sha256(manifest) == manifest_sha256(dict(reversed(list(manifest.items()))))


def test_render_execution_manifest_reuses_the_normalized_record() -> None:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        first = get_or_create_execution_manifest(session, build_render_execution_manifest())
        second = get_or_create_execution_manifest(session, build_render_execution_manifest())
        session.commit()

        assert first.id == second.id
        assert len(list(session.exec(select(ExecutionManifest)))) == 1
