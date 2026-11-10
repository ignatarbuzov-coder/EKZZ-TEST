/* Внешние источники: библиотека документов (стандарты, книги, инструкции) и дополнительные базы вопросов.
   Файлы можно загрузить в программу или подключить папку (в т.ч. сетевую) — тогда её можно перечитывать.
   Всё хранится в памяти браузера (IndexedDB) и работает без интернета. */
(function () {
  const DBN = 'test-prep-lib', ST = 'kv';
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => { const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return dbp;
  }
  async function get(k) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(ST).objectStore(ST).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
  async function set(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function del(k) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(ST, 'readwrite'); t.objectStore(ST).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

  const S = window.Search;
  const meta = { docs: [], bases: [], folders: [] };
  let loaded = false;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ext = n => (n.split('.').pop() || '').toLowerCase();
  const DOC_EXT = ['pdf', 'docx', 'txt', 'md', 'htm', 'html', 'pptx', 'xlsx', 'xls', 'xlsm', 'csv', 'rtf'];
  const BASE_EXT = ['xlsx', 'xls', 'xlsm', 'csv', 'json', 'docx', 'js'];

  async function init() {
    if (loaded) return;
    try { const m = await get('meta'); if (m) Object.assign(meta, m); } catch (e) {}
    loaded = true;
  }
  const saveMeta = () => set('meta', { docs: meta.docs, bases: meta.bases, folders: meta.folders.map(({ handle, ...f }) => f) });

  /* ---------- извлечение текста ---------- */
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не найден файл ' + src)); document.head.appendChild(s); }); }
  let pdfReady = null;
  function pdfLib() {
    if (!pdfReady) pdfReady = (async () => {
      // модуль PDF работает в основном потоке — так он запускается и из сетевой папки (file://)
      if (!window.pdfjsWorker) await loadScript('lib/pdf/pdf.worker.min.js');
      if (!window.pdfjsLib) await loadScript('lib/pdf/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf/pdf.worker.min.js';
      return window.pdfjsLib;
    })();
    return pdfReady;
  }
  async function pdfText(buf, onPage) {
    const lib = await pdfLib();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), tc = await pg.getTextContent();
      let t = '';
      tc.items.forEach(it => { t += it.str; if (it.hasEOL) t += '\n'; else if (it.str && !/\s$/.test(it.str)) t += ' '; });
      pages.push(t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n'));
      if (onPage) onPage(i, doc.numPages);
      pg.cleanup();
    }
    doc.destroy();
    return pages;
  }
  function xmlText(xml, paraTag) {
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    const out = [];
    const ps = d.getElementsByTagName(paraTag);
    for (const p of ps) { let t = ''; const ts = p.getElementsByTagName(paraTag === 'w:p' ? 'w:t' : 'a:t'); for (const x of ts) t += x.textContent; if (t.trim()) out.push(t.trim()); }
    return out.join('\n');
  }
  async function docxText(buf) { const z = await JSZip.loadAsync(buf); const f = z.file('word/document.xml'); return f ? xmlText(await f.async('string'), 'w:p') : ''; }
  async function pptxPages(buf) {
    const z = await JSZip.loadAsync(buf);
    const names = Object.keys(z.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const out = []; for (const n of names) out.push(xmlText(await z.file(n).async('string'), 'a:p')); return out;
  }
  function decode(buf) {
    let t = new TextDecoder('utf-8').decode(buf);
    if ((t.match(/\uFFFD/g) || []).length > 5) { try { t = new TextDecoder('windows-1251').decode(buf); } catch (e) {} }
    return t;
  }
  async function extract(file, onPage) {
    const e = ext(file.name), buf = await file.arrayBuffer();
    if (e === 'pdf') return pdfText(buf, onPage);
    if (e === 'docx') return [await docxText(buf)];
    if (e === 'pptx') return pptxPages(buf);
    if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) {
      const wb = XLSX.read(buf, { type: 'array' });
      return wb.SheetNames.map(n => n + '\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: ' | ', blankrows: false }));
    }
    let t = decode(buf);
    if (e === 'htm' || e === 'html') t = new DOMParser().parseFromString(t, 'text/html').body.innerText || '';
    if (e === 'rtf') t = t.replace(/\\'([0-9a-f]{2})/gi, (m, h) => new TextDecoder('windows-1251').decode(new Uint8Array([parseInt(h, 16)]))).replace(/\\[a-z]+-?\d* ?|[{}]/gi, '');
    return [t];
  }
  // разбить страницы на фрагменты ~700 знаков по абзацам
  function chunk(pages) {
    const out = [];
    pages.forEach((txt, pi) => {
      const paras = (txt || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
      let cur = '';
      const push = () => { if (cur.trim().length > 2) out.push({ p: pi + 1, t: cur.trim() }); cur = ''; };
      paras.forEach(pa => {
        if (cur.length + pa.length > 700 && cur) push();
        if (pa.length > 1100) { for (let i = 0; i < pa.length; i += 700) { cur = pa.slice(i, i + 760); push(); } }
        else cur += (cur ? '\n' : '') + pa;
      });
      push();
    });
    return out;
  }

  /* ---------- документы ---------- */
  async function addDoc(file, o = {}) {
    const sig = file.name + '|' + file.size + '|' + (file.lastModified || 0);
    const old = meta.docs.find(d => (o.path ? d.path === o.path && d.folder === o.folder : d.name === file.name && !d.folder));
    if (old && old.sig === sig) return { skipped: true, doc: old };
    const pages = await extract(file, o.onPage);
    const chunks = chunk(pages);
    const d = old || { id: uid() };
    Object.assign(d, { name: file.name, path: o.path || file.name, folder: o.folder || '', sig, pages: pages.length, chars: chunks.reduce((a, c) => a + c.t.length, 0), noText: !chunks.length, added: Date.now(), hasFile: !o.folder });
    await set('doc:' + d.id, chunks);
    if (!o.folder) { try { await set('file:' + d.id, file.slice(0, file.size, file.type || '')); } catch (e) { d.hasFile = false; } }
    if (!old) meta.docs.push(d);
    index = null;
    return { doc: d, updated: !!old };
  }

  /* ---------- дополнительные базы ---------- */
  async function parseBaseFile(file) {
    const e = ext(file.name);
    if (e === 'js') {
      const t = decode(await file.arrayBuffer()); const m = /BASE_DB\s*=\s*(\[[\s\S]*\]);?/.exec(t);
      return m ? JSON.parse(m[1]) : [];
    }
    if (e === 'json') { const d = JSON.parse(decode(await file.arrayBuffer())); return Array.isArray(d) ? d : (d.items || []); }
    return Importers.importFile(file, 'О');
  }
  async function addBase(name, items, o = {}) {
    const old = meta.bases.find(b => o.path ? b.path === o.path && b.folder === o.folder : b.name === name && !b.folder);
    const b = old || { id: uid(), on: true };
    Object.assign(b, { name, path: o.path || name, folder: o.folder || '', sig: o.sig || '', count: items.length, added: Date.now() });
    await set('base:' + b.id, items.map((x, i) => ({ id: 'x' + b.id + '_' + i, q: x.q, a: x.a || '', w: x.w || [], code: x.code || '', cat: x.cat || '', topic: x.topic || '', kb: b.id })));
    if (!old) meta.bases.push(b);
    baseEng = null;
    return b;
  }

  /* ---------- папки ---------- */
  async function walk(dir, path, out) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.') || name.startsWith('~$')) continue;
      if (h.kind === 'directory') { if (out.length < 3000) await walk(h, path + name + '/', out); }
      else out.push({ h, path: path + name });
    }
    return out;
  }
  // как поступить с файлом: база вопросов или документ библиотеки
  async function ingest(file, path, folder, rep, onStep) {
    const e = ext(file.name), sig = file.name + '|' + file.size + '|' + (file.lastModified || 0);
    const ob = meta.bases.find(b => b.path === path && b.folder === folder), od = meta.docs.find(d => d.path === path && d.folder === folder);
    if ((ob && ob.sig === sig) || (od && od.sig === sig)) { rep.same++; return; }
    if (onStep) onStep(path);
    if (BASE_EXT.includes(e) && e !== 'docx' || (e === 'docx')) {
      let items = [];
      try { items = await parseBaseFile(file); } catch (er) { items = []; }
      const withA = items.filter(x => x.a).length;
      if (items.length >= 3 && (e !== 'docx' || withA >= 5)) { await addBase(file.name.replace(/\.[^.]+$/, ''), items, { path, folder, sig }); rep.bases++; rep.q += items.length; return; }
    }
    if (DOC_EXT.includes(e)) {
      try { const r = await addDoc(file, { path, folder }); if (r.doc.noText) rep.noText.push(path); rep.docs++; } catch (er) { rep.err.push(path + ': ' + (er.message || er)); }
    }
  }
  async function scanFolder(f, onStep) {
    const rep = { docs: 0, bases: 0, q: 0, same: 0, removed: 0, noText: [], err: [] };
    const files = await walk(f.handle, '', []);
    const seen = new Set();
    for (const { h, path } of files) {
      if (!DOC_EXT.includes(ext(path)) && !BASE_EXT.includes(ext(path))) continue;
      seen.add(path);
      try { await ingest(await h.getFile(), path, f.id, rep, onStep); } catch (er) { rep.err.push(path + ': ' + (er.message || er)); }
    }
    // файлы, которых больше нет в папке
    for (const d of meta.docs.filter(d => d.folder === f.id && !seen.has(d.path))) { await removeDoc(d.id, true); rep.removed++; }
    for (const b of meta.bases.filter(b => b.folder === f.id && !seen.has(b.path))) { await removeBase(b.id, true); rep.removed++; }
    f.scanned = Date.now(); await saveMeta(); index = null; baseEng = null;
    return rep;
  }
  async function handles() { return (await get('handles')) || {}; }
  async function connectFolder(onStep) {
    if (!window.showDirectoryPicker) throw new Error('nopicker');
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    const hs = await handles();
    let f = meta.folders.find(x => x.name === handle.name);
    if (!f) { f = { id: uid(), name: handle.name }; meta.folders.push(f); }
    hs[f.id] = handle; await set('handles', hs);
    f.handle = handle;
    return scanFolder(f, onStep);
  }
  async function rescan(onStep) {
    const hs = await handles(), total = { docs: 0, bases: 0, q: 0, same: 0, removed: 0, noText: [], err: [] };
    for (const f of meta.folders) {
      const h = hs[f.id]; if (!h) continue;
      try {
        if (h.requestPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted' && (await h.requestPermission({ mode: 'read' })) !== 'granted') { total.err.push(f.name + ': нет доступа'); continue; }
        f.handle = h;
        const r = await scanFolder(f, onStep);
        Object.keys(total).forEach(k => Array.isArray(total[k]) ? total[k].push(...r[k]) : (total[k] += r[k]));
      } catch (e) { total.err.push(f.name + ': ' + (e.message || e)); }
    }
    return total;
  }
  // запасной вариант без доступа к папке: выбор папки через диалог файлов (разовая загрузка)
  async function addFolderFiles(files, onStep) {
    const rep = { docs: 0, bases: 0, q: 0, same: 0, removed: 0, noText: [], err: [] };
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      if (!DOC_EXT.includes(ext(path)) && !BASE_EXT.includes(ext(path))) continue;
      try { await ingest(file, path, '', rep, onStep); } catch (er) { rep.err.push(path + ': ' + (er.message || er)); }
    }
    await saveMeta(); return rep;
  }

  async function removeDoc(id, noSave) { meta.docs = meta.docs.filter(d => d.id !== id); await del('doc:' + id); await del('file:' + id).catch(() => {}); index = null; if (!noSave) await saveMeta(); }
  async function removeBase(id, noSave) { meta.bases = meta.bases.filter(b => b.id !== id); await del('base:' + id); baseEng = null; if (!noSave) await saveMeta(); }
  async function removeFolder(id) {
    for (const d of meta.docs.filter(d => d.folder === id)) await removeDoc(d.id, true);
    for (const b of meta.bases.filter(b => b.folder === id)) await removeBase(b.id, true);
    meta.folders = meta.folders.filter(f => f.id !== id);
    const hs = await handles(); delete hs[id]; await set('handles', hs); await saveMeta();
  }
  async function toggleBase(id, on) { const b = meta.bases.find(x => x.id === id); if (b) { b.on = on; baseEng = null; await saveMeta(); } }

  /* ---------- поиск по документам ---------- */
  let index = null, building = null;
  async function buildIndex() {
    if (index) return index;
    if (building) return building;
    building = (async () => {
      const chunks = [], map = new Map();
      for (const d of meta.docs) {
        const cs = (await get('doc:' + d.id)) || [];
        cs.forEach(c => {
          const ci = chunks.length; chunks.push({ d, p: c.p, t: c.t, n: ' ' + S.words(c.t).join(' ') + ' ' });
          new Set(S.words(c.t).filter(w => !S.STOP.has(w)).map(S.key5)).forEach(k => { let a = map.get(k); if (!a) map.set(k, a = []); a.push(ci); });
        });
      }
      index = { chunks, map, keys: [...map.keys()] };
      building = null; return index;
    })();
    return building;
  }
  async function searchDocs(raw, limit = 20) {
    await init();
    if (!meta.docs.length) return { list: [], tokens: [] };
    const ix = await buildIndex();
    let toks = S.words(raw).filter(w => !S.STOP.has(w));
    const typing = !/\s$/.test(raw);
    const pats = toks.map((t, i) => (i === toks.length - 1 && typing) ? t : S.stem(t)).filter(Boolean);
    if (!pats.length) return { list: [], tokens: [] };
    const N = ix.chunks.length || 1, score = new Map(), hits = new Map();
    pats.forEach(p => {
      const ks = p.length >= 5 ? [p.slice(0, 5)] : ix.keys.filter(k => k.startsWith(p));
      const set = new Set(); ks.forEach(k => (ix.map.get(k) || []).forEach(ci => set.add(ci)));
      const w = Math.log(1 + N / (1 + set.size));
      set.forEach(ci => { score.set(ci, (score.get(ci) || 0) + w); hits.set(ci, (hits.get(ci) || 0) + 1); });
    });
    let res = [...score.entries()].map(([ci, s]) => ({ ci, s, full: hits.get(ci) === pats.length }));
    let full = res.filter(r => r.full); if (!full.length) full = res.filter(r => hits.get(r.ci) >= Math.ceil(pats.length * 0.6));
    const phrase = pats.length > 1 ? ' ' + pats.join(' ') : '';
    full.forEach(r => { const c = ix.chunks[r.ci]; if (phrase && c.n.includes(phrase)) r.s += 3; pats.forEach(p => { if (c.n.includes(' ' + p)) r.s += 0.5; }); });
    full.sort((a, b) => b.s - a.s);
    return { list: full.slice(0, limit).map(r => ({ ...ix.chunks[r.ci], snip: snippet(ix.chunks[r.ci].t, pats) })), tokens: pats, total: full.length };
  }
  function snippet(t, pats) {
    const low = t.toLowerCase().replace(/ё/g, 'е');
    let pos = -1; for (const p of pats) { const m = new RegExp('(^|[^а-яa-z0-9])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(low); if (m) { pos = m.index; break; } }
    const a = Math.max(0, pos - 140), b = Math.min(t.length, Math.max(pos, 0) + 320);
    return (a > 0 ? '…' : '') + t.slice(a, b).replace(/\s*\n\s*/g, ' ') + (b < t.length ? '…' : '');
  }

  /* ---------- поиск по дополнительным базам ---------- */
  let baseEng = null;
  async function baseEngine() {
    if (baseEng) return baseEng;
    const items = [];
    for (const b of meta.bases.filter(b => b.on)) { const it = (await get('base:' + b.id)) || []; it.forEach(x => { x.kbName = b.name; items.push(x); }); }
    baseEng = S.make(); baseEng.build(items);
    return baseEng;
  }
  async function searchBases(raw, fuzzy) {
    await init();
    if (!meta.bases.some(b => b.on)) return { list: [], tokens: [] };
    const e = await baseEngine();
    return fuzzy ? e.fuzzy(raw) : e.query(raw);
  }
  async function baseItems(id) { return (await get('base:' + id)) || []; }

  /* ---------- открыть документ ---------- */
  async function openDoc(id, page) {
    const d = meta.docs.find(x => x.id === id); if (!d) return false;
    let blob = null;
    if (d.hasFile) blob = await get('file:' + id);
    else if (d.folder) {
      const h = (await handles())[d.folder];
      if (h) {
        if (h.requestPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') await h.requestPermission({ mode: 'read' });
        let cur = h; const parts = d.path.split('/');
        for (let i = 0; i < parts.length - 1; i++) cur = await cur.getDirectoryHandle(parts[i]);
        blob = await (await cur.getFileHandle(parts[parts.length - 1])).getFile();
      }
    }
    if (!blob) return false;
    const type = ext(d.name) === 'pdf' ? 'application/pdf' : (blob.type || '');
    const url = URL.createObjectURL(type && blob.type !== type ? new Blob([blob], { type }) : blob);
    const w = window.open(url + (type === 'application/pdf' && page ? '#page=' + page : ''), '_blank');
    if (!w) { const a = document.createElement('a'); a.href = url; a.download = d.name; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return true;
  }

  window.Lib = {
    init, meta, addDoc, addBase, parseBaseFile, connectFolder, rescan, addFolderFiles, removeDoc, removeBase, removeFolder, toggleBase,
    searchDocs, searchBases, baseItems, openDoc, saveMeta, extract, DOC_EXT, BASE_EXT,
    canPickFolder: () => !!window.showDirectoryPicker,
    has: () => meta.docs.length + meta.bases.filter(b => b.on).length > 0
  };
})();
