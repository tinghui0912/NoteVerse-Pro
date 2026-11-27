"""A notification page resolves all actors in one query."""

from app.modules.account.resource_users import resource_user_query

from sqlalchemy.orm import Session, joinedload
from pydantic import TypeAdapter
from app.db.models import Notification, NotificationKind, User
from app.modules.notifications.schemas import NotificationActorRead, NotificationRead
from app.modules.account.avatar_presentation import avatar_url_for_user

notification_read_adapter = TypeAdapter(NotificationRead)


class NotificationReadModel:
    def notification_page(self, db: Session, rows: list[Notification]) -> list[NotificationRead]:
        ids = {row.actor_user_id for row in rows if row.actor_user_id is not None}
        actors = (
            {
                row.id: row
                for row in db.scalars(
                    resource_user_query()
                    .options(joinedload(User.avatar_object))
                    .where(User.id.in_(ids))
                )
            }
            if ids
            else {}
        )
        return [self._read(row, actors) for row in rows]

    def _read(self, row: Notification, actors: dict[int, User]) -> NotificationRead:
        common = dict(
            notification_id=row.notification_uuid, read_at=row.read_at, created_at=row.created_at
        )
        fields = {**common, "kind": row.kind}
        if row.kind in {
            NotificationKind.SCORE_INVITE_ACCEPTED,
            NotificationKind.SCORE_INVITE_DECLINED,
            NotificationKind.SCORE_VERSION_CREATED,
        }:
            fields.update(
                actor=actor_read(actors.get(row.actor_user_id)),
                score_id=row.score_id,
                score_display_title=row.score_display_title_snapshot,
            )
            if row.kind == NotificationKind.SCORE_VERSION_CREATED:
                fields["revision_id"] = row.revision_id
            else:
                fields["invite_id"] = row.invite_id
        else:
            fields.update(
                job_id=row.import_job_id, import_display_title=row.import_display_title_snapshot
            )
            if row.kind == NotificationKind.IMPORT_READY_FOR_REVIEW:
                fields.update(
                    score_id=row.score_id, score_display_title=row.score_display_title_snapshot
                )
        return notification_read_adapter.validate_python(fields)


def actor_read(user: User | None) -> NotificationActorRead | None:
    if user is None:
        return None
    return NotificationActorRead(
        display_name=user.display_name, email=user.email, avatar_url=avatar_url_for_user(user)
    )
