"""
Dayflow HRMS — Payroll Router

Endpoints:
  GET /api/payroll/slip/{employee_id}        — Pro-rata payslip for current month.
  PUT /api/payroll/structure/{employee_id}   — Admin: set / update salary structure.
"""

import calendar
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import supabase
from app.dependencies import get_current_user, require_admin
from app.models.payroll import PayrollStructureIn, PayrollStructureOut, PayslipOut

router = APIRouter(prefix="/payroll", tags=["Payroll"])


# ─── GET PAYSLIP ─────────────────────────────────────────────────────

@router.get(
    "/slip/{employee_id}",
    response_model=PayslipOut,
    summary="Generate a pro-rata payslip for the current month",
)
async def get_payslip(
    employee_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Computes a dynamic, pro-rata monthly payslip:

    1. Fetches the employee's payroll structure (basic + allowances − deductions).
    2. Counts attendance days for the current month (Present + Half-day at 0.5).
    3. Counts approved leave days.
    4. Calculates absence deduction and net salary.

    **Access:**
      - Employees can only view their own payslip.
      - Admins can view any employee's payslip.
    """
    # Access control
    if current_user.get("role") != "admin" and current_user["id"] != employee_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own payslip.",
        )

    # ── 1. Fetch payroll structure ──────────────────────────────────
    structure_resp = (
        supabase.table("payroll_structures")
        .select("*")
        .eq("employee_id", employee_id)
        .maybe_single()
        .execute()
    )
    if not structure_resp.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payroll structure not configured for this employee.",
        )
    structure = structure_resp.data

    # ── 2. Fetch employee name ──────────────────────────────────────
    profile_resp = (
        supabase.table("profiles")
        .select("full_name")
        .eq("id", employee_id)
        .maybe_single()
        .execute()
    )
    employee_name = (profile_resp.data or {}).get("full_name", "Unknown")

    # ── 3. Determine current month boundaries ──────────────────────
    today = datetime.now(timezone.utc).date()
    first_day = today.replace(day=1)
    total_working_days = _business_days_in_month(today.year, today.month)

    # ── 4. Count attendance ─────────────────────────────────────────
    attendance_resp = (
        supabase.table("attendance")
        .select("status")
        .eq("employee_id", employee_id)
        .gte("date", first_day.isoformat())
        .lte("date", today.isoformat())
        .execute()
    )
    attendance_rows = attendance_resp.data or []

    days_present = 0.0
    for row in attendance_rows:
        if row.get("status") == "Present":
            days_present += 1
        elif row.get("status") == "Half-day":
            days_present += 0.5

    # ── 5. Count approved leave days ────────────────────────────────
    leave_resp = (
        supabase.table("leave_requests")
        .select("start_date, end_date")
        .eq("employee_id", employee_id)
        .eq("status", "Approved")
        .gte("start_date", first_day.isoformat())
        .lte("end_date", today.isoformat())
        .execute()
    )
    days_leave = 0
    for lv in (leave_resp.data or []):
        sd = date.fromisoformat(lv["start_date"])
        ed = date.fromisoformat(lv["end_date"])
        days_leave += (ed - sd).days + 1

    # ── 6. Compute pro-rata salary ──────────────────────────────────
    basic = float(structure["basic_salary"])
    allowances = float(structure["allowances"])
    deductions = float(structure["standard_deductions"])
    gross = basic + allowances - deductions

    days_absent = max(0, total_working_days - int(days_present) - days_leave)
    per_day_rate = gross / total_working_days if total_working_days > 0 else 0
    absence_deduction = round(per_day_rate * days_absent, 2)
    net_salary = round(gross - absence_deduction, 2)

    return PayslipOut(
        employee_id=employee_id,
        employee_name=employee_name,
        month=today.strftime("%B %Y"),
        total_working_days=total_working_days,
        days_present=int(days_present),
        days_absent=days_absent,
        days_leave_approved=days_leave,
        basic_salary=basic,
        allowances=allowances,
        standard_deductions=deductions,
        gross_salary=gross,
        absence_deduction=absence_deduction,
        net_salary=net_salary,
    )


# ─── SET / UPDATE PAYROLL STRUCTURE (admin) ──────────────────────────

@router.put(
    "/structure/{employee_id}",
    response_model=PayrollStructureOut,
    summary="Admin: set or update an employee's salary structure",
)
async def upsert_payroll_structure(
    employee_id: str,
    body: PayrollStructureIn,
    _admin: dict = Depends(require_admin),
):
    """
    Creates or updates the payroll structure for the given employee.
    Uses upsert on the UNIQUE(employee_id) constraint.
    """
    response = (
        supabase.table("payroll_structures")
        .upsert(
            {
                "employee_id": employee_id,
                "basic_salary": body.basic_salary,
                "allowances": body.allowances,
                "standard_deductions": body.standard_deductions,
            },
            on_conflict="employee_id",
        )
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save payroll structure.",
        )

    return response.data[0]


# ── Helpers ──────────────────────────────────────────────────────────

def _business_days_in_month(year: int, month: int) -> int:
    """Count weekdays (Mon–Fri) in the given month."""
    total = calendar.monthrange(year, month)[1]
    count = 0
    for day in range(1, total + 1):
        weekday = date(year, month, day).weekday()
        if weekday < 5:  # 0=Mon … 4=Fri
            count += 1
    return count
