// ============================================================
// Dayflow HRMS — Authentication & Role Management
// ============================================================

import { showToast } from './ui.js';
import { apiRequest } from './api.js';
import { cacheUserData, getCachedUserData } from './offline-db.js';

let _currentUser = null;
let _onRoleChangeCallbacks = [];
let _cachedEmployees = []; // Store profiles fetched when admin is online

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

/** Sign in via backend API */
export async function signIn(email, password) {
  try {
    const data = await apiRequest('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    _currentUser = data.user;
    localStorage.setItem('dayflow_token', data.access_token);
    localStorage.setItem('dayflow_user', JSON.stringify(_currentUser));

    // Cache user profile offline
    try {
      await cacheUserData(_currentUser, []);
    } catch (err) {
      console.warn("Could not cache profile offline:", err);
    }

    _fireRoleChange();
    return _currentUser;
  } catch (error) {
    showToast(`Sign in failed: ${error.message}`, 'error');
    throw error;
  }
}

/** Sign up via backend API */
export async function signUp({ employee_id, full_name, email, password, role }) {
  try {
    const data = await apiRequest('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ employee_id, full_name, email, password, role })
    });

    _currentUser = data.user;
    localStorage.setItem('dayflow_token', data.access_token);
    localStorage.setItem('dayflow_user', JSON.stringify(_currentUser));

    // Cache user profile offline
    try {
      await cacheUserData(_currentUser, []);
    } catch (err) {
      console.warn("Could not cache profile offline:", err);
    }

    _fireRoleChange();
    return _currentUser;
  } catch (error) {
    showToast(`Sign up failed: ${error.message}`, 'error');
    throw error;
  }
}

/** Sign out and clear credentials */
export function signOut() {
  _currentUser = null;
  localStorage.removeItem('dayflow_token');
  localStorage.removeItem('dayflow_user');
}

/** Switch role (via topbar dropdown) - updates view and session */
export function switchRole(role) {
  if (!_currentUser) return;
  _currentUser.role = role;
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

/** Get all employees (for admin views). Fetches from backend or returns cache. */
export async function getAllEmployees() {
  if (!navigator.onLine) {
    return _cachedEmployees;
  }

  try {
    const profiles = await apiRequest('/profile');
    _cachedEmployees = profiles;
    return profiles;
  } catch (error) {
    console.error("Failed to fetch profiles:", error);
    return _cachedEmployees;
  }
}
