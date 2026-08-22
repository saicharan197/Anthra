"""
Dayflow HRMS — FastAPI Dependencies (Auth & RBAC Guards)

Reusable dependency functions injected into route handlers:
  • get_current_user  — Decodes the Bearer JWT and fetches the caller's profile.
  • require_admin     — Enforces admin-only access; raises 403 for employees.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import get_settings, Settings
from app.database import supabase

# Extracts "Bearer <token>" from the Authorization header
_bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Decode the Supabase-issued JWT and return the caller's profile row.

    Flow:
      1. Extract and verify the JWT using the app's SECRET_KEY.
      2. Pull the `sub` claim (Supabase auth user UUID).
      3. Fetch the matching row from dayflow.profiles.
      4. Return the profile dict (id, email, role, …).

    Raises:
        401 Unauthorized — invalid / expired token or user not found.
    """
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_aud": False},   # Supabase tokens have custom aud
        )
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Fetch the user's profile from dayflow.profiles
    response = (
        supabase.table("profiles")
        .select("*")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User profile not found. Account may have been deleted.",
        )

    return response.data


async def require_admin(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Guard dependency — raises 403 if the authenticated user is not an admin.
    Inject this into any route that should be admin-only.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required for this action.",
        )
    return current_user
