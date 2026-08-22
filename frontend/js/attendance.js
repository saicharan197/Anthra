// ============================================================
// Dayflow HRMS — Attendance Module
// ============================================================

import { getCurrentUser, isAdmin, getAllEmployees } from './auth.js';
import { showToast, fmtDate, fmtTime, todayISO, uuid } from './ui.js';
import { enqueueAction } from './offline-db.js';
import { updateNetworkBadge } from './offline-sync.js';

// ── Mock Attendance Data ────────────────────────────────────
const _mockAttendance = [];

function _seedMockData() {
  if (_mockAttendance.length > 0) return;
  const today = new Date();
  const empId = 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c';
  const statuses = ['Present', 'Present', 'Present', 'Present', 'Absent', 'Present', 'Half-day', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present', 'Present'];

  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue; // Skip weekends

    const status = statuses[i] || 'Present';
    const checkIn = new Date(d);
    checkIn.setHours(9, Math.floor(Math.random() * 30), 0);
    const checkOut = status !== 'Absent' ? new Date(d) : null;
    if (checkOut) checkOut.setHours(17, 30 + Math.floor(Math.random() * 30), 0);

    _mockAttendance.push({
      id: uuid(),
      employee_id: empId,
      employee_name: 'Tharun R',
      date: d.toISOString().slice(0, 10),
      check_in_time: status !== 'Absent' ? checkIn.toISOString() : null,
      check_out_time: checkOut ? checkOut.toISOString() : null,
      status,
      hours: checkOut && status !== 'Absent' ? ((checkOut - checkIn) / 3600000).toFixed(1) : '0',
    });
  }
}

// ── Render ───────────────────────────────────────────────────

export function renderAttendanceView() {
  _seedMockData();
  _renderTodayStatus();
  _renderHistory();

  // Populate admin employee filter
  if (isAdmin()) {
    const sel = document.getElementById('att-filter-employee');
    sel.innerHTML = '<option value="">All Employees</option>';
    getAllEmployees().forEach(emp => {
      sel.innerHTML += `<option value="${emp.id}">${emp.full_name} (${emp.employee_id})</option>`;
    });
  }
}

function _renderTodayStatus() {
  const today = todayISO();
  const user = getCurrentUser();
  const rec = _mockAttendance.find(r => r.date === today && r.employee_id === user.id);

  const statusEl = document.getElementById('att-today-status');
  const badgeEl = document.getElementById('att-today-badge');
  const dateEl = document.getElementById('att-detail-date');
  const inEl = document.getElementById('att-detail-in');
  const outEl = document.getElementById('att-detail-out');
  const hoursEl = document.getElementById('att-detail-hours');
  const detailStatusEl = document.getElementById('att-detail-status');

  dateEl.textContent = fmtDate(today);

  if (rec) {
    statusEl.textContent = `${rec.status} · Check-in: ${fmtTime(rec.check_in_time)}`;
    badgeEl.textContent = rec.status;
    badgeEl.className = `badge badge-${rec.status.toLowerCase().replace('-', '')}`;
    inEl.textContent = fmtTime(rec.check_in_time);
    outEl.textContent = rec.check_out_time ? fmtTime(rec.check_out_time) : '— Pending';
    hoursEl.textContent = rec.hours + ' hrs';
    detailStatusEl.textContent = rec.status;
  } else {
    statusEl.textContent = 'Not checked in yet';
    badgeEl.textContent = '—';
    badgeEl.className = 'badge';
    inEl.textContent = '—';
    outEl.textContent = '—';
    hoursEl.textContent = '—';
    detailStatusEl.textContent = '—';
  }

  // Also update dashboard
  const dashCheckin = document.getElementById('today-checkin');
  const dashCheckout = document.getElementById('today-checkout');
  const dashBadge = document.getElementById('today-badge');
  if (rec) {
    dashCheckin.textContent = fmtTime(rec.check_in_time);
    dashCheckout.textContent = rec.check_out_time ? fmtTime(rec.check_out_time) : '— Pending';
    dashBadge.textContent = rec.status;
    dashBadge.className = `badge badge-${rec.status.toLowerCase().replace('-', '')}`;
  }
}

function _renderHistory() {
  const tbody = document.getElementById('attendance-tbody');
  const admin = isAdmin();
  const user = getCurrentUser();

  const records = admin
    ? [..._mockAttendance].reverse()
    : _mockAttendance.filter(r => r.employee_id === user.id).reverse();

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${admin ? 6 : 5}" class="text-center text-muted" style="padding:32px">No attendance records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      ${admin ? `<td class="fw-600">${r.employee_name || '—'}</td>` : ''}
      <td>${fmtTime(r.check_in_time)}</td>
      <td>${fmtTime(r.check_out_time)}</td>
      <td>${r.hours} hrs</td>
      <td><span class="badge badge-${r.status.toLowerCase().replace('-', '')}">${r.status}</span></td>
    </tr>
  `).join('');
}

// ── Actions ──────────────────────────────────────────────────

export async function handleCheckIn() {
  const user = getCurrentUser();
  const today = todayISO();
  const now = new Date().toISOString();

  // Check if already checked in
  const existing = _mockAttendance.find(r => r.date === today && r.employee_id === user.id);
  if (existing && existing.check_in_time) {
    showToast('Already checked in today!', 'warning');
    return;
  }

  const record = {
    id: uuid(),
    employee_id: user.id,
    employee_name: user.full_name,
    date: today,
    check_in_time: now,
    check_out_time: null,
    status: 'Present',
    hours: '0',
  };

  _mockAttendance.push(record);

  if (!navigator.onLine) {
    await enqueueAction('check_in', { date: today, check_in_time: now });
    await updateNetworkBadge();
  } else {
    showToast('Checked in successfully!', 'success');
  }

  renderAttendanceView();
}

export async function handleCheckOut() {
  const user = getCurrentUser();
  const today = todayISO();
  const now = new Date();

  const rec = _mockAttendance.find(r => r.date === today && r.employee_id === user.id);
  if (!rec || !rec.check_in_time) {
    showToast('Please check in first!', 'error');
    return;
  }

  if (rec.check_out_time) {
    showToast('Already checked out today!', 'warning');
    return;
  }

  rec.check_out_time = now.toISOString();
  rec.hours = ((now - new Date(rec.check_in_time)) / 3600000).toFixed(1);

  if (!navigator.onLine) {
    await enqueueAction('check_out', { date: today, check_out_time: rec.check_out_time });
    await updateNetworkBadge();
  } else {
    showToast('Checked out successfully!', 'success');
  }

  renderAttendanceView();
}

/** Get attendance stats for dashboard */
export function getAttendanceStats() {
  _seedMockData();
  const user = getCurrentUser();
  const records = _mockAttendance.filter(r => r.employee_id === user.id);
  const total = records.length || 1;
  const present = records.filter(r => r.status === 'Present' || r.status === 'Half-day').length;
  const rate = Math.round((present / total) * 100);
  return { total, present, rate };
}
