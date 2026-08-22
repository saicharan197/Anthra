"""
Dayflow HRMS — Leave Requests Router

Endpoints:
  POST  /api/leave/apply        — Submit a new leave request (Pending).
  GET   /api/leave/all          — Role-scoped leave listing.
  PATCH /api/leave/{id}/status  — Admin: approve / reject a request.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import supabase
from app.dependencies import get_current_user, require_admin
from app.models.leave import LeaveApplyRequest, LeaveStatusUpdate, LeaveOut

router = APIRouter(prefix="/leave", tags=["Leave Management"])


# ─── APPLY FOR LEAVE ─────────────────────────────────────────────────

@router.post(
    "/apply",
    response_model=LeaveOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a new leave request",
)
async def apply_leave(
    body: LeaveApplyRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Creates a leave request with status = Pending.
    Validates that end_date >= start_date (also enforced by the DB CHECK).
    """
    if body.end_date < body.start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be on or after start_date.",
        )

    response = (
        supabase.table("leave_requests")
        .insert(
            {
                "employee_id": current_user["id"],
                "leave_type": body.leave_type,
                "start_date": body.start_date.isoformat(),
                "end_date": body.end_date.isoformat(),
                "remarks": body.remarks or "",
                "status": "Pending",
            }
        )
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit leave request.",
        )

    return response.data[0]


# ─── LIST LEAVE REQUESTS ────────────────────────────────────────────

@router.get(
    "/all",
    response_model=list[LeaveOut],
    summary="List leave requests (role-scoped)",
)
async def list_leaves(
    current_user: dict = Depends(get_current_user),
):
    """
    - **Employees** see only their own leave requests.
    - **Admins** see all leave requests across the organisation.
    """
    query = supabase.table("leave_requests").select("*")

    if current_user.get("role") != "admin":
        query = query.eq("employee_id", current_user["id"])

    query = query.order("created_at", desc=True)
    response = query.execute()
    return response.data or []


# ─── UPDATE LEAVE STATUS (admin) ────────────────────────────────────

@router.patch(
    "/{leave_id}/status",
    response_model=LeaveOut,
    summary="Admin: approve or reject a leave request",
)
async def update_leave_status(
    leave_id: str,
    body: LeaveStatusUpdate,
    _admin: dict = Depends(require_admin),
):
    """
    Admin-only. Transitions a leave request from Pending to
    Approved or Rejected, with optional review comments.
    """
    update_data: dict = {"status": body.status}
    if body.admin_comments is not None:
        update_data["admin_comments"] = body.admin_comments

    response = (
        supabase.table("leave_requests")
        .update(update_data)
        .eq("id", leave_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Leave request {leave_id} not found.",
        )

    return response.data[0]
