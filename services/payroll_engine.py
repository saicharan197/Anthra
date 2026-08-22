import calendar
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

def compute_monthly_payslip(
    structure: dict,
    attendance_records: list[dict],
    approved_unpaid_leaves: list[dict],
    month: int,
    year: int,
    working_days: int = 30
) -> dict:
    """
    Compute a monthly pro-rata payslip using Decimal for financial accuracy.
    
    Formulas:
      - Gross Salary = Basic Salary + Allowances
      - Daily Rate = Gross Salary / working_days
      - Effective Absent Days = Unapproved Absences + Approved Unpaid Leave Days + (0.5 * Half-Days)
      - Pro-Rata Loss of Pay (LOP) = Daily Rate * Effective Absent Days
      - Total Deductions = Standard Deductions + Pro-Rata LOP
      - Net Salary = max(0.00, Gross Salary - Total Deductions)
      
    Output keys:
      month, year, basic_salary, allowances, gross_salary, standard_deductions,
      loss_of_pay_deduction, total_deductions, net_salary, breakdown
    """
    # ── 1. Read Inputs using Decimal ────────────────────────────────
    basic_val = structure.get("basic_salary", 0.0)
    allow_val = structure.get("allowances", 0.0)
    deduct_val = structure.get("standard_deductions", 0.0)

    basic = Decimal(str(basic_val))
    allowances = Decimal(str(allow_val))
    standard_deductions = Decimal(str(deduct_val))
    working_days_dec = Decimal(str(working_days))

    # ── 2. Gross Salary & Daily Rate ──────────────────────────────
    gross_salary = basic + allowances
    
    if working_days_dec > 0:
        daily_rate = gross_salary / working_days_dec
    else:
        daily_rate = Decimal("0.00")

    # ── 3. Count Attendance Statuses in target month/year ───────────
    present_days = 0
    half_days = 0
    unapproved_absent_days = 0

    for record in attendance_records:
        rec_date_str = record.get("date")
        if isinstance(rec_date_str, str):
            rec_date = date.fromisoformat(rec_date_str)
        elif isinstance(rec_date_str, date):
            rec_date = rec_date_str
        else:
            continue

        if rec_date.month != month or rec_date.year != year:
            continue

        status = record.get("status")
        if status == "Present":
            present_days += 1
        elif status == "Half-day":
            half_days += 1
        elif status == "Absent":
            unapproved_absent_days += 1

    # ── 4. Count Unpaid Leave Days (Mon-Fri business days inside month) ──
    unpaid_leave_days = 0
    for leave in approved_unpaid_leaves:
        # Only process unpaid leaves
        if leave.get("leave_type") != "Unpaid":
            continue
            
        start_val = leave.get("start_date")
        end_val = leave.get("end_date")

        if isinstance(start_val, str):
            start_date = date.fromisoformat(start_val)
        else:
            start_date = start_val

        if isinstance(end_val, str):
            end_date = date.fromisoformat(end_val)
        else:
            end_date = end_val

        if not start_date or not end_date:
            continue

        # Count intersecting weekdays (excluding weekends) within target month
        curr = start_date
        while curr <= end_date:
            if curr.month == month and curr.year == year:
                # Exclude weekends (5=Saturday, 6=Sunday)
                if curr.weekday() < 5:
                    unpaid_leave_days += 1
            curr += timedelta_days(1)

    # ── 5. Perform Pro-Rata Calculations ───────────────────────────
    half_days_dec = Decimal(str(half_days))
    unapproved_absent_dec = Decimal(str(unapproved_absent_days))
    unpaid_leave_dec = Decimal(str(unpaid_leave_days))

    effective_absent_days = unapproved_absent_dec + unpaid_leave_dec + (Decimal("0.5") * half_days_dec)
    
    loss_of_pay_deduction = daily_rate * effective_absent_days
    total_deductions = standard_deductions + loss_of_pay_deduction

    net_salary = gross_salary - total_deductions
    if net_salary < Decimal("0.00"):
        net_salary = Decimal("0.00")

    # Quantize all outputs to 2 decimal places using ROUND_HALF_UP
    two_places = Decimal("0.01")
    
    return {
        "month": month,
        "year": year,
        "basic_salary": float(basic.quantize(two_places, rounding=ROUND_HALF_UP)),
        "allowances": float(allowances.quantize(two_places, rounding=ROUND_HALF_UP)),
        "gross_salary": float(gross_salary.quantize(two_places, rounding=ROUND_HALF_UP)),
        "standard_deductions": float(standard_deductions.quantize(two_places, rounding=ROUND_HALF_UP)),
        "loss_of_pay_deduction": float(loss_of_pay_deduction.quantize(two_places, rounding=ROUND_HALF_UP)),
        "total_deductions": float(total_deductions.quantize(two_places, rounding=ROUND_HALF_UP)),
        "net_salary": float(net_salary.quantize(two_places, rounding=ROUND_HALF_UP)),
        "breakdown": {
            "present_days": present_days,
            "half_days": half_days,
            "unapproved_absent_days": unapproved_absent_days,
            "unpaid_leave_days": unpaid_leave_days,
            "effective_absent_days": float(effective_absent_days.quantize(two_places, rounding=ROUND_HALF_UP))
        }
    }

def timedelta_days(days: int) -> date:
    from datetime import timedelta
    return timedelta(days=days)
