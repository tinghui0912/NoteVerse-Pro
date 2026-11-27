"""Closed identity, retained owner history and fresh invitations on PostgreSQL."""

from tests.support.uploads import settled_upload_session

from app.composition import storage_resources as _resource_wiring

from datetime import timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.security import get_password_hash
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models import (
    User,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRenderAsset,
    ScorePlaybackAsset,
    ScoreRevisionNote,
    ScoreRevisionEvent,
    StoredObject,
    Upload,
    ScoreInvite,
    ScoreMembership,
    MailOutbox,
    MailOutboxStatus,
    StorageUsageAccount,
    AccountDeletionPhase,
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory as Category
from app.db.models.score_access import InviteTerminalOutcome as Outcome, MembershipRole
from app.modules.account.deletion_service import AccountDeletionService
from app.composition.account_deletion import AccountDeletionExecutor
from app.composition.storage_inventory import build_storage_inventory_registry
from app.composition.storage_resources import storage_usage_service as usage
from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.schemas import InviteCreateRequest
from app.modules.collaboration.invite_lifecycle import hash_invite_token
from app.modules.collaboration.mail_lifecycle import close_account_collaboration_data
from app.modules.mail.outbox_service import queue_mail
from app.db.models.mail_outbox import MailSourceKind
from app.modules.durable_work.delivery import DeliveryAttemptLease
from app.shared.time import utc_now
from tests.support.storage_state import provision_storage_users
from app.runtime.customer_api.context import get_context
from tests.support.runtime_resources import deliveries
from app.modules.auth.sessions_service import SessionService
from app.platform.config.account_deletion import AccountDeletionSettings
from app.platform.config.application import AccountEmailConfig
from app.platform.config.application import CustomerAuthConfig
from app.platform.config.application import InvitationConfig
from tests.support.runtime_resources import resources_for

settings = get_context().settings


@pytest.fixture
def collaboration_accounts(postgres_engine):
    with Session(postgres_engine) as db:
        for name in ("alice", "bob", "carol"):
            db.add(
                User(
                    email=f"{name}@example.com",
                    display_name=name,
                    password_hash=get_password_hash("secret123"),
                )
            )
        db.flush()
        provision_storage_users(db)
        score = Score(score_uuid="bob-score", owner_user_id=2, display_title="Bob continuity")
        db.add(score)
        db.flush()
        revision = ScoreRevision(
            revision_uuid="bob-revision",
            score_id=score.id,
            revision_number=1,
            content_hash="a" * 64,
            origin="IMPORT",
            created_by_user_id=1,
        )
        db.add(revision)
        db.flush()
        score.head_revision_id = revision.id
        objects = []
        for n, size in enumerate((10, 5, 7)):
            obj = StoredObject(
                object_key=f"bob-resource-{n}",
                byte_size=size,
                sha256=str(n) * 64,
                content_type="application/octet-stream",
            )
            db.add(obj)
            db.flush()
            objects.append(obj.id)
        db.add(
            ScoreRevisionSource(
                source_uuid="bob-source",
                revision_id=revision.id,
                format="MUSICXML",
                stored_object_id=objects[0],
                filename="score.musicxml",
                generator="test",
                generator_version="1",
            )
        )
        db.add(
            ScoreRenderAsset(
                asset_uuid="bob-render",
                revision_id=revision.id,
                kind="RENDERED_PAGE",
                stored_object_id=objects[1],
                filename="page.png",
                page_number=1,
                render_profile="test",
                generator="test",
                generator_version="1",
            )
        )
        db.add(
            ScorePlaybackAsset(
                asset_uuid="bob-audio",
                revision_id=revision.id,
                kind="AUDIO",
                stored_object_id=objects[2],
                filename="score.wav",
                source_fingerprint="a" * 64,
                generator="test",
                generator_version="1",
            )
        )
        db.add(
            ScoreRevisionNote(
                score_id=score.id,
                revision_id=revision.id,
                note="Bob historical note",
                author_user_id=1,
            )
        )
        db.add(
            ScoreRevisionEvent(
                score_id=score.id,
                revision_id=revision.id,
                target_revision_id=revision.id,
                type="RESTORE",
                actor_user_id=1,
                note="Bob history",
            )
        )
        db.add(
            ScoreMembership(
                score_id=score.id, user_id=3, role=MembershipRole.PRACTITIONER, created_by_user_id=2
            )
        )
        for category, size in (
            (Category.SOURCE, 10),
            (Category.DERIVED_RENDER, 5),
            (Category.DERIVED_AUDIO, 7),
        ):
            usage.record_allocation(
                db, user_id=2, category=category, bytes_count=size, reason="seed"
            )
        db.commit()
    return postgres_engine


def seed_invite(
    db,
    *,
    creator=2,
    email="alice@example.com",
    outcome=None,
    expired=False,
    created_at=None,
    actor=None,
):
    token = str(uuid4())
    now = utc_now()
    row = ScoreInvite(
        score_id=db.scalar(select(Score.id).where(Score.score_uuid == "bob-score")),
        token_hash=hash_invite_token(token),
        email=email,
        created_by_user_id=creator,
        role=MembershipRole.EDITOR,
        created_at=created_at or now - timedelta(hours=1),
        expires_at=now - timedelta(seconds=1) if expired else now + timedelta(days=1),
        terminal_outcome=outcome,
        terminal_at=now - timedelta(minutes=30) if outcome else None,
        terminal_actor_user_id=actor if outcome else None,
    )
    db.add(row)
    db.flush()
    mail = queue_mail(
        db,
        category="score.invite",
        source_kind=MailSourceKind.SCORE_INVITE,
        source_id=row.id,
        dedupe_key=f"score-invite:{row.invite_uuid}",
        recipient=email,
        subject="Invitation",
        text_body=f"Credential {token}",
        html_body=f"<p>{token}</p>",
        expires_at=row.expires_at,
    )
    return row, mail, token


def close_account(engine):
    with Session(engine) as db:
        identity = AccountDeletionService(
            session_service=SessionService(
                config=CustomerAuthConfig.model_validate(get_context().settings.model_dump())
            )
        ).request_deletion(db, 1, current_password="secret123")
        db.commit()
        return identity


def erasure_unit(engine, identity):
    with Session(engine) as db:
        lease = deliveries().account_deletion.claim(db, identity)
        db.commit()
    assert lease is not None
    with Session(engine) as db:
        completed = AccountDeletionExecutor(
            build_storage_inventory_registry(),
            resources=resources_for(),
            delivery=deliveries().account_deletion,
            config=AccountDeletionSettings.model_validate(get_context().settings.model_dump()),
        ).execute(db, lease)
        db.commit()
        return completed


def drain(engine, identity):
    for _ in range(80):
        if erasure_unit(engine, identity):
            return
    pytest.fail("Account erasure failed to reach completion")


def assert_bob_graph(db):
    assert db.scalar(select(Score).where(Score.score_uuid == "bob-score")).deleted_at is None
    assert db.scalar(select(ScoreRevision).where(ScoreRevision.revision_uuid == "bob-revision"))
    assert db.scalar(
        select(ScoreRevisionSource).where(ScoreRevisionSource.source_uuid == "bob-source")
    )
    assert db.scalar(select(ScoreRenderAsset).where(ScoreRenderAsset.asset_uuid == "bob-render"))
    assert db.scalar(select(ScorePlaybackAsset).where(ScorePlaybackAsset.asset_uuid == "bob-audio"))
    assert db.scalar(select(ScoreRevisionNote)).note == "Bob historical note"
    assert db.scalar(select(ScoreRevisionEvent)).note == "Bob history"
    member = db.scalar(select(ScoreMembership).where(ScoreMembership.user_id == 3))
    assert member.role == MembershipRole.PRACTITIONER and member.revoked_at is None


@pytest.mark.parametrize("expired", [False, True])
def test_recipient_closure_scrubs_pending_and_expired_invites_preserving_owner_graph(
    collaboration_accounts, expired
):
    engine = collaboration_accounts
    with Session(engine) as db:
        row, mail, token = seed_invite(db, expired=expired)
        uuid, mail_id = row.invite_uuid, mail.id
        db.commit()
    operation = close_account(engine)
    with Session(engine) as db:
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == uuid))
        assert row.terminal_outcome == Outcome.RECIPIENT_ACCOUNT_CLOSED
        assert row.terminal_at == db.get(User, 1).deleted_at and row.terminal_actor_user_id is None
        assert row.email is row.token_hash is None
        mail = db.get(MailOutbox, mail_id)
        assert mail.status == MailOutboxStatus.CANCELLED and mail.attempt_token is None
        assert mail.recipient == mail.subject == "" and mail.text_body is mail.html_body is None
        assert_bob_graph(db)
        with pytest.raises(ResourceNotFoundException):
            InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).accept_invite(db, token, 1)
    drain(engine, operation)
    with Session(engine) as db:
        assert db.get(User, 1) is None
        assert_bob_graph(db)
        assert db.get(StorageUsageAccount, 2).used_bytes == 10
        assert db.scalar(select(ScoreRevision)).created_by_user_id is None
        assert db.scalar(select(ScoreRevisionNote)).author_user_id is None


@pytest.mark.parametrize("outcome", [Outcome.ACCEPTED, Outcome.DECLINED, Outcome.REVOKED])
def test_existing_business_outcomes_survive_contact_and_actor_anonymization(
    collaboration_accounts, outcome
):
    with Session(collaboration_accounts) as db:
        row, _, _ = seed_invite(db, outcome=outcome, actor=1)
        uuid, at = row.invite_uuid, row.terminal_at
        db.commit()
    operation = close_account(collaboration_accounts)
    drain(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == uuid))
        assert row.terminal_outcome == outcome and row.terminal_at == at
        assert row.email is row.token_hash is row.terminal_actor_user_id is None
        assert row.created_by_user_id == 2
        assert_bob_graph(db)


@pytest.mark.parametrize("outcome", [None, Outcome.ACCEPTED, Outcome.DECLINED, Outcome.REVOKED])
def test_closed_inviter_preserves_foreign_membership_and_history(collaboration_accounts, outcome):
    with Session(collaboration_accounts) as db:
        row, _, _ = seed_invite(db, creator=1, email="carol@example.com", outcome=outcome, actor=1)
        uuid, at = row.invite_uuid, row.terminal_at
        member = db.scalar(select(ScoreMembership).where(ScoreMembership.user_id == 3))
        member.created_by_user_id = 1
        db.commit()
    operation = close_account(collaboration_accounts)
    with Session(collaboration_accounts) as db:
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == uuid))
        assert row.terminal_outcome == (outcome or Outcome.INVITER_ACCOUNT_CLOSED)
        if outcome:
            assert row.terminal_at == at
        assert (
            row.email
            is row.token_hash
            is row.created_by_user_id
            is row.terminal_actor_user_id
            is None
        )
        assert (
            db.scalar(
                select(ScoreMembership).where(ScoreMembership.user_id == 3)
            ).created_by_user_id
            is None
        )
        assert_bob_graph(db)
    drain(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        assert db.get(User, 1) is None
        assert_bob_graph(db)


def test_recipient_outcome_has_priority_and_cutoff_is_inclusive(
    collaboration_accounts, monkeypatch
):
    now = utc_now()
    with Session(collaboration_accounts) as db:
        old, _, _ = seed_invite(db, creator=1, created_at=now)
        future, _, _ = seed_invite(db, created_at=now + timedelta(microseconds=1))
        first, second = old.id, future.id
        db.commit()
    monkeypatch.setattr("app.modules.account.deletion_service.utc_now", lambda: now)
    operation = close_account(collaboration_accounts)
    drain(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        assert db.get(ScoreInvite, first).terminal_outcome == Outcome.RECIPIENT_ACCOUNT_CLOSED
        new = db.get(ScoreInvite, second)
        assert new.terminal_outcome is None and new.email == "alice@example.com" and new.token_hash


def test_same_email_registration_gets_only_new_invitation_and_role(
    collaboration_accounts, monkeypatch
):
    from app.modules.auth.email_verification_service import EmailVerificationService
    from app.modules.auth.schemas import RegisterRequest, VerifyEmailRequest

    with Session(collaboration_accounts) as db:
        old, _, token = seed_invite(db)
        old_uuid = old.invite_uuid
        InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ).accept_invite(db, token, 1)
        db.commit()
    operation = close_account(collaboration_accounts)
    with Session(collaboration_accounts) as db:
        closed_at = db.get(User, 1).deleted_at
        fresh = InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ).create_invite(
            db,
            "bob-score",
            2,
            InviteCreateRequest(email="alice@example.com", role=MembershipRole.VIEWER),
        )
        db.commit()
        new = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == fresh.invite_id))
        assert new.created_at > closed_at and new.expires_at - new.created_at == timedelta(days=7)
        assert fresh.token != token and fresh.invite_id != old_uuid
        assert new.token_hash == hash_invite_token(fresh.token)
        assert (
            db.scalar(
                select(MailOutbox).where(
                    MailOutbox.source_id == new.id, MailOutbox.source_kind == "SCORE_INVITE"
                )
            ).expires_at
            == new.expires_at
        )
    drain(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        assert db.get(User, 1) is None
        assert db.scalar(select(ScoreMembership).where(ScoreMembership.user_id == 1)) is None
        verification = EmailVerificationService(
            provision_storage=_resource_wiring.provision_storage_resources,
            config=AccountEmailConfig.model_validate(get_context().settings.model_dump()),
        )
        monkeypatch.setattr(verification, "_new_token", lambda: "fresh-registration")
        verification.register(
            db,
            RegisterRequest(
                email="alice@example.com",
                password="newsecret123",
                display_name="New Alice",
                locale="en",
            ),
        )
        new_user = verification.verify_email(db, VerifyEmailRequest(token="fresh-registration"))
        assert new_user.id != 1
        with pytest.raises(ResourceNotFoundException):
            InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).accept_invite(db, token, new_user.id)
        with pytest.raises(ValidationException):
            InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).accept_pending_invite(db, old_uuid, new_user.id)
        InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ).accept_invite(db, fresh.token, new_user.id)
        db.commit()
        member = db.scalar(select(ScoreMembership).where(ScoreMembership.user_id == new_user.id))
        assert member.role == MembershipRole.VIEWER
        assert_bob_graph(db)


@pytest.mark.parametrize(
    "status",
    [
        MailOutboxStatus.PENDING,
        MailOutboxStatus.DISPATCHED,
        MailOutboxStatus.PROCESSING,
        MailOutboxStatus.FAILED,
        MailOutboxStatus.SENT,
    ],
)
def test_closure_cancels_delivery_capability_without_claiming_provider_recall(
    collaboration_accounts, status
):
    with Session(collaboration_accounts) as db:
        _, mail, _ = seed_invite(db)
        mail.status = status
        mail.attempt_count = 1
        mail.attempt_token = "old-lease" if status == MailOutboxStatus.PROCESSING else None
        mail.provider_message_id = "provider-message"
        uuid = mail.outbox_uuid
        db.commit()
    close_account(collaboration_accounts)
    with Session(collaboration_accounts) as db:
        row = db.scalar(select(MailOutbox).where(MailOutbox.outbox_uuid == uuid))
        assert row.status == (
            MailOutboxStatus.SENT if status == MailOutboxStatus.SENT else MailOutboxStatus.CANCELLED
        )
        assert (
            row.attempt_token is row.text_body is row.html_body is row.provider_message_id is None
        )
        assert row.recipient == row.subject == "" and row.dedupe_key == f"erased:{uuid}"
        lease = DeliveryAttemptLease(attempt=1, token="old-lease")
        assert not deliveries().mail.sent(db, uuid, "late-result", lease=lease)
        assert not deliveries().mail.transient_failure(db, uuid, "late failure", lease=lease)
        assert deliveries().mail.claim(db, uuid) is None


def test_closure_rollback_preserves_invite_and_mail(collaboration_accounts):
    with Session(collaboration_accounts) as db:
        row, mail, _ = seed_invite(db)
        row_id, mail_id = row.id, mail.id
        db.commit()
        AccountDeletionService(
            session_service=SessionService(
                config=CustomerAuthConfig.model_validate(get_context().settings.model_dump())
            )
        ).request_deletion(db, 1, current_password="secret123")
        db.rollback()
        row = db.get(ScoreInvite, row_id)
        assert row.terminal_outcome is None and row.email == "alice@example.com" and row.token_hash
        assert db.get(MailOutbox, mail_id).status == MailOutboxStatus.PENDING
        assert db.get(User, 1).deleted_at is None


def test_finalization_cleans_late_issuer_in_bounded_units_but_keeps_new_recipient_invites(
    collaboration_accounts, monkeypatch
):
    from app.db.models import AccountDeletionOperation

    operation = close_account(collaboration_accounts)
    with Session(collaboration_accounts) as db:
        closed_at = db.get(User, 1).deleted_at
        late = []
        for n in range(5):
            row, _, _ = seed_invite(
                db,
                creator=1,
                email="carol@example.com",
                created_at=closed_at + timedelta(seconds=1),
            )
            late.append(row.id)
        fresh = InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ).create_invite(db, "bob-score", 2, InviteCreateRequest(email="alice@example.com"))
        db.scalar(select(AccountDeletionOperation)).phase = AccountDeletionPhase.FINALIZE
        db.commit()
    monkeypatch.setattr(settings, "ACCOUNT_DELETION_RESOURCE_BATCH_SIZE", 2)
    assert not erasure_unit(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(ScoreInvite)
                .where(ScoreInvite.created_by_user_id == 1)
            )
            == 3
        )
    drain(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        assert db.get(User, 1) is None
        assert all(
            db.get(ScoreInvite, n).terminal_outcome == Outcome.INVITER_ACCOUNT_CLOSED for n in late
        )
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == fresh.invite_id))
        assert row.email == "alice@example.com" and row.token_hash and row.terminal_outcome is None
        assert_bob_graph(db)


@pytest.mark.parametrize("creator", [None, 1])
def test_invitation_commands_fail_closed_for_missing_or_inactive_creator(
    collaboration_accounts, creator
):
    with Session(collaboration_accounts) as db:
        row, _, token = seed_invite(db, creator=creator, email="carol@example.com")
        if creator:
            db.get(User, creator).is_active = False
        db.commit()
        assert (
            InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            )
            .list_my_pending_invites(db, 3)
            .items
            == []
        )
        for command in [
            lambda: InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).inspect_invite(db, token, 3),
            lambda: InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).accept_invite(db, token, 3),
            lambda: InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).decline_pending_invite(db, row.invite_uuid, 3),
        ]:
            with pytest.raises(ValidationException):
                command()
        assert db.get(ScoreInvite, row.id).terminal_outcome is None
        assert_bob_graph(db)


@pytest.mark.parametrize("delta", [timedelta(), timedelta(seconds=-1)])
def test_new_invites_cannot_be_expired_at_admission(collaboration_accounts, delta):
    with Session(collaboration_accounts) as db:
        with pytest.raises(ValidationException):
            InvitationService(
                config=InvitationConfig.model_validate(get_context().settings.model_dump())
            ).create_invite(
                db,
                "bob-score",
                2,
                InviteCreateRequest(email="new@example.com", expires_at=utc_now() + delta),
            )
        db.rollback()
        assert db.scalar(select(func.count()).select_from(ScoreInvite)) == 0
        assert db.scalar(select(func.count()).select_from(MailOutbox)) == 0


def test_explicit_future_expiry_is_shared_with_outbox(collaboration_accounts):
    expires = utc_now() + timedelta(hours=2)
    with Session(collaboration_accounts) as db:
        created = InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ).create_invite(
            db, "bob-score", 2, InviteCreateRequest(email="new@example.com", expires_at=expires)
        )
        db.commit()
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == created.invite_id))
        assert row.expires_at == expires
        assert db.scalar(select(MailOutbox)).expires_at == expires


def test_owned_score_uses_domain_deletion_without_releasing_shared_object_twice(
    collaboration_accounts,
):
    from app.db.models import StoredObjectRetirement

    with Session(collaboration_accounts) as db:
        shared = StoredObject(
            object_key="shared-source-upload",
            byte_size=13,
            sha256="f" * 64,
            content_type="application/octet-stream",
        )
        db.add(shared)
        db.flush()
        shared_id = shared.id
        own = Score(score_uuid="alice-score", owner_user_id=1, display_title="Alice owned")
        db.add(own)
        db.flush()
        revision = ScoreRevision(
            revision_uuid="alice-revision",
            score_id=own.id,
            revision_number=1,
            content_hash="f" * 64,
            origin="IMPORT",
            created_by_user_id=1,
        )
        db.add(revision)
        db.flush()
        own.head_revision_id = revision.id
        db.add(
            ScoreRevisionSource(
                source_uuid="alice-source",
                revision_id=revision.id,
                format="MUSICXML",
                stored_object_id=shared_id,
                filename="score.musicxml",
                generator="test",
                generator_version="1",
            )
        )
        db.add(
            Upload(
                upload_session=settled_upload_session(user_id=2),
                upload_uuid="bob-shared-upload",
                uploader_user_id=2,
                original_filename="upload.xml",
                stored_object_id=shared_id,
            )
        )
        usage.record_allocation(
            db, user_id=1, category=Category.SOURCE, bytes_count=13, reason="seed"
        )
        usage.record_allocation(
            db, user_id=2, category=Category.UPLOAD, bytes_count=13, reason="seed"
        )
        db.commit()
    operation = close_account(collaboration_accounts)
    drain(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        assert db.scalar(select(Score).where(Score.score_uuid == "alice-score")) is None
        assert (
            db.scalar(select(ScoreRevision).where(ScoreRevision.revision_uuid == "alice-revision"))
            is None
        )
        assert db.get(StoredObject, shared_id) is not None
        assert (
            db.scalar(select(Upload).where(Upload.upload_uuid == "bob-shared-upload")) is not None
        )
        assert (
            db.scalar(
                select(StoredObjectRetirement).where(
                    StoredObjectRetirement.stored_object_id == shared_id
                )
            )
            is None
        )
        assert db.get(StorageUsageAccount, 2).used_bytes == 23
        assert db.get(StorageUsageAccount, 1) is None
        assert_bob_graph(db)


def test_closure_processes_contact_batches_in_one_atomic_request(collaboration_accounts):
    with Session(collaboration_accounts) as db:
        score_id = db.scalar(select(Score.id))
        db.add_all(
            [
                ScoreInvite(
                    score_id=score_id,
                    token_hash=f"{n:064x}",
                    email="alice@example.com",
                    created_by_user_id=2,
                    role=MembershipRole.VIEWER,
                )
                for n in range(501)
            ]
        )
        db.commit()
        identity = AccountDeletionService(
            session_service=SessionService(
                config=CustomerAuthConfig.model_validate(get_context().settings.model_dump())
            )
        ).request_deletion(db, 1, current_password="secret123")
        assert (
            db.scalar(
                select(func.count())
                .select_from(ScoreInvite)
                .where(ScoreInvite.terminal_outcome == Outcome.RECIPIENT_ACCOUNT_CLOSED)
            )
            == 501
        )
        db.rollback()
        assert (
            db.scalar(
                select(func.count())
                .select_from(ScoreInvite)
                .where(ScoreInvite.terminal_outcome.is_(None))
            )
            == 501
        )
        assert db.get(User, 1).deleted_at is None
        identity = AccountDeletionService(
            session_service=SessionService(
                config=CustomerAuthConfig.model_validate(get_context().settings.model_dump())
            )
        ).request_deletion(db, 1, current_password="secret123")
        db.commit()
    drain(collaboration_accounts, identity)
    with Session(collaboration_accounts) as db:
        assert db.get(User, 1) is None
        assert (
            db.scalar(
                select(func.count())
                .select_from(ScoreInvite)
                .where(ScoreInvite.email.is_(None), ScoreInvite.token_hash.is_(None))
            )
            == 501
        )


def test_contact_cleanup_is_repeatable_and_preserves_new_recipient_rows(collaboration_accounts):
    with Session(collaboration_accounts) as db:
        old, _, _ = seed_invite(db)
        old_id = old.id
        db.commit()
    close_account(collaboration_accounts)
    with Session(collaboration_accounts) as db:
        user = db.get(User, 1)
        fresh = InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ).create_invite(db, "bob-score", 2, InviteCreateRequest(email="alice@example.com"))
        db.commit()
        assert not close_account_collaboration_data(
            db, user_id=1, email=user.email, closed_at=user.deleted_at, limit=10
        )
        db.commit()
        assert not close_account_collaboration_data(
            db, user_id=1, email=user.email, closed_at=user.deleted_at, limit=10
        )
        db.commit()
        assert db.get(ScoreInvite, old_id).terminal_outcome == Outcome.RECIPIENT_ACCOUNT_CLOSED
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == fresh.invite_id))
        assert row.terminal_outcome is None and row.email == "alice@example.com" and row.token_hash


@pytest.mark.parametrize(
    "outcome,email,token,actor,at,error",
    [
        (None, None, None, None, False, "ck_score_invites_contact_facts"),
        (
            Outcome.ACCEPTED,
            "person@example.com",
            None,
            None,
            True,
            "ck_score_invites_contact_facts",
        ),
        (
            Outcome.RECIPIENT_ACCOUNT_CLOSED,
            "person@example.com",
            "d" * 64,
            None,
            True,
            "ck_score_invites_closed_facts",
        ),
        (
            Outcome.INVITER_ACCOUNT_CLOSED,
            None,
            None,
            None,
            False,
            "ck_score_invites_terminal_facts",
        ),
        (Outcome.INVITER_ACCOUNT_CLOSED, None, None, 1, True, "ck_score_invites_closed_facts"),
        (Outcome.INVITER_ACCOUNT_CLOSED, None, None, None, True, "ck_score_invites_closed_facts"),
    ],
)
def test_database_enforces_contact_and_system_terminal_facts(
    collaboration_accounts, outcome, email, token, actor, at, error
):
    from sqlalchemy.exc import IntegrityError

    with Session(collaboration_accounts) as db:
        row = ScoreInvite(
            score_id=db.scalar(select(Score.id)),
            email=email,
            token_hash=token,
            created_by_user_id=None if outcome == Outcome.INVITER_ACCOUNT_CLOSED and not at else 2,
            role=MembershipRole.VIEWER,
            terminal_outcome=outcome,
            terminal_actor_user_id=actor,
            terminal_at=utc_now() if at else None,
        )
        db.add(row)
        with pytest.raises(IntegrityError, match=error):
            db.flush()
        db.rollback()
        assert_bob_graph(db)


def test_anonymous_terminal_records_allow_null_hashes_but_nonnull_hash_stays_unique(
    collaboration_accounts,
):
    from sqlalchemy.exc import IntegrityError

    with Session(collaboration_accounts) as db:
        score_id = db.scalar(select(Score.id))
        for _ in range(2):
            db.add(
                ScoreInvite(
                    score_id=score_id,
                    terminal_outcome=Outcome.ACCEPTED,
                    terminal_at=utc_now(),
                    email=None,
                    token_hash=None,
                    created_by_user_id=None,
                    role=MembershipRole.VIEWER,
                )
            )
        db.commit()
        assert db.scalar(select(func.count()).select_from(ScoreInvite)) == 2
        row, _, _ = seed_invite(db)
        db.commit()
        with pytest.raises(IntegrityError, match="idx_score_invites_token_hash"):
            with db.begin_nested():
                db.add(
                    ScoreInvite(
                        score_id=score_id,
                        email="other@example.com",
                        token_hash=row.token_hash,
                        created_by_user_id=2,
                        role=MembershipRole.VIEWER,
                    )
                )
                db.flush()


def test_actor_only_anonymization_preserves_another_recipients_contact(collaboration_accounts):
    with Session(collaboration_accounts) as db:
        row, mail, _ = seed_invite(db, email="carol@example.com", outcome=Outcome.DECLINED, actor=1)
        uuid, at = row.invite_uuid, row.terminal_at
        mail.status = MailOutboxStatus.SENT
        mail.completed_at = utc_now()
        db.commit()
    operation = close_account(collaboration_accounts)
    drain(collaboration_accounts, operation)
    with Session(collaboration_accounts) as db:
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == uuid))
        assert row.terminal_outcome == Outcome.DECLINED and row.terminal_at == at
        assert row.terminal_actor_user_id is None and row.created_by_user_id == 2
        assert row.email == "carol@example.com" and row.token_hash
        mail = db.scalar(
            select(MailOutbox).where(
                MailOutbox.source_id == row.id, MailOutbox.source_kind == "SCORE_INVITE"
            )
        )
        assert mail.status == MailOutboxStatus.SENT and mail.recipient == "carol@example.com"
        assert_bob_graph(db)


def test_default_expiry_uses_the_configured_policy(collaboration_accounts, monkeypatch):

    monkeypatch.setattr(settings, "SCORE_INVITE_TTL_DAYS", 3)
    with Session(collaboration_accounts) as db:
        created = InvitationService(
            config=InvitationConfig.model_validate(get_context().settings.model_dump())
        ).create_invite(db, "bob-score", 2, InviteCreateRequest(email="new@example.com"))
        db.commit()
        row = db.scalar(select(ScoreInvite).where(ScoreInvite.invite_uuid == created.invite_id))
        assert row.expires_at - row.created_at == timedelta(days=3)
        assert db.scalar(select(MailOutbox)).expires_at == row.expires_at


def test_owner_history_http_serializes_anonymous_contact_and_system_outcome(collaboration_accounts):
    from fastapi.testclient import TestClient
    from app.runtime.customer_api.main import create_app
    from app.platform.db.dependencies import get_db
    from app.runtime.customer_api.deps import get_current_user

    with Session(collaboration_accounts) as db:
        _, _, token = seed_invite(db, creator=1, email="carol@example.com")
        db.commit()
    close_account(collaboration_accounts)
    application = create_app()
    with Session(collaboration_accounts) as db:
        application.dependency_overrides[get_db] = lambda: db
        application.dependency_overrides[get_current_user] = lambda: db.get(User, 2)
        with TestClient(application) as client:
            response = client.get("/api/v1/scores/bob-score/invites")
        assert response.status_code == 200
        row = response.json()["items"][0]
        assert row["status"] == "INVITER_ACCOUNT_CLOSED"
        assert row["email"] is row["created_by"] is row["terminal_actor"] is None
        assert row["terminal_at"] is not None
        assert "token_hash" not in row and token not in response.text
