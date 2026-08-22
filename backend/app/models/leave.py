"""
Dayflow HRMS — Pydantic Schemas: Leave Requests
"""

from datetime import date
from pydantic import BaseModel, Field
from typing import Optional


class LeaveApplyRequest(BaseModel):
    """Payload for POST /api/leave/apply."""
    leave_type: str = Field(..., pattern=r"^(Paid|Sick|Unpaid)$")
    start_date: date
    end_date: date
    remarks: Optional[str] = Field(default=None, max_length=1000)


class LeaveStatusUpdate(BaseModel):
    """Payload for PATCH /api/leave/{id}/status (admin only)."""
    status: str = Field(..., pattern=r"^(Approved|Rejected)$")
    admin_comments: Optional[str] = Field(default=None, max_length=1000)


class LeaveOut(BaseModel):
    """Leave request record returned by the API."""
    id: str
    employee_id: str
    leave_type: str
    start_date: str
    end_date: str
    remarks: Optional[str] = None
    status: str
    admin_comments: Optional[str] = None
    created_at: Optional[str] = None
