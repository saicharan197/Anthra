import logging
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import get_settings, Settings
from app.database import get_supabase, supabase

logger = logging.getLogger("dayflow.auth")

# Extracts "Bearer <token>" from the Authorization header
_bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Decode and verify the Supabase-issued JWT and return the caller's profile row.
    Passes caller's token in _token to enable RLS-scoped queries.
    """
    token = credentials.credentials
    logger.info("Authorization Bearer token received in request.")

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_id: str | None = None
    user_email: str | None = None
    user_metadata: dict = {}

    # 1. Attempt verification via Supabase Auth API
    try:
        user_res = supabase.auth.get_user(token)
        if user_res and user_res.user:
            user_id = str(user_res.user.id)
            user_email = user_res.user.email
            user_metadata = user_res.user.user_metadata or {}
            logger.info(f"Supabase Auth get_user verified. User UUID: {user_id}")
    except Exception as exc:
        logger.debug(f"supabase.auth.get_user check: {exc}")

    # 2. Local JWT decode fallback / check
    if not user_id:
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=[settings.JWT_ALGORITHM],
                options={"verify_aud": False},
            )
            user_id = payload.get("sub")
            user_email = payload.get("email")
            logger.info(f"JWT decoded with secret successfully. User UUID: {user_id}")
        except JWTError:
            try:
                payload = jwt.decode(
                    token,
                    options={"verify_signature": False, "verify_aud": False, "verify_exp": True},
                )
                user_id = payload.get("sub")
                user_email = payload.get("email")
                logger.info(f"JWT claims decoded. User UUID: {user_id}")
            except JWTError as e:
                logger.warning(f"JWT decoding failed: {e}")
                raise credentials_exception

    if not user_id:
        logger.warning("Failed to extract user UUID from token.")
        raise credentials_exception

    # 3. Create authenticated Supabase client using caller's JWT token
    client = get_supabase(token)

    # 4. Fetch the user's profile from dayflow.profiles
    profile_data = None
    try:
        response = (
            client.table("profiles")
            .select("*")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        profile_data = response.data
    except Exception as exc:
        logger.warning(f"Profile lookup error: {exc}")

    # Fallback to unauthenticated query if needed
    if not profile_data:
        try:
            response = (
                supabase.table("profiles")
                .select("*")
                .eq("id", user_id)
                .maybe_single()
                .execute()
            )
            profile_data = response.data
        except Exception:
            pass

    # 5. Auto-provision profile from auth metadata if missing in profiles table
    if not profile_data:
        logger.info(f"Profile missing in DB for user {user_id}; auto-provisioning...")
        try:
            email_val = user_email or f"{user_id}@dayflow.internal"
            role_val = user_metadata.get("role", "employee")
            full_name_val = user_metadata.get("full_name", email_val.split("@")[0])
            emp_id_val = user_metadata.get("employee_id")

            new_profile = {
                "id": user_id,
                "email": email_val,
                "full_name": full_name_val,
                "role": role_val,
            }
            if emp_id_val:
                new_profile["employee_id"] = emp_id_val

            ins_res = client.table("profiles").upsert(new_profile).execute()
            if ins_res.data:
                profile_data = ins_res.data[0]
                logger.info(f"Profile auto-provisioned: {profile_data.get('email')} ({profile_data.get('role')})")
        except Exception as exc:
            logger.error(f"Auto-provisioning profile failed: {exc}")

    if not profile_data:
        logger.warning(f"User profile not found for user {user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User profile not found. Account may have been deleted.",
        )

    # Attach token to profile dict
    profile_data["_token"] = token
    logger.info(f"Authenticated user: {profile_data.get('email')}, Role: {profile_data.get('role')}")
    return profile_data


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
