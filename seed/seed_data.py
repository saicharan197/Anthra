"""
Dayflow HRMS — Database Seed Script

Seeds 1 Admin and 3 Employees with 30 days of attendance,
leave requests, and payroll structures.
"""

import os
from datetime import date, timedelta
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Resolve and load .env from the project root
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(str(_ENV_FILE))

SUPABASE_URL = "https://yrjiiacdxknesvpaxdjr.supabase.co"
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_ANON_KEY:
    raise ValueError("SUPABASE_ANON_KEY environment variable is not set.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# ── Seed Data Definitions ──────────────────────────────────────────
USERS = [
    {
        "email": "admin@dayflow.internal",
        "password": "Admin@12345",
        "full_name": "HR Admin",
        "role": "admin",
        "employee_id": "EMP-001",
        "job_title": "HR Manager",
        "phone": "+91 90000 00001",
        "address": "HQ Administrative Block",
        "payroll": {"basic_salary": 80000, "allowances": 15000, "standard_deductions": 8000}
    },
    {
        "email": "sarah.chen@dayflow.internal",
        "password": "User@12345",
        "full_name": "Sarah Chen",
        "role": "employee",
        "employee_id": "EMP-002",
        "job_title": "Lead Frontend Engineer",
        "phone": "+91 98765 00002",
        "address": "Coimbatore, TN",
        "payroll": {"basic_salary": 60000, "allowances": 12000, "standard_deductions": 5000}
    },
    {
        "email": "marcus.rodriguez@dayflow.internal",
        "password": "User@12345",
        "full_name": "Marcus Rodriguez",
        "role": "employee",
        "employee_id": "EMP-003",
        "job_title": "QA Engineer",
        "phone": "+91 98765 00003",
        "address": "Chennai, TN",
        "payroll": {"basic_salary": 45000, "allowances": 9000, "standard_deductions": 4000}
    },
    {
        "email": "priya.sharma@dayflow.internal",
        "password": "User@12345",
        "full_name": "Priya Sharma",
        "role": "employee",
        "employee_id": "EMP-004",
        "job_title": "DevOps Engineer",
        "phone": "+91 98765 00004",
        "address": "Bangalore, KA",
        "payroll": {"basic_salary": 55000, "allowances": 10000, "standard_deductions": 4500}
    }
]

def seed():
    print("🚀 Starting Dayflow HRMS seeding...")
    user_tokens = {}
    profile_ids = {}

    # ── Step 1: Sign up and sign in users ────────────────────────────
    for user_info in USERS:
        email = user_info["email"]
        password = user_info["password"]
        
        # Try signing in first
        try:
            auth = supabase.auth.sign_in_with_password({"email": email, "password": password})
            print(f"✔ Signed in existing user: {email}")
        except Exception:
            # Sign up if sign in fails
            try:
                auth = supabase.auth.sign_up({
                    "email": email,
                    "password": password,
                    "options": {
                        "data": {
                            "full_name": user_info["full_name"],
                            "role": user_info["role"],
                            "employee_id": user_info["employee_id"]
                        }
                    }
                })
                print(f"➕ Registered and signed up new user: {email}")
            except Exception as e:
                print(f"❌ Failed signup for {email}: {e}")
                continue
        
        user_tokens[email] = auth.session.access_token
        profile_ids[email] = auth.user.id

    # Configure client to act as Admin
    admin_token = user_tokens.get("admin@dayflow.internal")
    if not admin_token:
        print("❌ Cannot proceed without Admin authentication.")
        return

    admin_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    admin_client.postgrest.auth(admin_token)

    # ── Step 2: Seed payroll structures and update profile details ──
    for user_info in USERS:
        email = user_info["email"]
        user_id = profile_ids.get(email)
        if not user_id:
            continue

        # Admin sets payroll structures & job title/phone
        p_struct = user_info["payroll"]
        try:
            admin_client.table("payroll_structures").upsert({
                "employee_id": user_id,
                "basic_salary": p_struct["basic_salary"],
                "allowances": p_struct["allowances"],
                "standard_deductions": p_struct["standard_deductions"]
            }, on_conflict="employee_id").execute()
            
            admin_client.table("profiles").update({
                "job_title": user_info["job_title"],
                "phone": user_info["phone"],
                "address": user_info["address"],
                "employee_id": user_info["employee_id"]
            }).eq("id", user_id).execute()
            
            print(f"✔ Configured profile and payroll structure for {email}")
        except Exception as e:
            print(f"⚠️ Error setting profile/payroll for {email}: {e}")

    # ── Step 3: Seed 30 calendar days of attendance ─────────────────
    today = date.today()
    for user_info in USERS:
        email = user_info["email"]
        user_id = profile_ids.get(email)
        token = user_tokens.get(email)
        if not user_id or not token:
            continue

        # Authenticate client as the respective user to satisfy RLS insertion
        user_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        user_client.postgrest.auth(token)

        print(f"📅 Seeding 30 days of attendance for {email}...")
        for i in range(30):
            day = today - timedelta(days=i)
            # Skip weekends for standard attendance
            if day.weekday() >= 5:
                continue

            # Determine attendance status state representation:
            # Marcus has some Absent and Half-days to check pro-rata calculations
            if email == "marcus.rodriguez@dayflow.internal" and i in [5, 12]:
                status = "Absent"
                check_in, check_out = None, None
            elif email == "marcus.rodriguez@dayflow.internal" and i == 8:
                status = "Half-day"
                check_in = f"{day.isoformat()}T09:00:00Z"
                check_out = f"{day.isoformat()}T13:00:00Z"
            else:
                status = "Present"
                check_in = f"{day.isoformat()}T08:45:00Z"
                check_out = f"{day.isoformat()}T17:15:00Z"

            try:
                user_client.table("attendance").upsert({
                    "employee_id": user_id,
                    "date": day.isoformat(),
                    "check_in_time": check_in,
                    "check_out_time": check_out,
                    "status": status,
                    "sync_idempotency_key": f"seed_att_{user_id}_{day.isoformat()}"
                }, on_conflict="employee_id,date").execute()
            except Exception as e:
                # Silently skip on insert conflicts
                pass

    # ── Step 4: Seed Leave Requests ─────────────────────────────────
    # We will log in as employees to submit leaves (satisfy INSERT check on status='Pending')
    # Then Admin will approve/reject them.
    for user_info in USERS:
        if user_info["role"] == "admin":
            continue
        email = user_info["email"]
        user_id = profile_ids.get(email)
        token = user_tokens.get(email)
        if not user_id or not token:
            continue

        user_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        user_client.postgrest.auth(token)

        # Create 3 leave requests of different types
        leaves_to_apply = [
            {"type": "Paid", "start": (today - timedelta(days=20)).isoformat(), "end": (today - timedelta(days=19)).isoformat(), "remarks": "Need to attend family event.", "target_status": "Approved"},
            {"type": "Sick", "start": (today - timedelta(days=10)).isoformat(), "end": (today - timedelta(days=10)).isoformat(), "remarks": "Dental appointment.", "target_status": "Rejected"},
            {"type": "Unpaid", "start": (today + timedelta(days=5)).isoformat(), "end": (today + timedelta(days=6)).isoformat(), "remarks": "Personal work.", "target_status": "Pending"}
        ]

        print(f"🏖️ Seeding leave requests for {email}...")
        for leave_item in leaves_to_apply:
            try:
                # Submit leave request as pending
                apply_resp = user_client.table("leave_requests").insert({
                    "employee_id": user_id,
                    "leave_type": leave_item["type"],
                    "start_date": leave_item["start"],
                    "end_date": leave_item["end"],
                    "remarks": leave_item["remarks"],
                    "status": "Pending"
                }).execute()

                if apply_resp.data and leave_item["target_status"] != "Pending":
                    leave_id = apply_resp.data[0]["id"]
                    # Admin approves / rejects it
                    admin_client.table("leave_requests").update({
                        "status": leave_item["target_status"],
                        "admin_comments": f"Processed: {leave_item['target_status']}"
                    }).eq("id", leave_id).execute()
            except Exception as e:
                print(f"⚠️ Error seeding leave for {email}: {e}")

    print("🎉 Database seeding completed successfully!")

if __name__ == "__main__":
    seed()
