"""
Dayflow HRMS — Pydantic Schemas: Attendance
"""

from datetime import date, datetime
from pydantic import BaseModel, Field
from typing import Optional


class AttendanceOut(BaseModel):
    """Attendance record returned by the API."""
    id: str
    employee_id: str
    date: str
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    status: Optional[str] = None
    sync_idempotency_key: Optional[str] = None
    created_at: Optional[str] = None


class AttendanceQuery(BaseModel):
    """Query parameters for admin attendance lookup."""
    employee_id: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
