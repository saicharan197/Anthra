"""
Dayflow HRMS — Attendance Router

Endpoints:
  POST /api/attendance/check-in   — Log check-in with status=Present.
  POST /api/attendance/check-out  — Update check-out timestamp.
  GET  /api/attendance            — Role-scoped attendance records.
"""

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.database import supabase
from app.dependencies import get_current_user
from app.models.attendance import AttendanceOut

router = APIRouter(prefix="/attendance", tags=["Attendance"])


# ─── CHECK-IN ────────────────────────────────────────────────────────

@router.post(
    "/check-in",
    response_model=AttendanceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Log attendance check-in",
)
async def check_in(current_user: dict = Depends(get_current_user)):
    """
    Records the current timestamp as check-in for today.
    Uses an upsert keyed on (employee_id, date) to prevent duplicates —
    a second check-in on the same day updates the existing row.
    """
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    employee_id = current_user["id"]

    # Upsert: insert or update on conflict (employee_id, date)
    response = (
        supabase.table("attendance")
        .upsert(
            {
                "employee_id": employee_id,
                "date": today,
                "check_in_time": now.isoformat(),
                "status": "Present",
            },
            on_conflict="employee_id,date",
        )
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record check-in.",
        )

    return response.data[0]


# ─── CHECK-OUT ───────────────────────────────────────────────────────

@router.post(
    "/check-out",
    response_model=AttendanceOut,
    summary="Log attendance check-out",
)
async def check_out(current_user: dict = Depends(get_current_user)):
    """
    Updates today's attendance record with the check-out timestamp.
    Fails if the employee hasn't checked in today.
    """
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    employee_id = current_user["id"]

    # Find today's attendance record
    existing = (
        supabase.table("attendance")
        .select("*")
        .eq("employee_id", employee_id)
        .eq("date", today)
        .maybe_single()
        .execute()
    )

    if not existing.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No check-in found for today. Please check in first.",
        )

    check_in_dt = datetime.fromisoformat(existing.data["check_in_time"])
    check_out_dt = now

    from app.services.attendance_engine import calculate_daily_status
    status_str, _ = calculate_daily_status(check_in_dt, check_out_dt, is_on_leave=False)

    # Update with check-out time and status
    response = (
        supabase.table("attendance")
        .update({
            "check_out_time": now.isoformat(),
            "status": status_str
        })
        .eq("id", existing.data["id"])
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record check-out.",
        )

    return response.data[0]


# ─── LIST ATTENDANCE ─────────────────────────────────────────────────

@router.get(
    "",
    response_model=list[AttendanceOut],
    summary="Get attendance records (role-scoped)",
)
async def list_attendance(
    employee_id: Optional[str] = Query(default=None, description="Filter by employee (admin only)"),
    start_date: Optional[date] = Query(default=None, description="Start of date range"),
    end_date: Optional[date] = Query(default=None, description="End of date range"),
    current_user: dict = Depends(get_current_user),
):
    """
    - **Employees** see only their own attendance records.
    - **Admins** can optionally filter by employee_id and date range.
    """
    is_admin = current_user.get("role") == "admin"

    query = supabase.table("attendance").select("*")

    if is_admin:
        if employee_id:
            query = query.eq("employee_id", employee_id)
    else:
        # Employees always scoped to self
        query = query.eq("employee_id", current_user["id"])

    if start_date:
        query = query.gte("date", start_date.isoformat())
    if end_date:
        query = query.lte("date", end_date.isoformat())

    query = query.order("date", desc=True)

    response = query.execute()
    return response.data or []
