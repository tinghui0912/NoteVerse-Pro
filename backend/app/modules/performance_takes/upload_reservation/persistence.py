"""The single row hydration/application and orphan JSON boundary."""

from __future__ import annotations

from datetime import datetime
import json
from app.shared.time import require_utc

from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.modules.performance_takes.upload_reservation.domain import (
    FinalizeLease,
    OrphanFinalCandidate,
    ReservationInvariantError,
    ReservationTransition,
    UploadReservationLifecycle,
)


def decode_orphan_candidates(value: str) -> tuple[OrphanFinalCandidate, ...]:
    try:
        items = json.loads(value)
        if not isinstance(items, list):
            raise ValueError("Candidate array required")
        candidates = []
        for item in items:
            if (
                not isinstance(item, dict)
                or set(item) != {"key", "remove_after"}
                or not isinstance(item["key"], str)
                or not isinstance(item["remove_after"], str)
            ):
                raise ValueError("Candidate shape invalid")
            candidates.append(
                OrphanFinalCandidate(
                    item["key"], require_utc(datetime.fromisoformat(item["remove_after"]))
                )
            )
        return tuple(candidates)
    except (TypeError, ValueError) as error:
        raise ReservationInvariantError("Invalid orphan candidate representation") from error


def encode_orphan_candidates(value: tuple[OrphanFinalCandidate, ...]) -> str:
    return json.dumps(
        [
            {"key": item.key, "remove_after": require_utc(item.remove_after).isoformat()}
            for item in value
        ],
        sort_keys=True,
        separators=(",", ":"),
    )


def lifecycle_from_row(row: PerformanceTakeUploadReservation) -> UploadReservationLifecycle:
    fields = (row.finalizing_token, row.finalizing_object_key, row.finalizing_expires_at)
    if any(value is not None for value in fields) and not all(
        value is not None for value in fields
    ):
        raise ReservationInvariantError("Partial finalize lease")
    lease = (
        FinalizeLease(row.finalizing_token, row.finalizing_object_key, row.finalizing_expires_at)
        if row.finalizing_token is not None
        and row.finalizing_object_key is not None
        and row.finalizing_expires_at is not None
        else None
    )
    return UploadReservationLifecycle(
        row.status,
        row.expires_at,
        lease,
        decode_orphan_candidates(row.orphan_final_object_keys),
        row.last_put_url_expires_at,
        row.staging_cleanup_after,
        row.staging_cleanup_completed_at,
    )


def initialize_lifecycle(
    row: PerformanceTakeUploadReservation, state: UploadReservationLifecycle
) -> None:
    _write(row, state)


def apply_transition(
    row: PerformanceTakeUploadReservation, transition: ReservationTransition, *, now: datetime
) -> None:
    if lifecycle_from_row(row) != transition.before:
        raise ReservationInvariantError("Transition does not match current persisted lifecycle")
    _write(row, transition.after)
    row.updated_at = now


def _write(row: PerformanceTakeUploadReservation, state: UploadReservationLifecycle) -> None:
    row.status = state.status
    row.expires_at = state.expires_at
    row.finalizing_token = state.lease.token if state.lease else None
    row.finalizing_object_key = state.lease.object_key if state.lease else None
    row.finalizing_expires_at = state.lease.expires_at if state.lease else None
    row.orphan_final_object_keys = encode_orphan_candidates(state.orphan_candidates)
    row.last_put_url_expires_at = state.last_put_url_expires_at
    row.staging_cleanup_after = state.staging_cleanup_after
    row.staging_cleanup_completed_at = state.staging_cleanup_completed_at
