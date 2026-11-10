/* Распознавание текста (Tesseract, работает без интернета — модели лежат в lib/tessdata).
   Дополнительно ищет зелёные отметки (кружок/галочка) слева от строк — так в системе
   тестирования выделяются правильные ответы. */
(function () {
  let worker = null, loading = null;
  const base = new URL('.', location.href).href;

  async function getWorker(onProgress) {
    if (worker) return worker;
    if (loading) return loading;
    loading = (async () => {
      const log = m => { if (onProgress && m.progress !== undefined) onProgress(m.status, m.progress); };
      let w;
      if (location.protocol === 'file:') {
        // Открытие с диска / из сетевой папки: браузер не даёт загружать файлы напрямую,
        // поэтому модуль распознавания подключается как скрипты и передаётся через blob.
        if (onProgress) onProgress('loading', 0.05);
        for (const f of ['ocr-worker', 'ocr-core', 'ocr-rus', 'ocr-eng']) await loadScript(base + 'lib/file/' + f + '.js');
        const blobUrl = (src) => URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
        w = await Tesseract.createWorker([{ code: 'rus', data: b64(window.TP_LANG.rus) }, { code: 'eng', data: b64(window.TP_LANG.eng) }], 1, {
          workerPath: blobUrl(window.TP_CORE_SRC + '\n;\n' + window.TP_WORKER_SRC.replace('return"string"==typeof t?t:t.data}', 'return"string"==typeof t?t:t.code}')), corePath: 'embedded.js',
          workerBlobURL: false, cacheMethod: 'none', gzip: true, logger: log
        });
      } else {
        w = await Tesseract.createWorker(['rus', 'eng'], 1, {
          workerPath: base + 'lib/tesseract/worker.min.js',
          corePath: base + 'lib/tesseract/',
          langPath: base + 'lib/tessdata',
          gzip: true, cacheMethod: 'none', workerBlobURL: false, logger: log
        });
      }
      worker = w; return w;
    })();
    try { return await loading; } finally { loading = null; }
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не найден файл ' + src)); document.head.appendChild(s); });
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }

  /* Подготовка: масштаб (мелкий текст с экрана увеличиваем), обрезка по выделению */
  function toCanvas(img, crop, photo) {
    const sx = crop ? crop.x : 0, sy = crop ? crop.y : 0;
    const sw = crop ? crop.w : (img.naturalWidth || img.width), sh = crop ? crop.h : (img.naturalHeight || img.height);
    let k = 1; const lim = photo ? 2600 : 3200;
    if (Math.max(sw, sh) < 1400) k = Math.min(2.5, (photo ? 2600 : 1800) / Math.max(sw, sh, 1)); else if (Math.max(sw, sh) > lim) k = lim / Math.max(sw, sh);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function isGreen(r, g, b) {
    if (g > 140 && g - b > 55 && g - r > 15 && r > 90 && b < 140) return true;
    // блеклый зелёный на фото монитора: важна не яркость, а оттенок
    return g > 80 && g - b > g * 0.22 && g - r > g * 0.05 && r > b;
  }
  function greenLeftOf(ctx, cw, ch, bb) {
    const h = bb.y1 - bb.y0;
    const x1 = Math.min(cw, bb.x0 + Math.round(h * 1.6)), x0 = Math.max(0, bb.x0 - Math.round(h * 3.2) - 10);
    const y0 = Math.max(0, bb.y0 - Math.round(h * 0.3)), y1 = Math.min(ch, bb.y1 + Math.round(h * 0.3));
    if (x1 - x0 < 4 || y1 - y0 < 4) return false;
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let n = 0, tot = 0;
    for (let i = 0; i < d.length; i += 8) { tot++; if (isGreen(d[i], d[i + 1], d[i + 2])) n++; }
    return n / tot > 0.04;
  }

  /* ---------- Улучшение снимка (фото монитора телефоном, неконтрастный текст) ----------
     1) серый; 2) лёгкое сглаживание против муара; 3) выравнивание фона (блики, тени, неравномерная
     подсветка) делением на оценку фона; 4) растяжение контраста; 5) вариант с адаптивной бинаризацией (Sauvola). */
  function grayOf(canvas) {
    const W = canvas.width, H = canvas.height;
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const g = new Float32Array(W * H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { g, W, H };
  }
  function stats(g) {
    const h = new Uint32Array(256); for (let i = 0; i < g.length; i += 3) h[Math.max(0, Math.min(255, g[i] | 0))]++;
    const n = Math.ceil(g.length / 3), pc = q => { let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (a >= n * q) return v; } return 255; };
    return { p02: pc(0.02), p05: pc(0.05), p50: pc(0.5), p95: pc(0.95), p98: pc(0.98) };
  }
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
    for (let y = 0; y < H; y++) { let acc = 0; const o = y * W;
      for (let x = -r; x <= r; x++) acc += src[o + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) { tmp[o + x] = acc / n; acc += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
    for (let x = 0; x < W; x++) { let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) { out[y * W + x] = acc / n; acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; } }
    return out;
  }
  function normalize(g, W, H, photo) {
    const st = stats(g);
    if (st.p50 < 110) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i]; // светлый текст на тёмном фоне
    const s = boxBlur(g, W, H, photo ? 2 : 1); // для фото сильнее гасим муар экрана
    // оценка фона: максимум в блоках + сглаживание + билинейная интерполяция
    const B = Math.max(16, Math.round(Math.min(W, H) / 36)), bw = Math.ceil(W / B), bh = Math.ceil(H / B);
    let bg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let m = 0; const y1 = Math.min(H, (by + 1) * B), x1 = Math.min(W, (bx + 1) * B);
      for (let y = by * B; y < y1; y += 2) for (let x = bx * B; x < x1; x += 2) { const v = s[y * W + x]; if (v > m) m = v; }
      bg[by * bw + bx] = m;
    }
    for (let k = 0; k < 2; k++) bg = boxBlur(bg, bw, bh, 1);
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / B - 0.5)), y0 = fy | 0, y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / B - 0.5)), x0 = fx | 0, x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
        const b = (bg[y0 * bw + x0] * (1 - tx) + bg[y0 * bw + x1] * tx) * (1 - ty) + (bg[y1 * bw + x0] * (1 - tx) + bg[y1 * bw + x1] * tx) * ty;
        out[y * W + x] = Math.min(255, s[y * W + x] * 255 / Math.max(b, 8));
      }
    }
    const st2 = stats(out), lo = st2.p02, hi = Math.max(lo + 20, Math.min(st2.p50, 250));
    for (let i = 0; i < out.length; i++) { const v = (out[i] - lo) / (hi - lo); out[i] = 255 * Math.max(0, Math.min(1, v)) ** (photo ? 1.6 : 1.15); }
    return out;
  }
  function sauvola(g, W, H, photo) {
    const r = photo ? Math.max(12, Math.round(Math.min(W, H) / 100)) : Math.max(8, Math.round(Math.min(W, H) / 50)), k = photo ? 0.15 : 0.22, R = 128;
    const I = new Float64Array((W + 1) * (H + 1)), I2 = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let a = 0, a2 = 0;
      for (let x = 0; x < W; x++) { const v = g[y * W + x]; a += v; a2 += v * v; const o = (y + 1) * (W + 1) + x + 1; I[o] = I[o - W - 1] + a; I2[o] = I2[o - W - 1] + a2; } }
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) { const ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
      for (let x = 0; x < W; x++) { const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1), n = (yb - ya) * (xb - xa);
        const A = yb * (W + 1) + xb, Bq = ya * (W + 1) + xb, C = yb * (W + 1) + xa, D = ya * (W + 1) + xa;
        const m = (I[A] - I[Bq] - I[C] + I[D]) / n, v = (I2[A] - I2[Bq] - I2[C] + I2[D]) / n - m * m;
        const t = m * (1 + k * (Math.sqrt(Math.max(0, v)) / R - 1));
        out[y * W + x] = g[y * W + x] > t || m > 245 ? 255 : 0; } }
    return out;
  }
  function toImage(g, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), im = ctx.createImageData(W, H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) { const v = g[j]; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    ctx.putImageData(im, 0, 0); return c;
  }
  // нужен ли «улучшенный» режим: фото/неконтрастный снимок
  function needsEnhance(canvas) {
    const { g } = grayOf(canvas), st = stats(g);
    return !(st.p02 < 70 && st.p98 > 200) || (st.p98 - st.p02) < 150;
  }
  function median3(b, W, H) { // убрать одиночные точки после бинаризации
    const o = new Float32Array(b.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx)); if (b[yy * W + xx] < 128) c++; }
      o[y * W + x] = c >= 5 ? 0 : 255; }
    return o;
  }
  function enhanceVariants(canvas, photo) {
    const { g, W, H } = grayOf(canvas);
    const n = normalize(g, W, H, photo);
    return { gray: toImage(n, W, H), bin: () => { let b = sauvola(n, W, H, photo); if (photo) b = median3(b, W, H); return toImage(b, W, H); } };
  }

  async function recognize(src, crop, onProgress, opt = {}) {
    const img = typeof src === 'string' ? await loadImage(src) : src;
    const canvas = toCanvas(img, crop, opt.photo);
    const w = await getWorker(onProgress);
    let data;
    const enh = opt.enhance === true || (opt.enhance !== false && (opt.photo || needsEnhance(canvas)));
    if (!enh) data = (await w.recognize(canvas)).data;
    else {
      if (onProgress) onProgress('enhance', 0.5);
      const v = enhanceVariants(canvas, !!opt.photo);
      const tries = [];
      let d1 = (await w.recognize(v.gray)).data; tries.push(d1);
      if (d1.confidence < 78 || opt.photo) {
        if (onProgress) onProgress('recognizing text (2)', 0.7);
        tries.push((await w.recognize(v.bin())).data);
        if (opt.photo && Math.max(...tries.map(t => t.confidence)) < 60) tries.push((await w.recognize(canvas)).data);
      }
      const score = t => t.confidence * Math.min(1, ((t.text || '').match(/[А-Яа-яЁё]{3,}/g) || []).length / 6 + 0.4);
      data = tries.sort((a, b) => score(b) - score(a))[0];
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const lines = [];
    (data.lines || []).forEach(l => {
      let t = (l.text || '').replace(/\s+/g, ' ').trim();
      // убрать мусор от кружков с буквами вариантов: «(A)», «© », «О », «В |» в начале строки
      t = t.replace(/^(?:[\(\[\{|]?\s*[A-Za-zА-Яа-яЁё0-9©®@◯○●"'“”]{0,2}\s*[\)\]\}|]+\s+|[A-DА-Г]?\s*[—=–\-|~_]+\s+|[A-DА-Г]\s+(?=[А-ЯЁ]))/, '')
        .replace(/^[|\\/_~]+\s*/, '').replace(/\s+(?:[\[\(]?[\wА-Яа-я]{0,2}[\]\)]|[ШIl|]|Вы здесь)$/, '').trim();
      if ((t.match(/[A-Za-zА-Яа-яЁё0-9]/g) || []).length < 3) return;
      let green = false;
      try { green = greenLeftOf(ctx, canvas.width, canvas.height, l.bbox); } catch (e) {}
      lines.push({ text: t, green, y: (l.bbox.y0 + l.bbox.y1) / 2, x: l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 });
    });
    return { text: lines.map(l => l.text).join('\n'), lines, conf: data.confidence };
  }

  /* Таблица на картинке: найти ячейки по светлым линиям сетки и распознать каждую отдельно */
  function findCells(canvas) {
    const { g, W, H } = grayOf(canvas);
    const light = v => v > 215 || v < 62; // линии сетки: очень светлые или очень тёмные
    const runs = (n, ratio) => { const out = []; let s = -1; for (let i = 0; i <= n; i++) { const on = i < n && ratio(i); if (on && s < 0) s = i; if (!on && s >= 0) { out.push([s, i]); s = -1; } } return out; };
    const between = (seps, n, min) => { const cuts = [0, ...seps.flatMap(r => [r[0], r[1]]), n], out = []; for (let i = 0; i < cuts.length; i += 2) if (cuts[i + 1] - cuts[i] >= min) out.push([cuts[i], cuts[i + 1]]); return out; };
    const hs = runs(H, y => { let c = 0; for (let x = 0; x < W; x++) if (light(g[y * W + x])) c++; return c > W * 0.9; });
    const bands = between(hs, H, 14), cells = [];
    bands.forEach(([y0, y1]) => {
      // фон полосы — медиана; вертикальная линия отличается от фона по всей высоте
      const smp = []; for (let y = y0; y < y1; y += 2) for (let x = 0; x < W; x += 3) smp.push(g[y * W + x]);
      smp.sort((a, b) => a - b); const med = smp[smp.length >> 1];
      const vs = runs(W, x => { let c = 0; for (let y = y0; y < y1; y++) if (Math.abs(g[y * W + x] - med) > 12) c++; return c > (y1 - y0) * 0.9; });
      between(vs, W, 14).forEach(([x0, x1]) => cells.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
    });
    return cells;
  }
  async function recognizeTable(img) {
    const base = document.createElement('canvas');
    base.width = img.naturalWidth || img.width; base.height = img.naturalHeight || img.height;
    base.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
    const cells = findCells(base);
    if (cells.length < 3) return null;
    const w = await getWorker();
    const out = [];
    try {
      await w.setParameters({ tessedit_pageseg_mode: '6' });
      for (const c of cells) {
        const cv = document.createElement('canvas'), k = Math.max(1, Math.min(4, 900 / Math.max(c.w, c.h)));
        cv.width = Math.round(c.w * k) + 40; cv.height = Math.round(c.h * k) + 40;
        const x = cv.getContext('2d', { willReadFrequently: true });
        x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.imageSmoothingQuality = 'high';
        x.drawImage(base, c.x + 2, c.y + 2, Math.max(1, c.w - 4), Math.max(1, c.h - 4), 20, 20, cv.width - 40, cv.height - 40);
        const im = x.getImageData(20, 20, cv.width - 40, cv.height - 40), d = im.data, n = d.length / 4;
        const gv = new Float32Array(n); let sum = 0;
        for (let i = 0; i < n; i++) { gv[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114; sum += gv[i]; }
        const dark = sum / n < 150; if (dark) for (let i = 0; i < n; i++) gv[i] = 255 - gv[i];
        const srt = Float32Array.from(gv).sort(), lo = srt[Math.floor(n * .01)], hi = srt[Math.floor(n * .99)];
        for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, (gv[i] - lo) / (hi - lo + 1e-6) * 255)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; }
        x.putImageData(im, 20, 20);
        const t = ((await w.recognize(cv)).data.text || '').trim();
        if (t) out.push(t);
      }
    } finally { await w.setParameters({ tessedit_pageseg_mode: '3' }).catch(() => {}); }
    return out;
  }
  /* Распознать таблицу/схему: вернуть текст по ячейкам (или абзацам) */
  async function recognizeBlocks(src) {
    const img = typeof src === 'string' ? await loadImage(src) : src;
    try { const t = await recognizeTable(img); if (t && t.length) return t; } catch (e) {}
    const canvas = toCanvas(img, null, false);
    const w = await getWorker();
    const src2 = needsEnhance(canvas) ? enhanceVariants(canvas).gray : canvas;
    const data = (await w.recognize(src2)).data;
    let paras = data.paragraphs || [];
    if (!paras.length && data.blocks) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => paras.push(p)));
    if (!paras.length) return (data.text || '').split(/\n/);
    return paras.map(p => (p.lines || []).map(l => (l.text || '').trim()).filter(Boolean).join('\n') || (p.text || '').trim()).filter(Boolean);
  }

  /* Разметка строк: вопрос / правильный / неправильный / пропустить */
  function splitQA(lines) {
    const out = lines.map(l => ({ ...l, role: 'x', b: 0 }));
    const HEAD = /функциональн.*компетенц|техническ.*компетенц|уровень [авс]|^екэ|итр\s*:?$|^\d\d:\d\d|все страницы|пройдено|вы здесь|^назад|^ответить|^далее/i;
    let start = 0, block = 0;
    while (start < out.length && block < 20) {
      let qs = -1;
      for (let k = start; k < out.length; k++) if (/\?/.test(out[k].text) && !HEAD.test(out[k].text)) { qs = k; break; }
      if (qs < 0 || block > 0) { // без «?» — первая подходящая строка
        for (let k = start; k < out.length; k++) if (!HEAD.test(out[k].text) && (block === 0 ? /:\s*$/.test(out[k].text) && out[k].text.length > 12 : true)) { if (qs < 0 || k < qs) qs = k; break; }
      }
      if (qs < 0 && block === 0) for (let k = start; k < out.length; k++) if (!HEAD.test(out[k].text)) { qs = k; break; }
      if (qs < 0) break;
      block++;
      out[qs].role = 'q'; out[qs].b = block;
      let i = qs + 1;
      while (i < out.length && !out[i].green && out[i].y - out[i - 1].y < out[i - 1].h * 1.9 && !/\?\s*$/.test(out[i - 1].text) && Math.abs(out[i].x - out[qs].x) < out[qs].h * 2) { out[i].role = 'q'; out[i].b = block; i++; }
      const gaps = []; let n = 0, prev = out[i - 1], next = out.length;
      for (; i < out.length; i++) {
        const l = out[i];
        if (HEAD.test(l.text) || Math.abs(l.x - out[qs].x) > out[qs].h * 8) continue;
        if (n >= 2) {
          const g = l.y - prev.y, med = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
          if (g > med * 1.35 || /\?\s*$/.test(l.text)) { next = i; break; }
        }
        if (n >= 1) gaps.push(l.y - prev.y);
        l.role = l.green ? 'a' : 'w'; l.b = block; n++; prev = l;
      }
      if (!n) { out[qs].role = 'x'; block--; }
      start = next;
    }
    return out;
  }

  /* Захват экрана (браузер на ПК или настольная версия) */
  async function captureScreen() {
    if (window.desk && window.desk.beforeCapture) await window.desk.beforeCapture();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      const v = document.createElement('video');
      v.srcObject = stream; v.muted = true; await v.play();
      await new Promise(r => setTimeout(r, 350));
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      return c.toDataURL('image/png');
    } finally {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (window.desk && window.desk.afterCapture) await window.desk.afterCapture();
    }
  }

  window.OCR = { recognize, recognizeBlocks, enhanceVariants, needsEnhance, splitQA, captureScreen, warm: () => getWorker().catch(() => {}) };
})();
