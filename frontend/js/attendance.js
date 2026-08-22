// ============================================================
// Dayflow HRMS — Attendance Module
// ============================================================

import { getCurrentUser, isAdmin, getAllEmployees } from './auth.js';
import { showToast, fmtDate, fmtTime, todayISO, uuid } from './ui.js';
import { enqueueAction, getPendingQueue, cacheUserData, getCachedUserData } from './offline-db.js';
import { updateNetworkBadge } from './offline-sync.js';
import { apiRequest } from './api.js';

let _attendanceRecords = [];

// ── Render ───────────────────────────────────────────────────

export function renderAttendanceView() {
  const temp = document.getElementById('view-template-attendance');
  return temp ? `<section class="view active" id="view-attendance">${temp.innerHTML}</section>` : '';
}

export async function initQRScanner() {
  await _loadAttendance();
  _renderTodayStatus();
  _renderHistory();

  // Populate admin employee filter
  if (isAdmin()) {
    const sel = document.getElementById('att-filter-employee');
    if (sel) {
      sel.innerHTML = '<option value="">All Employees</option>';
      try {
        const employees = await getAllEmployees();
        employees.forEach(emp => {
          sel.innerHTML += `<option value="${emp.id}">${emp.full_name} (${emp.employee_id || '—'})</option>`;
        });
      } catch (err) {
        console.warn("Could not load employees for filter:", err);
      }
      sel.addEventListener('change', async () => {
        await _loadAttendance(sel.value);
        _renderHistory();
      });
    }
  }

  // Bind local action buttons
  const btnIn = document.getElementById('btn-manual-checkin');
  const btnOut = document.getElementById('btn-manual-checkout');
  if (btnIn) btnIn.addEventListener('click', handleCheckIn);
  if (btnOut) btnOut.addEventListener('click', handleCheckOut);

  // Initialize Html5QrcodeScanner if available
  try {
    if (typeof Html5QrcodeScanner !== 'undefined' && document.getElementById('qr-reader')) {
      const scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
      scanner.render(async (decodedText) => {
        showToast(`Scanned: ${decodedText}`, 'success');
        // If the QR contains check-in/out command, run it
        if (decodedText.toLowerCase().includes('checkout')) {
          await handleCheckOut();
        } else {
          await handleCheckIn();
        }
      }, () => {});
    }
  } catch (err) {
    console.error("QR Scanner initialization failed:", err);
  }
}

/** Load attendance from API or local offline DB cache */
async function _loadAttendance(filterEmployeeId = "") {
  if (navigator.onLine) {
    try {
      let endpoint = '/attendance';
      if (isAdmin() && filterEmployeeId) {
        endpoint += `?employee_id=${filterEmployeeId}`;
      }
      const data = await apiRequest(endpoint);
      _attendanceRecords = data || [];

      // Update offline DB cache if not filtering
      if (!filterEmployeeId) {
        const user = getCurrentUser();
        await cacheUserData(user, _attendanceRecords);
      }
    } catch (err) {
      console.warn("Failed to fetch attendance from API:", err);
      await _loadFromCache();
    }
  } else {
    await _loadFromCache();
  }

  // Inject offline enqueued sync items
  try {
    const queue = await getPendingQueue();
    const user = getCurrentUser();
    
    // Process queued actions
    queue.forEach(item => {
      if (item.type === 'check_in') {
        const existingIndex = _attendanceRecords.findIndex(r => r.date === item.payload.date && r.employee_id === user.id);
        const record = {
          id: item.client_event_id,
          employee_id: user.id,
          employee_name: user.full_name,
          date: item.payload.date,
          check_in_time: item.payload.check_in_time,
          check_out_time: null,
          status: 'Present',
          hours: '0',
          pending: true
        };
        if (existingIndex > -1) {
          _attendanceRecords[existingIndex] = record;
        } else {
          _attendanceRecords.unshift(record);
        }
      } else if (item.type === 'check_out') {
        const record = _attendanceRecords.find(r => r.date === item.payload.date && r.employee_id === user.id);
        if (record) {
          record.check_out_time = item.payload.check_out_time;
          record.pending = true;
          if (record.check_in_time) {
            const diff = new Date(record.check_out_time) - new Date(record.check_in_time);
            record.hours = (diff / 3600000).toFixed(2);
            // Estimate status locally
            const hrs = parseFloat(record.hours);
            record.status = hrs >= 8.0 ? 'Present' : (hrs >= 4.0 ? 'Half-day' : 'Absent');
          }
        }
      }
    });
  } catch (err) {
    console.error("Error merging offline queue:", err);
  }
}

async function _loadFromCache() {
  try {
    const cached = await getCachedUserData();
    _attendanceRecords = cached.attendance || [];
  } catch (err) {
    console.error("Failed to load attendance from cache:", err);
  }
}

function _renderTodayStatus() {
  const today = todayISO();
  const user = getCurrentUser();
  const rec = _attendanceRecords.find(r => r.date === today && r.employee_id === user.id);

  const statusEl = document.getElementById('att-today-status');
  const badgeEl = document.getElementById('att-today-badge');
  const dateEl = document.getElementById('att-detail-date');
  const inEl = document.getElementById('att-detail-in');
  const outEl = document.getElementById('att-detail-out');
  const hoursEl = document.getElementById('att-detail-hours');
  const detailStatusEl = document.getElementById('att-detail-status');

  if (dateEl) dateEl.textContent = fmtDate(today);

  if (rec) {
    const labelSuffix = rec.pending ? ' (Pending Sync)' : '';
    if (statusEl) statusEl.textContent = `${rec.status}${labelSuffix} · Check-in: ${fmtTime(rec.check_in_time)}`;
    if (badgeEl) {
      badgeEl.textContent = rec.status + labelSuffix;
      badgeEl.className = `badge badge-${rec.status.toLowerCase().replace('-', '')}`;
    }
    if (inEl) inEl.textContent = fmtTime(rec.check_in_time);
    if (outEl) outEl.textContent = rec.check_out_time ? fmtTime(rec.check_out_time) : '— Pending';
    if (hoursEl) hoursEl.textContent = (parseFloat(rec.hours || 0)).toFixed(1) + ' hrs';
    if (detailStatusEl) detailStatusEl.textContent = rec.status + labelSuffix;
  } else {
    if (statusEl) statusEl.textContent = 'Not checked in yet';
    if (badgeEl) {
      badgeEl.textContent = '—';
      badgeEl.className = 'badge';
    }
    if (inEl) inEl.textContent = '—';
    if (outEl) outEl.textContent = '—';
    if (hoursEl) hoursEl.textContent = '—';
    if (detailStatusEl) detailStatusEl.textContent = '—';
  }

  // Also update dashboard today indicators
  const dashCheckin = document.getElementById('today-checkin');
  const dashCheckout = document.getElementById('today-checkout');
  const dashBadge = document.getElementById('today-badge');
  if (rec) {
    if (dashCheckin) dashCheckin.textContent = fmtTime(rec.check_in_time);
    if (dashCheckout) dashCheckout.textContent = rec.check_out_time ? fmtTime(rec.check_out_time) : '— Pending';
    if (dashBadge) {
      dashBadge.textContent = rec.status + (rec.pending ? ' (Pending)' : '');
      dashBadge.className = `badge badge-${rec.status.toLowerCase().replace('-', '')}`;
    }
  } else {
    if (dashCheckin) dashCheckin.textContent = '—';
    if (dashCheckout) dashCheckout.textContent = '—';
    if (dashBadge) {
      dashBadge.textContent = 'Absent';
      dashBadge.className = 'badge badge-absent';
    }
  }
}

function _renderHistory() {
  const tbody = document.getElementById('attendance-tbody');
  if (!tbody) return;

  const admin = isAdmin();
  const user = getCurrentUser();

  // If employee, only show own records
  const records = admin
    ? _attendanceRecords
    : _attendanceRecords.filter(r => r.employee_id === user.id);

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${admin ? 6 : 5}" class="text-center text-muted" style="padding:32px">No attendance records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const hoursFormatted = r.hours ? `${parseFloat(r.hours).toFixed(1)} hrs` : '—';
    const pendingLabel = r.pending ? ' <small class="text-muted">(queued)</small>' : '';
    return `
      <tr>
        <td>${fmtDate(r.date)}</td>
        ${admin ? `<td class="fw-600">${r.employee_name || '—'}</td>` : ''}
        <td>${fmtTime(r.check_in_time)}</td>
        <td>${fmtTime(r.check_out_time)}</td>
        <td>${hoursFormatted}</td>
        <td>
          <span class="badge badge-${r.status.toLowerCase().replace('-', '')}">${r.status}</span>${pendingLabel}
        </td>
      </tr>
    `;
  }).join('');
}

// ── Actions ──────────────────────────────────────────────────

export async function handleCheckIn() {
  const user = getCurrentUser();
  const today = todayISO();
  const now = new Date().toISOString();

  // Check if already checked in
  const existing = _attendanceRecords.find(r => r.date === today && r.employee_id === user.id);
  if (existing && existing.check_in_time) {
    showToast('Already checked in today!', 'warning');
    return;
  }

  if (!navigator.onLine) {
    await enqueueAction('check_in', { date: today, check_in_time: now });
    await updateNetworkBadge();
    showToast('Offline check-in queued successfully.', 'warning');
  } else {
    try {
      await apiRequest('/attendance/check-in', { method: 'POST' });
      showToast('Checked in successfully!', 'success');
    } catch (err) {
      showToast(`Check in failed: ${err.message}`, 'error');
      return;
    }
  }

  await initQRScanner();
}

export async function handleCheckOut() {
  const user = getCurrentUser();
  const today = todayISO();
  const now = new Date().toISOString();

  const rec = _attendanceRecords.find(r => r.date === today && r.employee_id === user.id);
  if (!rec || !rec.check_in_time) {
    showToast('Please check in first!', 'error');
    return;
  }

  if (rec.check_out_time) {
    showToast('Already checked out today!', 'warning');
    return;
  }

  if (!navigator.onLine) {
    await enqueueAction('check_out', { date: today, check_out_time: now });
    await updateNetworkBadge();
    showToast('Offline check-out queued successfully.', 'warning');
  } else {
    try {
      await apiRequest('/attendance/check-out', { method: 'POST' });
      showToast('Checked out successfully!', 'success');
    } catch (err) {
      showToast(`Check out failed: ${err.message}`, 'error');
      return;
    }
  }

  await initQRScanner();
}

/** Get attendance stats for dashboard */
export function getAttendanceStats() {
  const user = getCurrentUser();
  const records = _attendanceRecords.filter(r => r.employee_id === user.id);
  const total = records.length || 1;
  const present = records.filter(r => r.status === 'Present' || r.status === 'Half-day').length;
  const rate = Math.round((present / total) * 100);
  return { total, present, rate };
}
