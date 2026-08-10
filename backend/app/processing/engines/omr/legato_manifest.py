"""Versioned identity contract for the supported LEGATO OMR release."""

from typing import Final


LEGATO_MANIFEST_SCHEMA_VERSION: Final[int] = 1
OMR_ENGINE_NAME: Final[str] = "legato"
LEGATO_REPOSITORY_URL: Final[str] = "https://github.com/guang-yng/legato.git"
LEGATO_REPO_COMMIT: Final[str] = "179c228d3d5f67113cf739b44891b3abe046f1dc"
LEGATO_MODEL_REPOSITORY: Final[str] = "guangyangmusic/legato"
LEGATO_MODEL_SNAPSHOT: Final[str] = "2d07c5d0e73186f2c0b12e35ea187bbc30dec18c"
LEGATO_PROCESSOR_REPOSITORY: Final[str] = LEGATO_MODEL_REPOSITORY
LEGATO_PROCESSOR_SNAPSHOT: Final[str] = LEGATO_MODEL_SNAPSHOT
LEGATO_VISION_ENCODER_REPOSITORY: Final[str] = "meta-llama/Llama-3.2-11B-Vision"
LEGATO_VISION_ENCODER_SNAPSHOT: Final[str] = "3f2e93603aaa5dd142f27d34b06dfa2b6e97b8be"
HF_MODEL_REPOSITORIES: Final[tuple[str, ...]] = (
    LEGATO_MODEL_REPOSITORY,
    LEGATO_VISION_ENCODER_REPOSITORY,
)


def legato_execution_identity() -> dict[str, object]:
    """Return the source-owned identity of the supported OMR release."""

    return {
        "schema_version": LEGATO_MANIFEST_SCHEMA_VERSION,
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
