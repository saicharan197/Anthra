// ============================================================
// Dayflow HRMS — Profile Module
// ============================================================

import { getCurrentUser, isAdmin } from './auth.js';
import { showToast } from './ui.js';
import { apiRequest } from './api.js';
import { cacheUserData, getCachedUserData } from './offline-db.js';

// ── Render ───────────────────────────────────────────────────

export function renderProfileView() {
  const temp = document.getElementById('view-template-profile');
  return temp ? `<section class="view active" id="view-profile">${temp.innerHTML}</section>` : '';
}

export async function initProfileListeners() {
  let user = getCurrentUser();
  if (!user) return;

  // If online, fetch fresh profile from API
  if (navigator.onLine) {
    try {
      user = await apiRequest('/profile/me');
      localStorage.setItem('dayflow_user', JSON.stringify(user));
      await cacheUserData(user, []);
    } catch (err) {
      console.warn("Could not sync profile from API:", err);
    }
  } else {
    // If offline, load from IndexedDB cache
    try {
      const cached = await getCachedUserData();
      if (cached.profile) {
        user = cached.profile;
        localStorage.setItem('dayflow_user', JSON.stringify(user));
      }
    } catch (err) {
      console.warn("Could not load cached profile:", err);
    }
  }

  // Fetch salary structure details if online
  let salaryStr = '—';
  let salaryVal = '';
  let allowancesVal = '';
  let deductionsVal = '';

  if (navigator.onLine) {
    try {
      const struct = await apiRequest(`/payroll/structure/${user.id}`);
      salaryStr = `Basic: ₹${struct.basic_salary.toLocaleString()} · Allow: ₹${struct.allowances.toLocaleString()} · Deduct: ₹${struct.standard_deductions.toLocaleString()}`;
      salaryVal = struct.basic_salary;
      allowancesVal = struct.allowances;
      deductionsVal = struct.standard_deductions;
    } catch (_) {}
  }

  // Header
  const initials = user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').textContent = user.full_name;
  document.getElementById('profile-subtitle').textContent = `${user.job_title || 'Employee'} · ${user.employee_id}`;

  // Info grid
  const grid = document.getElementById('profile-info-grid');
  const fields = [
    { label: 'Employee ID', value: user.employee_id || '—' },
    { label: 'Email', value: user.email },
    { label: 'Role', value: user.role === 'admin' ? 'Admin / HR Manager' : 'Employee' },
    { label: 'Job Title', value: user.job_title || '—' },
    { label: 'Phone', value: user.phone || '—' },
    { label: 'Address', value: user.address || '—' },
    { label: 'Salary Structure', value: salaryStr },
    { label: 'Member Since', value: new Date(user.created_at || Date.now()).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) },
  ];

  grid.innerHTML = fields.map(f => `
    <div class="profile-field">
      <label>${f.label}</label>
      <div class="value">${f.value}</div>
    </div>
  `).join('');

  // Pre-fill edit form
  document.getElementById('pf-phone').value = user.phone || '';
  document.getElementById('pf-address').value = user.address || '';
  document.getElementById('pf-avatar').value = user.profile_pic_url || '';

  if (isAdmin()) {
    const pfJobTitle = document.getElementById('pf-jobtitle');
    const pfRole = document.getElementById('pf-role');
    const pfSalary = document.getElementById('pf-salary');
    const pfAllowances = document.getElementById('pf-allowances');
    const pfDeductions = document.getElementById('pf-deductions');

    if (pfJobTitle) pfJobTitle.value = user.job_title || '';
    if (pfRole) pfRole.value = user.role;
    if (pfSalary) pfSalary.value = salaryVal;
    if (pfAllowances) pfAllowances.value = allowancesVal;
    if (pfDeductions) pfDeductions.value = deductionsVal;
  }

  // Bind submit event listener to the newly mounted form
  const form = document.getElementById('form-profile');
  if (form) form.addEventListener('submit', handleProfileSave);
}

// ── Save Profile ─────────────────────────────────────────────

export async function handleProfileSave(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  if (!navigator.onLine) {
    showToast('Cannot update profile while offline.', 'error');
    return;
  }

  const phone = document.getElementById('pf-phone').value;
  const address = document.getElementById('pf-address').value;
  const profile_pic_url = document.getElementById('pf-avatar').value;

  try {
    let updatedUser;

    if (isAdmin()) {
      const job_title = document.getElementById('pf-jobtitle').value;
      const role = document.getElementById('pf-role').value;

      // Admin full update
      updatedUser = await apiRequest(`/profile/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          phone,
          address,
          profile_pic_url,
          job_title,
          role
        })
      });

      // Admin salary structure update
      const basic_salary = parseFloat(document.getElementById('pf-salary').value) || 0;
      const allowances = parseFloat(document.getElementById('pf-allowances').value) || 0;
      const standard_deductions = parseFloat(document.getElementById('pf-deductions').value) || 0;

      if (basic_salary > 0) {
        await apiRequest(`/payroll/structure/${user.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            basic_salary,
            allowances,
            standard_deductions
          })
        });
      }
    } else {
      // Employee self-update
      updatedUser = await apiRequest('/profile/me', {
        method: 'PUT',
        body: JSON.stringify({
          phone,
          address,
          profile_pic_url
        })
      });
    }

    // Persist and sync local cache
    localStorage.setItem('dayflow_user', JSON.stringify(updatedUser));
    await cacheUserData(updatedUser, []);

    showToast('Profile updated successfully!', 'success');
    initProfileListeners();
  } catch (error) {
    showToast(`Failed to save profile: ${error.message}`, 'error');
  }
}
