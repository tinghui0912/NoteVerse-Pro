"""PracticeBundle-owned immutable representation locators."""


def _require_segment(value: str) -> None:
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise ValueError("Object identity must be a nonempty namespace segment")


def practice_bundle_musicxml_object_key(bundle_id: str) -> str:
    _require_segment(bundle_id)
    return f"practice-bundles/{bundle_id}/score.musicxml"


def practice_bundle_artifact_object_key(bundle_id: str) -> str:
    _require_segment(bundle_id)
    return f"practice-bundles/{bundle_id}/artifact.json"
