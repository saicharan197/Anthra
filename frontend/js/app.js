// ============================================================
// Dayflow HRMS — Main Application (SPA Router & Orchestrator)
// ============================================================

import { initAuth, getCurrentUser, signIn, signUp, signOut, switchRole, onRoleChange } from './auth.js';
import { showToast, getGreeting, todayISO, fmtDate } from './ui.js';
import { initDB } from './offline-db.js';
import { initNetworkListeners, updateNetworkBadge, processSyncQueue, onSyncComplete } from './offline-sync.js';
import { renderAttendanceView, initQRScanner, getAttendanceStats } from './attendance.js';
import { renderLeaveView, initLeaveListeners } from './leave.js';
import { renderPayrollView, initPayrollListeners } from './payroll.js';
import { renderProfileView, initProfileListeners } from './profile.js';

// ── State ────────────────────────────────────────────────────
let _currentView = 'dashboard';

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize IndexedDB
  await initDB();

  // 2. Network listeners
  initNetworkListeners();
  await updateNetworkBadge();
  onSyncComplete(() => {
    _refreshCurrentView();
  });

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
    navigator.serviceWorker.register('sw.js').catch(() => { });
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
      if (!isSignIn) {
        document.getElementById('signup-empid').value = 'EMP-' + Math.floor(1000 + Math.random() * 9000);
      }
    });
  });

  // Sign In
  document.getElementById('form-signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signin-email').value;
    const password = document.getElementById('signin-password').value;
    try {
      await signIn(email, password);
      _enterApp();
      showToast('Welcome back!', 'success');
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
    }
  });

  // Sign Up
  document.getElementById('form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await signUp({
        employee_id: document.getElementById('signup-empid').value,
        full_name: document.getElementById('signup-name').value,
        email: document.getElementById('signup-email').value,
        password: document.getElementById('signup-password').value,
        role: document.getElementById('signup-role').value,
      });
      _enterApp();
      showToast('Account created successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Sign up failed', 'error');
    }
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
      if (view) navigateTo(view);
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

export function navigateTo(view) {
  _currentView = view;
  const container = document.getElementById('main-content') || document.querySelector('main');
  if (!container) return;

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (activeNav) activeNav.classList.add('active');

  // Update topbar title
  const titles = { dashboard: 'Dashboard', attendance: 'Attendance', leave: 'Leave Management', payroll: 'Payroll', profile: 'Profile' };
  const titleEl = document.getElementById('view-title');
  if (titleEl) titleEl.textContent = titles[view] || view;

  _applyRoleClass();

  // Handles DOM mounting from templates directly
  switch (view) {
    case 'dashboard':
      container.innerHTML = renderDashboardView();
      initDashboardListeners();
      break;
    case 'attendance':
      container.innerHTML = renderAttendanceView();
      initQRScanner();
      break;
    case 'leave':
      container.innerHTML = renderLeaveView();
      initLeaveListeners();
      break;
    case 'payroll':
      container.innerHTML = renderPayrollView();
      initPayrollListeners();
      break;
    case 'profile':
      container.innerHTML = renderProfileView();
      initProfileListeners();
      break;
  }
}

function renderDashboardView() {
  const temp = document.getElementById('view-template-dashboard');
  return temp ? `<section class="view active" id="view-dashboard">${temp.innerHTML}</section>` : '';
}

function initDashboardListeners() {
  _renderDashboard();
}

// ── Action Bindings ──────────────────────────────────────────

function _bindActionEvents() {
  // Sync button
  document.getElementById('btn-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    btn.classList.add('syncing');
    await processSyncQueue();
    btn.classList.remove('syncing');
  });
}

// ── App Enter / Exit ─────────────────────────────────────────

function _enterApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  _applyRoleClass();
  navigateTo('dashboard');
}

function _exitApp() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  document.body.classList.remove('is-admin');
}

function _refreshCurrentView() {
  _applyRoleClass();
  _updateUserDisplay();
  navigateTo(_currentView);
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
