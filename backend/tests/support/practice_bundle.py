"""Bind test candidates under the real live Practice mutation authority."""

from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings

from tests.support.runtime_resources import resources_for


from app.db.models import Score, ScoreRevision
from app.modules.practice.bundle.writer import PracticeBundleWriter
from app.modules.practice.bundle.mutation_access import lock_live_practice_mutation_access
from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.practice.bundle.retention import PracticeBundleRetention
from app.runtime.customer_api.context import get_context


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
    return PracticeBundleWriter(
        writes=resources_for(storage).build_object_write_coordinator(),
        retention=PracticeBundleRetention(
            config=StoredObjectRetirementSettings.model_validate(
                get_context().settings.model_dump()
            )
        ),
    ).ensure_binding(
        db,
        candidate,
        revision_id=revision_id,
        reauthorize_mutation=reauthorize_mutation,
    )
