"""
Dayflow HRMS — Pydantic Schemas: Payroll
"""

from pydantic import BaseModel, Field
from typing import Optional


class PayrollStructureIn(BaseModel):
    """Payload for PUT /api/payroll/structure/{employee_id} (admin only)."""
    basic_salary: float = Field(..., gt=0)
    allowances: float = Field(default=0.0, ge=0)
    standard_deductions: float = Field(default=0.0, ge=0)


class PayrollStructureOut(BaseModel):
    """Stored payroll structure returned by the API."""
    id: str
    employee_id: str
    basic_salary: float
    allowances: float
    standard_deductions: float
    updated_at: Optional[str] = None


class PayslipOut(BaseModel):
    """Computed pro-rata monthly payslip."""
    employee_id: str
    employee_name: str
    month: str
    total_working_days: int
    days_present: int
    days_absent: int
    days_leave_approved: int

    basic_salary: float
    allowances: float
    standard_deductions: float

    gross_salary: float
    absence_deduction: float
    net_salary: float
