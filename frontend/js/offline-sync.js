// ============================================================
// Dayflow HRMS — Offline Sync Engine (IndexedDB Action Queue)
// ============================================================

import { showToast, uuid } from './ui.js';

const DB_NAME = 'dayflow_offline';
const DB_VERSION = 1;
const STORE_NAME = 'sync_queue';

let _db = null;
let _onCountChange = null;

// ── Database Initialization ─────────────────────────────────

export function initOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('synced', 'synced', { unique: false });
        store.createIndex('idempotency_key', 'idempotency_key', { unique: true });
      }
    };

    request.onsuccess = (event) => {
      _db = event.target.result;
      resolve(_db);
    };

    request.onerror = () => reject(request.error);
  });
}

// ── Queue Operations ────────────────────────────────────────

/** Add an action to the offline queue */
export async function queueAction(type, payload) {
  const record = {
    idempotency_key: uuid(),
    type,              // 'check_in' | 'check_out' | 'leave_apply'
    payload,
    timestamp: new Date().toISOString(),
    synced: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = _db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);

    req.onsuccess = () => {
      _notifyCountChange();
      showToast('Action saved offline. Will auto-sync when connection restores.', 'warning');
      resolve(record);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Get all unsynced actions */
export async function getUnsyncedActions() {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('synced');
    const req = index.getAll(0);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Mark an action as synced */
async function markSynced(id) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.synced = 1;
        store.put(record);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Get count of unsynced items */
export async function getQueueCount() {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('synced');
    const req = index.count(0);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Sync Process ────────────────────────────────────────────

/** Process the offline queue — simulate POST /api/sync */
export async function syncQueue() {
  if (!navigator.onLine) {
    showToast('Still offline. Will sync when connection restores.', 'warning');
    return { processed: 0 };
  }

  const actions = await getUnsyncedActions();
  if (actions.length === 0) {
    showToast('Nothing to sync — queue is empty.', 'info');
    return { processed: 0 };
  }

  // Build the batch payload
  const events = actions.map(a => ({
    client_event_id: a.idempotency_key,
    type: a.type,
    payload: a.payload,
  }));

  try {
    // Simulate API call — in production replace with real fetch
    // const res = await fetch('/api/sync', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ...' },
    //   body: JSON.stringify({ events }),
    // });
    // const data = await res.json();

    // Simulated success
    for (const action of actions) {
      await markSynced(action.id);
    }

    _notifyCountChange();
    showToast(`Synced ${actions.length} queued action(s) successfully!`, 'success');
    return { processed: actions.length };
  } catch (err) {
    showToast(`Sync failed: ${err.message}`, 'error');
    return { processed: 0, error: err.message };
  }
}

// ── Network Status & Event Listeners ────────────────────────

export function initNetworkListeners() {
  const updateBadge = () => {
    const badge = document.getElementById('network-badge');
    const text = document.getElementById('network-text');

    if (navigator.onLine) {
      badge.classList.remove('offline');
      text.textContent = 'Online';
    } else {
      badge.classList.add('offline');
      text.textContent = 'Offline — Queue Active';
    }
  };

  window.addEventListener('online', () => {
    updateBadge();
    showToast('Connection restored! Syncing queued actions…', 'success');
    syncQueue(); // Auto-sync on reconnect
  });

  window.addEventListener('offline', () => {
    updateBadge();
    showToast('You are offline. Actions will be queued locally.', 'warning');
  });

  updateBadge();
}

/** Update the queue count badge in the topbar */
export async function updateQueueBadge() {
  const count = await getQueueCount();
  const el = document.getElementById('queue-count');
  el.textContent = count;
  el.classList.toggle('zero', count === 0);
}

function _notifyCountChange() {
  updateQueueBadge();
  if (_onCountChange) _onCountChange();
}

/** Register a callback when queue count changes */
export function onQueueCountChange(cb) {
  _onCountChange = cb;
}
