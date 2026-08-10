from app.processing.engines.omr.legato_manifest import (
    LEGATO_REPO_COMMIT,
    LEGATO_MODEL_REPOSITORY,
    LEGATO_MODEL_SNAPSHOT,
    LEGATO_PROCESSOR_REPOSITORY,
    LEGATO_PROCESSOR_SNAPSHOT,
    LEGATO_VISION_ENCODER_REPOSITORY,
    LEGATO_VISION_ENCODER_SNAPSHOT,
    OMR_ENGINE_NAME,
    legato_execution_identity,
)


def test_legato_execution_identity_is_complete_and_self_consistent() -> None:
    identity = legato_execution_identity()

    assert identity == {
        "schema_version": 1,
        "kind": "omr",
        "engine": OMR_ENGINE_NAME,
        "legato_commit": LEGATO_REPO_COMMIT,
        "model": {"repository": LEGATO_MODEL_REPOSITORY, "snapshot": LEGATO_MODEL_SNAPSHOT},
        "processor": {
            "repository": LEGATO_PROCESSOR_REPOSITORY,
            "snapshot": LEGATO_PROCESSOR_SNAPSHOT,
        },
        "vision_encoder": {
            "repository": LEGATO_VISION_ENCODER_REPOSITORY,
            "snapshot": LEGATO_VISION_ENCODER_SNAPSHOT,
        },
    }
