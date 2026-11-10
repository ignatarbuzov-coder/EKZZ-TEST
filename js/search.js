/* Поиск: нормализация русского текста, префиксное совпадение по словам (как фильтр в Excel),
   нечёткий поиск для распознанного с экрана текста. */
(function () {
  const LAT2CYR = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н', '3': 'з' };
  const STOP = new Set('и в во на по с со к ко о об а у от до за из не ни что как для это ли же или при его ее их то так бы был была были быть'.split(' '));
  const CODE_RE = /(функц|функ|тех)[\s._]*(\d+)\s*[.,]\s*(\d+)/i;

  function fixMixed(w) {
    // слова со смесью латиницы и кириллицы (частая ошибка распознавания) → в кириллицу
    if (/[а-я]/.test(w) && /[a-z]/.test(w)) return w.replace(/[a-z3]/g, ch => LAT2CYR[ch] || ch);
    return w;
  }
  function norm(s) { return (s || '').toLowerCase().replace(/ё/g, 'е'); }
  function words(s) {
    return norm(s).split(/[^0-9a-zа-я]+/i).filter(Boolean).map(fixMixed);
  }
  function stem(w) { return w.length >= 5 ? w.slice(0, Math.max(4, w.length - 2)) : w; }
  function key5(w) { return w.slice(0, 5); }

  function make() {
  const S = { items: [], idx: [], df: new Map(), N: 1 };

  S.build = function (items) {
    S.items = items;
    S.df = new Map();
    S.idx = items.map(it => {
      const qw = words(it.q), aw = words(it.a), ww = words((it.w || []).join(' '));
      const qk = new Set(qw.filter(w => !STOP.has(w)).map(key5));
      qk.forEach(k => S.df.set(k, (S.df.get(k) || 0) + 1));
      return { qw, aw, ww, qk, ak: new Set(aw.map(key5)), qn: ' ' + qw.join(' ') + ' ', code: norm(it.code) };
    });
    S.N = Math.max(1, items.length);
  };
  function idf(k) { const d = S.df.get(k) || 0; return Math.log(1 + S.N / (1 + d)); }

  S.parseCode = function (q) {
    const m = CODE_RE.exec(q || '');
    if (!m) return null;
    const p = m[1].toLowerCase().startsWith('тех') ? 'тех' : 'функц';
    return { code: p + ' ' + m[2] + '.' + m[3], rest: (q.slice(0, m.index) + ' ' + q.slice(m.index + m[0].length)).trim() };
  };

  /* Быстрый поиск по вводу: каждое слово запроса должно найтись как начало слова в вопросе
     (последнее слово — как вводимый префикс). Если строгих совпадений нет — частичные. */
  S.query = function (raw, opts = {}) {
    const res = [];
    let q = raw || '', codeF = null;
    const pc = S.parseCode(q);
    if (pc) { codeF = pc.code; q = pc.rest; }
    let toks = words(q);
    const typingLast = !/\s$/.test(raw || '');
    toks = toks.filter((t, i) => !(STOP.has(t) && toks.length > 1));
    if (!toks.length && !codeF && !opts.code && !opts.comp) return { list: [], tokens: [] };
    const pats = toks.map((t, i) => (i === toks.length - 1 && typingLast) ? t : stem(t));
    const wts = pats.map(p => idf(key5(p)) || 1);
    const total = wts.reduce((a, b) => a + b, 0) || 1;
    const phrase = toks.length > 1 ? ' ' + pats.join(' ') : '';
    for (let i = 0; i < S.items.length; i++) {
      const it = S.items[i], ix = S.idx[i];
      if (opts.cat && it.cat !== opts.cat) continue;
      if (opts.code && it.code !== opts.code) continue;
      if (opts.comp && (it.comp || '-') !== opts.comp) continue;
      if (codeF && ix.code !== codeF) continue;
      let sq = 0, sa = 0, hit = 0;
      for (let j = 0; j < pats.length; j++) {
        const p = pats[j];
        if (ix.qw.some(w => w.startsWith(p))) { sq += wts[j]; hit++; }
        else if (ix.aw.some(w => w.startsWith(p)) || ix.ww.some(w => w.startsWith(p))) { sa += wts[j] * 0.6; hit++; }
      }
      if (!pats.length) { res.push({ i, s: 1, full: true }); continue; }
      if (!hit) continue;
      let s = (sq + sa) / total;
      if (phrase && ix.qn.includes(phrase)) s += 0.5;
      if (ix.qn.startsWith(' ' + pats[0])) s += 0.15;
      s -= Math.min(ix.qw.length, 60) * 0.002; // короче вопрос — выше при равенстве
      res.push({ i, s, full: hit === pats.length });
    }
    let list = res.filter(r => r.full);
    let partial = false;
    if (!list.length) { list = res.filter(r => r.s >= 0.45); partial = true; }
    list.sort((a, b) => b.s - a.s);
    return { list: list.map(r => S.items[r.i]), tokens: pats, partial };
  };

  /* Поиск по распознанному тексту (камера/экран): какая доля слов вопроса из базы
     присутствует в распознанном тексте, плюс бонус за слова правильного ответа. */
  S.fuzzy = function (text, opts = {}) {
    const tw = words(text).filter(w => !STOP.has(w) && w.length > 1);
    const tk = new Set(tw.map(key5));
    if (!tk.size) return { list: [], tokens: [] };
    const res = [];
    for (let i = 0; i < S.items.length; i++) {
      const it = S.items[i], ix = S.idx[i];
      if (opts.cat && it.cat !== opts.cat) continue;
      if (opts.comp && (it.comp || '-') !== opts.comp) continue;
      if (!ix.qk.size) continue;
      let have = 0, all = 0;
      ix.qk.forEach(k => { const w = idf(k); all += w; if (tk.has(k)) have += w; });
      let s = have / (all || 1);
      if (s < 0.35) continue;
      // насколько вопрос покрывает распознанный фрагмент (штраф за «короткие» вопросы-совпадения)
      let cover = 0; ix.qk.forEach(k => { if (tk.has(k)) cover++; });
      s = s * 0.8 + Math.min(1, cover / Math.min(tk.size, 14)) * 0.2;
      if (ix.ak.size) { let ah = 0; ix.ak.forEach(k => { if (tk.has(k)) ah++; }); s += 0.12 * (ah / ix.ak.size); }
      res.push({ i, s });
    }
    res.sort((a, b) => b.s - a.s);
    return { list: res.slice(0, 30).map(r => S.items[r.i]), tokens: [...tk], scores: res.slice(0, 30).map(r => r.s) };
  };

  S.idf = idf;
  return S;
  }
  const S = make();
  S.make = make;
  S.dupKey = function (q, a) { return words(q).join(' ') + '||' + words(a).join(' '); };
  S.qKey = function (q) { return words(q).join(' '); };

  function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  S.esc = esc;
  /* Подсветка совпавших слов */
  S.highlight = function (text, pats) {
    if (!pats || !pats.length) return esc(text);
    const ps = pats.map(p => p.length > 5 ? p.slice(0, 5) : p);
    return (text || '').split(/([0-9A-Za-zА-Яа-яЁё]+)/).map((part, i) => {
      if (i % 2 === 0) return esc(part);
      const w = fixMixed(norm(part));
      return ps.some(p => w.startsWith(p)) ? '<mark>' + esc(part) + '</mark>' : esc(part);
    }).join('');
  };
  S.words = words; S.key5 = key5; S.stem = stem; S.STOP = STOP;
  window.Search = S;
})();
