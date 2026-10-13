'use strict';
/** Minimal in-memory IndexedDB covering exactly what static/js/app.js uses. */

class FakeRequest {
  constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; this.error = null; }
  _ok(result) { this.result = result; queueMicrotask(() => this.onsuccess && this.onsuccess({ target: this })); }
  _fail(error) { this.error = error; queueMicrotask(() => this.onerror && this.onerror({ target: this })); }
}

/** jsdom Blob instances can't be structuredCloned — keep them by reference. */
function safeClone(value) {
  try { return structuredClone(value); } catch { return value; }
}

class FakeObjectStore {
  constructor(name, { keyPath, autoIncrement }) {
    this.name = name; this.keyPath = keyPath; this.autoIncrement = autoIncrement;
    this.records = new Map(); this._seq = 1; this.indexes = new Map();
    this.failNextAddWith = null; // for quota tests
  }
  createIndex(name, keyPath) {
    const idx = { name, keyPath };
    this.indexes.set(name, idx);
    return idx;
  }
  _req() { return new FakeRequest(); }
  add(value) {
    const req = this._req();
    if (this.failNextAddWith) {
      const e = this.failNextAddWith;
      this.failNextAddWith = null;
      req._fail(e);
      return req;
    }
    if (value[this.keyPath] === undefined && this.autoIncrement) value[this.keyPath] = this._seq++;
    this.records.set(value[this.keyPath], safeClone(value));
    req._ok(value[this.keyPath]);
    return req;
  }
  put(value) { this.records.set(value[this.keyPath], safeClone(value)); const r = this._req(); r._ok(value[this.keyPath]); return r; }
  delete(id) { this.records.delete(id); const r = this._req(); r._ok(undefined); return r; }
  clear() { this.records.clear(); const r = this._req(); r._ok(undefined); return r; }
  get(id) { const r = this._req(); r._ok(this.records.get(id)); return r; }
  getAll() { const r = this._req(); r._ok([...this.records.values()]); return r; }
  index(name) {
    const idx = this.indexes.get(name);
    if (!idx) throw new Error(`no index ${name}`);
    const keyPath = idx.keyPath;
    return {
      getAll: () => {
        const r = new FakeRequest();
        r._ok([...this.records.values()].sort((a, b) => (a[keyPath] ?? 0) - (b[keyPath] ?? 0)));
        return r;
      },
    };
  }
}

class FakeDB {
  constructor() { this.stores = new Map(); }
  get objectStoreNames() {
    return { contains: (n) => this.stores.has(n) };
  }
  createObjectStore(name, opts) { const s = new FakeObjectStore(name, opts); this.stores.set(name, s); return s; }
  transaction(name) {
    if (!this.stores.has(name)) throw new Error(`no store ${name}`);
    const store = this.stores.get(name);
    return { objectStore: () => store };
  }
}

function installFakeIndexedDB(win) {
  const dbs = new Map();
  const idb = {
    open(name, version) {
      const req = new FakeRequest();
      queueMicrotask(() => {
        let db = dbs.get(name);
        if (!db) { db = new FakeDB(); dbs.set(name, db); }
        req.result = db;
        if (!db.stores.size) {
          req._upgrade = true;
          const store = db.createObjectStore('generations', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp');
          req.onupgradeneeded && req.onupgradeneeded({ target: req });
        }
        req.onsuccess && req.onsuccess({ target: req });
      });
      return req;
    },
  };
  win.indexedDB = idb;
  return {
    dbs, idb,
    // Auto-create the app's DB/store on first access so tests can seed
    // data before any generation triggers openDB().
    get store() {
      const NAME = 'talky_history';
      let db = dbs.get(NAME);
      if (!db) {
        db = new FakeDB();
        dbs.set(NAME, db);
        const store = db.createObjectStore('generations', { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp');
      }
      return db.stores.get('generations');
    }
  };
}

module.exports = { installFakeIndexedDB, FakeDB, FakeObjectStore };
