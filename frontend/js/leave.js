// ============================================================
// Dayflow HRMS — Leave Management Module
// ============================================================

import { getCurrentUser, isAdmin } from './auth.js';
import { showToast, showModal, hideModal, fmtDate, uuid, businessDaysBetween } from './ui.js';
import { enqueueAction, getPendingQueue } from './offline-db.js';
import { updateNetworkBadge } from './offline-sync.js';
import { apiRequest } from './api.js';

let _leaves = [];

// ── Render ───────────────────────────────────────────────────

export function renderLeaveView() {
  const temp = document.getElementById('view-template-leave');
  return temp ? `<section class="view active" id="view-leave">${temp.innerHTML}</section>` : '';
}

export async function initLeaveListeners() {
  await _loadLeaves();
  _renderBalances();
  _renderTable();
  const btn = document.getElementById('btn-apply-leave');
  if (btn) btn.addEventListener('click', openApplyLeaveModal);
}

/** Load leave requests from backend API or IndexedDB */
async function _loadLeaves() {
  if (navigator.onLine) {
    try {
      const data = await apiRequest('/leave/all');
      _leaves = data || [];
    } catch (err) {
      console.warn("Failed to fetch leaves from API:", err);
    }
  }

  // Merge queued offline items so they appear immediately in UI
  try {
    const queue = await getPendingQueue();
    const user = getCurrentUser();
    queue.forEach(item => {
      if (item.type === 'leave_apply') {
        _leaves.unshift({
          id: item.client_event_id,
          employee_id: user.id,
          employee_name: user.full_name,
          leave_type: item.payload.leave_type,
          start_date: item.payload.start_date,
          end_date: item.payload.end_date,
          remarks: item.payload.remarks,
          status: 'Pending',
          admin_comments: '',
          created_at: item.timestamp,
          pending: true
        });
      }
    });
  } catch (err) {
    console.error("Failed to load pending queue in leaves:", err);
  }
}

function _renderBalances() {
  // Paid leave balance starts at 16. Calculate based on Approved Paid leaves.
  const approvedPaidLeaves = _leaves.filter(l => l.leave_type === 'Paid' && l.status === 'Approved');
  let usedPaid = 0;
  approvedPaidLeaves.forEach(l => {
    usedPaid += businessDaysBetween(l.start_date, l.end_date);
  });

  // Sick leave balance starts at 7.
  const approvedSickLeaves = _leaves.filter(l => l.leave_type === 'Sick' && l.status === 'Approved');
  let usedSick = 0;
  approvedSickLeaves.forEach(l => {
    usedSick += businessDaysBetween(l.start_date, l.end_date);
  });

  const lbPaid = document.getElementById('lb-paid');
  const lbSick = document.getElementById('lb-sick');
  if (lbPaid) lbPaid.textContent = 16 - usedPaid;
  if (lbSick) lbSick.textContent = 7 - usedSick;
}

function _renderTable() {
  const tbody = document.getElementById('leave-tbody');
  if (!tbody) return;

  const admin = isAdmin();
  const user = getCurrentUser();

  const records = admin
    ? [..._leaves]
    : _leaves.filter(l => l.employee_id === user.id);

  // Sort by date descending
  records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${admin ? 8 : 7}" class="text-center text-muted" style="padding:32px">No leave requests found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(l => {
    const days = businessDaysBetween(l.start_date, l.end_date);
    const statusClass = l.status.toLowerCase();
    const pendingLabel = l.pending ? ' <small class="text-muted">(queued)</small>' : '';
    
    let actionsHtml = '<span class="text-muted text-sm">Done</span>';
    if (l.status === 'Pending') {
      if (l.pending) {
        actionsHtml = '<span class="text-muted text-sm">Queued offline</span>';
      } else {
        actionsHtml = `
          <button class="btn btn-accent btn-sm" onclick="window._leaveApprove('${l.id}')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="window._leaveReject('${l.id}')" style="margin-left:6px">Reject</button>
        `;
      }
    }

    return `
      <tr>
        ${admin ? `<td class="fw-600">${l.employee_name || '—'}</td>` : ''}
        <td>${l.leave_type}</td>
        <td>${fmtDate(l.start_date)}</td>
        <td>${fmtDate(l.end_date)}</td>
        <td class="fw-600">${days}</td>
        <td class="text-sm">${l.remarks || '—'}</td>
        <td><span class="badge badge-${statusClass}">${l.status}</span>${pendingLabel}</td>
        ${admin ? `<td>${actionsHtml}</td>` : ''}
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

  // ── Frontend Conflict Validation ───────────────────────────
  const newStart = new Date(start);
  const newEnd = new Date(end);
  const overlap = _leaves.some(l => {
    if (l.status === 'Rejected') return false;
    const extStart = new Date(l.start_date);
    const extEnd = new Date(l.end_date);
    return Math.max(newStart, extStart) <= Math.min(newEnd, extEnd);
  });

  if (overlap) {
    showToast("Leave request dates overlap with an existing request.", 'error');
    return;
  }

  if (!navigator.onLine) {
    // Queue offline action
    await enqueueAction('leave_apply', { leave_type: type, start_date: start, end_date: end, remarks });
    await updateNetworkBadge();
    showToast('Offline leave application queued.', 'warning');
  } else {
    try {
      await apiRequest('/leave/apply', {
        method: 'POST',
        body: JSON.stringify({
          leave_type: type,
          start_date: start,
          end_date: end,
          remarks
        })
      });
      showToast('Leave request submitted successfully!', 'success');
    } catch (err) {
      showToast(`Submission failed: ${err.message}`, 'error');
      return;
    }
  }

  hideModal();
  await initLeaveListeners();
}

// ── Admin Actions ────────────────────────────────────────────

async function _approveLeave(id) {
  const comments = window.prompt("Enter admin approval comments (optional):", "Approved by admin.");
  if (comments === null) return; // cancel click

  try {
    await apiRequest(`/leave/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'Approved',
        admin_comments: comments
      })
    });
    showToast('Leave request approved.', 'success');
    await initLeaveListeners();
  } catch (err) {
    showToast(`Approval failed: ${err.message}`, 'error');
  }
}

async function _rejectLeave(id) {
  const comments = window.prompt("Enter admin rejection comments (mandatory):");
  if (comments === null) return; // cancel click
  if (!comments.trim()) {
    showToast('Rejection comments are required.', 'error');
    return;
  }

  try {
    await apiRequest(`/leave/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'Rejected',
        admin_comments: comments
      })
    });
    showToast('Leave request rejected.', 'info');
    await initLeaveListeners();
  } catch (err) {
    showToast(`Rejection failed: ${err.message}`, 'error');
  }
}

// Expose to global scope for inline onclick handlers
window._leaveApprove = _approveLeave;
window._leaveReject = _rejectLeave;
window._closeModal = hideModal;
