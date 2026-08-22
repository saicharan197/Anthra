from datetime import datetime, timezone
from enum import Enum

class AttendanceStatus(str, Enum):
    PRESENT = "Present"
    HALF_DAY = "Half-day"
    ABSENT = "Absent"
    LEAVE = "Leave"

def make_utc(dt: datetime) -> datetime:
    """Normalize mixed naive/aware timestamps to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def calculate_daily_status(
    check_in: datetime | None,
    check_out: datetime | None,
    is_on_leave: bool = False
) -> tuple[str, float]:
    """
    Calculate daily attendance status and total hours logged.
    
    Rules:
      - If is_on_leave == True -> ("Leave", 0.0)
      - If check_in or check_out is None -> ("Absent", 0.0)
      - If check_out <= check_in -> ("Absent", 0.0)
      - Normalize naive/aware datetimes to UTC before calculation
      - Hours >= 8.0 -> ("Present", hours)
      - 4.0 <= Hours < 8.0 -> ("Half-day", hours)
      - Hours < 4.0 -> ("Absent", hours)
      - Hours rounded to 2 decimal places
    """
    if is_on_leave:
        return AttendanceStatus.LEAVE.value, 0.0
        
    if check_in is None or check_out is None:
        return AttendanceStatus.ABSENT.value, 0.0

    utc_in = make_utc(check_in)
    utc_out = make_utc(check_out)

    if utc_out <= utc_in:
        return AttendanceStatus.ABSENT.value, 0.0

    duration = utc_out - utc_in
    hours = round(duration.total_seconds() / 3600.0, 2)

    if hours >= 8.0:
        return AttendanceStatus.PRESENT.value, hours
    elif hours >= 4.0:
        return AttendanceStatus.HALF_DAY.value, hours
    else:
        return AttendanceStatus.ABSENT.value, hours

def consolidate_multisession_attendance(
    sessions: list[tuple[datetime, datetime]],
    is_on_leave: bool = False
) -> tuple[str, float]:
    """
    Merge overlapping or consecutive punch intervals for an employee
    on the same calendar day, calculate total non-overlapping duration,
    and map to an AttendanceStatus.
    """
    if is_on_leave:
        return AttendanceStatus.LEAVE.value, 0.0

    if not sessions:
        return AttendanceStatus.ABSENT.value, 0.0

    # Normalize to UTC and filter out invalid sessions where check_out <= check_in
    normalized_sessions = []
    for start, end in sessions:
        utc_start = make_utc(start)
        utc_end = make_utc(end)
        if utc_end > utc_start:
            normalized_sessions.append((utc_start, utc_end))

    if not normalized_sessions:
        return AttendanceStatus.ABSENT.value, 0.0

    # Sort sessions by check-in time
    normalized_sessions.sort(key=lambda x: x[0])

    # Merge overlapping or touching intervals
    merged: list[tuple[datetime, datetime]] = []
    for start, end in normalized_sessions:
        if not merged:
            merged.append((start, end))
        else:
            prev_start, prev_end = merged[-1]
            if start <= prev_end:  # Overlapping or touching
                # Merge current into previous by extending the end time
                merged[-1] = (prev_start, max(prev_end, end))
            else:
                merged.append((start, end))

    # Calculate total duration in hours
    total_seconds = sum((end - start).total_seconds() for start, end in merged)
    hours = round(total_seconds / 3600.0, 2)

    if hours >= 8.0:
        return AttendanceStatus.PRESENT.value, hours
    elif hours >= 4.0:
        return AttendanceStatus.HALF_DAY.value, hours
    else:
        return AttendanceStatus.ABSENT.value, hours
