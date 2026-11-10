/* Подготовка к тестированию — логика интерфейса */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const S = window.Search, esc = S.esc;
  const desk = window.desk || null;
  const CAT_NAME = { 'Ф': 'Функциональные', 'Т': 'Технические', 'О': 'Общие' };

  let DB = { version: 1, baseVersion: '', items: [], nextId: 1 };
  let cur = { list: [], tokens: [], sel: -1, focusId: null, fuzzy: null };
  const st = { cat: Store.getPref('cat', ''), code: '', compactIdx: 0 };

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
        DB.baseVersion = window.BASE_VERSION; persist();
        if (rep.added) setTimeout(() => toast('Общая база обновлена: добавлено вопросов — ' + rep.added, 4000), 600);
      }
    } else {
      DB.items = (window.BASE_DB || []).map(x => ({ ...x }));
      DB.baseVersion = window.BASE_VERSION || '';
      DB.nextId = DB.items.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
    }
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
  }
  function byId(id) { return DB.items.find(x => x.id === id); }

  /* ---------- поиск ---------- */
  const q = $('#q');
  let inT;
  q.addEventListener('input', () => { clearTimeout(inT); inT = setTimeout(() => runSearch(true), 50); });
  function runSearch(showSuggest) {
    cur.fuzzy = null; cur.focusId = null; st.compactIdx = 0;
    const r = S.query(q.value, { cat: st.cat, code: st.code });
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
  function rerun() { if (cur.fuzzy) showFuzzy(cur.fuzzy); else runSearch(false); }

  /* ---------- отображение ---------- */
  function answers(it) { return (it.a || '').split(/\n+/).map(s => s.trim()).filter(Boolean); }
  function card(it, focus) {
    const tk = cur.tokens, tka = cur.fuzzy ? [] : tk;
    const meta = [
      it.code ? `<span class="badge code">${esc(it.code)}</span>` : '',
      it.cat ? `<span class="badge cat-${it.cat}" title="${it.auto ? 'Категория определена автоматически' : ''}">${CAT_NAME[it.cat]}${it.auto ? ' *' : ''}</span>` : '',
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
    if (!q.value.trim() && !cur.fuzzy && !st.code) {
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
    stEl.textContent = cur.fuzzy ? `Распознанный текст: найдено похожих вопросов — ${list.length}` :
      list.length ? `Найдено: ${list.length}${list.length > 60 ? ' (показаны первые 60 — уточните запрос)' : ''}${cur.partial ? ' · точных совпадений нет, показаны частичные' : ''}` : 'Ничего не найдено. Попробуйте другие слова или их начало.';
    box.innerHTML = shown.map((it, i) => card(it, cur.focusId && i === 0)).join('');
    box.scrollTop = 0;
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
    const b = e.target.closest('[data-act]'); if (!b) return;
    const it = byId(+b.closest('.qcard').dataset.id);
    if (b.dataset.act === 'edit') editItem(it);
    if (b.dataset.act === 'copy') { navigator.clipboard && navigator.clipboard.writeText(it.a || '').then(() => toast('Ответ скопирован')); }
  });

  /* ---------- редактирование ---------- */
  function itemForm(it) {
    const o = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    return `<div class="field"><label>Вопрос</label><textarea id="fQ" rows="3">${esc(it.q || '')}</textarea></div>
      <div class="field"><label>Правильный ответ (если правильных несколько — каждый с новой строки)</label><textarea id="fA" rows="2">${esc(it.a || '')}</textarea></div>
      <div class="field"><label>Неправильные варианты (каждый с новой строки, необязательно)</label><textarea id="fW" rows="3">${esc((it.w || []).join('\n'))}</textarea></div>
      <div class="grid2">
        <div class="field"><label>Категория</label><select id="fC">${o('Ф', 'Функциональные', it.cat)}${o('Т', 'Технические', it.cat)}${o('О', 'Общие', it.cat || 'О')}</select></div>
        <div class="field"><label>Идентификатор</label><input id="fCode" list="codesList" placeholder="например, ТЕХ 3.1" value="${esc(it.code || '')}"></div>
        <div class="field"><label>Уровень</label><select id="fL">${o('', '—', it.level || '')}${o('А', 'А', it.level)}${o('В', 'В', it.level)}${o('С', 'С', it.level)}</select></div>
      </div>
      <div class="field"><label>Тема / компетенция</label><input id="fT" value="${esc(it.topic || '')}"></div>
      <datalist id="codesList">${[...new Set(DB.items.map(x => x.code).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      ${it.src && it.src.length ? `<p class="note">Источник: ${esc(it.src.slice(0, 4).join('; '))}</p>` : ''}`;
  }
  function readForm() {
    const v = id => $('#' + id).value.trim();
    let code = v('fCode'); const nc = Importers.normCode(code); if (nc) code = nc;
    return { q: v('fQ'), a: v('fA'), w: v('fW').split('\n').map(s => s.trim()).filter(Boolean), cat: v('fC'), code, level: v('fL'), topic: v('fT') };
  }
  function editItem(it) {
    modal('Изменить вопрос', itemForm(it), [
      { text: 'Удалить', cls: 'danger', onClick: () => { if (confirm('Удалить этот вопрос из базы?')) { forget(it); DB.items = DB.items.filter(x => x !== it); afterChange(); closeModal(); toast('Вопрос удалён'); } } },
      { text: 'Отмена', onClick: closeModal },
      { text: 'Сохранить', cls: 'primary', onClick: () => {
        const f = readForm(); if (!f.q) return toast('Вопрос не может быть пустым');
        if (f.cat !== it.cat) delete it.auto;
        forget(it); Object.assign(it, f); delete it.conflict; it.edited = Date.now();
        afterChange(); closeModal(); toast('Изменения сохранены');
      } }
    ]);
  }
  function newItem(pre = {}) {
    modal('Добавить вопрос', itemForm({ cat: st.cat || 'О', ...pre }), [
      { text: 'Отмена', onClick: closeModal },
      { text: 'Добавить в базу', cls: 'primary', onClick: () => {
        const f = readForm(); if (!f.q) return toast('Введите вопрос');
        const r = addItems([{ ...f, src: [pre.srcName || 'Добавлено вручную'] }]);
        closeModal(); toast(r.added ? 'Вопрос добавлен в базу' : (r.updated ? 'Такой вопрос уже был — ответ обновлён' : 'Такой вопрос с этим ответом уже есть в базе'));
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
    const rep = { added: 0, dup: 0, updated: 0, conflict: 0, noAns: 0 };
    list.forEach(n => {
      if (!n || !n.q) return;
      const k = S.dupKey(n.q, n.a);
      const ex = byKey.get(k);
      if (ex) { // дубль — дополним недостающее
        rep.dup++;
        if (!ex.code && n.code) ex.code = n.code;
        if ((!ex.w || !ex.w.length) && n.w && n.w.length) ex.w = n.w;
        if (n.src) ex.src = [...new Set([...(ex.src || []), ...n.src])].slice(0, 8);
        return;
      }
      const same = byQ.get(S.qKey(n.q)) || [];
      if (same.length) {
        const noA = same.find(x => !x.a);
        if (noA && n.a) { noA.a = n.a; if (n.w && n.w.length) noA.w = n.w; rep.updated++; byKey.set(k, noA); return; }
        if (!n.a) { rep.dup++; return; }
        if (opt.replace) { same[0].a = n.a; if (n.w && n.w.length) same[0].w = n.w; rep.updated++; return; }
        rep.conflict++; same.forEach(x => (x.conflict = 1)); n.conflict = 1;
      }
      if (!n.a) rep.noAns++;
      const it = { id: DB.nextId++, q: n.q, a: n.a || '', w: n.w || [], code: n.code || '', cat: n.cat || 'О', topic: n.topic || '', level: n.level || '', qt: n.qt || '', src: n.src || [], added: Date.now() };
      if (n.conflict) it.conflict = 1;
      DB.items.push(it); byKey.set(k, it);
      const qk = S.qKey(n.q); if (!byQ.has(qk)) byQ.set(qk, []); byQ.get(qk).push(it);
      rep.added++;
    });
    if (opt.silent) { reindex(); } else afterChange();
    return rep;
  }

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
    <p class="note">Повторяющиеся вопросы не добавляются. Если в новом файле у вопроса другой ответ — оба варианта сохранятся с пометкой «в источниках разные ответы».</p>`);
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
      <label class="field" style="flex-direction:row;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="impRepl" style="width:auto"> Если вопрос уже есть, но ответ другой — заменить ответ (иначе сохранить оба)</label>`,
      [{ text: 'Отмена', onClick: closeModal }, { text: 'Добавить в базу', cls: 'primary', onClick: () => {
        const r = addItems(all, { replace: $('#impRepl').checked });
        modal('Готово', `<ul class="report"><li>Добавлено новых: <b>${r.added}</b></li><li>Уже были в базе: ${r.dup}</li><li>Дополнены/обновлены ответы: ${r.updated}</li><li>С другим ответом (помечены): ${r.conflict}</li><li>Без отмеченного ответа: ${r.noAns}</li></ul>`, [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }]);
      } }]);
  };

  /* ---------- Распознавание (камера / снимок / экран) ---------- */
  let imgMode = 'search';
  function pickImage(sel, mode) { imgMode = mode; $(sel).click(); }
  ['#fileCam', '#fileImg'].forEach(sel => $(sel).onchange = e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const rd = new FileReader(); rd.onload = () => cropDialog(rd.result, imgMode); rd.readAsDataURL(f);
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

  function cropDialog(url, mode) {
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
          ost.textContent = /recogn/.test(s) ? 'Распознавание текста…' : 'Подготовка модуля распознавания (первый раз дольше)…';
        });
        if (!r.text.trim()) { ost.textContent = 'Текст не найден. Попробуйте выделить область крупнее или сделать снимок ровнее.'; btn.disabled = false; return; }
        if (mode === 'add') ocrAddDialog(r); else { closeModal(); showFuzzy(r.text); }
      } catch (e) { ost.textContent = 'Ошибка распознавания: ' + (e.message || e); btn.disabled = false; }
    }
  }
  function showFuzzy(text) {
    cur.fuzzy = text; cur.focusId = null; st.compactIdx = 0;
    const r = S.fuzzy(text, { cat: st.cat });
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
        const rep = addItems(items);
        modal('Готово', `<ul class="report"><li>Добавлено новых: <b>${rep.added}</b></li><li>Уже были в базе: ${rep.dup}</li><li>Дополнены ответы: ${rep.updated}</li><li>С другим ответом (помечены): ${rep.conflict}</li><li>Без отмеченного ответа: ${rep.noAns}</li></ul>`, [{ text: 'Закрыть', cls: 'blue', onClick: closeModal }]);
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
      const rows = arr.map((x, i) => ({ '№': i + 1, 'Идентификатор': x.code, 'Вопрос': x.q, 'Правильный ответ': x.a, 'Неправильные варианты': (x.w || []).join('\n'), 'Уровень': x.level, 'Тема': x.topic, 'Пометка': x.conflict ? 'разные ответы в источниках' : (x.a ? '' : 'нет ответа') }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 70 }, { wch: 50 }, { wch: 40 }, { wch: 8 }, { wch: 30 }, { wch: 22 }];
      ws['!autofilter'] = { ref: ws['!ref'] };
      return ws;
    };
    const sorted = c => DB.items.filter(x => x.cat === c).sort((a, b) => (a.code || 'я').localeCompare(b.code || 'я', 'ru', { numeric: true }));
    XLSX.utils.book_append_sheet(wb, mk(sorted('Ф')), 'Функциональные');
    XLSX.utils.book_append_sheet(wb, mk(sorted('Т')), 'Технические');
    XLSX.utils.book_append_sheet(wb, mk(sorted('О')), 'Общие');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(`База_вопросов_${stamp()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  };
  $('#btnPublish').onclick = () => {
    closeMenu();
    const ver = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const items = DB.items.map(({ added, edited, ...x }) => x);
    const js = 'window.BASE_VERSION=' + JSON.stringify(ver) + ';\nwindow.BASE_DB=' + JSON.stringify(items) + ';\n';
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
       { text: 'Объединить', cls: 'blue', onClick: () => { const r = addItems(items.map(x => ({ ...x, src: x.src || [] }))); closeModal(); toast(`Добавлено ${r.added}, совпало ${r.dup}`); } },
       { text: 'Заменить', cls: 'primary', onClick: () => { DB = { version: 1, baseVersion: data.baseVersion || '', items, nextId: items.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1 }; afterChange(); closeModal(); toast('База восстановлена'); } }]);
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
    window.App = { DB: () => DB, addItems, showFuzzy };
  })();
})();
