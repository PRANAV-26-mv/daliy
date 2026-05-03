/* ─────────────────────────────────────────────
   WorkFlow — db.js  (v3)
   IndexedDB wrapper
   Exposes: DB.tasks, DB.reminders, DB.prefs
───────────────────────────────────────────── */

'use strict';

const DB = (() => {
  const NAME = 'workflow-db';
  const VER  = 1;
  let _db    = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }
      const req = indexedDB.open(NAME, VER);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tasks')) {
          const ts = db.createObjectStore('tasks', { keyPath: 'id' });
          ts.createIndex('date',     'date',     { unique: false });
          ts.createIndex('priority', 'priority', { unique: false });
          ts.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains('reminders')) {
          db.createObjectStore('reminders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('prefs')) {
          db.createObjectStore('prefs', { keyPath: 'key' });
        }
      };

      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t   = db.transaction(store, mode);
      const obj = t.objectStore(store);
      const req = fn(obj);
      if (req) {
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
      } else {
        t.oncomplete = () => resolve();
        t.onerror    = e => reject(e.target.error);
      }
    }));
  }

  function getAll(store) {
    return open().then(db => new Promise((resolve, reject) => {
      const t   = db.transaction(store, 'readonly');
      const req = t.objectStore(store).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    }));
  }

  function put(store, item)  { return tx(store, 'readwrite', s => s.put(item)); }
  function del(store, id)    { return tx(store, 'readwrite', s => s.delete(id)); }
  function get(store, id)    { return tx(store, 'readonly',  s => s.get(id)); }
  function clear(store)      { return tx(store, 'readwrite', s => s.clear()); }

  const tasks = {
    getAll:    ()     => getAll('tasks'),
    getByDate: (date) => open().then(db => new Promise((resolve, reject) => {
      const t   = db.transaction('tasks', 'readonly');
      const idx = t.objectStore('tasks').index('date');
      const req = idx.getAll(date);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    })),
    save:   item => put('tasks', item),
    delete: id   => del('tasks', id),
    get:    id   => get('tasks', id),
    clear:  ()   => clear('tasks'),
  };

  const reminders = {
    getAll: ()   => getAll('reminders'),
    save:   item => put('reminders', item),
    delete: id   => del('reminders', id),
  };

  const prefs = {
    get:    key        => get('prefs', key).then(r => r ? r.value : null),
    set:    (key, val) => put('prefs', { key, value: val }),
    getAll: ()         => getAll('prefs').then(rows =>
      rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {})),
  };

  async function migrateFromLocalStorage() {
    const migrated = await prefs.get('ls_migrated');
    if (migrated) return;
    try {
      const oldTasks     = JSON.parse(localStorage.getItem('wf_tasks')     || '[]');
      const oldReminders = JSON.parse(localStorage.getItem('wf_reminders') || '[]');
      const oldTheme     = localStorage.getItem('wf_theme');
      const oldNotif     = localStorage.getItem('wf_notif');
      for (const t of oldTasks)     await tasks.save(t);
      for (const r of oldReminders) await reminders.save(r);
      if (oldTheme) await prefs.set('theme', oldTheme);
      if (oldNotif) await prefs.set('notifEnabled', oldNotif === 'true');
      localStorage.removeItem('wf_tasks');
      localStorage.removeItem('wf_reminders');
      localStorage.removeItem('wf_theme');
      localStorage.removeItem('wf_notif');
    } catch(e) {
      console.warn('[DB] Migration error:', e);
    }
    await prefs.set('ls_migrated', true);
  }

  async function init() {
    await open();
    await migrateFromLocalStorage();
  }

  return { init, tasks, reminders, prefs };
})();