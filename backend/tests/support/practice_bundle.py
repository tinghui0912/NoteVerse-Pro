"""Bind test candidates under the real live Practice mutation authority."""

from app.db.models import Score, ScoreRevision
from app.modules.practice.bundle.writer import PracticeBundleWriter
from app.modules.practice.bundle.mutation_access import lock_live_practice_mutation_access
from app.modules.score_access.policy import ScoreAccessPolicy


def bind_bundle(db, storage, candidate, *, revision_id):
    revision = db.get(ScoreRevision, revision_id)
    score = db.get(Score, revision.score_id)
    user_id, score_uuid, revision_uuid = (
        score.owner_user_id,
        score.score_uuid,
        revision.revision_uuid,
    )

    def reauthorize_mutation():
        lock_live_practice_mutation_access(
            db,
            ScoreAccessPolicy(),
            user_id=user_id,
            score_uuid=score_uuid,
            revision_uuid=revision_uuid,
        )

    reauthorize_mutation()
    return PracticeBundleWriter(storage).ensure_binding(
        db,
        candidate,
        revision_id=revision_id,
        reauthorize_mutation=reauthorize_mutation,
    )
