#!/bin/bash
# ==============================================================================
# Dayflow HRMS — Backend API Routing Verification Script
# ==============================================================================
# This script executes cURL requests to validate the endpoints.
# Adjust the API_URL variable if your local server runs on a different port.
# ==============================================================================

API_URL="http://127.0.0.1:8000/api"

echo "----------------------------------------------------------------"
echo " Dayflow HRMS API Verification"
echo "----------------------------------------------------------------"

# ── 1. Register Admin User ───────────────────────────────────────────────────
echo -e "\n1. Registering Admin Account..."
curl -s -X POST "$API_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@dayflow.internal",
    "password": "Admin@12345",
    "full_name": "System Admin",
    "role": "admin",
    "employee_id": "EMP-001"
  }' | json_pp 2>/dev/null || curl -s -X POST "$API_URL/auth/signup" -H "Content-Type: application/json" -d '{"email": "admin@dayflow.internal", "password": "Admin@12345", "full_name": "System Admin", "role": "admin", "employee_id": "EMP-001"}'

# ── 2. Authenticate and Fetch Token ───────────────────────────────────────────
echo -e "\n2. Authenticating Admin User..."
AUTH_RESP=$(curl -s -X POST "$API_URL/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@dayflow.internal",
    "password": "Admin@12345"
  }')

echo "Auth Response: $AUTH_RESP"

# Extract Token using a simple python inline block (cross-platform helper)
TOKEN=$(python -c "import json; print(json.loads('''$AUTH_RESP''').get('access_token', ''))" 2>/dev/null || echo "demo-token")

if [ "$TOKEN" == "" ] || [ "$TOKEN" == "demo-token" ]; then
  echo "⚠️ Failed to extract bearer token. Using hardcoded dummy fallback."
  TOKEN="eyJhbGciOiJIUzI1NiJ9.demo-bearer-token"
fi

echo "Bearer Token: ${TOKEN:0:20}..."

# ── 3. Profile Operations ────────────────────────────────────────────────────
echo -e "\n3. Fetching own profile details (/profile/me)..."
curl -s -X GET "$API_URL/profile/me" \
  -H "Authorization: Bearer $TOKEN"

echo -e "\n\n4. Updating profile contact details (PUT /profile/me)..."
curl -s -X PUT "$API_URL/profile/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+91 99000 99000",
    "address": "Admin Quarters, Tower 2"
  }'

# ── 5. Attendance & Check-In Operations ──────────────────────────────────────
echo -e "\n\n5. Logging check-in (/attendance/check-in)..."
curl -s -X POST "$API_URL/attendance/check-in" \
  -H "Authorization: Bearer $TOKEN"

echo -e "\n\n6. Fetching personal attendance log (/attendance)..."
curl -s -X GET "$API_URL/attendance" \
  -H "Authorization: Bearer $TOKEN"

# ── 6. Idempotent Offline Synchronization ─────────────────────────────────────
echo -e "\n\n7. Dispatching batch sync events (/sync)..."
curl -s -X POST "$API_URL/sync" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "client_event_id": "sync-test-uuid-001",
        "type": "check_in",
        "payload": {
          "date": "2026-08-22",
          "check_in_time": "2026-08-22T09:00:00Z"
        }
      }
    ]
  }'

# ── 7. Leave Application ─────────────────────────────────────────────────────
echo -e "\n\n8. Submitting leave request (/leave/apply)..."
curl -s -X POST "$API_URL/leave/apply" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leave_type": "Paid",
    "start_date": "2026-08-28",
    "end_date": "2026-08-30",
    "remarks": "API verification check"
  }'

# ── 8. Payroll Generation ────────────────────────────────────────────────────
echo -e "\n\n9. Setting payroll compensation structure (PUT /payroll/structure)..."
# We extract user ID from profile for correct targeting
PROFILE_DATA=$(curl -s -X GET "$API_URL/profile/me" -H "Authorization: Bearer $TOKEN")
USER_ID=$(python -c "import json; print(json.loads('''$PROFILE_DATA''').get('id', ''))" 2>/dev/null)

if [ "$USER_ID" != "" ]; then
  curl -s -X PUT "$API_URL/payroll/structure/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "basic_salary": 75000,
      "allowances": 15000,
      "standard_deductions": 5000
    }'

  echo -e "\n\n10. Fetching computed payslip breakdown (/payroll/slip)..."
  curl -s -X GET "$API_URL/payroll/slip/$USER_ID" \
    -H "Authorization: Bearer $TOKEN"
else
  echo "⚠️ Skipping payroll tests: user ID not resolved."
fi

echo -e "\n\n----------------------------------------------------------------"
echo " API Routing Verification Complete."
echo "----------------------------------------------------------------"
