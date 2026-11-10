/* Подготовка к тестированию — логика интерфейса */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const S = window.Search, esc = S.esc;
  const desk = window.desk || null;
  const CAT_NAME = { 'Ф': 'Функциональные', 'Т': 'Технические', 'О': 'Общие' };

  let DB = { version: 1, baseVersion: '', items: [], nextId: 1 };
  let cur = { list: [], tokens: [], sel: -1, focusId: null, fuzzy: null };
  const st = { cat: Store.getPref('cat', ''), code: '', comp: '', compactIdx: 0, ext: Store.getPref('ext', false), tab: 'search' };
  const GROUP = { 'Ф': 'Функциональные', 'Т': 'Технические', 'О': 'Общие' };

  /* ---------- платформа ---------- */
  const isMobile = matchMedia('(pointer:coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  document.body.classList.toggle('web', !desk);
  document.body.classList.toggle('mobile', isMobile);
  if (!desk && !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) document.body.classList.add('mobile');

  /* ---------- уведомления ---------- */
  let toastT;
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }

  /* ---------- модальное окно ---------- */
  function modal(title, bodyHTML, buttons = []) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    const f = $('#modalFoot'); f.innerHTML = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || ''); el.textContent = b.text;
      el.onclick = () => b.onClick && b.onClick(el);
      f.appendChild(el);
    });
    f.hidden = !buttons.length;
    $('#modal').hidden = false;
    return $('#modalBody');
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

  /* ---------- данные ---------- */
  async function loadDB() {
    const saved = await Store.load();
    if (saved && saved.items && saved.items.length) {
      DB = saved;
      // в папке программы лежит более новая база — добавить из неё новые вопросы
      if (window.BASE_VERSION && DB.baseVersion !== window.BASE_VERSION && window.BASE_DB) {
        const rm = new Set(DB.removed || []);
        S.build(DB.items);
        const rep = addItems(window.BASE_DB.filter(x => !rm.has(S.dupKey(x.q, x.a))).map(x => ({ ...x })), { silent: true });
        // компетенции из общей базы — тем вопросам, у которых они ещё не указаны
        const bk = new Map(), bq = new Map();
        window.BASE_DB.forEach(x => { if (x.comp) { bk.set(S.dupKey(x.q, x.a), x.comp); bq.set(S.qKey(x.q), x.comp); } });
        DB.items.forEach(x => { if (!x.comp || x.compAuto) { const c = bk.get(S.dupKey(x.q, x.a)) || bq.get(S.qKey(x.q)); if (c) { x.comp = c; delete x.compAuto; } } });
        if (window.BASE_MATRIX && !DB.matrixEdited) DB.matrix = window.BASE_MATRIX.map(x => ({ ...x }));
        DB.baseVersion = window.BASE_VERSION; persist();
        if (rep.added) setTimeout(() => toast('Общая база обновлена: добавлено вопросов — ' + rep.added, 4000), 600);
      }
    } else {
      DB.items = (window.BASE_DB || []).map(x => ({ ...x }));
      DB.baseVersion = window.BASE_VERSION || '';
      DB.nextId = DB.items.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
    }
    if (!DB.matrix) DB.matrix = (window.BASE_MATRIX || []).map(x => ({ ...x }));
    if (!DB.thr) DB.thr = { r: 5, y: 10 };
    reindex();
  }
  let saveT;
  function persist() { clearTimeout(saveT); saveT = setTimeout(() => Store.save(DB).then(ok => { if (!ok) toast('Не удалось сохранить базу в памяти браузера — сделайте резервную копию'); }), 150); }
  function reindex() {
    S.build(DB.items);
    $('#dbCount').textContent = DB.items.length.toLocaleString('ru-RU') + ' вопр.';
    const codes = [...new Set(DB.items.map(x => x.code).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
    const sel = $('#codeSel'), v = sel.value;
    sel.innerHTML = '<option value="">Все идентификаторы</option>' + codes.map(c => `<option${c === v ? ' selected' : ''}>${esc(c)}</option>`).join('');
    renderCompSel();
    if (st.tab === 'matrix') renderMatrix();
  }
  const compId = m => m.g + m.c;
  function compName(id) { const m = (DB.matrix || []).find(x => compId(x) === id); return m ? m.n : ''; }
  function compLabel(id) { if (!id) return ''; const g = id[0], c = id.slice(1); return (g === 'Ф' ? 'Ф ' : g === 'Т' ? 'Т ' : 'О ') + c; }
  function renderCompSel() {
    const sel = $('#compSel'); if (!sel) return;
    const opts = ['Ф', 'Т', 'О'].map(g => {
      const ms = (DB.matrix || []).filter(m => m.g === g); if (!ms.length) return '';
      return `<optgroup label="${GROUP[g]}">${ms.map(m => `<option value="${compId(m)}"${compId(m) === st.comp ? ' selected' : ''}>${esc(m.c + ' ' + m.n)}</option>`).join('')}</optgroup>`;
    }).join('');
    sel.innerHTML = `<option value="">Все компетенции</option>${opts}<option value="-"${st.comp === '-' ? ' selected' : ''}>Без компетенции</option>`;
    sel.classList.toggle('on', !!st.comp);
  }
  function byId(id) { return DB.items.find(x => x.id === id); }

  /* ---------- поиск ---------- */
  const q = $('#q');
  let inT;
  q.addEventListener('input', () => { clearTimeout(inT); inT = setTimeout(() => runSearch(true), 50); });
  function runSearch(showSuggest) {
    cur.fuzzy = null; cur.focusId = null; st.compactIdx = 0;
    const r = S.query(q.value, { cat: st.cat, code: st.code, comp: st.comp });
    cur.list = r.list; cur.tokens = r.tokens; cur.partial = r.partial; cur.sel = -1;
    renderSuggest(showSuggest);
    renderResults();
  }
  function renderSuggest(show) {
    const ul = $('#suggest');
    if (!show || !q.value.trim() || !cur.list.length) { ul.hidden = true; fitCompact(); return; }
    const n = document.body.classList.contains('compact') ? 10 : 12;
    ul.innerHTML = cur.list.slice(0, n).map((it, i) =>
      `<li role="option" data-i="${i}" class="${i === cur.sel ? 'sel' : ''}">${it.code ? `<span class="badge code">${esc(it.code)}</span>` : ''}<span class="sq">${S.highlight(oneLine(it.q), cur.tokens)}</span></li>`).join('');
    ul.hidden = false; fitCompact();
  }
  let fitT;
  function fitCompact() {
    if ((!desk && !lite) || !document.body.classList.contains('compact')) return;
    clearTimeout(fitT);
    fitT = setTimeout(() => {
      const card = document.querySelector('.search-card'), ul = $('#suggest');
      let h = card.offsetHeight + 4;
      if (!ul.hidden) h = Math.max(h, ul.offsetTop + Math.min(ul.scrollHeight + 2, 380) + 10);
      if (desk) desk.fit(h); else liteResize(window.outerWidth, Math.round(h + (window.outerHeight - window.innerHeight)));
    }, 10);
  }
  function oneLine(s) { return (s || '').replace(/\s*\n\s*/g, ' '); }
  $('#suggest').addEventListener('mousedown', e => {
    const li = e.target.closest('li'); if (!li) return;
    e.preventDefault(); pick(+li.dataset.i);
  });
  function pick(i) {
    const it = cur.list[i]; if (!it) return;
    cur.focusId = it.id; st.compactIdx = i;
    $('#suggest').hidden = true;
    renderResults();
  }
  q.addEventListener('keydown', e => {
    const ul = $('#suggest');
    const n = Math.min(cur.list.length, 12);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return; e.preventDefault();
      if (ul.hidden && document.body.classList.contains('compact')) { // листать ответы
        st.compactIdx = (st.compactIdx + (e.key === 'ArrowDown' ? 1 : -1) + cur.list.length) % cur.list.length;
        cur.focusId = cur.list[st.compactIdx].id; renderCompact(); return;
      }
      cur.sel = (cur.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderSuggest(true);
      const li = ul.querySelector('li.sel'); if (li) li.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault(); pick(cur.sel >= 0 ? cur.sel : 0);
    } else if (e.key === 'Escape') {
      if (!ul.hidden) ul.hidden = true;
      else if (q.value) { q.value = ''; runSearch(false); }
      else if (desk) desk.tray();
    }
  });
  q.addEventListener('blur', () => setTimeout(() => { $('#suggest').hidden = true; fitCompact(); }, 120));
  q.addEventListener('focus', () => { if (q.value.trim() && !cur.focusId) renderSuggest(true); });
  $('#btnClear').onclick = () => { q.value = ''; runSearch(false); q.focus(); };

  $('#catSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    st.cat = b.dataset.cat; Store.setPref('cat', st.cat);
    $$('#catSeg button').forEach(x => x.classList.toggle('on', x === b));
    rerun();
  });
  $('#codeSel').onchange = e => { st.code = e.target.value; rerun(); };
  $('#compSel').onchange = e => { st.comp = e.target.value; renderCompSel(); rerun(); };
  function rerun() { if (cur.fuzzy) showFuzzy(cur.fuzzy); else runSearch(false); }

  /* ---------- отображение ---------- */
  function answers(it) { return (it.a || '').split(/\n+/).map(s => s.trim()).filter(Boolean); }
  function card(it, focus) {
    const tk = cur.tokens, tka = cur.fuzzy ? [] : tk;
    const meta = [
      it.code ? `<span class="badge code">${esc(it.code)}</span>` : '',
      it.cat ? `<span class="badge cat-${it.cat}" title="${it.auto ? 'Категория определена автоматически' : ''}">${CAT_NAME[it.cat]}${it.auto ? ' *' : ''}</span>` : '',
      it.comp && it.comp !== '-' ? `<span class="badge comp" data-comp="${esc(it.comp)}" title="${esc(compName(it.comp) || 'Компетенции нет в матрице')}${it.compAuto ? ' (определена автоматически)' : ''}">${esc(compLabel(it.comp))}${it.compAuto ? ' *' : ''}</span>` : '',
      it.level ? `<span class="badge lvl">Уровень ${esc(it.level)}</span>` : '',
      it.conflict ? '<span class="badge warn" title="Один и тот же вопрос встречается в файлах с разными ответами — проверьте">в источниках разные ответы</span>' : '',
      it.topic ? `<span class="topic">${esc(it.topic)}</span>` : ''
    ].join('');
    const ans = answers(it);
    let opts = ans.map(a => `<div class="opt right"><span class="dot"></span><span class="atext">${S.highlight(a, tka)}</span></div>`).join('');
    if (!ans.length) opts = '<div class="opt none"><span class="dot">?</span><span class="atext">Правильный ответ в источниках не отмечен. Нажмите «Изменить», чтобы указать его.</span></div>';
    if (Store.getPref('showOpts', false) || !ans.length) {
      opts += (it.w || []).map(w => `<div class="opt wrong"><span class="dot"></span><span class="atext">${S.highlight(w, tka)}</span></div>`).join('');
    }
    return `<article class="qcard${focus ? ' focus' : ''}" data-id="${it.id}">
      <div class="qhead"><svg class="qico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01"/></svg>
      <div class="qtext">${S.highlight(it.q, tk)}</div></div>
      <div class="qmeta">${meta}</div>
      <hr class="sep">${opts}
      <div class="qactions"><button class="link-btn" data-act="edit">Изменить</button><button class="link-btn" data-act="copy">Копировать ответ</button></div>
    </article>`;
  }
  function renderResults() {
    const box = $('#results'), stEl = $('#status');
    renderCompact();
    if (!q.value.trim() && !cur.fuzzy && !st.code && !st.comp) {
      const c = { 'Ф': 0, 'Т': 0, 'О': 0 }; DB.items.forEach(x => c[x.cat] = (c[x.cat] || 0) + 1);
      stEl.textContent = '';
      box.innerHTML = `<div class="empty"><b>Введите начало вопроса или несколько ключевых слов</b><br>
        Например: «наряд допуск», «тех 3.1 давлен», «ведущ ремонт». Слова можно вводить не полностью и в любом порядке.<br><br>
        В базе ${DB.items.length.toLocaleString('ru-RU')} вопросов: функциональных — ${c['Ф']}, технических — ${c['Т']}, общих — ${c['О']}.</div>`;
      return;
    }
    let list = cur.list;
    if (cur.focusId) { const f = byId(cur.focusId); list = [f, ...list.filter(x => x.id !== cur.focusId)]; }
    const shown = list.slice(0, 60);
    const compT = st.comp ? (st.comp === '-' ? 'Без компетенции · ' : compLabel(st.comp) + ' ' + compName(st.comp) + ' · ') : '';
    stEl.textContent = compT + (cur.fuzzy ? `Распознанный текст: найдено похожих вопросов — ${list.length}` :
      list.length ? `Найдено: ${list.length}${list.length > 60 ? ' (показаны первые 60 — уточните запрос)' : ''}${cur.partial ? ' · точных совпадений нет, показаны частичные' : ''}` : 'Ничего не найдено. Попробуйте другие слова или их начало.');
    box.innerHTML = shown.map((it, i) => card(it, cur.focusId && i === 0)).join('') + '<div id="extBox"></div>';
    box.scrollTop = 0;
    runExternal();
  }
  function renderCompact() {
    const el = $('#compactAnswer');
    const list = cur.list;
    if (!list.length || (!q.value.trim() && !cur.fuzzy)) { el.innerHTML = q.value.trim() ? '<div class="ca-q">Ничего не найдено</div>' : ''; fitCompact(); return; }
    const idx = Math.max(0, list.findIndex(x => x.id === cur.focusId));
    const it = list[idx];
    const ans = answers(it);
    el.innerHTML = `<div class="ca-q" title="${esc(it.q)}">${it.code ? esc(it.code) + ' · ' : ''}${S.highlight(oneLine(it.q), cur.tokens)}</div>
      <div class="ca-a"><span class="dot"></span><span>${ans.length ? ans.map(esc).join('<br>') : '<span style="color:var(--warn)">ответ не отмечен</span>'}</span><span class="nav">${idx + 1}/${list.length} ↑↓</span></div>`;
    fitCompact();
  }
  $('#results').addEventListener('click', e => {
    const bc = e.target.closest('.badge.comp'); if (bc) { setComp(bc.dataset.comp); return; }
    const od = e.target.closest('[data-open]'); if (od) { Lib.openDoc(od.dataset.open, +od.dataset.page || 0).then(ok => { if (!ok) toast('Файл недоступен. Для документов из папки откройте вкладку «Библиотека» → «Перечитать папки».', 4500); }); return; }
    if (e.target.closest('[data-goext]')) { setTab('lib'); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.closest('.ext')) { const x = extCache.get(b.closest('.qcard').dataset.x); if (!x) return;
      if (b.dataset.act === 'copy') navigator.clipboard && navigator.clipboard.writeText(x.a || '').then(() => toast('Ответ скопирован'));
      if (b.dataset.act === 'take') { const { id, kb, kbName, ...n } = x; addChecked([{ ...n, src: ['Доп. база: ' + kbName] }], r => toast(r.added ? 'Вопрос перенесён в основную базу' : 'Вопрос не добавлен')); }
      return; }
    const it = byId(+b.closest('.qcard').dataset.id);
    if (b.dataset.act === 'edit') editItem(it);
    if (b.dataset.act === 'copy') { navigator.clipboard && navigator.clipboard.writeText(it.a || '').then(() => toast('Ответ скопирован')); }
  });

  /* ---------- редактирование ---------- */
  function itemForm(it) {
    const o = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    return `<div class="field"><label>Вопрос${micBtn('fQ')}</label><textarea id="fQ" rows="3">${esc(it.q || '')}</textarea></div>
      <div class="field"><label>Правильный ответ (если правильных несколько — каждый с новой строки)${micBtn('fA')}</label><textarea id="fA" rows="2">${esc(it.a || '')}</textarea></div>
      <div class="field"><label>Неправильные варианты (каждый с новой строки, необязательно)</label><textarea id="fW" rows="3">${esc((it.w || []).join('\n'))}</textarea></div>
      <div class="grid2">
        <div class="field"><label>Категория</label><select id="fC">${o('Ф', 'Функциональные', it.cat)}${o('Т', 'Технические', it.cat)}${o('О', 'Общие', it.cat || 'О')}</select></div>
        <div class="field"><label>Идентификатор</label><input id="fCode" list="codesList" placeholder="например, ТЕХ 3.1" value="${esc(it.code || '')}"></div>
        <div class="field"><label>Уровень</label><select id="fL">${o('', '—', it.level || '')}${o('А', 'А', it.level)}${o('В', 'В', it.level)}${o('С', 'С', it.level)}</select></div>
      </div>
      <div class="field"><label>Компетенция (матрица)</label><select id="fComp">${compOptions(it.comp === undefined ? '*' : it.comp)}</select></div>
      <div class="field"><label>Тема</label><input id="fT" value="${esc(it.topic || '')}"></div>
      <datalist id="codesList">${[...new Set(DB.items.map(x => x.code).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      ${it.src && it.src.length ? `<p class="note">Источник: ${esc(it.src.slice(0, 4).join('; '))}</p>` : ''}`;
  }
  const micBtn = id => `<button type="button" class="mic sm" data-for="${id}" title="Диктовать голосом"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>`;
  function compOptions(v) {
    return `<option value="*"${v === '*' ? ' selected' : ''}>определить автоматически</option><option value=""${!v ? ' selected' : ''}>— не указана —</option>` + ['Ф', 'Т', 'О'].map(g => {
      const ms = DB.matrix.filter(m => m.g === g); return ms.length ? `<optgroup label="${GROUP[g]}">${ms.map(m => `<option value="${compId(m)}"${compId(m) === v ? ' selected' : ''}>${esc(m.c + ' ' + m.n)}</option>`).join('')}</optgroup>` : '';
    }).join('');
  }
  function readForm() {
    const v = id => $('#' + id).value.trim();
    let code = v('fCode'); const nc = Importers.normCode(code); if (nc) code = nc;
    return { q: v('fQ'), a: v('fA'), w: v('fW').split('\n').map(s => s.trim()).filter(Boolean), cat: v('fC'), code, level: v('fL'), topic: v('fT'), comp: v('fComp') };
  }
  function editItem(it) {
    modal('Изменить вопрос', itemForm({ ...it, comp: it.compAuto ? (it.comp || '*') : (it.comp || '') }), [
      { text: 'Удалить', cls: 'danger', onClick: () => { if (confirm('Удалить этот вопрос из базы?')) { forget(it); DB.items = DB.items.filter(x => x !== it); afterChange(); closeModal(); toast('Вопрос удалён'); } } },
      { text: 'Отмена', onClick: closeModal },
      { text: 'Сохранить', cls: 'primary', onClick: () => {
        const f = readForm(); if (!f.q) return toast('Вопрос не может быть пустым');
        const save = () => {
          if (f.cat !== it.cat) delete it.auto;
          const prevComp = it.comp;
          forget(it); Object.assign(it, f); delete it.conflict; it.edited = Date.now();
          if (f.comp === '*') { const c = autoComp(it); if (c) { it.comp = c; it.compAuto = 1; } else it.comp = prevComp || ''; } else delete it.compAuto;
          compIx = null; afterChange(); closeModal(); toast('Изменения сохранены');
        };
        const changed = S.qKey(f.q) !== S.qKey(it.q) || S.dupKey(f.q, f.a) !== S.dupKey(it.q, it.a);
        const d = changed ? findDups([f], it) : [];
        if (!d.length || d[0].kind === 'inner') return save();
        modal('Найден дубль', `<p class="report" style="margin-top:0">После изменения ${DUP_TXT[d[0].kind]}${d[0].j ? ` (совпадение ${Math.round(d[0].j * 100)}%)` : ''}.</p>${dupPair(d[0])}`,
          [{ text: 'Сохранить дубль', onClick: save }, { text: 'Удалить дубль', cls: 'primary', onClick: () => { forget(it); DB.items = DB.items.filter(x => x !== it); afterChange(); closeModal(); toast('Дубль удалён, в базе остался прежний вопрос'); } }]);
      } }
    ]);
  }
  function newItem(pre = {}) {
    modal('Добавить вопрос', itemForm({ cat: st.cat || 'О', comp: st.comp && st.comp !== '-' ? st.comp : '*', ...pre }), [
      { text: 'Отмена', onClick: closeModal },
      { text: 'Добавить в базу', cls: 'primary', onClick: () => {
        const f = readForm(); if (!f.q) return toast('Введите вопрос');
        closeModal();
        addChecked([{ ...f, src: [pre.srcName || 'Добавлено вручную'] }], r => toast(r.added ? 'Вопрос добавлен в базу' + (r.keptDups ? ' (дубль сохранён)' : '') : r.removedDups ? 'Дубль удалён — вопрос не добавлен' : (r.updated ? 'Такой вопрос уже был — ответ обновлён' : 'Вопрос не добавлен')));
      } }
    ]);
    setTimeout(() => { const t = $('#fQ'); if (t && !t.value) t.focus(); }, 30);
  }
  // запомнить исходный вариант, чтобы при обновлении общей базы он не вернулся
  function forget(it) { DB.removed = DB.removed || []; const k = S.dupKey(it.q, it.a); if (!DB.removed.includes(k)) DB.removed.push(k); }
  function afterChange() { reindex(); persist(); rerun(); }

  /* Добавление с проверкой дублей. Возвращает отчёт. */
  function addItems(list, opt = {}) {
    const byKey = new Map(), byQ = new Map();
    DB.items.forEach(x => { byKey.set(S.dupKey(x.q, x.a), x); const k = S.qKey(x.q); if (!byQ.has(k)) byQ.set(k, []); byQ.get(k).push(x); });
    const rep = { added: 0, dup: 0, updated: 0, conflict: 0, noAns: 0, compAuto: 0 };
    const force = opt.force || new Set();
    compIx = null;
    list.forEach(n => {
      if (!n || !n.q) return;
      const k = S.dupKey(n.q, n.a);
      const ex = force.has(n) ? null : byKey.get(k);
      if (ex) { // дубль — дополним недостающее
        rep.dup++;
        if (!ex.code && n.code) ex.code = n.code;
        if ((!ex.w || !ex.w.length) && n.w && n.w.length) ex.w = n.w;
        if (n.src) ex.src = [...new Set([...(ex.src || []), ...n.src])].slice(0, 8);
        return;
      }
      const same = byQ.get(S.qKey(n.q)) || [];
      if (same.length && force.has(n)) { if (n.a && same.some(x => x.a && x.a !== n.a)) { rep.conflict++; same.forEach(x => (x.conflict = 1)); n.conflict = 1; } }
      else if (same.length) {
        const noA = same.find(x => !x.a);
        if (noA && n.a) { noA.a = n.a; if (n.w && n.w.length) noA.w = n.w; rep.updated++; byKey.set(k, noA); return; }
        if (!n.a) { rep.dup++; return; }
        if (opt.replace) { same[0].a = n.a; if (n.w && n.w.length) same[0].w = n.w; rep.updated++; return; }
        rep.conflict++; same.forEach(x => (x.conflict = 1)); n.conflict = 1;
      }
      if (!n.a) rep.noAns++;
      const it = { id: DB.nextId++, q: n.q, a: n.a || '', w: n.w || [], code: n.code || '', cat: n.cat || 'О', topic: n.topic || '', level: n.level || '', qt: n.qt || '', src: n.src || [], added: Date.now() };
      if (n.conflict) it.conflict = 1;
      if (n.comp && n.comp !== '*') it.comp = n.comp;
      else if (!opt.silent) { const c = autoComp(it); if (c) { it.comp = c; it.compAuto = 1; rep.compAuto++; } }
      DB.items.push(it); byKey.set(k, it);
      const qk = S.qKey(n.q); if (!byQ.has(qk)) byQ.set(qk, []); byQ.get(qk).push(it);
      rep.added++;
    });
    if (opt.silent) { reindex(); } else afterChange();
    return rep;
  }

  /* ================= Компетенции ================= */
  function keysOf(t) { return new Set(S.words(t).filter(w => w.length > 2 && !S.STOP.has(w)).map(S.key5)); }
  let compIx = null; // кэш для автоопределения
  function compIndex() {
    if (compIx && compIx.n === DB.items.length && compIx.m === DB.matrix) return compIx;
    const ids = new Set(DB.matrix.map(compId));
    const its = DB.items.filter(x => x.comp && ids.has(x.comp) && !x.compAuto).map(x => ({ c: x.comp, code: x.code, k: keysOf(x.q + ' ' + (x.a || '')) }));
    const names = DB.matrix.map(m => ({ c: compId(m), k: keysOf(m.n) }));
    return (compIx = { n: DB.items.length, m: DB.matrix, its, names, ids });
  }
  function autoComp(it) {
    const ix = compIndex();
    const m = /ТЕХ\s*(\d+\.\d+)/i.exec(it.code || '');
    if (m && ix.ids.has('Т' + m[1])) return 'Т' + m[1];
    const K = keysOf(it.q + ' ' + (it.a || '')); if (!K.size) return '';
    const sc = [];
    ix.its.forEach(x => { let s = 0; K.forEach(k => { if (x.k.has(k)) s += S.idf(k); }); if (s > 0) { if (it.code && x.code === it.code) s *= 1.5; if (it.cat && x.c[0] === it.cat) s *= 1.2; sc.push([x.c, s]); } });
    sc.sort((a, b) => b[1] - a[1]);
    const vote = new Map();
    sc.slice(0, 9).forEach(([c, s], i) => vote.set(c, (vote.get(c) || 0) + s / (1 + i * 0.15)));
    ix.names.forEach(n => { let s = 0; K.forEach(k => { if (n.k.has(k)) s += S.idf(k); }); if (s) vote.set(n.c, (vote.get(n.c) || 0) + s * 0.6); });
    let best = '', bv = 0; vote.forEach((v, c) => { if (v > bv) { bv = v; best = c; } });
    return best;
  }
  function compStats() {
    const c = new Map(); let none = 0, noneA = 0;
    const ids = new Set(DB.matrix.map(compId));
    DB.items.forEach(x => {
      const id = x.comp && ids.has(x.comp) ? x.comp : null;
      if (!id) { none++; if (x.a) noneA++; return; }
      const o = c.get(id) || { all: 0, ans: 0 }; o.all++; if (x.a) o.ans++; c.set(id, o);
    });
    return { c, none, noneA };
  }
  function light(n) { return n <= DB.thr.r ? 'red' : n <= DB.thr.y ? 'yellow' : 'green'; }
  const LIGHT_NAME = { red: 'мало вопросов', yellow: 'средне', green: 'достаточно' };
  function renderMatrix() {
    const box = $('#matrixView'); if (!box) return;
    const { c, none, noneA } = compStats();
    const L = { red: 0, yellow: 0, green: 0 };
    const groups = ['Ф', 'Т', 'О'].map(g => {
      const ms = DB.matrix.filter(m => m.g === g); if (!ms.length) return '';
      let tot = 0;
      const tiles = ms.map(m => {
        const id = compId(m), o = c.get(id) || { all: 0, ans: 0 }, l = light(o.ans); L[l]++; tot += o.all;
        return `<button class="mx-tile l-${l}" data-comp="${esc(id)}" title="${esc(m.n)} — ${LIGHT_NAME[l]}. Нажмите, чтобы показать вопросы">
          <span class="mx-top"><span class="mx-code">${esc(m.c)}</span><span class="mx-light"></span></span>
          <span class="mx-name">${esc(m.n)}</span>
          <span class="mx-cnt"><b>${o.ans}</b> с ответом${o.all !== o.ans ? ` · всего ${o.all}` : ''}</span></button>`;
      }).join('');
      return `<section class="mx-group"><div class="mx-gh">${GROUP[g]}<small>${tot} вопр.</small></div><div class="mx-grid">${tiles}</div></section>`;
    }).join('');
    box.innerHTML = `<div class="mx-bar">
        <div class="mx-legend"><span class="lg l-red"></span>до ${DB.thr.r}<span class="lg l-yellow"></span>${DB.thr.r + 1}–${DB.thr.y}<span class="lg l-green"></span>${DB.thr.y + 1} и более
          <span class="mx-sum">Компетенций: красных ${L.red}, жёлтых ${L.yellow}, зелёных ${L.green}</span></div>
        <div class="mx-btns"><button class="btn" id="mxThr">Пороги светофора</button><button class="btn" id="mxEdit">Изменить матрицу</button><button class="btn blue" id="mxUpd">Обновить матрицу из файла</button></div>
      </div>
      ${groups || '<div class="empty">Матрица компетенций пуста. Нажмите «Обновить матрицу из файла» или «Изменить матрицу».</div>'}
      ${none ? `<section class="mx-group"><div class="mx-gh">Не распределены<small>${none} вопр.</small></div><div class="mx-grid">
        <button class="mx-tile l-none" data-comp="-"><span class="mx-top"><span class="mx-code">—</span></span><span class="mx-name">Без компетенции</span><span class="mx-cnt"><b>${noneA}</b> с ответом · всего ${none}</span></button>
        <button class="mx-tile l-none act" id="mxAuto"><span class="mx-top"><span class="mx-code">авто</span></span><span class="mx-name">Распределить по компетенциям автоматически</span><span class="mx-cnt">по похожим вопросам</span></button></div></section>` : ''}
      <p class="note">Светофор считается по вопросам с правильным ответом. Нажмите на компетенцию, чтобы открыть её вопросы в поиске.</p>`;
  }
  $('#matrixView').addEventListener('click', e => {
    if (e.target.closest('#mxAuto')) return autoDistribute();
    const t = e.target.closest('.mx-tile[data-comp]'); if (t) return setComp(t.dataset.comp);
    if (e.target.closest('#mxEdit')) return matrixEditor(DB.matrix.map(m => ({ ...m, orig: compId(m) })));
    if (e.target.closest('#mxUpd')) return $('#fileMatrix').click();
    if (e.target.closest('#mxThr')) {
      modal('Пороги светофора', `<div class="grid2"><div class="field"><label>Красный — не больше</label><input id="thR" type="number" min="0" value="${DB.thr.r}"></div>
        <div class="field"><label>Жёлтый — не больше</label><input id="thY" type="number" min="1" value="${DB.thr.y}"></div></div>
        <p class="note">Больше жёлтого порога — зелёный. Считаются вопросы с правильным ответом.</p>`,
        [{ text: 'Отмена', onClick: closeModal }, { text: 'Сохранить', cls: 'primary', onClick: () => {
          const r = Math.max(0, parseInt($('#thR').value) || 0), y = Math.max(r + 1, parseInt($('#thY').value) || r + 1);
          DB.thr = { r, y }; persist(); renderMatrix(); closeModal();
        } }]);
    }
  });
  function setComp(id) {
    st.comp = id || ''; renderCompSel(); setTab('search');
    q.value = ''; cur.fuzzy = null; runSearch(false);
  }
  function autoDistribute(all) {
    const ids = new Set(DB.matrix.map(compId));
    const list = DB.items.filter(x => all ? x.compAuto || !x.comp || !ids.has(x.comp) : !x.comp || !ids.has(x.comp));
    if (!list.length) return toast('Все вопросы уже распределены');
    compIx = null; let n = 0;
    list.forEach(x => { const c = autoComp(x); if (c) { x.comp = c; x.compAuto = 1; n++; } });
    afterChange(); renderMatrix();
    toast(`Распределено вопросов: ${n}. Отмечены «*» — при необходимости поправьте в карточке вопроса.`, 4500);
  }
  function matrixEditor(rows, note) {
    const row = m => `<div class="mx-row${m.mark ? ' mk-' + m.mark : ''}" data-orig="${esc(m.orig || '')}"${m.was ? ` title="Было: ${esc(m.was)}"` : ''}><select>${['Ф', 'Т', 'О'].map(g => `<option value="${g}"${m.g === g ? ' selected' : ''}>${GROUP[g]}</option>`).join('')}</select>
      <input class="mx-c" value="${esc(m.c)}" placeholder="1.1"><input class="mx-n" value="${esc(m.n)}" placeholder="Название компетенции"><button class="icon-btn ghost" data-del title="Удалить строку"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></button></div>`;
    const body = modal('Матрица компетенций', `${note ? `<p class="note" style="margin-top:0">${note}</p>` : ''}<div class="mx-rows">${rows.map(row).join('')}</div>
      <button class="btn" id="mxAdd" style="margin-top:8px">Добавить строку</button>
      <p class="note">Код — номер компетенции в матрице (например, 2.3). Если код изменить, вопросы переедут вместе с ним. Вопросы удалённых компетенций станут «без компетенции».</p>`,
      [{ text: 'Отмена', onClick: closeModal }, { text: 'Сохранить матрицу', cls: 'primary', onClick: () => {
        const rs = $$('#modalBody .mx-row').map(d => ({ g: d.querySelector('select').value, c: d.querySelector('.mx-c').value.trim().replace(/,/g, '.'), n: d.querySelector('.mx-n').value.trim(), orig: d.dataset.orig })).filter(x => x.c || x.n);
        const seen = new Set();
        for (const r of rs) { if (!r.c || !r.n) return toast('У каждой строки должны быть код и название'); if (seen.has(r.g + r.c)) return toast('Код повторяется: ' + GROUP[r.g] + ' ' + r.c); seen.add(r.g + r.c); }
        const move = new Map(); rs.forEach(r => { if (r.orig && r.orig !== r.g + r.c) move.set(r.orig, r.g + r.c); });
        DB.items.forEach(x => { if (x.comp && move.has(x.comp)) x.comp = move.get(x.comp); });
        DB.matrix = rs.map(({ g, c, n }) => ({ g, c, n })).sort((a, b) => 'ФТО'.indexOf(a.g) - 'ФТО'.indexOf(b.g) || a.c.localeCompare(b.c, 'ru', { numeric: true }));
        DB.matrixEdited = true; compIx = null;
        afterChange(); closeModal(); renderMatrix();
        const ids = new Set(DB.matrix.map(compId)), un = DB.items.filter(x => !x.comp || !ids.has(x.comp)).length;
        if (un) modal('Матрица сохранена', `<p class="report">Вопросов без компетенции: <b>${un}</b>. Распределить их по компетенциям автоматически (по похожим вопросам)?</p>`,
          [{ text: 'Позже', onClick: closeModal }, { text: 'Распределить', cls: 'primary', onClick: () => { closeModal(); autoDistribute(); } }]);
        else toast('Матрица сохранена');
      } }]);
    body.addEventListener('click', e => {
      if (e.target.closest('[data-del]')) e.target.closest('.mx-row').remove();
      if (e.target.closest('#mxAdd')) { body.querySelector('.mx-rows').insertAdjacentHTML('beforeend', row({ g: 'Ф', c: '', n: '' })); body.querySelector('.mx-rows').lastElementChild.querySelector('.mx-c').focus(); }
    });
  }
  // Разбор матрицы из текста: «1.1 Название», группа — по заголовкам «Функциональные» / «Технические» / «Общие»
  function parseMatrix(units) {
    const vocab = new Set(); DB.items.forEach(x => S.words(x.q).forEach(w => vocab.add(w)));
    const out = []; let g = 'Ф';
    const glue = t => t.replace(/([а-яё]+)[ \t]*\n\s*([а-яё]+)/gi, (m, a, b) => vocab.has((a + b).toLowerCase()) && !vocab.has(a.toLowerCase()) ? a + b : a + ' ' + b).replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
    units.forEach(u0 => {
      const u = glue(u0 || '').replace(/^(\d)[,\s]?(\d)(?=\s+[А-ЯЁA-Z])/, '$1.$2'); if (!u) return;
      const hdr = u.length < 60 && !/\d+\.\d+/.test(u);
      if (hdr && /функц/i.test(u)) { g = 'Ф'; return; }
      if (hdr && /техн/i.test(u)) { g = 'Т'; return; }
      if (hdr && /^общ|охран|промышленн.*безопасн/i.test(u)) { g = 'О'; return; }
      const re = /(?:^|\s)(ФУНКЦ|ФУНК|ТЕХ)?\.?\s*(\d{1,2}\.\d{1,2})\.?(?=\s|$)/gi; let m; const marks = [];
      while ((m = re.exec(u))) marks.push({ i: m.index, end: re.lastIndex, c: m[2], p: m[1] });
      marks.forEach((mk, k) => {
        const name = u.slice(mk.end, k + 1 < marks.length ? marks[k + 1].i : u.length).replace(/^[\s.:–—-]+|[\s,;–—-]+$/g, '');
        const gg = mk.p ? (/^тех/i.test(mk.p) ? 'Т' : 'Ф') : g;
        if (name.length >= 2) out.push({ g: gg, c: mk.c, n: name });
        else if (k + 1 === marks.length) out.push({ g: gg, c: mk.c, n: '', pend: true });
      });
      if (!marks.length && out.length && out[out.length - 1].pend) { out[out.length - 1].n = u; delete out[out.length - 1].pend; }
    });
    const uniq = new Map(); out.filter(x => x.n).forEach(x => { if (!uniq.has(x.g + x.c)) uniq.set(x.g + x.c, x); });
    return [...uniq.values()];
  }
  async function matrixUnits(file) {
    const e = (file.name.split('.').pop() || '').toLowerCase(), units = [];
    const ocrImg = async blob => { const url = URL.createObjectURL(blob); try { const r = await OCR.recognizeBlocks(url); units.push(...r); } finally { URL.revokeObjectURL(url); } };
    if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      wb.SheetNames.forEach(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false }).forEach(r => r.forEach(c => { if (c !== null && c !== undefined && String(c).trim()) units.push(String(c)); })));
    } else if (e === 'docx') {
      const z = await JSZip.loadAsync(await file.arrayBuffer());
      const xml = await z.file('word/document.xml').async('string');
      const d = new DOMParser().parseFromString(xml, 'application/xml');
      const txt = el => [...el.getElementsByTagName('w:p')].map(p => [...p.getElementsByTagName('w:t')].map(t => t.textContent).join('')).filter(Boolean).join('\n');
      const body = d.getElementsByTagName('w:body')[0];
      [...(body ? body.children : [])].forEach(ch => {
        if (ch.tagName === 'w:tbl') [...ch.getElementsByTagName('w:tc')].forEach(tc => units.push(txt(tc)));
        else if (ch.tagName === 'w:p') { const t = txt(ch); if (t) units.push(t); }
      });
      const imgs = Object.keys(z.files).filter(n => /^word\/media\/.+\.(png|jpe?g|bmp|gif)$/i.test(n));
      for (const n of imgs) await ocrImg(await z.file(n).async('blob'));
    } else if (/^(png|jpe?g|bmp|gif|webp)$/.test(e)) await ocrImg(file);
    else units.push(...(await file.text()).split(/\r?\n/));
    return units;
  }
  $('#fileMatrix').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    modal('Обновление матрицы', '<p>Чтение файла… Если матрица в виде картинки — распознавание займёт до минуты.</p><div class="progress"><i style="width:60%"></i></div>');
    let found = [];
    try { found = parseMatrix(await matrixUnits(f)); } catch (err) { return modal('Обновление матрицы', `<p>Не удалось прочитать файл: ${esc(err.message || err)}</p>`, [{ text: 'Закрыть', onClick: closeModal }]); }
    if (!found.length) return modal('Обновление матрицы', '<p>В файле не найдены компетенции вида «1.1 Название». Откройте «Изменить матрицу» и внесите их вручную.</p>', [{ text: 'Закрыть', onClick: closeModal }]);
    const gs = [...new Set(found.map(x => x.g))];
    const keep = DB.matrix.filter(m => !gs.includes(m.g)).map(m => ({ ...m, orig: compId(m) }));
    const old = new Map(DB.matrix.map(m => [compId(m), m])), fids = new Set(found.map(m => m.g + m.c));
    const sim = (a, b) => { const A = keysOf(a), B = keysOf(b); let i = 0; A.forEach(k => { if (B.has(k)) i++; }); return i / Math.max(1, A.size + B.size - i); };
    // компетенции группы, которых нет в файле, — показать с пометкой (удалить можно вручную)
    const missing = DB.matrix.filter(m => gs.includes(m.g) && !fids.has(compId(m))).map(m => ({ ...m, orig: compId(m), mark: 'missing' }));
    const rows = [...found.map(m => { const o = old.get(m.g + m.c); if (!o) return { ...m, mark: 'new' }; return sim(o.n, m.n) >= 0.4 ? { ...m, n: o.n, orig: compId(o) } : { ...m, orig: compId(o), mark: 'changed', was: o.n }; }), ...missing, ...keep].sort((a, b) => 'ФТО'.indexOf(a.g) - 'ФТО'.indexOf(b.g) || a.c.localeCompare(b.c, 'ru', { numeric: true }));
    matrixEditor(rows, `Из файла «${esc(f.name)}» прочитано компетенций: <b>${found.length}</b> (группы: ${gs.map(g => GROUP[g]).join(', ')}). Остальные группы оставлены без изменений. Цветом отмечены: <span class="mk new">новые</span>, <span class="mk changed">изменённые</span>, <span class="mk missing">нет в файле</span> (удалите крестиком, если компетенция исключена). Проверьте названия и нажмите «Сохранить матрицу».`);
  };

  /* ================= Дубли ================= */
  function dupIndex(exclude) {
    const byKey = new Map(), byQ = new Map(), inv = new Map(), sets = [];
    DB.items.forEach(x => {
      if (x === exclude) return;
      byKey.set(S.dupKey(x.q, x.a), x);
      const k = S.qKey(x.q); if (!byQ.has(k)) byQ.set(k, []); byQ.get(k).push(x);
      const K = keysOf(x.q); const i = sets.push({ x, K }) - 1;
      K.forEach(kk => { let a = inv.get(kk); if (!a) inv.set(kk, a = []); a.push(i); });
    });
    return { byKey, byQ, inv, sets };
  }
  function nearOf(ix, K) {
    if (K.size < 4) return null;
    const cnt = new Map();
    K.forEach(k => { const a = ix.inv.get(k); if (a && a.length < 400) a.forEach(i => cnt.set(i, (cnt.get(i) || 0) + 1)); });
    let best = null, bj = 0;
    cnt.forEach((n, i) => {
      const s = ix.sets[i]; if (n < K.size * 0.6) return;
      let inter = 0; K.forEach(k => { if (s.K.has(k)) inter++; });
      const j = inter / (K.size + s.K.size - inter);
      if (j > bj) { bj = j; best = s.x; }
    });
    return bj >= 0.8 ? { x: best, j: bj } : null;
  }
  /* Найти дубли среди новых вопросов: в базе и внутри самого списка */
  function findDups(list, exclude) {
    const ix = dupIndex(exclude), out = [], seenK = new Map(), seenQ = new Map();
    list.forEach(n => {
      if (!n || !n.q) return;
      const dk = S.dupKey(n.q, n.a), qk = S.qKey(n.q);
      let d = null;
      if (ix.byKey.has(dk)) d = { kind: 'exact', ex: ix.byKey.get(dk) };
      else if (ix.byQ.has(qk)) {
        const same = ix.byQ.get(qk);
        if (!(n.a && same.every(x => !x.a))) d = { kind: n.a ? 'same' : 'noans', ex: same.find(x => x.a) || same[0] };
      } else if (seenK.has(dk) || seenQ.has(qk)) d = { kind: 'inner', ex: seenK.get(dk) || seenQ.get(qk) };
      else { const nr = nearOf(ix, keysOf(n.q)); if (nr) d = { kind: 'near', ex: nr.x, j: nr.j }; }
      if (d) out.push({ n, ...d });
      if (!seenK.has(dk)) seenK.set(dk, n); if (!seenQ.has(qk)) seenQ.set(qk, n);
    });
    return out;
  }
  const DUP_TXT = { exact: 'такой же вопрос с таким же ответом уже есть в базе', same: 'такой же вопрос уже есть, но с другим ответом', noans: 'такой вопрос уже есть, у нового нет ответа', inner: 'повторяется в загружаемых данных', near: 'в базе есть очень похожий вопрос' };
  const shortA = x => esc(oneLine(x.a || '— ответ не отмечен').slice(0, 220));
  function dupPair(d) {
    return `<div class="dup-pair"><div><div class="dup-l">Новый</div><div class="dup-q">${esc(oneLine(d.n.q))}</div><div class="dup-a">${shortA(d.n)}</div></div>
      <div><div class="dup-l">${d.kind === 'inner' ? 'Ранее в этом же списке' : 'Уже в базе'}${d.ex.code ? ' · ' + esc(d.ex.code) : ''}</div><div class="dup-q">${esc(oneLine(d.ex.q))}</div><div class="dup-a">${shortA(d.ex)}</div></div></div>`;
  }
  /* Добавить с проверкой дублей: предупреждение и выбор — сохранить дубль или удалить */
  function addChecked(list, done, opt = {}) {
    list = list.filter(x => x && x.q);
    const ds = findDups(list);
    const finish = drop => { const l = list.filter(x => !drop.has(x)); const keep = new Set(ds.map(d => d.n).filter(n => !drop.has(n))); const r = addItems(l, { ...opt, force: keep }); r.removedDups = drop.size; r.keptDups = keep.size; done(r); };
    if (!ds.length) return finish(new Set());
    if (ds.length === 1) {
      const d = ds[0];
      modal('Найден дубль', `<p class="report" style="margin-top:0">${list.length > 1 ? `Из ${list.length} вопросов один — дубль: ` : 'Внимание: '}${DUP_TXT[d.kind]}${d.j ? ` (совпадение ${Math.round(d.j * 100)}%)` : ''}.</p>${dupPair(d)}`,
        [{ text: 'Сохранить дубль', onClick: () => { closeModal(); finish(new Set()); } }, { text: 'Удалить дубль', cls: 'primary', onClick: () => { closeModal(); finish(new Set([d.n])); } }]);
      return;
    }
    const kinds = {}; ds.forEach(d => (kinds[d.kind] = (kinds[d.kind] || 0) + 1));
    const shown = ds.slice(0, 400);
    const body = modal('Найдены дубли', `<p class="report" style="margin-top:0">Из ${list.length} вопросов найдено дублей: <b>${ds.length}</b>.<br>${Object.entries(kinds).map(([k, v]) => `${DUP_TXT[k][0].toUpperCase() + DUP_TXT[k].slice(1)} — ${v}`).join('<br>')}</p>
      <p class="note">Отмеченные галочкой дубли будут удалены (не попадут в базу). Остальные вопросы добавятся в любом случае.</p>
      <label class="dup-all"><input type="checkbox" id="dupAll" checked> отметить все</label>
      <div class="dup-list">${shown.map((d, i) => `<label class="dup-item"><input type="checkbox" data-i="${i}" checked><div><span class="badge warn">${DUP_TXT[d.kind]}${d.j ? ' ' + Math.round(d.j * 100) + '%' : ''}</span>${dupPair(d)}</div></label>`).join('')}</div>
      ${ds.length > shown.length ? `<p class="note">Показаны первые ${shown.length}; остальные удаляются при «Удалить все дубли».</p>` : ''}`,
      [{ text: 'Сохранить все', onClick: () => { closeModal(); finish(new Set()); } },
       { text: 'Применить выбор', cls: 'blue', onClick: () => { const drop = new Set(); $$('#modalBody .dup-item input').forEach(c => { if (c.checked) drop.add(shown[+c.dataset.i].n); }); ds.slice(shown.length).forEach(d => drop.add(d.n)); closeModal(); finish(drop); } },
       { text: 'Удалить все дубли', cls: 'primary', onClick: () => { closeModal(); finish(new Set(ds.map(d => d.n))); } }]);
    body.querySelector('#dupAll').onchange = e => $$('#modalBody .dup-item input').forEach(c => (c.checked = e.target.checked));
  }
  function reportHTML(r) {
    return `<ul class="report"><li>Добавлено новых: <b>${r.added}</b></li>${r.removedDups ? `<li>Удалено дублей: ${r.removedDups}</li>` : ''}${r.keptDups ? `<li>Сохранено дублей: ${r.keptDups}</li>` : ''}<li>Совпали полностью (объединены): ${r.dup}</li><li>Дополнены ответы: ${r.updated}</li><li>С другим ответом (помечены): ${r.conflict}</li><li>Без отмеченного ответа: ${r.noAns}</li>${r.compAuto ? `<li>Компетенция определена автоматически: ${r.compAuto}</li>` : ''}</ul>`;
  }
  /* Проверка дублей во всей базе */
  function baseDupGroups() {
    const g = new Map();
    DB.items.forEach(x => { const k = S.qKey(x.q); if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
    const rank = x => (x.a ? 8 : 0) + (x.code ? 2 : 0) + (x.edited ? 4 : 0) + (x.comp && !x.compAuto ? 1 : 0);
    return [...g.values()].filter(a => a.length > 1).map(a => { const s = a.slice().sort((p, q2) => rank(q2) - rank(p) || p.id - q2.id); const keep = s[0]; return { keep, rest: s.slice(1).map(x => ({ x, same: S.dupKey(x.q, x.a) === S.dupKey(keep.q, keep.a) || !x.a })) }; });
  }
  function removeDups(dels) {
    const keepOf = new Map(); dels.forEach(([x, keep]) => keepOf.set(x, keep));
    dels.forEach(([x, keep]) => {
      keep.src = [...new Set([...(keep.src || []), ...(x.src || [])])].slice(0, 8);
      if (!keep.code && x.code) keep.code = x.code; if ((!keep.w || !keep.w.length) && x.w && x.w.length) keep.w = x.w;
      if (S.dupKey(x.q, x.a) !== S.dupKey(keep.q, keep.a)) forget(x);
    });
    DB.items = DB.items.filter(x => !keepOf.has(x));
    // пометка «разные ответы» больше не нужна, если у вопроса остался один вариант
    const cnt = new Map(); DB.items.forEach(x => { const k = S.qKey(x.q); cnt.set(k, (cnt.get(k) || 0) + 1); });
    DB.items.forEach(x => { if (x.conflict && cnt.get(S.qKey(x.q)) === 1) delete x.conflict; });
    afterChange();
  }
  $('#btnDups').onclick = () => {
    closeMenu();
    const gs = baseDupGroups();
    if (!gs.length) return modal('Проверка дублей', '<p class="report">Дублей в базе не найдено.</p>', [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }]);
    const same = gs.reduce((a, g) => a + g.rest.filter(r => r.same).length, 0), diff = gs.reduce((a, g) => a + g.rest.filter(r => !r.same).length, 0);
    const shown = gs.slice(0, 300);
    const body = modal('Проверка дублей в базе', `<p class="report" style="margin-top:0">Повторяющихся вопросов: <b>${gs.length}</b> групп. Полных дублей (тот же вопрос и ответ или без ответа): <b>${same}</b>. Тот же вопрос с другим ответом: <b>${diff}</b>.</p>
      <label class="dup-all"><input type="checkbox" id="dupDiff"> удалять и вопросы с другим ответом (останется вариант с ответом, отредактированный или с идентификатором)</label>
      <div class="dup-list">${shown.map((g, gi) => `<div class="dup-group"><div class="dup-keep"><span class="badge comp">остаётся</span> ${esc(oneLine(g.keep.q).slice(0, 200))}<div class="dup-a">${shortA(g.keep)}</div></div>
        ${g.rest.map((r, ri) => `<label class="dup-item"><input type="checkbox" data-g="${gi}" data-r="${ri}" class="${r.same ? 'same' : 'diff'}"${r.same ? ' checked' : ''}><div><span class="badge ${r.same ? 'warn' : 'lvl'}">${r.same ? 'дубль' : 'другой ответ'}</span> <span class="dup-a">${shortA(r.x)}</span></div></label>`).join('')}</div>`).join('')}</div>`,
      [{ text: 'Закрыть', onClick: closeModal },
       { text: 'Удалить отмеченные', cls: 'blue', onClick: () => { const d = []; $$('#modalBody .dup-item input').forEach(c => { if (c.checked) { const g = shown[+c.dataset.g]; d.push([g.rest[+c.dataset.r].x, g.keep]); } }); closeModal(); removeDups(d); toast('Удалено дублей: ' + d.length); } },
       { text: 'Удалить все дубли', cls: 'primary', onClick: () => { const all = $('#dupDiff').checked; const d = []; gs.forEach(g => g.rest.forEach(r => { if (r.same || all) d.push([r.x, g.keep]); })); closeModal(); removeDups(d); toast('Удалено дублей: ' + d.length); } }]);
    body.querySelector('#dupDiff').onchange = e => $$('#modalBody .dup-item input.diff').forEach(c => (c.checked = e.target.checked));
  };

  /* ================= Вкладки ================= */
  function setTab(t) {
    st.tab = t;
    $('#suggest').hidden = true;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.body.dataset.tab = t;
    if (t === 'matrix') renderMatrix();
    if (t === 'lib') renderLib();
    if (t === 'search') rerun();
  }
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };

  /* ================= Внешний запрос ================= */
  const extCache = new Map(); let extT, extSeq = 0, extN = 0;
  function setExt(on) { st.ext = on; Store.setPref('ext', on); $('#btnExt').classList.toggle('on', on); $('#btnExt').setAttribute('aria-pressed', on); }
  $('#btnExt').onclick = () => { setExt(!st.ext); toast(st.ext ? 'Внешний запрос включён: поиск также в дополнительных базах и библиотеке документов' : 'Внешний запрос выключен — поиск только в основной базе'); rerun(); };
  function topWords(t) { return [...new Set(S.words(t).filter(w => w.length > 3 && !S.STOP.has(w)))].sort((a, b) => S.idf(S.key5(b)) - S.idf(S.key5(a))).slice(0, 5).join(' ') + ' '; }
  const webLink = t => navigator.onLine ? `<a class="link-btn" href="https://yandex.ru/search/?text=${encodeURIComponent(oneLine(t).slice(0, 200))}" target="_blank" rel="noopener">Искать в интернете</a>` : '';
  function runExternal() {
    clearTimeout(extT);
    const box = $('#extBox'); if (!box) return;
    const raw = cur.fuzzy || q.value;
    if (!st.ext || !raw.trim()) { box.innerHTML = ''; return; }
    const seq = ++extSeq;
    extT = setTimeout(async () => {
      try {
        await Lib.init();
        if (seq !== extSeq) return;
        if (!Lib.has()) { box.innerHTML = `<div class="ext-sec"><div class="ext-h">Внешний запрос</div><p class="note">Дополнительные базы и документы ещё не подключены. <a href="#" data-goext>Открыть вкладку «Библиотека»</a>, чтобы добавить стандарты, книги, инструкции или сетевую папку. ${webLink(raw)}</p></div>`; return; }
        const fz = !!cur.fuzzy;
        const [b, d] = await Promise.all([Lib.searchBases(raw, fz), Lib.searchDocs(fz ? topWords(raw) : raw, 15)]);
        if (seq !== extSeq) return;
        extCache.clear();
        let h = '';
        if (b.list.length) h += `<div class="ext-sec"><div class="ext-h">Дополнительные базы · ${b.list.length}</div>${b.list.slice(0, 20).map(x => extCard(x, b.tokens)).join('')}</div>`;
        if (d.list.length) h += `<div class="ext-sec"><div class="ext-h">Библиотека документов · ${d.total}${d.total > d.list.length ? ' (показаны первые ' + d.list.length + ')' : ''}</div>${d.list.map(r => `<div class="docres"><div class="doc-h"><svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg><span class="doc-n">${esc(r.d.name)}</span>${r.d.pages > 1 ? `<span class="doc-p">стр. ${r.p}</span>` : ''}<button class="link-btn" data-open="${esc(r.d.id)}" data-page="${r.p}">Открыть</button></div><div class="doc-s">${S.highlight(r.snip, d.tokens)}</div></div>`).join('')}</div>`;
        if (!h) h = `<div class="ext-sec"><div class="ext-h">Внешний запрос</div><p class="note">В дополнительных базах и документах ничего не найдено. ${webLink(raw)}</p></div>`;
        box.innerHTML = h;
      } catch (e) { box.innerHTML = `<div class="ext-sec"><p class="note">Ошибка внешнего поиска: ${esc(e.message || e)}</p></div>`; }
    }, 220);
  }
  function extCard(x, tk) {
    const k = 'x' + (++extN); extCache.set(k, x);
    const ans = answers(x);
    return `<article class="qcard ext" data-x="${k}"><div class="qhead"><svg class="qico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01"/></svg><div class="qtext">${S.highlight(x.q, tk)}</div></div>
      <div class="qmeta"><span class="badge kb">${esc(x.kbName || 'доп. база')}</span>${x.code ? `<span class="badge code">${esc(x.code)}</span>` : ''}</div><hr class="sep">
      ${ans.length ? ans.map(a => `<div class="opt right"><span class="dot"></span><span class="atext">${S.highlight(a, tk)}</span></div>`).join('') : '<div class="opt none"><span class="dot">?</span><span class="atext">ответ не отмечен</span></div>'}
      <div class="qactions"><button class="link-btn" data-act="copy">Копировать ответ</button><button class="link-btn" data-act="take">В основную базу</button></div></article>`;
  }

  /* ================= Библиотека ================= */
  const fmtDate = t => t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  async function renderLib() {
    await Lib.init();
    const M = Lib.meta, box = $('#libView');
    const fName = id => (M.folders.find(f => f.id === id) || {}).name || '';
    box.innerHTML = `<div class="lib-bar">
        <button class="btn blue" id="libDocs">Добавить документы…</button>
        <button class="btn" id="libDir">Подключить папку…</button>
        ${M.folders.length ? '<button class="btn" id="libRescan">Перечитать папки</button>' : ''}
        <button class="btn" id="libKb">Добавить базу вопросов…</button></div>
      <p class="note">Здесь подключаются внешние источники для кнопки «Внешний запрос» (значок книги в строке поиска): стандарты, книги, инструкции (PDF, Word .docx, PowerPoint .pptx, Excel, TXT, HTML) и дополнительные базы вопросов (Excel, Word, base.js, резервные копии .json).
      Подключённую папку (в том числе сетевую) можно перечитать — новые и изменённые файлы обновятся. Всё работает без интернета. Сканированные PDF без текстового слоя и старый формат .doc не читаются.</p>
      <div id="libProg" class="note" hidden></div>
      ${M.folders.length ? `<h3 class="lib-h">Папки</h3><div class="lib-list">${M.folders.map(f => `<div class="lib-row"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z"/></svg><span class="lr-n">${esc(f.name)}</span><span class="lr-m">обновлена ${fmtDate(f.scanned)} · документов ${M.docs.filter(d => d.folder === f.id).length}, баз ${M.bases.filter(b => b.folder === f.id).length}</span><button class="link-btn" data-rmf="${f.id}">Отключить</button></div>`).join('')}</div>` : ''}
      <h3 class="lib-h">Дополнительные базы вопросов · ${M.bases.length}</h3>
      <div class="lib-list">${M.bases.map(b => `<div class="lib-row"><label class="switch sm"><input type="checkbox" data-kb="${b.id}"${b.on ? ' checked' : ''}><span></span></label><span class="lr-n">${esc(b.name)}</span><span class="lr-m">${b.count} вопр.${b.folder ? ' · папка ' + esc(fName(b.folder)) : ''}</span><button class="link-btn" data-take="${b.id}">Перенести в основную базу</button><button class="link-btn" data-rmb="${b.id}">Удалить</button></div>`).join('') || '<p class="note">Нет. Дополнительные базы ищутся отдельно от основной и не смешиваются с ней.</p>'}</div>
      <h3 class="lib-h">Документы · ${M.docs.length}</h3>
      <div class="lib-list">${M.docs.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(d => `<div class="lib-row"><svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg><span class="lr-n" title="${esc(d.path)}">${esc(d.name)}</span><span class="lr-m">${d.noText ? '<span style="color:var(--warn)">нет текста (скан?)</span>' : (d.pages > 1 ? d.pages + ' стр. · ' : '') + (d.chars < 1000 ? d.chars + ' зн.' : Math.round(d.chars / 1000) + ' тыс. зн.')}${d.folder ? ' · папка ' + esc(fName(d.folder)) : ''}</span><button class="link-btn" data-open="${d.id}">Открыть</button>${d.folder ? '' : `<button class="link-btn" data-rmd="${d.id}">Удалить</button>`}</div>`).join('') || '<p class="note">Нет документов.</p>'}</div>`;
  }
  const libProg = t => { const p = $('#libProg'); if (p) { p.hidden = !t; p.textContent = t || ''; } };
  function libReport(r, title) {
    renderLib();
    modal(title || 'Библиотека', `<ul class="report"><li>Документов прочитано: <b>${r.docs}</b></li><li>Баз вопросов: <b>${r.bases}</b>${r.q ? ` (вопросов ${r.q})` : ''}</li>${r.same ? `<li>Без изменений: ${r.same}</li>` : ''}${r.removed ? `<li>Удалено (нет в папке): ${r.removed}</li>` : ''}</ul>
      ${r.noText.length ? `<p class="note">Без текстового слоя (сканы, поиск по ним невозможен): ${r.noText.slice(0, 10).map(esc).join(', ')}${r.noText.length > 10 ? '…' : ''}</p>` : ''}
      ${r.err.length ? `<p class="note">Ошибки: ${r.err.slice(0, 8).map(esc).join('<br>')}</p>` : ''}`, [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }]);
  }
  $('#libView').addEventListener('click', async e => {
    const t = e.target.closest('button,[data-kb]'); if (!t) return;
    try {
      if (t.id === 'libDocs') $('#fileDocs').click();
      else if (t.id === 'libKb') $('#fileKb').click();
      else if (t.id === 'libDir') {
        if (!Lib.canPickFolder()) return $('#fileDir').click();
        try { libProg('Чтение папки…'); const r = await Lib.connectFolder(p => libProg('Чтение: ' + p)); libProg(''); libReport(r, 'Папка подключена'); }
        catch (er) { libProg(''); if (er.name === 'AbortError') return; if (er.message === 'nopicker' || er.name === 'SecurityError' || er.name === 'TypeError') $('#fileDir').click(); else toast('Не удалось подключить папку: ' + (er.message || er), 5000); }
      } else if (t.id === 'libRescan') { libProg('Перечитывание папок…'); const r = await Lib.rescan(p => libProg('Чтение: ' + p)); libProg(''); libReport(r, 'Папки обновлены'); }
      else if (t.dataset.rmf) { if (confirm('Отключить папку? Её документы и базы будут убраны из библиотеки (сами файлы не удаляются).')) { await Lib.removeFolder(t.dataset.rmf); renderLib(); } }
      else if (t.dataset.rmb) { if (confirm('Удалить дополнительную базу из программы?')) { await Lib.removeBase(t.dataset.rmb); renderLib(); } }
      else if (t.dataset.rmd) { await Lib.removeDoc(t.dataset.rmd); renderLib(); }
      else if (t.dataset.open) { if (!(await Lib.openDoc(t.dataset.open))) toast('Файл недоступен — перечитайте папку', 4000); }
      else if (t.dataset.take) {
        const its = await Lib.baseItems(t.dataset.take), b = Lib.meta.bases.find(x => x.id === t.dataset.take);
        addChecked(its.map(({ id, kb, kbName, ...n }) => ({ ...n, cat: n.cat || 'О', src: ['Доп. база: ' + b.name] })), r => modal('Перенос в основную базу', reportHTML(r), [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }]));
      }
    } catch (er) { libProg(''); toast('Ошибка: ' + (er.message || er), 5000); }
  });
  $('#libView').addEventListener('change', async e => { const c = e.target.closest('[data-kb]'); if (c) { await Lib.toggleBase(c.dataset.kb, c.checked); } });
  $('#fileDocs').onchange = async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    await Lib.init();
    const r = { docs: 0, bases: 0, q: 0, same: 0, removed: 0, noText: [], err: [] };
    for (let i = 0; i < files.length; i++) {
      libProg(`Чтение ${i + 1} из ${files.length}: ${files[i].name}`);
      try { const x = await Lib.addDoc(files[i], { onPage: (p, n) => libProg(`Чтение ${files[i].name}: стр. ${p} из ${n}`) }); if (x.skipped) r.same++; else { r.docs++; if (x.doc.noText) r.noText.push(files[i].name); } }
      catch (er) { r.err.push(files[i].name + ': ' + (er.message || er)); }
    }
    await Lib.saveMeta(); libProg(''); libReport(r, 'Документы добавлены');
  };
  $('#fileKb').onchange = async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    await Lib.init();
    const r = { docs: 0, bases: 0, q: 0, same: 0, removed: 0, noText: [], err: [] };
    for (const f of files) {
      libProg('Чтение: ' + f.name);
      try { const its = await Lib.parseBaseFile(f); if (!its.length) { r.err.push(f.name + ': вопросы не найдены'); continue; } await Lib.addBase(f.name.replace(/\.[^.]+$/, ''), its); r.bases++; r.q += its.length; }
      catch (er) { r.err.push(f.name + ': ' + (er.message || er)); }
    }
    await Lib.saveMeta(); libProg(''); libReport(r, 'Дополнительные базы');
  };
  $('#fileDir').onchange = async e => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    await Lib.init(); libProg('Чтение папки…');
    const r = await Lib.addFolderFiles(files, p => libProg('Чтение: ' + p)); libProg(''); libReport(r, 'Файлы из папки загружены');
  };

  /* ================= Голосовой ввод ================= */
  function micFor(input, after) {
    if (Voice.busy()) { Voice.stop(); return; }
    const before = input.value && !/\s$/.test(input.value) && input !== q ? input.value + ' ' : (input === q ? '' : input.value);
    $$('.mic').forEach(b => b.classList.remove('rec'));
    const btn = document.querySelector(`.mic[data-for="${input.id}"]`); if (btn) btn.classList.add('rec');
    const ok = Voice.start({
      onText: (t) => { input.value = before + t; if (after) after(); },
      onEnd: () => { $$('.mic').forEach(b => b.classList.remove('rec')); if (input === q) runSearch(!isMobile); },
      onError: c => { if (c !== 'aborted') toast(Voice.message(c), 5000); }
    });
    if (!ok && btn) btn.classList.remove('rec');
    if (ok && input === q) toast('Говорите… Вопрос или ключевые слова', 2000);
  }
  $('#btnMic').onclick = () => micFor(q, () => { cur.fuzzy = null; clearTimeout(inT); inT = setTimeout(() => runSearch(false), 80); });
  if (!Voice.supported) $('#btnMic').classList.add('nosr');
  document.addEventListener('click', e => { const b = e.target.closest('.mic[data-for]'); if (b && b.id !== 'btnMic') { e.preventDefault(); micFor(document.getElementById(b.dataset.for)); } });


  /* ---------- Пополнить базу ---------- */
  const ICON = {
    file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    scr: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M5 19h4l10-10-4-4L5 15z"/></svg>'
  };
  function addMenu() {
    const scr = !document.body.classList.contains('mobile');
    const body = modal('Пополнить базу', `<div class="tiles">
      <button class="tile" data-t="file">${ICON.file}Из файла<small>Excel (.xlsx, .xls, .csv) или Word (.docx), можно несколько файлов</small></button>
      ${scr ? `<button class="tile" data-t="scr">${ICON.scr}С экрана<small>Снимок экрана, выделите вопрос — программа распознает текст</small></button>` : ''}
      <button class="tile" data-t="cam">${ICON.cam}${isMobile ? 'Камерой' : 'Из снимка'}<small>${isMobile ? 'Сфотографируйте вопрос на мониторе' : 'Картинка или скриншот с вопросом'}</small></button>
      ${isMobile ? `<button class="tile" data-t="gal">${ICON.file}Из галереи<small>Скриншот или фото, сохранённое на телефоне</small></button>` : ''}
      <button class="tile" data-t="hand">${ICON.hand}Вручную<small>Ввести вопрос и ответ с клавиатуры</small></button>
    </div>
    <p class="note">Перед добавлением программа проверяет дубли: при повторе предупредит и предложит сохранить дубль или удалить (при нескольких дублях — удалить все сразу).</p>`);
    body.querySelector('.tiles').onclick = e => {
      const t = e.target.closest('.tile'); if (!t) return;
      if (t.dataset.t === 'file') fileImportDialog();
      if (t.dataset.t === 'hand') newItem();
      if (t.dataset.t === 'cam') pickImage(isMobile ? '#fileCam' : '#fileImg', 'add');
      if (t.dataset.t === 'scr') screenFlow('add');
      if (t.dataset.t === 'gal') pickImage('#fileImg', 'add');
    };
  }
  $('#btnAdd').onclick = () => { closeMenu(); addMenu(); };
  $('#btnNew').onclick = () => { closeMenu(); newItem(); };

  function fileImportDialog() {
    modal('Пополнить базу из файла', `
      <div class="field"><label>Категория для вопросов, у которых в файле нет признака (ТЕХ / ФУНКЦ)</label>
        <select id="impCat"><option value="Ф">Функциональные</option><option value="Т">Технические</option><option value="О" selected>Общие</option></select></div>
      <p class="note">Программа сама находит столбцы «Вопрос», «Правильный ответ», «Неправильный ответ», идентификатор (например, ТЕХ 3.1) в названии листа или в столбце, все вкладки файла.
      Если заголовков нет — столбец A считается вопросом, B — ответом. В Word правильный ответ определяется по знаку «+», выделению цветом или жирным шрифтом.
      Старый формат .doc нужно предварительно пересохранить в .docx.</p>`,
      [{ text: 'Отмена', onClick: closeModal }, { text: 'Выбрать файлы…', cls: 'primary', onClick: () => $('#fileImport').click() }]);
  }
  $('#fileImport').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const defCat = ($('#impCat') && $('#impCat').value) || 'О';
    modal('Чтение файлов', '<p>Обработка…</p><div class="progress"><i id="pg"></i></div>');
    const all = [], errs = [];
    for (let i = 0; i < files.length; i++) {
      try { const r = await Importers.importFile(files[i], defCat); all.push(...r); if (!r.length) errs.push(files[i].name + ': вопросы не найдены'); }
      catch (err) { errs.push(files[i].name + ': ' + (err.message || err)); }
      const pg = $('#pg'); if (pg) pg.style.width = ((i + 1) / files.length * 100) + '%';
    }
    if (!all.length) { modal('Пополнение базы', `<p>Не удалось найти вопросы.</p><ul class="report">${errs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`, [{ text: 'Закрыть', onClick: closeModal }]); return; }
    const withA = all.filter(x => x.a).length;
    const preview = all.slice(0, 5).map(x => `<li><b>${esc(oneLine(x.q).slice(0, 140))}</b><br><span style="color:var(--green-d)">${esc(oneLine(x.a || '— ответ не отмечен'))}</span>${x.code ? ' · ' + esc(x.code) : ''}</li>`).join('');
    modal('Пополнение базы', `<p class="report">Найдено вопросов: <b>${all.length}</b>, из них с правильным ответом: ${withA}.</p>
      <ul class="report">${preview}</ul>${errs.length ? `<p class="note">${errs.map(esc).join('<br>')}</p>` : ''}
      <p class="note">Перед добавлением программа проверит дубли и предложит удалить их или сохранить.</p>`,
      [{ text: 'Отмена', onClick: closeModal }, { text: 'Добавить в базу', cls: 'primary', onClick: () => {
        closeModal();
        addChecked(all, r => modal('Готово', reportHTML(r), [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }]));
      } }]);
  };

  /* ---------- Распознавание (камера / снимок / экран) ---------- */
  let imgMode = 'search';
  function pickImage(sel, mode) { imgMode = mode; $(sel).click(); }
  ['#fileCam', '#fileImg'].forEach(sel => $(sel).onchange = e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    // фото с камеры (снимок монитора) — включить улучшение неконтрастного изображения
    const photo = sel === '#fileCam' || (isMobile && /jpe?g|heic|heif/i.test(f.type || f.name));
    const rd = new FileReader(); rd.onload = () => cropDialog(rd.result, imgMode, photo); rd.readAsDataURL(f);
  });
  $('#btnCam').onclick = () => {
    if (isMobile) return pickImage('#fileCam', 'search');
    modal('Распознать вопрос', `<div class="tiles">
      <button class="tile" data-t="scr">${ICON.scr}С экрана<small>Снимок экрана и выделение вопроса</small></button>
      <button class="tile" data-t="img">${ICON.file}Из картинки<small>Файл скриншота или фото</small></button>
      <button class="tile" data-t="cam">${ICON.cam}Камерой<small>Веб-камера / камера телефона</small></button></div>`);
    $('#modalBody .tiles').onclick = e => {
      const t = e.target.closest('.tile'); if (!t) return;
      if (t.dataset.t === 'scr') screenFlow('search');
      if (t.dataset.t === 'img') pickImage('#fileImg', 'search');
      if (t.dataset.t === 'cam') pickImage('#fileCam', 'search');
    };
  };
  $('#btnScreen').onclick = () => screenFlow('search');
  async function screenFlow(mode) {
    closeModal();
    try { const url = await OCR.captureScreen(); cropDialog(url, mode); }
    catch (e) { if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('Не удалось сделать снимок экрана: ' + (e.message || e)); }
  }

  function cropDialog(url, mode, photo) {
    const body = modal(mode === 'add' ? 'Выделите вопрос и варианты ответа' : 'Выделите область с вопросом',
      `<div class="cropwrap" id="cw"><img id="cimg" src="${url}" alt="Снимок"><div class="cropbox" id="cbox" hidden></div></div>
       <p class="note">Проведите пальцем или мышью, чтобы выделить нужную часть. Без выделения распознаётся весь снимок.</p>
       <div class="progress" id="opg" hidden><i></i></div><div class="note" id="ost"></div>`,
      [{ text: 'Отмена', onClick: closeModal }, { text: 'Распознать', cls: 'primary', onClick: btn => go(btn) }]);
    const img = body.querySelector('#cimg'), box = body.querySelector('#cbox'), cw = body.querySelector('#cw');
    let sel = null, start = null;
    const pt = e => { const r = img.getBoundingClientRect(); return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) }; };
    cw.addEventListener('pointerdown', e => { start = pt(e); cw.setPointerCapture(e.pointerId); e.preventDefault(); });
    cw.addEventListener('pointermove', e => {
      if (!start) return; const p = pt(e);
      sel = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      Object.assign(box.style, { left: sel.x + img.offsetLeft + 'px', top: sel.y + img.offsetTop + 'px', width: sel.w + 'px', height: sel.h + 'px' }); box.hidden = false;
    });
    cw.addEventListener('pointerup', () => { start = null; if (sel && (sel.w < 12 || sel.h < 12)) { sel = null; box.hidden = true; } });
    async function go(btn) {
      btn.disabled = true;
      const k = img.naturalWidth / img.clientWidth;
      const crop = sel ? { x: Math.round(sel.x * k), y: Math.round(sel.y * k), w: Math.round(sel.w * k), h: Math.round(sel.h * k) } : null;
      const pg = $('#opg'), ost = $('#ost'); pg.hidden = false;
      try {
        const r = await OCR.recognize(img, crop, (s, p) => {
          pg.firstElementChild.style.width = Math.round(p * 100) + '%';
          ost.textContent = /recogn/.test(s) ? 'Распознавание текста…' : s === 'enhance' ? 'Улучшение контраста снимка…' : 'Подготовка модуля распознавания (первый раз дольше)…';
        }, { photo: !!photo });
        if (!r.text.trim()) { ost.textContent = 'Текст не найден. Попробуйте выделить область крупнее или сделать снимок ровнее.'; btn.disabled = false; return; }
        if (mode === 'add') ocrAddDialog(r); else { closeModal(); showFuzzy(r.text); }
      } catch (e) { ost.textContent = 'Ошибка распознавания: ' + (e.message || e); btn.disabled = false; }
    }
  }
  function showFuzzy(text) {
    cur.fuzzy = text; cur.focusId = null; st.compactIdx = 0;
    const r = S.fuzzy(text, { cat: st.cat, comp: st.comp });
    cur.list = r.list; cur.tokens = r.tokens;
    q.value = oneLine(text).slice(0, 200);
    $('#suggest').hidden = true;
    renderResults();
    if (!r.list.length) $('#status').textContent = 'По распознанному тексту похожих вопросов не найдено. Отредактируйте текст в строке поиска.';
  }

  const ROLES = { q: 'Вопрос', a: 'Правильный ответ', w: 'Неправильный', x: 'Пропустить' };
  function ocrAddDialog(r) {
    const lines = OCR.splitQA(r.lines);
    let lastB = -1;
    const row = (l, i) => {
      let h = '';
      if (l.b && l.b !== lastB) { h = `<div class="ocr-block">Вопрос ${l.b}</div>`; lastB = l.b; }
      return h + `<div class="ocr-line r-${l.role}" data-b="${l.b || 0}"><select>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === l.role ? ' selected' : ''}>${v}</option>`).join('')}</select><input value="${esc(l.text)}"></div>`;
    };
    const nb = Math.max(0, ...lines.map(l => l.b || 0));
    const body = modal('Распределите строки', `<p class="note" style="margin-top:0">Проверьте распознанный текст и укажите, где вопрос, а где правильный ответ. Варианты, отмеченные на снимке зелёным, определены как правильные автоматически.${nb > 1 ? ` На снимке найдено вопросов: ${nb}.` : ''}</p>
      <div class="ocr-lines">${lines.map(row).join('')}</div>`,
      [{ text: 'Отмена', onClick: closeModal }, { text: nb > 1 ? 'Добавить в базу' : 'Далее', cls: 'primary', onClick: () => {
        const rows = $$('#modalBody .ocr-line').map(d => ({ b: +d.dataset.b, role: d.querySelector('select').value, text: d.querySelector('input').value.trim() })).filter(x => x.text);
        const code = Importers.normCode(r.text);
        const head = r.lines.slice(0, 4).map(l => l.text).join(' ').toLowerCase();
        const cat = code ? Importers.catOf(code) : /техническ/.test(head) ? 'Т' : /функциональн/.test(head) ? 'Ф' : (st.cat || 'О');
        const topicM = /компетенции\s*\/\s*([^/]+?)(?:\s+\d\d:\d\d|\/|$)/i.exec(r.lines.slice(0, 4).map(l => l.text).join(' '));
        const topic = topicM ? topicM[1].trim() : '';
        const blocks = [...new Set(rows.map(x => x.b))];
        const items = blocks.map(b => {
          const rs = rows.filter(x => x.b === b || (blocks.length === 1));
          return { q: rs.filter(x => x.role === 'q').map(x => x.text).join(' '), a: rs.filter(x => x.role === 'a').map(x => x.text).join('\n'), w: rs.filter(x => x.role === 'w').map(x => x.text), code, cat, topic, src: ['Распознано с изображения'] };
        }).filter(x => x.q);
        if (!items.length) return toast('Отметьте хотя бы одну строку как «Вопрос»');
        if (items.length === 1) return newItem({ ...items[0], srcName: 'Распознано с изображения' });
        closeModal();
        addChecked(items, rep => modal('Готово', reportHTML(rep), [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }]));
      } }]);
    body.addEventListener('change', e => { const d = e.target.closest('.ocr-line'); if (d && e.target.tagName === 'SELECT') d.className = 'ocr-line r-' + e.target.value; });
  }

  /* ---------- Экспорт / резервная копия ---------- */
  async function download(name, blob) {
    // iPhone/iPad: через меню «Поделиться» → «Сохранить в Файлы»
    if (isMobile && navigator.canShare) {
      try { const f = new File([blob], name, { type: blob.type }); if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('#btnExportX').onclick = () => {
    closeMenu();
    const wb = XLSX.utils.book_new();
    const mk = arr => {
      const rows = arr.map((x, i) => ({ '№': i + 1, 'Идентификатор': x.code, 'Компетенция': x.comp ? compLabel(x.comp) + ' ' + compName(x.comp) : '', 'Вопрос': x.q, 'Правильный ответ': x.a, 'Неправильные варианты': (x.w || []).join('\n'), 'Уровень': x.level, 'Тема': x.topic, 'Пометка': x.conflict ? 'разные ответы в источниках' : (x.a ? '' : 'нет ответа') }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 28 }, { wch: 70 }, { wch: 50 }, { wch: 40 }, { wch: 8 }, { wch: 30 }, { wch: 22 }];
      ws['!autofilter'] = { ref: ws['!ref'] };
      return ws;
    };
    const sorted = c => DB.items.filter(x => x.cat === c).sort((a, b) => (a.code || 'я').localeCompare(b.code || 'я', 'ru', { numeric: true }));
    XLSX.utils.book_append_sheet(wb, mk(sorted('Ф')), 'Функциональные');
    XLSX.utils.book_append_sheet(wb, mk(sorted('Т')), 'Технические');
    XLSX.utils.book_append_sheet(wb, mk(sorted('О')), 'Общие');
    const { c } = compStats(), LN = { red: 'красный', yellow: 'жёлтый', green: 'зелёный' };
    const mws = XLSX.utils.json_to_sheet(DB.matrix.map(m => { const o = c.get(compId(m)) || { all: 0, ans: 0 }; return { 'Группа': GROUP[m.g], 'Код': m.c, 'Компетенция': m.n, 'Вопросов': o.all, 'С ответом': o.ans, 'Светофор': LN[light(o.ans)] }; }));
    mws['!cols'] = [{ wch: 16 }, { wch: 6 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, mws, 'Матрица');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(`База_вопросов_${stamp()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  };
  $('#btnPublish').onclick = () => {
    closeMenu();
    const ver = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const items = DB.items.map(({ added, edited, ...x }) => x);
    const js = 'window.BASE_VERSION=' + JSON.stringify(ver) + ';\nwindow.BASE_MATRIX=' + JSON.stringify(DB.matrix) + ';\nwindow.BASE_DB=' + JSON.stringify(items) + ';\n';
    DB.baseVersion = ver; persist();
    download('base.js', new Blob([js], { type: 'application/javascript' }));
    modal('Общая база для папки программы', `<p class="report">Скачан файл <b>base.js</b> с текущей базой (${items.length} вопросов).</p>
      <ol class="report"><li>Откройте папку программы (например, в сетевой папке) → папка <b>data</b>.</li><li>Замените в ней файл <b>base.js</b> скачанным.</li></ol>
      <p class="note">У коллег, которые открывают программу из этой папки, новые вопросы добавятся автоматически при следующем запуске. Их собственные правки сохранятся.</p>`, [{ text: 'Понятно', cls: 'blue', onClick: closeModal }]);
  };
  $('#btnBackup').onclick = () => { closeMenu(); download(`База_резервная_копия_${stamp()}.json`, new Blob([JSON.stringify(DB)], { type: 'application/json' })); if (!isMobile) toast('Резервная копия сохранена в «Загрузки»'); };
  $('#btnRestore').onclick = () => { closeMenu(); $('#fileRestore').click(); };
  $('#fileRestore').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch (err) { return toast('Файл повреждён или это не резервная копия'); }
    const items = Array.isArray(data) ? data : data.items;
    if (!items || !items.length) return toast('В файле нет вопросов');
    modal('Восстановить из копии', `<p class="report">В копии ${items.length} вопросов. Заменить текущую базу (${DB.items.length}) или объединить?</p><p class="note">«Объединить» — удобно, чтобы перенести вопросы, добавленные на телефоне, в базу на компьютере и наоборот.</p>`,
      [{ text: 'Отмена', onClick: closeModal },
       { text: 'Объединить', cls: 'blue', onClick: () => { closeModal(); addChecked(items.map(({ id, ...x }) => ({ ...x, src: x.src || [] })), r => modal('Объединение', reportHTML(r), [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }])); } },
       { text: 'Заменить', cls: 'primary', onClick: () => { DB = { version: 1, baseVersion: data.baseVersion || '', items, nextId: items.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1, matrix: data.matrix || DB.matrix, thr: data.thr || DB.thr, matrixEdited: data.matrixEdited || DB.matrixEdited }; compIx = null; afterChange(); closeModal(); toast('База восстановлена'); } }]);
  };

  /* ---------- настройки и окно ---------- */
  function applyFont(v) { document.documentElement.style.setProperty('--fs', v + 'px'); }
  const fs = $('#fontSize'); fs.value = Store.getPref('fs', 14); applyFont(fs.value);
  fs.oninput = () => { applyFont(fs.value); Store.setPref('fs', +fs.value); };
  const so = $('#showOpts'); so.checked = Store.getPref('showOpts', false);
  so.onchange = () => { Store.setPref('showOpts', so.checked); renderResults(); };
  $$('#catSeg button').forEach(b => b.classList.toggle('on', b.dataset.cat === st.cat));

  const op = $('#opacity'), ot = $('#onTop');
  if (desk) {
    op.value = Store.getPref('opacity', 100); desk.setOpacity(op.value / 100);
    op.oninput = () => { desk.setOpacity(op.value / 100); Store.setPref('opacity', +op.value); };
    ot.checked = Store.getPref('onTop', false); desk.setOnTop(ot.checked);
    ot.onchange = () => { desk.setOnTop(ot.checked); Store.setPref('onTop', ot.checked); };
    $('#presets').onclick = e => { const b = e.target.closest('button'); if (b) { setCompact(false); desk.preset(b.dataset.p); } };
    $('#btnTray').onclick = () => desk.tray();
    $('#btnQuit').onclick = () => desk.quit();
    if (desk.onCommand) desk.onCommand(cmd => { if (cmd === 'compact') setCompact(true); if (cmd === 'full') setCompact(false); if (cmd === 'focus') { q.focus(); q.select(); } });
  }
  /* В браузере: окно, открытое через «Запустить.cmd» (режим приложения), можно двигать и менять размер */
  const lite = !desk && !isMobile;
  let liteFull = null;
  function liteResize(w, h, x, y) {
    try { window.resizeTo(w, h); if (x !== undefined) window.moveTo(x, y); } catch (e) {}
  }
  if (lite) {
    $('#presets').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (document.body.classList.contains('compact')) setCompact(false);
      const W = screen.availWidth, H = screen.availHeight, X = screen.availLeft || 0, Y = screen.availTop || 0;
      const w = Math.min(560, W), h = Math.min(680, H), before = window.outerWidth + 'x' + window.outerHeight + '@' + window.screenX;
      const P = { max: [W, H, X, Y], center: [Math.min(1100, W), Math.min(780, H), X + (W - Math.min(1100, W)) / 2, Y + (H - Math.min(780, H)) / 2], tl: [w, h, X, Y], tr: [w, h, X + W - w, Y], bl: [w, h, X, Y + H - h], br: [w, h, X + W - w, Y + H - h] }[b.dataset.p];
      liteResize(...P.map(Math.round));
      setTimeout(() => { if (window.outerWidth + 'x' + window.outerHeight + '@' + window.screenX === before) toast('Положение окна меняется, если программа запущена через «Запустить.cmd». В обычной вкладке браузера — перетащите окно вручную.', 5000); }, 300);
    };
  }
  function setCompact(on) {
    if (lite) {
      if (on && !document.body.classList.contains('compact')) { liteFull = [window.outerWidth, window.outerHeight]; liteResize(Math.min(700, window.outerWidth), 190); }
      if (!on && document.body.classList.contains('compact') && liteFull) liteResize(liteFull[0], liteFull[1]);
    }
    document.body.classList.toggle('compact', on);
    $('#btnCompact').classList.toggle('on', on);
    $('#btnCompact').title = on ? 'Полный режим (Ctrl+M)' : 'Компактный режим: только поиск и ответ (Ctrl+M)';
    Store.setPref('compact', on);
    if (desk) desk.compact(on);
    renderCompact(); q.focus(); setTimeout(fitCompact, 60);
  }
  $('#btnCompact').onclick = () => setCompact(!document.body.classList.contains('compact'));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'ь' || e.code === 'KeyM')) { e.preventDefault(); setCompact(!document.body.classList.contains('compact')); }
    else if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
    else if (e.key === '/' && document.activeElement !== q && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  });

  /* мобильное меню */
  function closeMenu() { document.body.classList.remove('menu-open'); }
  $('#btnMenu').onclick = e => { e.stopPropagation(); document.body.classList.toggle('menu-open'); };
  document.addEventListener('click', e => { if (document.body.classList.contains('menu-open') && !e.target.closest('#side') && !e.target.closest('#btnMenu')) closeMenu(); });

  /* ---------- запуск ---------- */
  (async function init() {
    await loadDB();
    if (Store.getPref('compact', false)) setCompact(true);
    runSearch(false);
    if (!isMobile) q.focus();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    setExt(st.ext);
    window.App = { DB: () => DB, addItems, addChecked, findDups, autoComp, parseMatrix, showFuzzy, setTab };
  })();
})();
