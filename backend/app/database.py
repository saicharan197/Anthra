from supabase import create_client, Client
from app.config import get_settings


def get_supabase(token: str | None = None) -> Client:
    """
    Create and return a Supabase client instance.
    If a user JWT token is provided, sets the PostgREST authorization header
    so that queries execute with the authenticated user's context (satisfying RLS).
    """
    settings = get_settings()
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    if token:
        client.postgrest.auth(token)
    return client


# ── Exported singleton for unauthenticated operations ──────────────
supabase: Client = get_supabase()

