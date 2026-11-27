"""Execute admitted Score deletion operations in service-level fixtures."""

from tests.support.runtime_resources import resources_for

from app.composition import storage_resources as _resource_wiring

from app.modules.scores.deletion_delivery import ScoreDeletionDeliveryService
from app.modules.scores.deletion_executor import ScoreDeletionExecutor, ScoreDeletionResult
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings


def complete_score_deletions(db):
    delivery = ScoreDeletionDeliveryService(config=ScoreDeletionDeliverySettings())
    due = delivery.recover_and_list_due(db)
    db.commit()
    scores, retirements = 0, 0
    for operation_uuid in due:
        lease = delivery.claim(db, operation_uuid)
        db.commit()
        if lease is not None:
            result = ScoreDeletionExecutor(
                delivery,
                input_assets=resources_for().build_input_asset_lifecycle(),
                usage=_resource_wiring.storage_usage_service,
            ).execute(db, lease)
            db.commit()
            scores += result.scores_deleted
            retirements += result.object_retirements_queued
    return ScoreDeletionResult(scores, retirements)
