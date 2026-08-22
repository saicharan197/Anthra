// ============================================================
// Dayflow HRMS — Profile Module
// ============================================================

import { getCurrentUser, isAdmin } from './auth.js';
import { showToast } from './ui.js';

// ── Render ───────────────────────────────────────────────────

export function renderProfileView() {
  const user = getCurrentUser();
  if (!user) return;

  // Header
  const initials = user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').textContent = user.full_name;
  document.getElementById('profile-subtitle').textContent = `${user.job_title || 'Employee'} · ${user.employee_id}`;

  // Info grid
  const grid = document.getElementById('profile-info-grid');
  const fields = [
    { label: 'Employee ID', value: user.employee_id },
    { label: 'Email', value: user.email },
    { label: 'Role', value: user.role === 'admin' ? 'Admin / HR Manager' : 'Employee' },
    { label: 'Job Title', value: user.job_title || '—' },
    { label: 'Phone', value: user.phone || '—' },
    { label: 'Address', value: user.address || '—' },
    { label: 'Member Since', value: new Date(user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) },
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
    document.getElementById('pf-jobtitle').value = user.job_title || '';
    document.getElementById('pf-role').value = user.role;
  }
}

// ── Save Profile ─────────────────────────────────────────────

export function handleProfileSave(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) return;

  // Update user object
  user.phone = document.getElementById('pf-phone').value;
  user.address = document.getElementById('pf-address').value;
  user.profile_pic_url = document.getElementById('pf-avatar').value;

  if (isAdmin()) {
    user.job_title = document.getElementById('pf-jobtitle').value;
    user.role = document.getElementById('pf-role').value;
  }

  // Persist
  localStorage.setItem('dayflow_user', JSON.stringify(user));

  showToast('Profile updated successfully!', 'success');
  renderProfileView();
}
