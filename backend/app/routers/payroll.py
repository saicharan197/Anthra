"""
Dayflow HRMS — Payroll Router

Endpoints:
  GET /api/payroll/slip/{employee_id}        — Pro-rata payslip for current month.
  PUT /api/payroll/structure/{employee_id}   — Admin: set / update salary structure.
"""

import calendar
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_supabase, supabase
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

    client = get_supabase(current_user.get("_token"))

    # ── 1. Fetch payroll structure ──────────────────────────────────
    structure_resp = (
        client.table("payroll_structures")
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
        client.table("profiles")
        .select("full_name")
        .eq("id", employee_id)
        .maybe_single()
        .execute()
    )
    employee_name = (profile_resp.data or {}).get("full_name", "Unknown")

    # ── 3. Determine current month boundaries ──────────────────────
    today = datetime.now(timezone.utc).date()
    last_day = today.replace(day=calendar.monthrange(today.year, today.month)[1])

    # ── 4. Fetch all attendance & approved leaves ───────────────────
    attendance_resp = (
        client.table("attendance")
        .select("date, status")
        .eq("employee_id", employee_id)
        .gte("date", today.replace(day=1).isoformat())
        .lte("date", last_day.isoformat())
        .execute()
    )
    
    leave_resp = (
        client.table("leave_requests")
        .select("start_date, end_date, leave_type, status")
        .eq("employee_id", employee_id)
        .eq("status", "Approved")
        .execute()
    )

    from app.services.payroll_engine import compute_monthly_payslip
    payslip_data = compute_monthly_payslip(
        structure=structure,
        attendance_records=attendance_resp.data or [],
        approved_unpaid_leaves=leave_resp.data or [],
        month=today.month,
        year=today.year,
        working_days=30
    )

    return PayslipOut(
        employee_id=employee_id,
        employee_name=employee_name,
        month=today.strftime("%B %Y"),
        total_working_days=30,
        days_present=payslip_data["breakdown"]["present_days"],
        days_absent=payslip_data["breakdown"]["unapproved_absent_days"],
        days_leave_approved=payslip_data["breakdown"]["unpaid_leave_days"],
        basic_salary=payslip_data["basic_salary"],
        allowances=payslip_data["allowances"],
        standard_deductions=payslip_data["standard_deductions"],
        gross_salary=payslip_data["gross_salary"],
        absence_deduction=payslip_data["loss_of_pay_deduction"],
        net_salary=payslip_data["net_salary"],
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
    client = get_supabase(_admin.get("_token"))
    response = (
        client.table("payroll_structures")
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


# ─── LIST ALL PAYROLL STRUCTURES (admin) ───────────────────────────

@router.get(
    "/structures",
    response_model=list[PayrollStructureOut],
    summary="Admin: list all payroll structures",
)
async def list_all_structures(_admin: dict = Depends(require_admin)):
    """
    Returns all payroll structures. Admin only.
    """
    client = get_supabase(_admin.get("_token"))
    response = client.table("payroll_structures").select("*").execute()
    return response.data or []


# ─── GET PAYROLL STRUCTURE (admin / own) ─────────────────────────────

@router.get(
    "/structure/{employee_id}",
    response_model=PayrollStructureOut,
    summary="Get employee's payroll structure",
)
async def get_payroll_structure(
    employee_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns the payroll structure for a specific employee.
    Accessible by admin or the employee themselves.
    """
    if current_user.get("role") != "admin" and current_user["id"] != employee_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own payroll structure.",
        )

    client = get_supabase(current_user.get("_token"))
    response = (
        client.table("payroll_structures")
        .select("*")
        .eq("employee_id", employee_id)
        .maybe_single()
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payroll structure not found.",
        )
    return response.data


