// ============================================================
// Dayflow HRMS — Central API Client
// ============================================================

export const API_BASE = (window.location.port && window.location.port !== '8000')
  ? `http://${window.location.hostname || '127.0.0.1'}:8000/api`
  : '/api';


/**
 * Returns authorization and standard content headers.
 */
function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('dayflow_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Fetch helper that attaches Bearer tokens and resolves JSON.
 * Throws clean error messages on failures.
 * Throws custom 'offline' error if navigator.onLine is false and method is mutating.
 */
export async function apiRequest(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (!navigator.onLine && method !== 'GET') {
    throw new Error('offline');
  }

  const url = `${API_BASE}${endpoint}`;
  const mergedOptions = {
    ...options,
    headers: {
      ...getHeaders(),
      ...options.headers
    }
  };

  const response = await fetch(url, mergedOptions);
  
  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    let msg = response.statusText;
    try {
      const err = await response.json();
      msg = err.detail || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  return response.json();
}
