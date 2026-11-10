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
  function toCanvas(img, crop) {
    const sx = crop ? crop.x : 0, sy = crop ? crop.y : 0;
    const sw = crop ? crop.w : (img.naturalWidth || img.width), sh = crop ? crop.h : (img.naturalHeight || img.height);
    let k = 1;
    if (Math.max(sw, sh) < 1400) k = 2; else if (Math.max(sw, sh) > 3200) k = 3200 / Math.max(sw, sh);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function isGreen(r, g, b) { return g > 140 && g - b > 55 && g - r > 15 && r > 90 && b < 140; }
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

  async function recognize(src, crop, onProgress) {
    const img = typeof src === 'string' ? await loadImage(src) : src;
    const canvas = toCanvas(img, crop);
    const w = await getWorker(onProgress);
    const { data } = await w.recognize(canvas);
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

  window.OCR = { recognize, splitQA, captureScreen, warm: () => getWorker().catch(() => {}) };
})();
