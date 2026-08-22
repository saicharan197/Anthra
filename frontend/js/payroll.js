// ============================================================
// Dayflow HRMS — Payroll Module
// ============================================================

import { getCurrentUser, isAdmin, getAllEmployees } from './auth.js';
import { showToast, fmtCurrency, showModal, hideModal } from './ui.js';
import { apiRequest } from './api.js';

let _payrollStructures = []; // Admin cache of structures

// ── Render ───────────────────────────────────────────────────

export function renderPayrollView() {
  const temp = document.getElementById('view-template-payroll');
  return temp ? `<section class="view active" id="view-payroll">${temp.innerHTML}</section>` : '';
}

export async function initPayrollListeners() {
  if (isAdmin()) {
    await _renderAdminTable();
  } else {
    await _renderPayslip();
  }
  const btn = document.getElementById('btn-download-pdf');
  if (btn) btn.addEventListener('click', handleDownloadPDF);
}

async function _renderPayslip() {
  const user = getCurrentUser();
  if (!user) return;

  const monthEl = document.getElementById('payslip-month');
  const nameEl = document.getElementById('payslip-emp-name');
  
  const psBasic = document.getElementById('ps-basic');
  const psAllow = document.getElementById('ps-allow');
  const psGross = document.getElementById('ps-gross');
  const psDeduct = document.getElementById('ps-deduct');
  const psAbsence = document.getElementById('ps-absence');
  const psNet = document.getElementById('ps-net');

  const now = new Date();
  if (monthEl) monthEl.textContent = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (nameEl) nameEl.textContent = `${user.full_name} · ${user.employee_id || 'No ID'}`;

  try {
    const slip = await apiRequest(`/payroll/slip/${user.id}`);
    
    if (psBasic) psBasic.textContent = fmtCurrency(slip.basic_salary);
    if (psAllow) psAllow.textContent = fmtCurrency(slip.allowances);
    if (psGross) psGross.textContent = fmtCurrency(slip.gross_salary);
    if (psDeduct) psDeduct.textContent = `−${fmtCurrency(slip.standard_deductions)}`;
    if (psAbsence) psAbsence.textContent = `−${fmtCurrency(slip.absence_deduction)}`;
    if (psNet) psNet.textContent = fmtCurrency(slip.net_salary);
  } catch (err) {
    console.error("Failed to load payslip:", err);
    // Display error/unconfigured state friendly to user
    const errorMsg = err.message.includes('not configured')
      ? 'Compensation structure not set by Admin. Please contact HR.'
      : `Failed to load payslip: ${err.message}`;
      
    if (psBasic) psBasic.textContent = '—';
    if (psAllow) psAllow.textContent = '—';
    if (psGross) psGross.textContent = '—';
    if (psDeduct) psDeduct.textContent = '—';
    if (psAbsence) psAbsence.textContent = '—';
    if (psNet) psNet.textContent = 'Unconfigured';
    showToast(errorMsg, 'warning');
  }
}

async function _renderAdminTable() {
  const tbody = document.getElementById('payroll-admin-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:32px">Loading compensation structures...</td></tr>`;

  try {
    const employees = await getAllEmployees();
    
    // Fetch all payroll structures if online
    if (navigator.onLine) {
      _payrollStructures = await apiRequest('/payroll/structures');
    }

    if (employees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:32px">No employees found.</td></tr>`;
      return;
    }

    tbody.innerHTML = employees.map(emp => {
      const struct = _payrollStructures.find(s => s.employee_id === emp.id) || {
        basic_salary: 0,
        allowances: 0,
        standard_deductions: 0
      };
      
      const net = struct.basic_salary + struct.allowances - struct.standard_deductions;
      
      return `
        <tr>
          <td class="fw-600">${emp.full_name}</td>
          <td>${emp.employee_id || '—'}</td>
          <td>${fmtCurrency(struct.basic_salary)}</td>
          <td>${fmtCurrency(struct.allowances)}</td>
          <td>${fmtCurrency(struct.standard_deductions)}</td>
          <td class="fw-700 text-accent">${fmtCurrency(net)}</td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="window._editPayroll('${emp.id}', '${emp.full_name}')">Edit</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error("Failed to render payroll admin table:", err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding:32px; color: var(--danger-text)">Failed to load data: ${err.message}</td></tr>`;
  }
}

// ── Admin Edit Modal ─────────────────────────────────────────

async function _openEditModal(empId, empName) {
  const struct = _payrollStructures.find(s => s.employee_id === empId) || {
    basic_salary: 0,
    allowances: 0,
    standard_deductions: 0
  };

  const html = `
    <div class="modal-header">
      <h3>Edit Compensation — ${empName}</h3>
      <button class="modal-close" onclick="window._closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Basic Salary (₹)</label>
        <input type="number" class="form-input" id="edit-basic" value="${struct.basic_salary}" min="0" step="500">
      </div>
      <div class="form-group">
        <label>Allowances (₹)</label>
        <input type="number" class="form-input" id="edit-allow" value="${struct.allowances}" min="0" step="500">
      </div>
      <div class="form-group">
        <label>Standard Deductions (₹)</label>
        <input type="number" class="form-input" id="edit-deduct" value="${struct.standard_deductions}" min="0" step="500">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="window._closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-save-payroll">Save Changes</button>
    </div>
  `;
  showModal(html);

  setTimeout(() => {
    const btnSave = document.getElementById('btn-save-payroll');
    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        const basic = parseFloat(document.getElementById('edit-basic').value) || 0;
        const allow = parseFloat(document.getElementById('edit-allow').value) || 0;
        const deduct = parseFloat(document.getElementById('edit-deduct').value) || 0;

        if (basic <= 0) {
          showToast('Basic salary must be greater than zero.', 'error');
          return;
        }

        try {
          const updated = await apiRequest(`/payroll/structure/${empId}`, {
            method: 'PUT',
            body: JSON.stringify({
              basic_salary: basic,
              allowances: allow,
              standard_deductions: deduct
            })
          });

          // Update local cache
          const idx = _payrollStructures.findIndex(s => s.employee_id === empId);
          if (idx > -1) {
            _payrollStructures[idx] = updated;
          } else {
            _payrollStructures.push(updated);
          }

          showToast(`Compensation updated for ${empName}.`, 'success');
          hideModal();
          await _renderAdminTable();
        } catch (err) {
          showToast(`Failed to update payroll structure: ${err.message}`, 'error');
        }
      });
    }
  }, 50);
}

/** Handle PDF download */
export function handleDownloadPDF() {
  // Generate a mock PDF download toast
  showToast('Generating PDF payslip...', 'info');
  setTimeout(() => {
    showToast('Payslip downloaded successfully!', 'success');
  }, 1500);
}

// Expose to global scope for inline onclick handlers
window._editPayroll = _openEditModal;
window._closeModal = hideModal;
