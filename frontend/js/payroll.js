// ============================================================
// Dayflow HRMS — Payroll Module
// ============================================================

import { getCurrentUser, isAdmin, getAllEmployees } from './auth.js';
import { showToast, fmtCurrency, showModal, hideModal } from './ui.js';

// ── Mock Payroll Structures ──────────────────────────────────
const _payrollData = {
  'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c': {
    basic_salary: 45000,
    allowances: 10000,
    standard_deductions: 5000,
  },
  'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d': {
    basic_salary: 75000,
    allowances: 15000,
    standard_deductions: 8000,
  },
};

// ── Render ───────────────────────────────────────────────────

export function renderPayrollView() {
  if (isAdmin()) {
    _renderAdminTable();
  } else {
    _renderPayslip();
  }
}

function _renderPayslip() {
  const user = getCurrentUser();
  const data = _payrollData[user.id];

  if (!data) {
    document.getElementById('ps-basic').textContent = '—';
    document.getElementById('ps-allow').textContent = '—';
    document.getElementById('ps-gross').textContent = '—';
    document.getElementById('ps-deduct').textContent = '—';
    document.getElementById('ps-absence').textContent = '—';
    document.getElementById('ps-net').textContent = '—';
    return;
  }

  const gross = data.basic_salary + data.allowances;
  const absenceDeduction = 0; // Would be calculated from attendance in production
  const net = gross - data.standard_deductions - absenceDeduction;

  const now = new Date();
  document.getElementById('payslip-month').textContent = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  document.getElementById('payslip-emp-name').textContent = `${user.full_name} · ${user.employee_id}`;
  document.getElementById('ps-basic').textContent = fmtCurrency(data.basic_salary);
  document.getElementById('ps-allow').textContent = fmtCurrency(data.allowances);
  document.getElementById('ps-gross').textContent = fmtCurrency(gross);
  document.getElementById('ps-deduct').textContent = `−${fmtCurrency(data.standard_deductions)}`;
  document.getElementById('ps-absence').textContent = absenceDeduction > 0 ? `−${fmtCurrency(absenceDeduction)}` : '−₹0';
  document.getElementById('ps-net').textContent = fmtCurrency(net);
}

function _renderAdminTable() {
  const tbody = document.getElementById('payroll-admin-tbody');
  const employees = getAllEmployees();

  tbody.innerHTML = employees.map(emp => {
    const data = _payrollData[emp.id] || { basic_salary: 0, allowances: 0, standard_deductions: 0 };
    const net = data.basic_salary + data.allowances - data.standard_deductions;
    return `
      <tr>
        <td class="fw-600">${emp.full_name}</td>
        <td>${emp.employee_id}</td>
        <td>${fmtCurrency(data.basic_salary)}</td>
        <td>${fmtCurrency(data.allowances)}</td>
        <td>${fmtCurrency(data.standard_deductions)}</td>
        <td class="fw-700 text-accent">${fmtCurrency(net)}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="window._editPayroll('${emp.id}', '${emp.full_name}')">Edit</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ── Admin Edit Modal ─────────────────────────────────────────

function _openEditModal(empId, empName) {
  const data = _payrollData[empId] || { basic_salary: 0, allowances: 0, standard_deductions: 0 };
  const html = `
    <div class="modal-header">
      <h3>Edit Compensation — ${empName}</h3>
      <button class="modal-close" onclick="window._closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Basic Salary (₹)</label>
        <input type="number" class="form-input" id="edit-basic" value="${data.basic_salary}" min="0" step="500">
      </div>
      <div class="form-group">
        <label>Allowances (₹)</label>
        <input type="number" class="form-input" id="edit-allow" value="${data.allowances}" min="0" step="500">
      </div>
      <div class="form-group">
        <label>Standard Deductions (₹)</label>
        <input type="number" class="form-input" id="edit-deduct" value="${data.standard_deductions}" min="0" step="500">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="window._closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-save-payroll">Save Changes</button>
    </div>
  `;
  showModal(html);

  setTimeout(() => {
    document.getElementById('btn-save-payroll').addEventListener('click', () => {
      const basic = parseFloat(document.getElementById('edit-basic').value) || 0;
      const allow = parseFloat(document.getElementById('edit-allow').value) || 0;
      const deduct = parseFloat(document.getElementById('edit-deduct').value) || 0;

      _payrollData[empId] = { basic_salary: basic, allowances: allow, standard_deductions: deduct };
      showToast(`Compensation updated for ${empName}.`, 'success');
      hideModal();
      renderPayrollView();
    });
  }, 50);
}

/** Handle PDF download stub */
export function handleDownloadPDF() {
  showToast('PDF download feature coming soon!', 'info');
}

// Expose to global scope
window._editPayroll = _openEditModal;
window._closeModal = hideModal;
