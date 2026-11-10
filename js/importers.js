/* Импорт вопросов из Excel (xlsx/xls/csv), Word (docx), текста и резервных копий (json).
   Правила распознавания повторяют те, по которым собрана исходная база. */
(function () {
  const CODE_RE = /(ФУНКЦ|ФУНК|Функц|ТЕХ|Тех)[\s._]*(\d+)\s*[.,]\s*(\d+)/i;
  const SEC_RE = /^(\d+)\.(\d+)\.?\s*([ФТ])\s*[–—-]\s*(.*)$/; // «1.2.Ф – Название»
  const LVL = { C: 'С', B: 'В', A: 'А', 'С': 'С', 'В': 'В', 'А': 'А' };
  const TECH_HINT = ['тех', 'кип', 'асутп', 'электр', 'механ', 'метролог', 'вибро', 'материал', 'нк', 'дин.об', 'стат.об', 'теплоэнерг', 'сварк', 'спа'];

  function clean(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/\u00a0/g, ' ').replace(/\r/g, '').replace(/[ \t]+/g, ' ')
      .split('\n').map(l => l.trim()).join('\n').trim();
  }
  function normCode(s) {
    const m = CODE_RE.exec(String(s || ''));
    if (!m) return '';
    const p = /^тех/i.test(m[1]) ? 'ТЕХ' : 'ФУНКЦ';
    return p + ' ' + m[2] + '.' + m[3];
  }
  function catOf(code, hint) {
    if (code.startsWith('ТЕХ')) return 'Т';
    if (code.startsWith('ФУНКЦ')) return 'Ф';
    const h = (hint || '').toLowerCase();
    if (h.startsWith('тех')) return 'Т';
    if (h.startsWith('функ')) return 'Ф';
    if (/общ|охран|безопасн|эколог|экономик/.test(h)) return 'О';
    return '';
  }
  function mk(q, a, w, meta) {
    q = clean(q); a = clean(a);
    if (!q || q.length < 3) return null;
    return {
      q, a, w: (w || []).map(clean).filter(x => x && x !== a),
      code: meta.code || '', cat: meta.cat || '', topic: clean(meta.topic || ''),
      level: LVL[clean(meta.level).toUpperCase()] || '', src: [meta.src || ''], qt: clean(meta.qt || '')
    };
  }

  /* ---------- Excel ---------- */
  function fromWorkbook(wb, fname, defCat) {
    const out = [];
    wb.SheetNames.forEach(sn => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false });
      if (!rows.length) return;
      let hi = -1;
      for (let i = 0; i < Math.min(12, rows.length); i++) {
        if (rows[i].some(v => /^вопрос/i.test(clean(v)))) { hi = i; break; }
      }
      const sCode = normCode(sn);
      const sLow = sn.toLowerCase();
      const sCat = sCode ? catOf(sCode) : (TECH_HINT.some(k => sLow.includes(k)) ? 'Т' : (/функ/.test(sLow) ? 'Ф' : ''));
      const sTopic = sn.replace(/^\s*[\d.]+\s*/, '').replace(CODE_RE, '').trim();
      const src = fname + ' / ' + sn;
      if (hi < 0) {
        // без заголовка: A — вопрос, B — ответ, остальные — варианты
        rows.forEach(r => {
          const it = mk(r[0], r[1], r.slice(2), { code: sCode, cat: sCat || defCat, topic: sTopic, src });
          if (it) out.push(it);
        });
        return;
      }
      const H = rows[hi].map(v => clean(v).toLowerCase());
      const find = (...tests) => { for (const t of tests) { const j = H.findIndex(h => typeof t === 'string' ? h === t : t.test(h)); if (j >= 0) return j; } return -1; };
      const cQ = find('вопрос', /^вопрос/);
      const cA = find('правильный ответ', /^правильн/, 'ответ', /^ответ/);
      const cW = H.map((h, j) => (/^неправильн|^вариант|^неверн/.test(h) ? j : -1)).filter(j => j >= 0);
      const cType = find('тип компетенций', /направлен/);
      const cSub = find('под-компетенция', 'идентификатор', 'код', /^тест/, /раздел/);
      const cComp = find('компетенция');
      const cLvl = find('уровень компетенций', 'уровень');
      const cQt = find('тип вопроса');
      for (let r = hi + 1; r < rows.length; r++) {
        const row = rows[r], g = j => (j >= 0 ? row[j] : '');
        if (!clean(g(cQ))) continue;
        let lvl = g(cLvl);
        if (!lvl && cQ > 0) { for (let k = 0; k < cQ; k++) { if (LVL[clean(row[k]).toUpperCase()]) { lvl = row[k]; break; } } }
        const code = normCode(g(cSub)) || normCode(g(cComp)) || sCode;
        const cat = catOf(code, clean(g(cType)) || clean(g(cSub))) || sCat || defCat;
        let topic = clean(g(cSub)) || clean(g(cComp)) || sTopic;
        topic = topic.replace(/^(Технические|Функциональные) компетенции\s*\/\s*/i, '').replace(/^(ФУНКЦ|ФУНК|ТЕХ)\s*\d+[.,]\d+\.?\s*/i, '');
        let ans = g(cA);
        let wrong = cW.map(g);
        const it = mk(g(cQ), ans, wrong, { code, cat, topic, level: lvl, src, qt: g(cQt) });
        if (it) out.push(it);
      }
    });
    return out;
  }

  /* ---------- Word (docx) ---------- */
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  async function docxParagraphs(buf) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const ps = doc.getElementsByTagNameNS(W, 'p');
    const out = [];
    for (const p of ps) {
      let text = '', marked = false, boldAll = true, any = false;
      const pPr = p.getElementsByTagNameNS(W, 'pPr')[0];
      const pShd = pPr && [...pPr.childNodes].find(n => n.localName === 'shd');
      const pFill = pShd ? (pShd.getAttributeNS(W, 'fill') || '') : '';
      for (const r of p.getElementsByTagNameNS(W, 'r')) {
        let t = '';
        for (const n of r.childNodes) {
          if (n.localName === 't') t += n.textContent;
          else if (n.localName === 'tab') t += '\t';
          else if (n.localName === 'br') t += '\n';
        }
        if (!t) continue;
        const rPr = [...r.childNodes].find(n => n.localName === 'rPr');
        const has = name => rPr && [...rPr.childNodes].find(n => n.localName === name);
        const hl = has('highlight'); const shd = has('shd'); const b = has('b');
        const isHl = (hl && hl.getAttributeNS(W, 'val') !== 'none') || (shd && /^(?!auto$|ffffff$|000000$)/i.test(shd.getAttributeNS(W, 'fill') || 'auto'));
        const isB = b && !/^(0|false)$/.test(b.getAttributeNS(W, 'val') || '');
        const core = t.replace(/^[\s\-−–+•*a-eа-е\)\.\d]{0,4}/i, '');
        if (t.trim()) {
          if (isHl) marked = true;
          if (core.trim()) { any = true; if (!isB) boldAll = false; }
        }
        text += t;
      }
      out.push({ text: clean(text), hl: marked, bold: any && boldAll, fill: pFill });
    }
    return out;
  }

  const OPT_RE = /^([+\-−–•]|[a-hа-зс][)\.]\s|[a-hа-зс]\)|\d+\))\s*/i;
  const META_RE = /^(Тип:|Статус:|Код:|Задание\s*#|Пожалуйста|Правильный ответ)/i;
  function fromParagraphs(paras, fname, defCat) {
    const out = [];
    let code = '', cat = defCat || '', topic = '', level = '', qt = '';
    let cur = null;
    const flush = () => {
      if (!cur || !cur.q || (!cur.opts.length && !cur.ans)) { cur = null; return; }
      const opts = cur.opts;
      let right = opts.filter(o => o.plus);
      if (!right.length) right = opts.filter(o => o.hl);
      if (!right.length) {
        const bolds = opts.filter(o => o.bold);
        if (bolds.length && bolds.length < opts.length) right = bolds;
      }
      if (!right.length && cur.ans) right = [{ t: cur.ans }];
      const rs = new Set(right);
      const it = mk(cur.q, right.map(o => o.t).join('\n'), opts.filter(o => !rs.has(o)).map(o => o.t), { code, cat, topic, level, src: fname, qt });
      if (it) { if (!right.length) it.w = opts.map(o => o.t); out.push(it); }
      cur = null;
    };
    for (const p of paras) {
      const t = p.text;
      if (!t) continue;
      let m;
      if ((m = SEC_RE.exec(t))) { flush(); cat = m[3]; code = (cat === 'Ф' ? 'ФУНКЦ' : 'ТЕХ') + ' ' + m[1] + '.' + m[2]; topic = m[4]; continue; }
      if (/^\*[ABCАВС]/.test(t)) { flush(); level = LVL[t[1]] || level; const c = normCode(t); if (c) { code = c; cat = catOf(c); topic = t.replace(/^\*\S*\s*/, '').replace(CODE_RE, '').replace(/\[\d+\]/, '').trim(); } continue; }
      if (/^Задание\s*#/i.test(t)) { flush(); cur = { q: '', opts: [], ans: '' }; continue; }
      if (/^Тип:/i.test(t)) { qt = t.slice(4).trim(); continue; }
      if (META_RE.test(t) && !/^Правильный ответ/i.test(t)) continue;
      if ((m = /^(Правильный ответ|Ответ)\s*[:\-–]\s*(.+)$/i.exec(t))) { if (cur) cur.ans = m[2]; continue; }
      if (normCode(t) && t.length < 120 && !/[?:]$/.test(t)) { flush(); code = normCode(t); cat = catOf(code); topic = t.replace(CODE_RE, '').replace(/^[\s.\-–]+/, ''); continue; }
      const isOpt = OPT_RE.test(t) && cur && cur.q;
      if (isOpt) {
        const mark = t.match(OPT_RE)[1];
        cur.lastRaw = /[;.]\s*$/.test(t) ? '.' : '';
        const v = t.replace(OPT_RE, '').replace(/[;.]\s*$/, '').trim();
        cur.opts.push({ t: v, plus: mark === '+', hl: p.hl || /^(a8d08d|c5e0b3|e2efd9|92d050|00ff00|ffff00|ffe599|fff2cc)$/i.test(p.fill) && false, bold: p.bold });
        if (p.hl) cur.opts[cur.opts.length - 1].hl = true;
        continue;
      }
      // продолжение варианта, перенесённого на новую строку
      if (cur && cur.opts.length && /^[(а-яёa-z]/.test(t) && !/[.;?!]$/.test(cur.opts[cur.opts.length - 1].t + (cur.lastRaw || ''))) { const o = cur.opts[cur.opts.length - 1]; o.t += ' ' + t.replace(/[;.]\s*$/, ''); if (p.hl) o.hl = true; if (!p.bold) o.bold = o.bold && false; continue; }
      // новая строка-вопрос
      if (cur && cur.q && !cur.opts.length && !/^\d+\.\s/.test(t)) { cur.q += '\n' + t; continue; }
      flush();
      cur = { q: t.replace(/^\d+\.\s*/, ''), opts: [], ans: '' };
    }
    flush();
    return out;
  }

  /* ---------- Текст / CSV ---------- */
  function fromText(txt, fname, defCat) {
    const lines = txt.replace(/\r/g, '').split('\n');
    const tabbed = lines.filter(l => l.includes('\t') || /;/.test(l)).length > lines.length * 0.6;
    if (tabbed) {
      const out = [];
      lines.forEach(l => {
        const parts = l.includes('\t') ? l.split('\t') : l.split(';');
        if (/^вопрос/i.test(parts[0])) return;
        const it = mk(parts[0], parts[1], parts.slice(2), { cat: defCat, src: fname });
        if (it) out.push(it);
      });
      return out;
    }
    return fromParagraphs(lines.map(l => ({ text: clean(l), hl: false, bold: false, fill: '' })), fname, defCat);
  }

  async function importFile(file, defCat) {
    const name = file.name;
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'json') {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : data.items;
      return arr.map(x => ({ ...x, src: Array.isArray(x.src) ? x.src : [x.src || name] }));
    }
    if (ext === 'doc') throw new Error('Формат .doc (старый Word) не читается. Откройте файл в Word и сохраните как .docx.');
    if (ext === 'docx') return fromParagraphs(await docxParagraphs(await file.arrayBuffer()), name, defCat);
    if (ext === 'txt') return fromText(await file.text(), name, defCat);
    if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      return fromWorkbook(wb, name, defCat);
    }
    throw new Error('Неподдерживаемый формат: .' + ext);
  }

  window.Importers = { importFile, fromParagraphs, normCode, catOf, clean };
})();
