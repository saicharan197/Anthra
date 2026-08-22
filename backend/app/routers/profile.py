"""
Dayflow HRMS — Profile Router

Endpoints:
  GET  /api/profile/me      — Fetch the authenticated user's profile.
  PUT  /api/profile/me      — Employee self-update (phone, address, pic).
  PUT  /api/profile/{id}    — Admin-only full profile update.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import get_supabase, supabase
from app.dependencies import get_current_user, require_admin
from app.models.profile import ProfileOut, ProfileUpdateSelf, ProfileUpdateAdmin

router = APIRouter(prefix="/profile", tags=["Profiles"])


# ─── GET OWN PROFILE ─────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=ProfileOut,
    summary="Get the authenticated user's profile",
)
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    return current_user


# ─── UPDATE OWN PROFILE (employee) ──────────────────────────────────

@router.put(
    "/me",
    response_model=ProfileOut,
    summary="Update own contact info (employee)",
)
async def update_my_profile(
    body: ProfileUpdateSelf,
    current_user: dict = Depends(get_current_user),
):
    """
    Employees may only update: phone, address, profile_pic_url.
    Any fields left as None are ignored (partial update).
    """
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields provided for update.",
        )

    client = get_supabase(current_user.get("_token"))
    response = (
        client.table("profiles")
        .update(update_data)
        .eq("id", current_user["id"])
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Profile update failed.",
        )

    return response.data[0]


# ─── UPDATE ANY PROFILE (admin) ─────────────────────────────────────

@router.put(
    "/{profile_id}",
    response_model=ProfileOut,
    summary="Admin: update any user's profile",
)
async def update_profile_admin(
    profile_id: str,
    body: ProfileUpdateAdmin,
    _admin: dict = Depends(require_admin),
):
    """
    Admins can modify any field on any profile: role, job_title,
    employee_id, email, etc.
    """
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields provided for update.",
        )

    client = get_supabase(_admin.get("_token"))
    response = (
        client.table("profiles")
        .update(update_data)
        .eq("id", profile_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile {profile_id} not found.",
        )

    return response.data[0]


# ─── LIST ALL PROFILES (admin) ──────────────────────────────────────

@router.get(
    "",
    response_model=list[ProfileOut],
    summary="Admin: list all profiles",
)
async def list_all_profiles(_admin: dict = Depends(require_admin)):
    """
    Returns a list of all employee profiles. Admin only.
    """
    client = get_supabase(_admin.get("_token"))
    response = client.table("profiles").select("*").execute()
    return response.data or []


