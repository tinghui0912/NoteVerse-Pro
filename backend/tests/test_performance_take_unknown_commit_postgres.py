"""Unknown semantic commits reconcile from independent committed reservation lineage."""

from sqlalchemy.orm import Session
from sqlalchemy import select, func
from sqlalchemy.exc import OperationalError
from unittest.mock import patch
import pytest
from app.db.models import (
    PerformanceTake,
    PerformanceTakeUploadReservation,
    StorageUsageAccount,
    UploadSession,
)
from app.core.exceptions import ExternalServiceException
from tests.test_performance_take_finalization_postgres import setup
from tests.test_upload_reservation_postgres import MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


@pytest.mark.parametrize("committed", [False, True])
@pytest.mark.parametrize("kind", ["runtime", "timeout", "database"])
def test_unknown_commit_uses_fresh_lineage_and_never_duplicates_usage(
    postgres_bundle, committed, kind
):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    opened = []
    factory = service.recovery.sessions

    def fresh():
        db = factory()
        opened.append(db)
        return db

    class UncertainSession(Session):
        uncertain = False

        def commit(self):
            completing = any(
                isinstance(row, PerformanceTakeUploadReservation) and row.status == "COMPLETED"
                for row in self.identity_map.values()
            )
            if completing:
                if committed:
                    super().commit()
                self.uncertain = True
                if kind == "timeout":
                    raise TimeoutError("Commit acknowledgement lost")
                if kind == "database":
                    raise OperationalError(
                        "COMMIT", {}, Exception("lost"), connection_invalidated=False
                    )
                raise RuntimeError("Commit acknowledgement lost")
            super().commit()

        def execute(self, *args, **kwargs):
            if self.uncertain:
                raise AssertionError("Uncertain request session queried")
            return super().execute(*args, **kwargs)

    with patch.object(service.recovery, "sessions", fresh):
        with UncertainSession(postgres_bundle[0], expire_on_commit=False) as db:
            with pytest.raises(ExternalServiceException):
                service.finalize_take(db, 1, accepted.reservation_id)
    assert opened
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(PerformanceTake)) == int(committed)
        assert db.get(StorageUsageAccount, 1).used_bytes == (len(MEDIA) if committed else 0)
        assert db.scalar(select(UploadSession)).status.value == (
            "CONSUMED" if committed else "COMPLETED"
        )
        result = service.finalize_take(db, 1, accepted.reservation_id)
        assert result.take_id == accepted.take_id
        assert db.get(StorageUsageAccount, 1).used_bytes == len(MEDIA)
