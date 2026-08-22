// ============================================================
// Dayflow HRMS — Authentication & Role Management
// ============================================================

import { showToast } from './ui.js';

// ── Mock Users ──────────────────────────────────────────────
const MOCK_USERS = {
  employee: {
    id: 'e1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c',
    employee_id: 'EMP-1042',
    full_name: 'Tharun R',
    email: 'tharun@dayflow.co',
    role: 'employee',
    phone: '+91 98765 43210',
    address: '42 Tech Park, Coimbatore, TN',
    job_title: 'Software Engineer',
    profile_pic_url: '',
    created_at: '2025-06-15T09:00:00Z',
  },
  admin: {
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    employee_id: 'ADM-0001',
    full_name: 'Admin',
    email: 'admin@dayflow.co',
    role: 'admin',
    phone: '+91 90000 00001',
    address: 'HR Office, Dayflow HQ',
    job_title: 'HR Manager',
    profile_pic_url: '',
    created_at: '2025-01-10T09:00:00Z',
  },
};

let _currentUser = null;
let _onRoleChangeCallbacks = [];

/** Initialize auth — restore from localStorage or default to null */
export function initAuth() {
  const saved = localStorage.getItem('dayflow_user');
  if (saved) {
    _currentUser = JSON.parse(saved);
  }
  return _currentUser;
}

/** Get current user */
export function getCurrentUser() {
  return _currentUser;
}

/** Is current user an admin? */
export function isAdmin() {
  return _currentUser?.role === 'admin';
}

/** Simulate sign-in */
export function signIn(email, password) {
  // Accept any credentials — match by email or just default to employee
  const found = Object.values(MOCK_USERS).find(u => u.email === email);
  _currentUser = found || { ...MOCK_USERS.employee, email };
  localStorage.setItem('dayflow_user', JSON.stringify(_currentUser));
  _fireRoleChange();
  return _currentUser;
}

/** Simulate sign-up */
export function signUp({ employee_id, full_name, email, password, role }) {
  _currentUser = {
    ...(role === 'admin' ? MOCK_USERS.admin : MOCK_USERS.employee),
    employee_id,
    full_name,
    email,
    role,
  };
  localStorage.setItem('dayflow_user', JSON.stringify(_currentUser));
  _fireRoleChange();
  return _currentUser;
}

/** Sign out */
export function signOut() {
  _currentUser = null;
  localStorage.removeItem('dayflow_user');
}

/** Switch role (via topbar dropdown) */
export function switchRole(role) {
  if (!_currentUser) return;
  const mock = role === 'admin' ? MOCK_USERS.admin : MOCK_USERS.employee;
  _currentUser = { ...mock };
  localStorage.setItem('dayflow_user', JSON.stringify(_currentUser));
  _fireRoleChange();
  showToast(`Switched to ${role === 'admin' ? 'Admin / HR Manager' : 'Employee'} view`, 'info');
}

/** Register a callback for role changes */
export function onRoleChange(cb) {
  _onRoleChangeCallbacks.push(cb);
}

function _fireRoleChange() {
  _onRoleChangeCallbacks.forEach(cb => cb(_currentUser));
}

/** Get all mock employees (for admin views) */
export function getAllEmployees() {
  return Object.values(MOCK_USERS);
}
