import pytest
from datetime import date, datetime, timedelta
from decimal import Decimal
from fastapi.testclient import TestClient

from app.main import app
from app.database import supabase
from app.config import get_settings

client = TestClient(app)

# Helper to mock Supabase calls in endpoints if needed, but since we are testing integration
# we can mock database responses to keep tests deterministic and stable.
# We will mock the database table calls to return mock profiles, leaves, etc.

@pytest.fixture(autouse=True)
def mock_supabase_client(monkeypatch):
    """
    Mock Supabase table calls to isolate the API tests from the live DB,
    ensuring deterministic and fast execution.
    """
    class MockResponse:
        def __init__(self, data):
            self.data = data

    class MockQuery:
        def __init__(self, table_name):
            self.table_name = table_name
            self.filters = {}
            self.result_data = None
            self.single = False

        def select(self, *args, **kwargs):
            return self

        def eq(self, col, val):
            self.filters[col] = val
            return self

        def gte(self, col, val):
            return self

        def lte(self, col, val):
            return self

        def order(self, *args, **kwargs):
            return self

        def limit(self, *args, **kwargs):
            return self

        def maybe_single(self):
            self.single = True
            return self

        def insert(self, payload):
            self.result_data = [payload] if isinstance(payload, dict) else payload
            return self

        def upsert(self, payload, on_conflict=None):
            self.result_data = [payload] if isinstance(payload, dict) else payload
            return self

        def update(self, payload):
            self.result_data = [payload] if isinstance(payload, dict) else payload
            return self

        def execute(self):
            if self.result_data is not None:
                data = self.result_data
                # Merge dynamic updates with base mock profile to ensure Pydantic validates successfully
                if self.table_name == "profiles":
                    base = {
                        "id": "emp-123", "role": "employee", "full_name": "Test Emp",
                        "email": "emp@company.com", "employee_id": "EMP-1042",
                        "phone": None, "address": None, "profile_pic_url": None, "job_title": None
                    }
                    if isinstance(data, list):
                        data = [{**base, **item} for item in data]
                    elif isinstance(data, dict):
                        data = {**base, **data}

                # Ensure 'id' exists for response mapping
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "id" not in item:
                            item["id"] = "mock-id-uuid"
                elif isinstance(data, dict):
                    if "id" not in data:
                        data["id"] = "mock-id-uuid"

                if self.single and isinstance(data, list):
                    data = data[0] if data else None
                return MockResponse(data)

            # Default GET queries
            if self.table_name == "profiles":
                user_id = self.filters.get("id")
                if user_id == "emp-123":
                    data = {
                        "id": "emp-123", "role": "employee", "full_name": "Test Emp",
                        "email": "emp@company.com", "employee_id": "EMP-1042",
                        "phone": None, "address": None, "profile_pic_url": None, "job_title": None
                    }
                elif user_id == "admin-123":
                    data = {
                        "id": "admin-123", "role": "admin", "full_name": "Test Admin",
                        "email": "admin@company.com", "employee_id": "EMP-0001",
                        "phone": None, "address": None, "profile_pic_url": None, "job_title": None
                    }
                else:
                    data = {
                        "id": "emp-123", "role": "employee", "full_name": "Test Emp",
                        "email": "emp@company.com", "employee_id": "EMP-1042",
                        "phone": None, "address": None, "profile_pic_url": None, "job_title": None
                    }
                if not self.single:
                    data = [data]
                return MockResponse(data)

            elif self.table_name == "payroll_structures":
                data = {
                    "id": "ps-1", "employee_id": "emp-123", "basic_salary": 45000.0,
                    "allowances": 10000.0, "standard_deductions": 5000.0
                }
                if not self.single:
                    data = [data]
                return MockResponse(data)

            elif self.table_name == "leave_requests":
                # Overlap collision testing mock list
                data = [
                    {
                        "id": "existing-leave-1",
                        "employee_id": "emp-123",
                        "start_date": "2026-08-20",
                        "end_date": "2026-08-25",
                        "leave_type": "Paid",
                        "status": "Approved"
                    }
                ]
                return MockResponse(data)

            elif self.table_name == "attendance":
                data = [
                    {"date": "2026-08-01", "status": "Present"},
                    {"date": "2026-08-02", "status": "Half-day"},
                    {"date": "2026-08-03", "status": "Half-day"},
                    {"date": "2026-08-04", "status": "Absent"}
                ]
                return MockResponse(data)

            return MockResponse([])

    monkeypatch.setattr(supabase, "table", lambda name: MockQuery(name))


# Mock token generation / verification
@pytest.fixture(autouse=True)
def mock_jwt_auth():
    """
    Bypasses token verification by mocking get_current_user to return mock users.
    We handle authorization scoping through custom headers in tests.
    """
    from app.dependencies import get_current_user
    from fastapi import Depends
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
    
    _bearer_scheme = HTTPBearer()
    
    async def mock_get_user(credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme), settings = None):
        # Read header or check some state to decide who is calling
        # For simplicity, we decode custom mock tokens: "admin-token" or "emp-token"
        token = credentials.credentials if credentials else ""
        if token == "admin-token":
            return {
                "id": "admin-123", "role": "admin", "full_name": "Test Admin",
                "email": "admin@company.com", "employee_id": "EMP-0001",
                "phone": None, "address": None, "profile_pic_url": None, "job_title": None
            }
        else:
            return {
                "id": "emp-123", "role": "employee", "full_name": "Test Emp",
                "email": "emp@company.com", "employee_id": "EMP-1042",
                "phone": None, "address": None, "profile_pic_url": None, "job_title": None
            }

    app.dependency_overrides[get_current_user] = mock_get_user
    yield
    app.dependency_overrides.clear()


# ─── 1. RBAC SECURITY BOUNDARIES ─────────────────────────────────────

def test_rbac_employee_denied_on_admin_routes():
    headers = {"Authorization": "Bearer emp-token"}
    
    # 1. Update structure -> 403 Forbidden
    resp = client.put(
        "/api/payroll/structure/emp-123",
        json={"basic_salary": 90000, "allowances": 10000, "standard_deductions": 5000},
        headers=headers
    )
    assert resp.status_code == 403
    assert "admin privileges required" in resp.json()["detail"].lower()

    # 2. Approve leave request -> 403 Forbidden
    resp = client.patch(
        "/api/leave/leave-abc/status",
        json={"status": "Approved", "admin_comments": "Looks good"},
        headers=headers
    )
    assert resp.status_code == 403

    # 3. Update another user's profile -> 403 Forbidden
    resp = client.put(
        "/api/profile/other-user-uuid",
        json={"employee_id": "NEW-ID", "role": "admin"},
        headers=headers
    )
    assert resp.status_code == 403


def test_rbac_admin_allowed_on_admin_routes():
    headers = {"Authorization": "Bearer admin-token"}
    
    # Update structure -> 200 OK
    resp = client.put(
        "/api/payroll/structure/emp-123",
        json={"basic_salary": 90000, "allowances": 10000, "standard_deductions": 5000},
        headers=headers
    )
    assert resp.status_code == 200


def test_employee_cannot_escalate_profile_fields():
    headers = {"Authorization": "Bearer emp-token"}
    
    # Employees PUT /profile/me supports only: phone, address, profile_pic_url.
    # Pydantic schema validation ignores or rejects extra fields.
    resp = client.put(
        "/api/profile/me",
        json={"phone": "+91 99999 88888", "role": "admin", "job_title": "Director"},
        headers=headers
    )
    # The output profile schema should contain the updated phone, but not the role or job_title
    # because Pydantic's ProfileUpdateSelf excludes these fields during loading.
    assert resp.status_code == 200
    data = resp.json()
    assert data["phone"] == "+91 99999 88888"
    assert "role" not in data or data.get("role") != "admin"


# ─── 2. IDEMPOTENCY REPLAY ───────────────────────────────────────────

def test_sync_idempotency_replay(monkeypatch):
    """
    Test that sending the same client_event_id in POST /api/sync
    results in a 'duplicate' report for the second request.
    """
    headers = {"Authorization": "Bearer emp-token"}
    
    # Mocking first call to return no duplicate, second call to return duplicate
    called = []
    
    class MockQueryWithState:
        def __init__(self):
            self.single = False
            
        def select(self, *args, **kwargs): return self
        def eq(self, col, val): return self
        
        def maybe_single(self):
            self.single = True
            return self
            
        def execute(self):
            class MockResponse:
                def __init__(self, data):
                    self.data = data
            if "called" in called:
                # Second call, return a mock record to simulate duplicate
                data = {"id": "existing-att-id"} if self.single else [{"id": "existing-att-id"}]
                return MockResponse(data)
            called.append("called")
            data = None if self.single else []
            return MockResponse(data)
            
        def upsert(self, payload, on_conflict=None):
            return self

    monkeypatch.setattr(supabase, "table", lambda name: MockQueryWithState() if name == "attendance" else supabase.table(name))

    payload = {
        "events": [
            {
                "client_event_id": "unique-event-uuid-abc",
                "type": "check_in",
                "payload": {"date": "2026-08-22", "check_in_time": "2026-08-22T09:00:00Z"}
            }
        ]
    }

    # First request
    resp1 = client.post("/api/sync", json=payload, headers=headers)
    assert resp1.status_code == 200
    res1 = resp1.json()["results"][0]
    assert res1["status"] == "created"

    # Replay request
    resp2 = client.post("/api/sync", json=payload, headers=headers)
    assert resp2.status_code == 200
    res2 = resp2.json()["results"][0]
    assert res2["status"] == "duplicate"


# ─── 3. LEAVE DATE INVARIANTS ────────────────────────────────────────

def test_leave_apply_inverted_dates():
    headers = {"Authorization": "Bearer emp-token"}
    
    # End date before start date
    resp = client.post(
        "/api/leave/apply",
        json={"leave_type": "Paid", "start_date": "2026-08-25", "end_date": "2026-08-20", "remarks": "vacation"},
        headers=headers
    )
    assert resp.status_code == 422
    assert "on or after start_date" in resp.json()["detail"].lower()


def test_leave_apply_overlapping_dates():
    headers = {"Authorization": "Bearer emp-token"}
    
    # Existing leave mock has Aug 20 to Aug 25
    # Requesting Aug 24 to Aug 27 (Overlaps at 24 and 25)
    resp = client.post(
        "/api/leave/apply",
        json={"leave_type": "Sick", "start_date": "2026-08-24", "end_date": "2026-08-27", "remarks": "overlapping request"},
        headers=headers
    )
    assert resp.status_code == 400
    assert "overlap" in resp.json()["detail"].lower()


# ─── 4. REAL-TIME PAYROLL CALCULATION ────────────────────────────────

def test_payslip_real_time_calculation(monkeypatch):
    headers = {"Authorization": "Bearer emp-token"}
    
    # Mocking leave_requests query to return approved unpaid leaves (2 business days: Aug 17, 18)
    original_table = supabase.table
    def mock_table(name):
        if name == "leave_requests":
            class MockQuery:
                def select(self, *args, **kwargs): return self
                def eq(self, col, val): return self
                def execute(self):
                    class MockResponse:
                        data = [
                            {
                                "id": "leave-1",
                                "employee_id": "emp-123",
                                "start_date": "2026-08-17",
                                "end_date": "2026-08-18",
                                "leave_type": "Unpaid",
                                "status": "Approved"
                            }
                        ]
                    return MockResponse()
            return MockQuery()
        return original_table(name)
        
    monkeypatch.setattr(supabase, "table", mock_table)

    # Mocking attendance query to return:
    #   - 1 Present (Aug 1)
    #   - 2 Half-days (Aug 2, Aug 3) = 1 effective absent day
    #   - 1 Absent (Aug 4) = 1 effective absent day
    # Total effective absent days = 2 (unpaid leaves) + 1 (half days) + 1 (absent) = 4 days LOP.
    # Gross = 55000. LOP = 55000 / 30 * 4 = 7333.33
    # Net = 55000 - 5000 (standard) - 7333.33 = 42666.67
    
    resp = client.get("/api/payroll/slip/emp-123", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    
    assert data["gross_salary"] == 55000.00
    assert data["standard_deductions"] == 5000.00
    assert data["absence_deduction"] == 7333.33
    assert data["net_salary"] == 42666.67
    assert data["days_present"] == 1
    assert data["days_absent"] == 1
    assert data["days_leave_approved"] == 2
