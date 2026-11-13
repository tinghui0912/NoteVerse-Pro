"""Execute admitted Score deletion operations in service-level fixtures."""

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
            result = ScoreDeletionExecutor(delivery).execute(db, lease)
            db.commit()
            scores += result.scores_deleted
            retirements += result.object_retirements_queued
    return ScoreDeletionResult(scores, retirements)
