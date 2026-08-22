"""
Dayflow HRMS — Authentication Router

Endpoints:
  POST /api/auth/signup   — Register a new user via Supabase Auth.
  POST /api/auth/signin   — Authenticate and receive an access token.
"""

from fastapi import APIRouter, HTTPException, status

from app.database import supabase
from app.models.auth import SignUpRequest, SignInRequest, AuthResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ─── SIGNUP ──────────────────────────────────────────────────────────

@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new employee / admin account",
)
async def signup(body: SignUpRequest):
    """
    Creates a Supabase Auth user and lets the database trigger
    (`handle_new_user`) auto-insert a `dayflow.profiles` row with the
    metadata supplied here (full_name, role, employee_id).
    """
    try:
        auth_response = supabase.auth.sign_up(
            {
                "email": body.email,
                "password": body.password,
                "options": {
                    "data": {
                        "full_name": body.full_name,
                        "role": body.role,
                        "employee_id": body.employee_id,
                    }
                },
            }
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Signup failed: {exc}",
        )

    user = auth_response.user
    session = auth_response.session

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signup failed: no user returned. Email may already be registered.",
        )

    # Update the employee_id in profiles (trigger only sets full_name & role)
    try:
        supabase.table("profiles").update(
            {"employee_id": body.employee_id}
        ).eq("id", str(user.id)).execute()
    except Exception:
        pass  # Non-critical; admin can set later

    return AuthResponse(
        access_token=session.access_token if session else "",
        user={
            "id": str(user.id),
            "email": user.email,
            "role": body.role,
            "full_name": body.full_name,
        },
    )


# ─── SIGNIN ──────────────────────────────────────────────────────────

@router.post(
    "/signin",
    response_model=AuthResponse,
    summary="Sign in and receive an access token",
)
async def signin(body: SignInRequest):
    """
    Authenticates against Supabase Auth and returns the session JWT
    along with user metadata.
    """
    try:
        auth_response = supabase.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid credentials: {exc}",
        )

    user = auth_response.user
    session = auth_response.session

    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed: no session returned.",
        )

    # Fetch the full profile for the response
    profile_resp = (
        supabase.table("profiles")
        .select("*")
        .eq("id", str(user.id))
        .maybe_single()
        .execute()
    )
    profile = profile_resp.data or {}

    return AuthResponse(
        access_token=session.access_token,
        user={
            "id": str(user.id),
            "email": user.email,
            "role": profile.get("role", "employee"),
            "full_name": profile.get("full_name", ""),
        },
    )
