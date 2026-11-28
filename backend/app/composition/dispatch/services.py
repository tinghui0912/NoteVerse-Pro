"""Process-owned broker relays over the existing durable domain records."""

from dataclasses import dataclass
from celery import Celery
from sqlalchemy.orm import Session, sessionmaker
from app.composition.delivery_services import DispatchDeliveries
from app.composition.dispatch.account_deletion import AccountDeletionDispatcher
from app.composition.dispatch.imports import ImportDispatcher
from app.composition.dispatch.mail import MailDispatcher
from app.composition.dispatch.score_deletion import ScoreDeletionDispatcher
from app.composition.dispatch.write_cleanup import ObjectWriteCleanupDispatcher
from app.composition.dispatch.retirement import StoredObjectRetirementDispatcher
from app.composition.dispatch.render import RevisionRenderDispatcher
from app.composition.dispatch.metadata import RevisionMetadataDispatcher
from app.composition.dispatch.playback import PlaybackDispatcher


@dataclass(frozen=True)
class DispatchServices:
    account_deletion: AccountDeletionDispatcher
    imports: ImportDispatcher
    mail: MailDispatcher
    score_deletion: ScoreDeletionDispatcher
    write_cleanup: ObjectWriteCleanupDispatcher
    retirement: StoredObjectRetirementDispatcher
    render: RevisionRenderDispatcher
    metadata: RevisionMetadataDispatcher
    playback: PlaybackDispatcher


def build_dispatch_services(
    sessions: sessionmaker[Session], deliveries: DispatchDeliveries, sender: Celery
) -> DispatchServices:
    return DispatchServices(
        account_deletion=AccountDeletionDispatcher(sessions, deliveries.account_deletion, sender),
        imports=ImportDispatcher(sessions, deliveries.imports, sender),
        mail=MailDispatcher(sessions, deliveries.mail, sender),
        score_deletion=ScoreDeletionDispatcher(sessions, deliveries.score_deletion, sender),
        write_cleanup=ObjectWriteCleanupDispatcher(sessions, deliveries.write_cleanup, sender),
        retirement=StoredObjectRetirementDispatcher(sessions, deliveries.retirement, sender),
        render=RevisionRenderDispatcher(sessions, deliveries.render, sender),
        metadata=RevisionMetadataDispatcher(sessions, deliveries.metadata, sender),
        playback=PlaybackDispatcher(sessions, deliveries.playback, sender),
    )
