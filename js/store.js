/* Хранилище базы: IndexedDB (основное), localStorage / память (запасные варианты). */
(function () {
  const DB_NAME = 'test-prep', STORE = 'kv', KEY = 'db';
  let mode = 'idb', mem = null;

  function idb() {
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(DB_NAME, 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    const d = await idb();
    return new Promise((res, rej) => { const t = d.transaction(STORE).objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  }
  async function idbSet(k, v) {
    const d = await idb();
    return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }

  const Store = {
    mode: () => mode,
    async load() {
      try { const v = await idbGet(KEY); mode = 'idb'; return v || null; }
      catch (e) {
        try { const s = localStorage.getItem(DB_NAME + ':' + KEY); mode = 'ls'; return s ? JSON.parse(s) : null; }
        catch (e2) { mode = 'mem'; return mem; }
      }
    },
    async save(data) {
      if (mode === 'idb') { try { await idbSet(KEY, data); return true; } catch (e) { mode = 'ls'; } }
      if (mode === 'ls') { try { localStorage.setItem(DB_NAME + ':' + KEY, JSON.stringify(data)); return true; } catch (e) { mode = 'mem'; } }
      mem = data; return false;
    },
    getPref(k, d) { try { const v = localStorage.getItem('tp:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    setPref(k, v) { try { localStorage.setItem('tp:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  window.Store = Store;
})();
