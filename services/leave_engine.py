from datetime import date, timedelta

def calculate_requested_leave_days(
    start_date: date,
    end_date: date,
    exclude_weekends: bool = True
) -> int:
    """
    Calculate inclusive calendar days between start_date and end_date.
    
    Rules:
      - If start_date > end_date -> return 0
      - If exclude_weekends == True -> filter out Saturday (weekday 5) and Sunday (weekday 6)
    """
    if start_date > end_date:
        return 0

    total_days = 0
    curr = start_date
    while curr <= end_date:
        if not exclude_weekends or curr.weekday() < 5:
            total_days += 1
        curr += timedelta(days=1)
        
    return total_days

def validate_leave_no_overlap(
    new_start: date,
    new_end: date,
    existing_leaves: list[dict]
) -> tuple[bool, str | None]:
    """
    Validate that new leave request does not overlap with any active leave.
    
    Rules:
      - Enforce new_start <= new_end
      - Only consider existing records where status is 'Pending' or 'Approved'
      - Overlap condition: max(new_start, existing_start) <= min(new_end, existing_end)
    """
    if new_start > new_end:
        return False, "Start date cannot be after end date."

    for leave in existing_leaves:
        status = leave.get("status")
        if status not in ["Pending", "Approved"]:
            continue

        # Parse existing dates (handle date objects or ISO strings)
        ext_start = leave.get("start_date")
        ext_end = leave.get("end_date")

        if isinstance(ext_start, str):
            ext_start = date.fromisoformat(ext_start)
        if isinstance(ext_end, str):
            ext_end = date.fromisoformat(ext_end)

        if not ext_start or not ext_end:
            continue

        # Check interval collision
        if max(new_start, ext_start) <= min(new_end, ext_end):
            return (
                False,
                f"Requested leave dates [{new_start} to {new_end}] overlap with an "
                f"existing {status} leave request [{ext_start} to {ext_end}]."
            )

    return True, None
