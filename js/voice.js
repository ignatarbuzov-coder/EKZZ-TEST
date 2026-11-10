/* Голосовой ввод (диктовка). Использует распознавание речи браузера (Safari / Chrome). */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, active = null;
  function stop() { if (rec) { try { rec.stop(); } catch (e) {} } }
  function start(o) {
    // o: {onText(text, final), onEnd(), onError(code)}
    if (!SR) { o.onError && o.onError('unsupported'); return false; }
    if (rec) { stop(); return false; }
    rec = new SR();
    rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    active = o;
    rec.onresult = e => {
      let fin = '', mid = '';
      for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else mid += r[0].transcript; }
      o.onText && o.onText((fin + mid).trim(), !mid);
    };
    rec.onerror = e => { o.onError && o.onError(e.error || 'error'); };
    rec.onend = () => { rec = null; active = null; o.onEnd && o.onEnd(); };
    try { rec.start(); } catch (e) { rec = null; o.onError && o.onError('start'); return false; }
    return true;
  }
  const MSG = {
    'not-allowed': 'Нет доступа к микрофону. Разрешите микрофон в настройках браузера.',
    'service-not-allowed': 'Диктовка недоступна в этом режиме. Нажмите на поле и используйте кнопку микрофона на клавиатуре.',
    'network': 'Для распознавания речи браузеру нужен интернет. Без сети используйте микрофон на клавиатуре телефона.',
    'no-speech': 'Речь не распознана, попробуйте ещё раз.',
    'audio-capture': 'Микрофон не найден.',
    'unsupported': 'Браузер не поддерживает диктовку. Нажмите на поле и используйте кнопку микрофона на клавиатуре.'
  };
  window.Voice = { supported: !!SR, start, stop, busy: () => !!rec, message: c => MSG[c] || ('Ошибка распознавания речи: ' + c) };
})();
