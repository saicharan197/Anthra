"""
Dayflow HRMS — Pydantic Schemas: Authentication
"""

from pydantic import BaseModel, EmailStr, Field


class SignUpRequest(BaseModel):
    """Payload for POST /api/auth/signup."""
    employee_id: str = Field(..., min_length=1, max_length=20, examples=["EMP-0042"])
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=120)
    role: str = Field(default="employee", pattern=r"^(admin|employee)$")


class SignInRequest(BaseModel):
    """Payload for POST /api/auth/signin."""
    email: EmailStr
    password: str = Field(..., min_length=1)


class AuthResponse(BaseModel):
    """Unified response for signup / signin."""
    access_token: str
    token_type: str = "bearer"
    user: dict
