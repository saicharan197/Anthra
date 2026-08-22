import pytest
from datetime import datetime, date, timezone, timedelta
from app.services.attendance_engine import calculate_daily_status, consolidate_multisession_attendance, AttendanceStatus
from app.services.leave_engine import calculate_requested_leave_days, validate_leave_no_overlap
from app.services.payroll_engine import compute_monthly_payslip

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  1. ATTENDANCE ENGINE TESTS                                              ║
# ╚══════════════════════════════════════════════════════════════════════════╝

def test_calculate_daily_status_on_leave():
    status, hours = calculate_daily_status(
        check_in=datetime(2026, 8, 22, 9, 0),
        check_out=datetime(2026, 8, 22, 17, 0),
        is_on_leave=True
    )
    assert status == AttendanceStatus.LEAVE.value
    assert hours == 0.0

def test_calculate_daily_status_missing_punches():
    # Missing checkout
    status, hours = calculate_daily_status(datetime(2026, 8, 22, 9, 0), None)
    assert status == AttendanceStatus.ABSENT.value
    assert hours == 0.0

    # Missing checkin
    status, hours = calculate_daily_status(None, datetime(2026, 8, 22, 17, 0))
    assert status == AttendanceStatus.ABSENT.value
    assert hours == 0.0

def test_calculate_daily_status_inverted_time():
    # check_out <= check_in
    status, hours = calculate_daily_status(
        datetime(2026, 8, 22, 17, 0),
        datetime(2026, 8, 22, 9, 0)
    )
    assert status == AttendanceStatus.ABSENT.value
    assert hours == 0.0

def test_calculate_daily_status_mixed_timezone():
    # One naive, one aware
    check_in = datetime(2026, 8, 22, 9, 0) # naive
    check_out = datetime(2026, 8, 22, 17, 0, tzinfo=timezone.utc) # aware (8 hours duration)
    status, hours = calculate_daily_status(check_in, check_out)
    assert status == AttendanceStatus.PRESENT.value
    assert hours == 8.0

def test_calculate_daily_status_boundaries():
    # 7.99 hours -> Half-day
    start = datetime(2026, 8, 22, 9, 0)
    end = start + timedelta(hours=7, minutes=59, seconds=24) # 7.99 hours
    status, hours = calculate_daily_status(start, end)
    assert status == AttendanceStatus.HALF_DAY.value
    assert hours == 7.99

    # 8.00 hours -> Present
    end_exact = start + timedelta(hours=8)
    status, hours = calculate_daily_status(start, end_exact)
    assert status == AttendanceStatus.PRESENT.value
    assert hours == 8.0

    # 3.99 hours -> Absent
    end_short = start + timedelta(hours=3, minutes=59, seconds=24)
    status, hours = calculate_daily_status(start, end_short)
    assert status == AttendanceStatus.ABSENT.value
    assert hours == 3.99

    # 4.00 hours -> Half-day
    end_half = start + timedelta(hours=4)
    status, hours = calculate_daily_status(start, end_half)
    assert status == AttendanceStatus.HALF_DAY.value
    assert hours == 4.0

def test_consolidate_multisession_attendance_overlapping():
    # Overlapping sessions:
    # 1. 09:00 - 12:00 (3 hours)
    # 2. 11:30 - 15:00 (3.5 hours, overlapping 30m, total non-overlapping 09:00-15:00 = 6 hours)
    # 3. 16:00 - 18:30 (2.5 hours, total 8.5 hours)
    base = datetime(2026, 8, 22, 0, 0)
    sessions = [
        (base + timedelta(hours=9), base + timedelta(hours=12)),
        (base + timedelta(hours=11, minutes=30), base + timedelta(hours=15)),
        (base + timedelta(hours=16), base + timedelta(hours=18, minutes=30))
    ]
    status, hours = consolidate_multisession_attendance(sessions)
    assert status == AttendanceStatus.PRESENT.value
    assert hours == 8.5

def test_consolidate_multisession_attendance_consecutive():
    # Consecutive touching sessions:
    # 1. 09:00 - 13:00 (4 hours)
    # 2. 13:00 - 17:00 (4 hours, touching, consolidated to 8 hours)
    base = datetime(2026, 8, 22, 0, 0)
    sessions = [
        (base + timedelta(hours=9), base + timedelta(hours=13)),
        (base + timedelta(hours=13), base + timedelta(hours=17))
    ]
    status, hours = consolidate_multisession_attendance(sessions)
    assert status == AttendanceStatus.PRESENT.value
    assert hours == 8.0


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  2. LEAVE ENGINE TESTS                                                   ║
# ╚══════════════════════════════════════════════════════════════════════════╝

def test_calculate_requested_leave_days_start_after_end():
    days = calculate_requested_leave_days(date(2026, 8, 25), date(2026, 8, 20))
    assert days == 0

def test_calculate_requested_leave_days_weekends():
    # Aug 21 (Fri) to Aug 24 (Mon). Inclusive calendar days: 4. Inclusive business days: 2 (Fri, Mon)
    start = date(2026, 8, 21)
    end = date(2026, 8, 24)
    
    # Exclude weekends
    assert calculate_requested_leave_days(start, end, exclude_weekends=True) == 2
    # Include weekends
    assert calculate_requested_leave_days(start, end, exclude_weekends=False) == 4

def test_calculate_requested_leave_days_adjacent():
    # Adjacent dates (same day)
    d = date(2026, 8, 22) # Saturday
    assert calculate_requested_leave_days(d, d, exclude_weekends=True) == 0
    assert calculate_requested_leave_days(d, d, exclude_weekends=False) == 1

def test_validate_leave_no_overlap():
    # Existing leaves
    existing = [
        {"start_date": date(2026, 8, 10), "end_date": date(2026, 8, 15), "status": "Approved"},
        {"start_date": "2026-08-20", "end_date": "2026-08-25", "status": "Pending"},
        {"start_date": date(2026, 8, 27), "end_date": date(2026, 8, 30), "status": "Rejected"}
    ]

    # No overlap
    ok, err = validate_leave_no_overlap(date(2026, 8, 16), date(2026, 8, 19), existing)
    assert ok is True
    assert err is None

    # Overlaps with rejected -> should be ignored (succeed)
    ok, err = validate_leave_no_overlap(date(2026, 8, 28), date(2026, 8, 29), existing)
    assert ok is True
    assert err is None

    # Boundary-touching overlaps (Aug 20 is start of existing Pending)
    ok, err = validate_leave_no_overlap(date(2026, 8, 18), date(2026, 8, 20), existing)
    assert ok is False
    assert "overlap" in err.lower()

    # Exact boundary touching at the end (Aug 25)
    ok, err = validate_leave_no_overlap(date(2026, 8, 25), date(2026, 8, 26), existing)
    assert ok is False
    assert "overlap" in err.lower()


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  3. PAYROLL ENGINE TESTS                                                 ║
# ╚══════════════════════════════════════════════════════════════════════════╝

def test_compute_monthly_payslip_exact():
    structure = {
        "basic_salary": 45000.00,
        "allowances": 10000.00,
        "standard_deductions": 5000.00
    }
    
    # 2 half days = 1 effective absent day. Unpaid leave = 2 days. Unapproved absent = 1 day.
    # Total effective absent days = 1 + 2 + 1 = 4 days LOP.
    # Gross = 55000. Daily rate = 55000 / 30 = 1833.333333333333333333333333
    # 4 days LOP = 1833.3333333 * 4 = 7333.333333... -> rounded = 7333.33
    # Total deductions = 5000 (standard) + 7333.33 = 12333.33
    # Net = 55000 - 12333.33 = 42666.67
    
    attendance = [
        {"date": date(2026, 8, 1), "status": "Present"},
        {"date": date(2026, 8, 2), "status": "Half-day"},
        {"date": date(2026, 8, 3), "status": "Half-day"},
        {"date": date(2026, 8, 4), "status": "Absent"}
    ]
    
    unpaid_leaves = [
        {"start_date": date(2026, 8, 17), "end_date": date(2026, 8, 18), "leave_type": "Unpaid"} # 2 days (Mon-Tue)
    ]

    payslip = compute_monthly_payslip(
        structure, attendance, unpaid_leaves, month=8, year=2026, working_days=30
    )

    assert payslip["gross_salary"] == 55000.00
    assert payslip["loss_of_pay_deduction"] == 7333.33
    assert payslip["total_deductions"] == 12333.33
    assert payslip["net_salary"] == 42666.67
    
    breakdown = payslip["breakdown"]
    assert breakdown["present_days"] == 1
    assert breakdown["half_days"] == 2
    assert breakdown["unapproved_absent_days"] == 1
    assert breakdown["unpaid_leave_days"] == 2
    assert breakdown["effective_absent_days"] == 4.0

def test_compute_monthly_payslip_net_pay_floor():
    structure = {
        "basic_salary": 1000.00,
        "allowances": 0.00,
        "standard_deductions": 2000.00 # Deductions > Gross
    }
    
    payslip = compute_monthly_payslip(
        structure, [], [], month=8, year=2026, working_days=30
    )
    
    assert payslip["net_salary"] == 0.00

def test_compute_monthly_payslip_zero_gross():
    structure = {
        "basic_salary": 0.00,
        "allowances": 0.00,
        "standard_deductions": 0.00
    }
    payslip = compute_monthly_payslip(
        structure, [], [], month=8, year=2026, working_days=30
    )
    assert payslip["gross_salary"] == 0.00
    assert payslip["net_salary"] == 0.00
