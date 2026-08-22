"""
Dayflow HRMS — Pydantic Schemas: Offline Sync Engine
"""

from pydantic import BaseModel, Field
from typing import Any, Literal


class SyncEvent(BaseModel):
    """A single queued event from the offline client."""
    client_event_id: str = Field(..., description="Client-generated UUID for idempotency")
    type: Literal["check_in", "check_out", "leave_apply"]
    payload: dict[str, Any]


class SyncRequest(BaseModel):
    """Batch of queued events sent by the offline client."""
    events: list[SyncEvent] = Field(..., min_length=1, max_length=100)


class SyncResultItem(BaseModel):
    """Result for a single sync event."""
    client_event_id: str
    status: Literal["created", "duplicate", "error"]
    detail: str = ""


class SyncResponse(BaseModel):
    """Aggregated results for the batch sync request."""
    processed: int
    results: list[SyncResultItem]
