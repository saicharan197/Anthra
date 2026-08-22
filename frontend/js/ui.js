// ============================================================
// Dayflow HRMS — UI Utilities (Toast, Modal, Helpers)
// ============================================================

/** Show a toast notification */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/** Show a modal with custom HTML content */
export function showModal(html) {
  const overlay = document.getElementById('modal-overlay');
  const card = document.getElementById('modal-card');
  card.innerHTML = html;
  overlay.classList.remove('hidden');
  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) hideModal();
  };
}

/** Hide the modal */
export function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

/** Format a date string to locale short date */
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Format a timestamp to HH:MM AM/PM */
export function fmtTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** Format currency in INR */
export function fmtCurrency(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0 });
}

/** Get today's date as YYYY-MM-DD */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Get a greeting based on the hour */
export function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/** Generate a UUID v4 */
export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/** Calculate business days between two dates */
export function businessDaysBetween(start, end) {
  let count = 0;
  const d = new Date(start);
  const e = new Date(end);
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}
