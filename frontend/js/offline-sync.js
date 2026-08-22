// ============================================================
// Dayflow HRMS — Synchronization Manager & Network Listener
// ============================================================

import { getPendingQueue, removeSyncedAction } from './offline-db.js';
import { showToast } from './ui.js';

let _onSyncCompleteCallbacks = [];

/**
 * Register callbacks to trigger when sync completes successfully (to refresh UI).
 */
export function onSyncComplete(callback) {
  _onSyncCompleteCallbacks.push(callback);
}

/**
 * Update the top-right network status badge and text.
 */
export async function updateNetworkBadge() {
  const badge = document.getElementById('network-badge');
  const text = document.getElementById('network-text');
  const queueCountEl = document.getElementById('queue-count');

  const pendingQueue = await getPendingQueue();
  const pendingCount = pendingQueue.length;

  if (queueCountEl) {
    queueCountEl.textContent = pendingCount;
    queueCountEl.classList.toggle('zero', pendingCount === 0);
  }

  if (navigator.onLine) {
    if (badge) badge.classList.remove('offline');
    if (text) {
      text.textContent = pendingCount > 0 
        ? `Online (${pendingCount} pending)` 
        : 'Online';
    }
  } else {
    if (badge) badge.classList.add('offline');
    if (text) {
      text.textContent = pendingCount > 0
        ? `Offline (${pendingCount} actions pending)`
        : 'Offline';
    }
  }
}

/**
 * Process the offline IndexedDB queue and send to POST /api/sync.
 * @returns {Promise<boolean>} - True if synced successfully, false otherwise.
 */
export async function processSyncQueue() {
  if (!navigator.onLine) {
    console.log('Skipping sync: Navigator is offline.');
    updateNetworkBadge();
    return false;
  }

  try {
    const pendingEvents = await getPendingQueue();
    if (pendingEvents.length === 0) {
      console.log('Skipping sync: No pending actions.');
      updateNetworkBadge();
      return true;
    }

    // Build the exact payload schema required: { events: [...] }
    const payload = {
      events: pendingEvents.map(event => ({
        client_event_id: event.client_event_id,
        type: event.type,
        payload: event.payload
      }))
    };

    console.log('Syncing pending actions to backend:', payload);

    // Perform actual API sync call
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // In real app, attach bearer token header if needed
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Sync server responded with ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('Sync complete. Server response:', data);

    // Delete successfully synced items from IndexedDB
    for (const event of pendingEvents) {
      await removeSyncedAction(event.client_event_id);
    }

    showToast(`Successfully synchronized ${pendingEvents.length} action(s)!`, 'success');
    updateNetworkBadge();

    // Trigger registered callbacks (e.g. to update the UI tables and history)
    _onSyncCompleteCallbacks.forEach(cb => cb());

    return true;
  } catch (error) {
    console.error('Offline synchronization failed:', error);
    showToast(`Offline sync failed: ${error.message}`, 'error');
    updateNetworkBadge();
    return false;
  }
}

/**
 * Initialize window network listeners to handle automatic sync.
 */
export function initNetworkListeners() {
  window.addEventListener('online', () => {
    showToast('Network connection detected. Synced queue...', 'info');
    processSyncQueue();
  });

  window.addEventListener('offline', () => {
    showToast('Connection lost. Working in offline mode.', 'warning');
    updateNetworkBadge();
  });

  // Periodically check and update the network status badge
  setInterval(updateNetworkBadge, 5000);
  
  // Perform initial status check
  updateNetworkBadge();
}
