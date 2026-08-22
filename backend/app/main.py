"""
Dayflow HRMS — FastAPI Application Entrypoint

Initializes the FastAPI app with CORS middleware, registers all modular
routers under the /api prefix, and exposes a health-check endpoint.

Run with:
    uvicorn app.main:app --reload --port 8000
"""

import time
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import supabase
from app.routers import auth, profile, attendance, sync, leave, payroll

# ── App Boot Timestamp ───────────────────────────────────────────────
_START_TIME = time.monotonic()
_BOOT_UTC = datetime.now(timezone.utc).isoformat()


# ── FastAPI Instance ─────────────────────────────────────────────────
app = FastAPI(
    title="Dayflow HRMS API",
    description=(
        "Offline-first Human Resource Management System — "
        "Attendance, Leave Management, Payroll & Sync Engine."
    ),
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


# ── CORS Middleware ──────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # Permissive for local dev; lock down in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Register Routers ────────────────────────────────────────────────
_API_PREFIX = "/api"

app.include_router(auth.router,       prefix=_API_PREFIX)
app.include_router(profile.router,    prefix=_API_PREFIX)
app.include_router(attendance.router, prefix=_API_PREFIX)
app.include_router(sync.router,       prefix=_API_PREFIX)
app.include_router(leave.router,      prefix=_API_PREFIX)
app.include_router(payroll.router,    prefix=_API_PREFIX)


# ── Health Check ─────────────────────────────────────────────────────

@app.get(
    "/api/health",
    tags=["System"],
    summary="Server health & database connectivity check",
)
async def health_check():
    """
    Returns:
      - **status**: `healthy` or `degraded`
      - **uptime_seconds**: seconds since the process started
      - **boot_time**: UTC ISO timestamp of when the server started
      - **database**: `connected` or the error message
    """
    uptime = round(time.monotonic() - _START_TIME, 2)

    # Quick DB ping: try to read a single row from profiles
    db_status = "connected"
    try:
        supabase.table("profiles").select("id").limit(1).execute()
    except Exception as exc:
        db_status = f"error: {exc}"

    overall = "healthy" if db_status == "connected" else "degraded"

    return {
        "status": overall,
        "uptime_seconds": uptime,
        "boot_time": _BOOT_UTC,
        "database": db_status,
    }
