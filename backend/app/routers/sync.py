"""
Dayflow HRMS — Offline Sync Router

Endpoint:
  POST /api/sync — Idempotent batch ingestion of offline-queued events.

Each event carries a `client_event_id` used as the `sync_idempotency_key`
in the database. Duplicate keys are silently acknowledged (not re-inserted),
making the endpoint safe for network retries and replay.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, status

from app.database import supabase
from app.dependencies import get_current_user
from app.models.sync import SyncRequest, SyncResponse, SyncResultItem

router = APIRouter(prefix="/sync", tags=["Offline Sync"])


@router.post(
    "",
    response_model=SyncResponse,
    status_code=status.HTTP_200_OK,
    summary="Process a batch of offline-queued events",
)
async def process_sync_batch(
    body: SyncRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Accepts an array of events queued offline by the PWA client.

    Supported event types:
      - **check_in**    → Upserts into `attendance` with status=Present.
      - **check_out**   → Updates the matching attendance row's check_out_time.
      - **leave_apply** → Inserts into `leave_requests` with status=Pending.

    Idempotency is guaranteed by the `sync_idempotency_key` (UNIQUE column):
      - If the key already exists → reported as `duplicate`, no data change.
      - If the key is new → inserted as `created`.
    """
    employee_id = current_user["id"]
    results: list[SyncResultItem] = []

    for event in body.events:
        try:
            if event.type == "check_in":
                result = _sync_check_in(employee_id, event.client_event_id, event.payload)
            elif event.type == "check_out":
                result = _sync_check_out(employee_id, event.client_event_id, event.payload)
            elif event.type == "leave_apply":
                result = _sync_leave_apply(employee_id, event.client_event_id, event.payload)
            else:
                result = SyncResultItem(
                    client_event_id=event.client_event_id,
                    status="error",
                    detail=f"Unknown event type: {event.type}",
                )
            results.append(result)
        except Exception as exc:
            results.append(
                SyncResultItem(
                    client_event_id=event.client_event_id,
                    status="error",
                    detail=str(exc),
                )
            )

    return SyncResponse(processed=len(results), results=results)


# ── Internal Sync Handlers ──────────────────────────────────────────


def _sync_check_in(employee_id: str, idempotency_key: str, payload: dict) -> SyncResultItem:
    """Upsert a check-in attendance record."""
    record_date = payload.get("date", datetime.now(timezone.utc).date().isoformat())
    check_in_time = payload.get("check_in_time", datetime.now(timezone.utc).isoformat())

    # Check for existing idempotency key
    existing = (
        supabase.table("attendance")
        .select("id")
        .eq("sync_idempotency_key", idempotency_key)
        .maybe_single()
        .execute()
    )
    if existing.data:
        return SyncResultItem(
            client_event_id=idempotency_key,
            status="duplicate",
            detail="Attendance record already synced.",
        )

    supabase.table("attendance").upsert(
        {
            "employee_id": employee_id,
            "date": record_date,
            "check_in_time": check_in_time,
            "status": "Present",
            "sync_idempotency_key": idempotency_key,
        },
        on_conflict="employee_id,date",
    ).execute()

    return SyncResultItem(client_event_id=idempotency_key, status="created")


def _sync_check_out(employee_id: str, idempotency_key: str, payload: dict) -> SyncResultItem:
    """Update an existing attendance record with check-out time."""
    record_date = payload.get("date", datetime.now(timezone.utc).date().isoformat())
    check_out_time = payload.get("check_out_time", datetime.now(timezone.utc).isoformat())

    # Find the existing check-in to get check_in_time
    existing = (
        supabase.table("attendance")
        .select("*")
        .eq("employee_id", employee_id)
        .eq("date", record_date)
        .maybe_single()
        .execute()
    )

    if not existing.data:
        return SyncResultItem(
            client_event_id=idempotency_key,
            status="error",
            detail="No matching check-in found for the given date.",
        )

    check_in_dt = datetime.fromisoformat(existing.data["check_in_time"])
    check_out_dt = datetime.fromisoformat(check_out_time)

    from app.services.attendance_engine import calculate_daily_status
    status_str, _ = calculate_daily_status(check_in_dt, check_out_dt, is_on_leave=False)

    response = (
        supabase.table("attendance")
        .update({
            "check_out_time": check_out_time,
            "status": status_str
        })
        .eq("id", existing.data["id"])
        .execute()
    )

    if not response.data:
        return SyncResultItem(
            client_event_id=idempotency_key,
            status="error",
            detail="Failed to update check-out status.",
        )

    return SyncResultItem(client_event_id=idempotency_key, status="created")


def _sync_leave_apply(employee_id: str, idempotency_key: str, payload: dict) -> SyncResultItem:
    """Insert a leave request if the idempotency key is new."""
    # Check for duplicate
    existing = (
        supabase.table("leave_requests")
        .select("id")
        .eq("id", idempotency_key)
        .maybe_single()
        .execute()
    )
    if existing.data:
        return SyncResultItem(
            client_event_id=idempotency_key,
            status="duplicate",
            detail="Leave request already synced.",
        )

    supabase.table("leave_requests").insert(
        {
            "id": idempotency_key,
            "employee_id": employee_id,
            "leave_type": payload.get("leave_type", "Paid"),
            "start_date": payload["start_date"],
            "end_date": payload["end_date"],
            "remarks": payload.get("remarks", ""),
            "status": "Pending",
        }
    ).execute()

    return SyncResultItem(client_event_id=idempotency_key, status="created")
