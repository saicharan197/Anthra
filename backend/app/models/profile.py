"""
Dayflow HRMS — Pydantic Schemas: Profiles
"""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional


class ProfileOut(BaseModel):
    """Read-only profile representation returned by the API."""
    id: str
    employee_id: Optional[str] = None
    full_name: str
    email: str
    role: str
    phone: Optional[str] = None
    address: Optional[str] = None
    job_title: Optional[str] = None
    profile_pic_url: Optional[str] = None
    created_at: Optional[str] = None


class ProfileUpdateSelf(BaseModel):
    """Fields an employee is allowed to update on their own profile."""
    phone: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=500)
    profile_pic_url: Optional[str] = Field(default=None, max_length=2048)


class ProfileUpdateAdmin(BaseModel):
    """Fields an admin can update on any profile."""
    employee_id: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = Field(default=None, pattern=r"^(admin|employee)$")
    phone: Optional[str] = None
    address: Optional[str] = None
    job_title: Optional[str] = None
    profile_pic_url: Optional[str] = None
