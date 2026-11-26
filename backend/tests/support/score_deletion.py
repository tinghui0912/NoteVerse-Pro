"""Execute admitted Score deletion operations in service-level fixtures."""

from app.composition import storage_resources as _resource_wiring
from app.composition import media_resources as _media_wiring

from app.modules.scores.deletion_delivery import ScoreDeletionDeliveryService
from app.modules.scores.deletion_executor import ScoreDeletionExecutor, ScoreDeletionResult


def complete_score_deletions(db):
    delivery = ScoreDeletionDeliveryService()
    due = delivery.recover_and_list_due(db)
    db.commit()
    scores, retirements = 0, 0
    for operation_uuid in due:
        lease = delivery.claim(db, operation_uuid)
        db.commit()
        if lease is not None:
            result = ScoreDeletionExecutor(
                delivery,
                input_assets=_media_wiring.build_input_asset_lifecycle(),
                usage=_resource_wiring.storage_usage_service,
            ).execute(db, lease)
            db.commit()
            scores += result.scores_deleted
            retirements += result.object_retirements_queued
    return ScoreDeletionResult(scores, retirements)
