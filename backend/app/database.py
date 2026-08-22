"""
Dayflow HRMS — Supabase Client Initialization

Provides a pre-configured Supabase client singleton using the ANON key.
All requests pass through RLS policies and respect the authenticated
user's JWT claims.
"""

from supabase import create_client, Client
from app.config import get_settings


def _init_supabase() -> Client:
    """Create and return a Supabase client instance."""
    settings = get_settings()
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


# ── Exported singleton ──────────────────────────────────────────────
supabase: Client = _init_supabase()
