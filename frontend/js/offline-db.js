// ============================================================
// Dayflow HRMS — IndexedDB Offline Database Client
// ============================================================

const DB_NAME = 'DayflowOfflineDB';
const DB_VERSION = 1;

const STORES = {
  SYNC_QUEUE: 'sync_queue',
  CACHED_PROFILE: 'cached_profile',
  CACHED_ATTENDANCE: 'cached_attendance'
};

let _db = null;

/**
 * Helper to generate UUID v4 for client-side events.
 */
function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Initialize IndexedDB instance and set up object stores.
 * @returns {Promise<IDBDatabase>}
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    if (_db) {
      return resolve(_db);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // sync_queue: Stores actions to be dispatched when back online
      if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'client_event_id' });
      }

      // cached_profile: Cache employee profile details
      if (!db.objectStoreNames.contains(STORES.CACHED_PROFILE)) {
        db.createObjectStore(STORES.CACHED_PROFILE, { keyPath: 'id' });
      }

      // cached_attendance: Cache attendance history logs
      if (!db.objectStoreNames.contains(STORES.CACHED_ATTENDANCE)) {
        db.createObjectStore(STORES.CACHED_ATTENDANCE, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      _db = event.target.result;
      resolve(_db);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to open IndexedDB: ${event.target.error?.message}`));
    };
  });
}

/**
 * Add a new action payload to the sync queue.
 * @param {string} actionType - 'check_in' | 'check_out' | 'leave_apply'
 * @param {object} payload - Event detail payload
 * @returns {Promise<object>} - The enqueued action object
 */
export function enqueueAction(actionType, payload) {
  return new Promise((resolve, reject) => {
    if (!_db) return reject(new Error('Database not initialized'));

    const client_event_id = generateUUID();
    const action = {
      client_event_id,
      type: actionType,
      payload: {
        ...payload,
        recorded_at: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    const transaction = _db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.add(action);

    request.onsuccess = () => {
      resolve(action);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to enqueue action: ${event.target.error?.message}`));
    };
  });
}

/**
 * Retrieve all pending items sorted by their local creation time.
 * @returns {Promise<Array>}
 */
export function getPendingQueue() {
  return new Promise((resolve, reject) => {
    if (!_db) return reject(new Error('Database not initialized'));

    const transaction = _db.transaction(STORES.SYNC_QUEUE, 'readonly');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result || [];
      // Sort in-place by timestamp ascending
      results.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      resolve(results);
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to fetch pending queue: ${event.target.error?.message}`));
    };
  });
}

/**
 * Remove a single action from the sync queue.
 * @param {string} clientEventId - UUID key of the synced action
 * @returns {Promise<void>}
 */
export function removeSyncedAction(clientEventId) {
  return new Promise((resolve, reject) => {
    if (!_db) return reject(new Error('Database not initialized'));

    const transaction = _db.transaction(STORES.SYNC_QUEUE, 'readwrite');
    const store = transaction.objectStore(STORES.SYNC_QUEUE);
    const request = store.delete(clientEventId);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = (event) => {
      reject(new Error(`Failed to delete action: ${event.target.error?.message}`));
    };
  });
}

/**
 * Cache current user profile and attendance data for offline viewing.
 * @param {object} profileData - Profile details
 * @param {Array<object>} attendanceData - List of attendance logs
 * @returns {Promise<void>}
 */
export function cacheUserData(profileData, attendanceData) {
  return new Promise((resolve, reject) => {
    if (!_db) return reject(new Error('Database not initialized'));

    const transaction = _db.transaction(
      [STORES.CACHED_PROFILE, STORES.CACHED_ATTENDANCE],
      'readwrite'
    );

    const profileStore = transaction.objectStore(STORES.CACHED_PROFILE);
    const attendanceStore = transaction.objectStore(STORES.CACHED_ATTENDANCE);

    // Clear previous cached entries first
    profileStore.clear();
    attendanceStore.clear();

    if (profileData && profileData.id) {
      profileStore.put(profileData);
    }

    if (Array.isArray(attendanceData)) {
      attendanceData.forEach((record) => {
        if (record && record.id) {
          attendanceStore.put(record);
        }
      });
    }

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = (event) => {
      reject(new Error(`Failed to cache user data: ${event.target.error?.message}`));
    };
  });
}

/**
 * Retrieve cached user profile and attendance logs.
 * @returns {Promise<{profile: object|null, attendance: Array}>}
 */
export function getCachedUserData() {
  return new Promise((resolve, reject) => {
    if (!_db) return reject(new Error('Database not initialized'));

    const transaction = _db.transaction(
      [STORES.CACHED_PROFILE, STORES.CACHED_ATTENDANCE],
      'readonly'
    );

    const profileStore = transaction.objectStore(STORES.CACHED_PROFILE);
    const attendanceStore = transaction.objectStore(STORES.CACHED_ATTENDANCE);

    const profileRequest = profileStore.getAll();
    const attendanceRequest = attendanceStore.getAll();

    transaction.oncomplete = () => {
      const profile = profileRequest.result?.[0] || null;
      const attendance = attendanceRequest.result || [];
      resolve({ profile, attendance });
    };

    transaction.onerror = (event) => {
      reject(new Error(`Failed to read cached data: ${event.target.error?.message}`));
    };
  });
}
