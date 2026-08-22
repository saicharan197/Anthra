// ============================================================
// Dayflow HRMS — API client helper library (placeholder)
// ============================================================

/**
 * Perform a generic API fetch request.
 * @param {string} url - API Endpoint URL
 * @param {object} [options={}] - HTTP fetch options
 * @returns {Promise<any>}
 */
export async function apiRequest(url, options = {}) {
  const defaults = {
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  const mergedOptions = {
    ...defaults,
    ...options,
    headers: {
      ...defaults.headers,
      ...(options.headers || {})
    }
  };

  const response = await fetch(url, mergedOptions);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
}
