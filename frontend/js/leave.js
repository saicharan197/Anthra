// ============================================================
// Dayflow HRMS — Leave Management Module
// ============================================================

import { getCurrentUser, isAdmin } from './auth.js';
import { showToast, showModal, hideModal, fmtDate, uuid, businessDaysBetween } from './ui.js';
import { queueAction } from './offline-sync.js';

// ── Mock Leave Data ─────────────────────────────────────────
const _mockLeaves = [
  {
    id: uuid(),
    employee_id: 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    employee_name: 'Tharun R',
    leave_type: 'Sick',
    start_date: '2026-08-25',
    end_date: '2026-08-26',
    remarks: 'Feeling unwell, need rest.',
    status: 'Pending',
    admin_comments: '',
    created_at: '2026-08-20T10:00:00Z',
  },
  {
    id: uuid(),
    employee_id: 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    employee_name: 'Tharun R',
    leave_type: 'Paid',
    start_date: '2026-07-14',
    end_date: '2026-07-18',
    remarks: 'Family vacation planned.',
    status: 'Approved',
    admin_comments: 'Approved. Enjoy your trip!',
    created_at: '2026-07-05T09:00:00Z',
  },
  {
    id: uuid(),
    employee_id: 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    employee_name: 'Tharun R',
    leave_type: 'Unpaid',
    start_date: '2026-06-20',
    end_date: '2026-06-20',
    remarks: 'Personal errand.',
    status: 'Rejected',
    admin_comments: 'Too many leaves this month.',
    created_at: '2026-06-18T11:00:00Z',
  },
];

// ── Leave Balances (mock) ───────────────────────────────────
const _balances = { paid: { total: 16, used: 4 }, sick: { total: 7, used: 1 }, unpaid: { total: Infinity, used: 0 } };

// ── Render ───────────────────────────────────────────────────

export function renderLeaveView() {
  _renderBalances();
  _renderTable();
}

function _renderBalances() {
  document.getElementById('lb-paid').textContent = _balances.paid.total - _balances.paid.used;
  document.getElementById('lb-sick').textContent = _balances.sick.total - _balances.sick.used;
  document.getElementById('lb-unpaid').textContent = '∞';
}

function _renderTable() {
  const tbody = document.getElementById('leave-tbody');
  const admin = isAdmin();
  const user = getCurrentUser();

  const records = admin
    ? [..._mockLeaves]
    : _mockLeaves.filter(l => l.employee_id === user.id);

  records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${admin ? 8 : 7}" class="text-center text-muted" style="padding:32px">No leave requests found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(l => {
    const days = businessDaysBetween(l.start_date, l.end_date);
    const statusClass = l.status.toLowerCase();
    return `
      <tr>
        ${admin ? `<td class="fw-600">${l.employee_name}</td>` : ''}
        <td>${l.leave_type}</td>
        <td>${fmtDate(l.start_date)}</td>
        <td>${fmtDate(l.end_date)}</td>
        <td class="fw-600">${days}</td>
        <td class="text-sm">${l.remarks || '—'}</td>
        <td><span class="badge badge-${statusClass}">${l.status}</span></td>
        ${admin ? `
          <td>
            ${l.status === 'Pending' ? `
              <button class="btn btn-accent btn-sm" onclick="window._leaveApprove('${l.id}')">Approve</button>
              <button class="btn btn-danger btn-sm" onclick="window._leaveReject('${l.id}')" style="margin-left:6px">Reject</button>
            ` : '<span class="text-muted text-sm">Done</span>'}
          </td>
        ` : ''}
      </tr>
    `;
  }).join('');
}

// ── Apply Leave Modal ────────────────────────────────────────

export function openApplyLeaveModal() {
  const html = `
    <div class="modal-header">
      <h3>Apply for Leave</h3>
      <button class="modal-close" onclick="window._closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Leave Type</label>
        <select class="form-select" id="leave-type">
          <option value="Paid">Paid Leave</option>
          <option value="Sick">Sick Leave</option>
          <option value="Unpaid">Unpaid Leave</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Start Date</label>
          <input type="date" class="form-input" id="leave-start" required>
        </div>
        <div class="form-group">
          <label>End Date</label>
          <input type="date" class="form-input" id="leave-end" required>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:12px">
        <span class="badge badge-pending" id="leave-days-badge" style="font-size:0.875rem;padding:6px 16px">Total Days: 0</span>
      </div>
      <div class="form-group">
        <label>Remarks / Reason</label>
        <textarea class="form-textarea" id="leave-remarks" placeholder="Brief reason for leave…" rows="3"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="window._closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btn-submit-leave">Submit Request</button>
    </div>
  `;
  showModal(html);

  // Live day calculation
  const calcDays = () => {
    const s = document.getElementById('leave-start').value;
    const e = document.getElementById('leave-end').value;
    if (s && e) {
      const days = businessDaysBetween(s, e);
      document.getElementById('leave-days-badge').textContent = `Total Days: ${days}`;
    }
  };

  setTimeout(() => {
    document.getElementById('leave-start').addEventListener('change', calcDays);
    document.getElementById('leave-end').addEventListener('change', calcDays);
    document.getElementById('btn-submit-leave').addEventListener('click', _submitLeave);
  }, 50);
}

async function _submitLeave() {
  const type = document.getElementById('leave-type').value;
  const start = document.getElementById('leave-start').value;
  const end = document.getElementById('leave-end').value;
  const remarks = document.getElementById('leave-remarks').value;

  if (!start || !end) {
    showToast('Please select start and end dates.', 'error');
    return;
  }

  if (new Date(end) < new Date(start)) {
    showToast('End date must be on or after start date.', 'error');
    return;
  }

  const user = getCurrentUser();
  const leave = {
    id: uuid(),
    employee_id: user.id,
    employee_name: user.full_name,
    leave_type: type,
    start_date: start,
    end_date: end,
    remarks,
    status: 'Pending',
    admin_comments: '',
    created_at: new Date().toISOString(),
  };

  _mockLeaves.push(leave);

  if (!navigator.onLine) {
    await queueAction('leave_apply', { leave_type: type, start_date: start, end_date: end, remarks });
  } else {
    showToast('Leave request submitted!', 'success');
  }

  hideModal();
  renderLeaveView();
}

// ── Admin Actions ────────────────────────────────────────────

function _approveLeave(id) {
  const leave = _mockLeaves.find(l => l.id === id);
  if (leave) {
    leave.status = 'Approved';
    leave.admin_comments = 'Approved by admin.';
    showToast('Leave request approved.', 'success');
    renderLeaveView();
  }
}

function _rejectLeave(id) {
  const leave = _mockLeaves.find(l => l.id === id);
  if (leave) {
    leave.status = 'Rejected';
    leave.admin_comments = 'Rejected by admin.';
    showToast('Leave request rejected.', 'info');
    renderLeaveView();
  }
}

// Expose to global scope for inline onclick handlers
window._leaveApprove = _approveLeave;
window._leaveReject = _rejectLeave;
window._closeModal = hideModal;
