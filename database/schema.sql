-- ============================================================================
-- Dayflow HRMS — Master Database Schema
-- ============================================================================
-- Target:   Supabase (PostgreSQL 15+)
-- Purpose:  Database creation, schema setup, tables, constraints, helper
--           functions, RLS policies, and triggers.
--
-- USAGE:
--   1. Connect as a superuser / postgres role and run the DATABASE + SCHEMA
--      creation section first (§0a–§0b).
--   2. Then connect to the `dayflow` database and run the rest of the script
--      in the Supabase SQL Editor or via psql.
--
-- IMPORTANT:
--   This script is idempotent — it uses IF NOT EXISTS / OR REPLACE so it can
--   be re-run safely without destroying existing data.
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  0a. CREATE DATABASE                                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- NOTE: CREATE DATABASE cannot run inside a transaction block.
-- If running in Supabase SQL Editor, you may need to execute this
-- statement separately, or skip it if using the default `postgres` DB.

-- Uncomment the line below if you need a dedicated database:
-- CREATE DATABASE dayflow;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  0b. CREATE SCHEMA & SET SEARCH PATH                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE SCHEMA IF NOT EXISTS dayflow;

-- Set search_path so unqualified names resolve to our schema first
SET search_path TO dayflow, public;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  0c. EXTENSIONS                                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- pgcrypto provides gen_random_uuid() — enabled by default on Supabase,
-- but we ensure it explicitly for local / self-hosted setups.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  1. TABLES & CONSTRAINTS                                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ────────────────────────────────────────────────
-- 1a. profiles
-- ────────────────────────────────────────────────
-- One-to-one extension of auth.users.
-- Automatically populated via trigger on signup (see §5).

CREATE TABLE IF NOT EXISTS dayflow.profiles (
    id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    employee_id     VARCHAR     UNIQUE,
    full_name       VARCHAR     NOT NULL DEFAULT '',
    email           VARCHAR     UNIQUE NOT NULL,
    role            VARCHAR     NOT NULL DEFAULT 'employee'
                                CHECK (role IN ('admin', 'employee')),
    phone           VARCHAR,
    address         TEXT,
    job_title       VARCHAR,
    profile_pic_url TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  dayflow.profiles             IS 'Extended user profiles linked 1-to-1 with Supabase auth.users.';
COMMENT ON COLUMN dayflow.profiles.role        IS 'RBAC role — admin has elevated access; employee is default.';
COMMENT ON COLUMN dayflow.profiles.employee_id IS 'Human-readable employee identifier (e.g., EMP-0042). Assigned by admin.';


-- ────────────────────────────────────────────────
-- 1b. attendance
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dayflow.attendance (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id           UUID        NOT NULL REFERENCES dayflow.profiles(id) ON DELETE CASCADE,
    date                  DATE        NOT NULL,
    check_in_time         TIMESTAMPTZ,
    check_out_time        TIMESTAMPTZ,
    status                VARCHAR     CHECK (status IN ('Present', 'Absent', 'Half-day', 'Leave')),
    sync_idempotency_key  VARCHAR     UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate attendance rows for the same employee on the same date
    UNIQUE (employee_id, date)
);

COMMENT ON TABLE  dayflow.attendance                       IS 'Daily attendance records per employee.';
COMMENT ON COLUMN dayflow.attendance.sync_idempotency_key  IS 'Client-generated key ensuring offline-synced records are not duplicated.';


-- ────────────────────────────────────────────────
-- 1c. leave_requests
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dayflow.leave_requests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID        NOT NULL REFERENCES dayflow.profiles(id) ON DELETE CASCADE,
    leave_type      VARCHAR     NOT NULL
                                CHECK (leave_type IN ('Paid', 'Sick', 'Unpaid')),
    start_date      DATE        NOT NULL,
    end_date        DATE        NOT NULL,
    remarks         TEXT,
    status          VARCHAR     NOT NULL DEFAULT 'Pending'
                                CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    admin_comments  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Sanity: leave cannot end before it starts
    CHECK (end_date >= start_date)
);

COMMENT ON TABLE  dayflow.leave_requests        IS 'Employee time-off requests with admin approval workflow.';
COMMENT ON COLUMN dayflow.leave_requests.status IS 'Approval state — only admins may transition from Pending.';


-- ────────────────────────────────────────────────
-- 1d. payroll_structures
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dayflow.payroll_structures (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id         UUID        UNIQUE NOT NULL REFERENCES dayflow.profiles(id) ON DELETE CASCADE,
    basic_salary        NUMERIC(10,2) NOT NULL,
    allowances          NUMERIC(10,2) NOT NULL DEFAULT 0,
    standard_deductions NUMERIC(10,2) NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dayflow.payroll_structures IS 'Per-employee salary structure. One row per employee; admin-managed.';


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  2. INDEXES (Performance)                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date
    ON dayflow.attendance (employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee
    ON dayflow.leave_requests (employee_id);

CREATE INDEX IF NOT EXISTS idx_leave_requests_status
    ON dayflow.leave_requests (status);

CREATE INDEX IF NOT EXISTS idx_profiles_role
    ON dayflow.profiles (role);


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  3. SECURITY HELPER FUNCTIONS                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ────────────────────────────────────────────────
-- 3a. is_admin(user_id UUID) → BOOLEAN
-- ────────────────────────────────────────────────
-- Centralises the admin check used by every RLS policy.
-- SECURITY DEFINER ensures the function runs with the privileges of the
-- function owner (postgres), bypassing RLS on the profiles table itself
-- and avoiding infinite recursion.

CREATE OR REPLACE FUNCTION dayflow.is_admin(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE                     -- Pure read; result is stable within a single statement
SECURITY DEFINER           -- Bypass RLS to avoid recursive policy evaluation
SET search_path = dayflow  -- Harden against search_path attacks
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM dayflow.profiles
        WHERE id   = check_user_id
          AND role = 'admin'
    );
$$;

COMMENT ON FUNCTION dayflow.is_admin(UUID) IS
    'Returns TRUE if the given user has the admin role. Used by RLS policies.';


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  4. ROW LEVEL SECURITY (RLS)                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Enable RLS on every dayflow table.
ALTER TABLE dayflow.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dayflow.attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE dayflow.leave_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dayflow.payroll_structures ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────
-- 4a. profiles — RLS Policies
-- ────────────────────────────────────────────────

-- SELECT: Users see their own row; admins see all rows.
DROP POLICY IF EXISTS profiles_select_own_or_admin ON dayflow.profiles;
CREATE POLICY profiles_select_own_or_admin
    ON dayflow.profiles FOR SELECT
    USING (
        auth.uid() = id
        OR dayflow.is_admin(auth.uid())
    );

-- UPDATE (employee): Employees may update ONLY their contact info & photo.
-- The WITH CHECK ensures they cannot promote themselves or change their email.
DROP POLICY IF EXISTS profiles_update_own_contact ON dayflow.profiles;
CREATE POLICY profiles_update_own_contact
    ON dayflow.profiles FOR UPDATE
    USING (
        auth.uid() = id
        AND NOT dayflow.is_admin(auth.uid())   -- non-admins only
    )
    WITH CHECK (
        -- Immutable fields must remain unchanged
        auth.uid()  = id
        AND role    = (SELECT p.role        FROM dayflow.profiles p WHERE p.id = id)
        AND email   = (SELECT p.email       FROM dayflow.profiles p WHERE p.id = id)
        AND full_name = (SELECT p.full_name FROM dayflow.profiles p WHERE p.id = id)
        AND job_title = (SELECT p.job_title FROM dayflow.profiles p WHERE p.id = id)
        AND employee_id = (SELECT p.employee_id FROM dayflow.profiles p WHERE p.id = id)
    );

-- INSERT (admin): Only admins can manually insert profile rows.
-- (Normal signups are handled by the auth trigger in §5.)
DROP POLICY IF EXISTS profiles_insert_admin ON dayflow.profiles;
CREATE POLICY profiles_insert_admin
    ON dayflow.profiles FOR INSERT
    WITH CHECK (
        dayflow.is_admin(auth.uid())
    );

-- UPDATE (admin): Admins can update any field on any profile.
DROP POLICY IF EXISTS profiles_update_admin ON dayflow.profiles;
CREATE POLICY profiles_update_admin
    ON dayflow.profiles FOR UPDATE
    USING (
        dayflow.is_admin(auth.uid())
    )
    WITH CHECK (
        dayflow.is_admin(auth.uid())
    );


-- ────────────────────────────────────────────────
-- 4b. attendance — RLS Policies
-- ────────────────────────────────────────────────

-- SELECT: Employees see own records; admins see all.
DROP POLICY IF EXISTS attendance_select ON dayflow.attendance;
CREATE POLICY attendance_select
    ON dayflow.attendance FOR SELECT
    USING (
        auth.uid() = employee_id
        OR dayflow.is_admin(auth.uid())
    );

-- INSERT: Employees can log their own attendance.
DROP POLICY IF EXISTS attendance_insert_own ON dayflow.attendance;
CREATE POLICY attendance_insert_own
    ON dayflow.attendance FOR INSERT
    WITH CHECK (
        auth.uid() = employee_id
    );

-- UPDATE: Employees can update their own records (e.g., check-out);
--         admins can update any record (e.g., corrections).
DROP POLICY IF EXISTS attendance_update ON dayflow.attendance;
CREATE POLICY attendance_update
    ON dayflow.attendance FOR UPDATE
    USING (
        auth.uid() = employee_id
        OR dayflow.is_admin(auth.uid())
    )
    WITH CHECK (
        auth.uid() = employee_id
        OR dayflow.is_admin(auth.uid())
    );


-- ────────────────────────────────────────────────
-- 4c. leave_requests — RLS Policies
-- ────────────────────────────────────────────────

-- SELECT: Employees see own requests; admins see all.
DROP POLICY IF EXISTS leave_select ON dayflow.leave_requests;
CREATE POLICY leave_select
    ON dayflow.leave_requests FOR SELECT
    USING (
        auth.uid() = employee_id
        OR dayflow.is_admin(auth.uid())
    );

-- INSERT: Employees can submit new requests — status MUST be 'Pending'.
DROP POLICY IF EXISTS leave_insert_own ON dayflow.leave_requests;
CREATE POLICY leave_insert_own
    ON dayflow.leave_requests FOR INSERT
    WITH CHECK (
        auth.uid() = employee_id
        AND status  = 'Pending'
    );

-- UPDATE: Only admins can update leave requests (approve / reject + comments).
DROP POLICY IF EXISTS leave_update_admin ON dayflow.leave_requests;
CREATE POLICY leave_update_admin
    ON dayflow.leave_requests FOR UPDATE
    USING (
        dayflow.is_admin(auth.uid())
    )
    WITH CHECK (
        dayflow.is_admin(auth.uid())
    );


-- ────────────────────────────────────────────────
-- 4d. payroll_structures — RLS Policies
-- ────────────────────────────────────────────────

-- SELECT: Employees see only their own structure; admins see all.
DROP POLICY IF EXISTS payroll_select ON dayflow.payroll_structures;
CREATE POLICY payroll_select
    ON dayflow.payroll_structures FOR SELECT
    USING (
        auth.uid() = employee_id
        OR dayflow.is_admin(auth.uid())
    );

-- INSERT: Admin only.
DROP POLICY IF EXISTS payroll_insert_admin ON dayflow.payroll_structures;
CREATE POLICY payroll_insert_admin
    ON dayflow.payroll_structures FOR INSERT
    WITH CHECK (
        dayflow.is_admin(auth.uid())
    );

-- UPDATE: Admin only.
DROP POLICY IF EXISTS payroll_update_admin ON dayflow.payroll_structures;
CREATE POLICY payroll_update_admin
    ON dayflow.payroll_structures FOR UPDATE
    USING  ( dayflow.is_admin(auth.uid()) )
    WITH CHECK ( dayflow.is_admin(auth.uid()) );

-- DELETE: Admin only.
DROP POLICY IF EXISTS payroll_delete_admin ON dayflow.payroll_structures;
CREATE POLICY payroll_delete_admin
    ON dayflow.payroll_structures FOR DELETE
    USING (
        dayflow.is_admin(auth.uid())
    );


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  5. AUTOMATIC USER-SYNC TRIGGER                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- When a new user signs up via Supabase Auth, automatically insert a
-- corresponding row into dayflow.profiles.
--
-- The trigger reads optional metadata from the signup payload:
--   • raw_user_meta_data->>'full_name'
--   • raw_user_meta_data->>'role'   (defaults to 'employee')
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dayflow.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER           -- Must bypass RLS to insert into profiles
SET search_path = dayflow  -- Harden against search_path attacks
AS $$
DECLARE
    _role VARCHAR;
BEGIN
    -- Extract role from signup metadata; fall back to 'employee'
    _role := COALESCE(
        NEW.raw_user_meta_data ->> 'role',
        'employee'
    );

    -- Validate role value to satisfy the CHECK constraint
    IF _role NOT IN ('admin', 'employee') THEN
        _role := 'employee';
    END IF;

    INSERT INTO dayflow.profiles (id, email, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        _role
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION dayflow.handle_new_user() IS
    'Trigger function: auto-creates a dayflow.profiles row when a new auth.users row is inserted.';

-- Drop and recreate trigger to ensure idempotency
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION dayflow.handle_new_user();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  6. UPDATED_AT AUTO-TOUCH TRIGGER (payroll_structures)                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION dayflow.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_updated_at ON dayflow.payroll_structures;
CREATE TRIGGER trg_payroll_updated_at
    BEFORE UPDATE ON dayflow.payroll_structures
    FOR EACH ROW
    EXECUTE FUNCTION dayflow.set_updated_at();


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  7. GRANT USAGE ON SCHEMA                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Supabase uses the `anon` and `authenticated` roles for API access.
-- They need USAGE on the dayflow schema and SELECT/INSERT/UPDATE/DELETE
-- on its tables for RLS policies to take effect.

GRANT USAGE ON SCHEMA dayflow TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE
    ON dayflow.profiles TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE
    ON dayflow.attendance TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE
    ON dayflow.leave_requests TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON dayflow.payroll_structures TO anon, authenticated;

-- Allow execution of helper functions
GRANT EXECUTE ON FUNCTION dayflow.is_admin(UUID)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION dayflow.handle_new_user()    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION dayflow.set_updated_at()     TO anon, authenticated;


-- ============================================================================
-- ✅  Schema setup complete.
--
-- Next steps:
--   1. Run this script in your Supabase SQL Editor.
--   2. Create your first admin user via Supabase Auth and manually set
--      their role to 'admin' in the profiles table:
--
--        UPDATE dayflow.profiles SET role = 'admin' WHERE email = 'admin@yourco.com';
--
--   3. Start building API endpoints in backend/app/
-- ============================================================================
