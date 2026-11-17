"""Object identity of canonical immutable revision source bytes."""


def _require_segment(value: str) -> None:
    if not value or value in {".", ".."} or "/" in value or "\\" in value:
        raise ValueError("Object identity must be a nonempty namespace segment")


def canonical_revision_source_object_key(*, score_uuid: str, revision_uuid: str) -> str:
    _require_segment(score_uuid)
    _require_segment(revision_uuid)
    return f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"
