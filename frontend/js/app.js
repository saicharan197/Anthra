// ============================================================
// Dayflow HRMS — Main Application (SPA Router & Orchestrator)
// ============================================================

import { initAuth, getCurrentUser, signIn, signUp, signOut, switchRole, onRoleChange } from './auth.js';
import { showToast, getGreeting, todayISO, fmtDate } from './ui.js';
import { initOfflineDB, initNetworkListeners, updateQueueBadge, syncQueue } from './offline-sync.js';
import { renderAttendanceView, handleCheckIn, handleCheckOut, getAttendanceStats } from './attendance.js';
import { renderLeaveView, openApplyLeaveModal } from './leave.js';
import { renderPayrollView, handleDownloadPDF } from './payroll.js';
import { renderProfileView, handleProfileSave } from './profile.js';

// ── State ────────────────────────────────────────────────────
let _currentView = 'dashboard';

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize IndexedDB
  await initOfflineDB();

  // 2. Network listeners
  initNetworkListeners();
  await updateQueueBadge();

  // 3. Check auth state
  const user = initAuth();
  if (user) {
    _enterApp();
  }

  // 4. Bind event listeners
  _bindAuthEvents();
  _bindNavEvents();
  _bindActionEvents();

  // 5. Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// ── Auth Events ──────────────────────────────────────────────

function _bindAuthEvents() {
  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isSignIn = tab.dataset.tab === 'signin';
      document.getElementById('form-signin').classList.toggle('hidden', !isSignIn);
      document.getElementById('form-signup').classList.toggle('hidden', isSignIn);
    });
  });

  // Sign In
  document.getElementById('form-signin').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('signin-email').value;
    const password = document.getElementById('signin-password').value;
    signIn(email, password);
    _enterApp();
    showToast('Welcome back!', 'success');
  });

  // Sign Up
  document.getElementById('form-signup').addEventListener('submit', (e) => {
    e.preventDefault();
    signUp({
      employee_id: document.getElementById('signup-empid').value,
      full_name: document.getElementById('signup-name').value,
      email: document.getElementById('signup-email').value,
      password: document.getElementById('signup-password').value,
      role: document.getElementById('signup-role').value,
    });
    _enterApp();
    showToast('Account created successfully!', 'success');
  });

  // Sign Out
  document.getElementById('btn-logout').addEventListener('click', () => {
    signOut();
    _exitApp();
  });
}

// ── Navigation ───────────────────────────────────────────────

function _bindNavEvents() {
  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      if (view) _navigateTo(view);
      // Close mobile sidebar
      document.getElementById('sidebar').classList.remove('open');
    });
  });

  // Mobile menu toggle
  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Role switcher
  document.getElementById('role-select').addEventListener('change', (e) => {
    switchRole(e.target.value);
    _refreshCurrentView();
  });

  // React to role changes
  onRoleChange(() => _refreshCurrentView());
}

function _navigateTo(viewName) {
  _currentView = viewName;

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (activeNav) activeNav.classList.add('active');

  // Switch views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  // Update topbar title
  const titles = { dashboard: 'Dashboard', attendance: 'Attendance', leave: 'Leave Management', payroll: 'Payroll', profile: 'Profile' };
  document.getElementById('view-title').textContent = titles[viewName] || viewName;

  // Render the view
  _renderView(viewName);
}

// ── Action Bindings ──────────────────────────────────────────

function _bindActionEvents() {
  // Attendance
  document.getElementById('btn-manual-checkin').addEventListener('click', handleCheckIn);
  document.getElementById('btn-manual-checkout').addEventListener('click', handleCheckOut);

  // Leave
  document.getElementById('btn-apply-leave').addEventListener('click', openApplyLeaveModal);

  // Payroll PDF
  document.getElementById('btn-download-pdf').addEventListener('click', handleDownloadPDF);

  // Profile
  document.getElementById('form-profile').addEventListener('submit', handleProfileSave);

  // Sync button
  document.getElementById('btn-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    btn.classList.add('syncing');
    await syncQueue();
    btn.classList.remove('syncing');
  });
}

// ── App Enter / Exit ─────────────────────────────────────────

function _enterApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  _applyRoleClass();
  _navigateTo('dashboard');
}

function _exitApp() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.body.classList.remove('is-admin');
}

// ── View Rendering ───────────────────────────────────────────

function _renderView(viewName) {
  _applyRoleClass();

  switch (viewName) {
    case 'dashboard':
      _renderDashboard();
      break;
    case 'attendance':
      renderAttendanceView();
      break;
    case 'leave':
      renderLeaveView();
      break;
    case 'payroll':
      renderPayrollView();
      break;
    case 'profile':
      renderProfileView();
      break;
  }
}

function _refreshCurrentView() {
  _applyRoleClass();
  _updateUserDisplay();
  _renderView(_currentView);
}

function _applyRoleClass() {
  const user = getCurrentUser();
  if (user?.role === 'admin') {
    document.body.classList.add('is-admin');
  } else {
    document.body.classList.remove('is-admin');
  }

  // Sync role select
  const sel = document.getElementById('role-select');
  if (user && sel.value !== user.role) {
    sel.value = user.role;
  }
}

function _updateUserDisplay() {
  const user = getCurrentUser();
  if (!user) return;

  const initials = user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('avatar-initials').textContent = initials;
  document.getElementById('topbar-user-name').textContent = user.full_name;
}

// ── Dashboard Rendering ──────────────────────────────────────

function _renderDashboard() {
  const user = getCurrentUser();
  if (!user) return;

  // Welcome message
  document.getElementById('welcome-msg').textContent = `${getGreeting()}, ${user.full_name.split(' ')[0]} 👋`;
  document.getElementById('dashboard-date').textContent = fmtDate(todayISO());

  // Stats
  const stats = getAttendanceStats();
  document.getElementById('stat-attendance').textContent = stats.rate + '%';
  document.getElementById('stat-working').textContent = `${stats.present}/${stats.total}`;

  // Recent activity
  const activityEl = document.getElementById('recent-activity');
  const activities = [
    { icon: '✓', text: 'Checked in at 09:15 AM', time: 'Today' },
    { icon: '📋', text: 'Leave request submitted (Sick Leave)', time: 'Yesterday' },
    { icon: '💰', text: 'August payslip generated', time: '2 days ago' },
    { icon: '✓', text: 'Checked out at 06:12 PM', time: '3 days ago' },
  ];

  activityEl.innerHTML = activities.map(a => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--slate-100)">
      <span style="width:32px;height:32px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-size:0.875rem;flex-shrink:0">${a.icon}</span>
      <div style="flex:1">
        <div style="font-size:0.875rem;font-weight:500;color:var(--slate-700)">${a.text}</div>
        <div style="font-size:0.75rem;color:var(--slate-400)">${a.time}</div>
      </div>
    </div>
  `).join('');

  _updateUserDisplay();
}
