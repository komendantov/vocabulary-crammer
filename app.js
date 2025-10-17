// Vocabulary Crammer – Vanilla JS SPA

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// App state
const state = {
  all: [], // { a, b }
  session: [], // indices for current session order
  i: 0,
  mode: 'flashcards',
  direction: 'ab',
  answered: 0,
  correct: 0,
  seed: Date.now(),
  datasetId: null,
  langA: 'A',
  langB: 'B',
  rawCsvText: '',
  view: 'upload', // 'upload' | 'modes' | 'study'
  // Settings defaults
  showOnDontKnow: true,
  showDelay: 2000,
  shuffleOrder: true,
  streakRequired: 2,
  // Flashcards queue-based practice
  flashQueue: [], // list of indices to master (in order)
  flashTotal: 0,
  // Batch learning system
  batchSize: 20, // размер порции для изучения
  batchMode: true, // включен ли режим порций
};

// Progress store (per CSV dataset)
const storeKey = 'vocab-crammer:v2';
function loadStore() {
  try { return JSON.parse(localStorage.getItem(storeKey) || '{"datasets":{}}'); }
  catch { return { datasets: {} }; }
}
function saveStore(store) { localStorage.setItem(storeKey, JSON.stringify(store)); }
function getDatasetStore(id) {
  const store = loadStore();
  if (!store.datasets[id]) {
    store.datasets[id] = {
      progress: {},
      stats: { answered: 0, correct: 0 },
      meta: {},
      learned: {},
      streaks: {},
      // Batch learning
      currentBatch: 0, // текущая активная порция (0 = первые 20 слов)
      unlockedBatches: 1, // количество разблокированных порций
    };
  }
  // Backwards compatibility - добавляем поля, если их нет
  if (store.datasets[id].currentBatch === undefined) store.datasets[id].currentBatch = 0;
  if (store.datasets[id].unlockedBatches === undefined) store.datasets[id].unlockedBatches = 1;
  return store;
}
function updateDatasetMeta(id, meta) {
  const store = getDatasetStore(id);
  store.datasets[id].meta = { ...store.datasets[id].meta, ...meta };
  saveStore(store);
}

// Utilities
function shuffleInPlace(arr, seed = Date.now()) {
  // Deterministic-ish shuffle using seed
  let s = seed >>> 0;
  function rnd() {
    // xorshift32
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:()\[\]"'`]/g, '')
    .trim();
}

function parseCSV(text, hasHeader = true) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const out = [];
  if (!lines.length) return { rows: out, langA: 'A', langB: 'B' };
  const first = lines[0];
  const comma = first.indexOf(',');
  let langA = 'A', langB = 'B';
  let start = 0;
  if (hasHeader && comma !== -1) {
    langA = first.slice(0, comma).trim() || 'A';
    langB = first.slice(comma + 1).trim() || 'B';
    start = 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const c = line.indexOf(',');
    if (c === -1) continue;
    const a = line.slice(0, c).trim();
    const b = line.slice(c + 1).trim();
    if (!a || !b) continue;
    out.push({ a, b });
  }
  return { rows: out, langA, langB };
}

function pickSessionIndices(total, size) {
  const idx = Array.from({ length: total }, (_, i) => i);
  if (state.shuffleOrder) shuffleInPlace(idx, state.seed);
  return idx.slice(0, Math.min(size, total));
}

function setStatus(msg) { $('#status').textContent = msg; }
function setStats() {
  const { answered, correct, session, i } = state;
  const total = state.mode === 'flashcards' ? (state.flashTotal || 0) : session.length;
  const left = state.mode === 'flashcards' ? (state.flashQueue ? state.flashQueue.length : 0) : Math.max(total - i, 0);
  const done = total ? (total - left) : 0;
  const rate = answered ? Math.round((correct / answered) * 100) : 0;
  const text = `${done}/${total} • Ответов: ${answered} • Точность: ${rate}% • Осталось: ${left}`;
  const sessBottom = $('#studyStatsBottom'); if (sessBottom) sessBottom.textContent = text;
  const bar = $('#progressBar'); if (bar && total) bar.style.width = `${Math.min(100, Math.max(0, (done/total)*100))}%`;
  const sum = $('#datasetSummary');
  if (sum) {
    const words = state.all.length;
    sum.textContent = words ? `${state.langA} → ${state.langB} • ${words} слов` : '—';
    const segAB = $('#segAB'); const segBA = $('#segBA');
    if (segAB) segAB.textContent = `${state.langA} → ${state.langB}`;
    if (segBA) segBA.textContent = `${state.langB} → ${state.langA}`;
    const tileAB = $('#tileAB'); const tileBA = $('#tileBA');
    if (tileAB) tileAB.textContent = `${state.langA} → ${state.langB}`;
    if (tileBA) tileBA.textContent = `${state.langB} → ${state.langA}`;
  }
}

function ensureDataLoaded() {
  if (!state.all.length) throw new Error('Сначала загрузите CSV файл.');
}

// Rendering
function render() {
  setStats();
  const root = $('#studyApp');
  root.innerHTML = '';
  if (state.view !== 'study' || !state.session.length) {
    return;
  }
  let idx = state.session[Math.min(state.i, state.session.length - 1)];
  if (state.mode === 'flashcards') {
    if (!state.flashQueue || state.flashQueue.length === 0) {
      // finished mastery
      const finishedHtml = `<div class="card enter">
        <div class="term">Все карточки выучены 🎉</div>
        <div class="answer">Точность: ${state.answered ? Math.round((state.correct / state.answered) * 100) : 0}%</div>
        <div class="actions"><button id="restartBtn" class="primary">Новая сессия</button><button id="backBtn">К режимам</button></div>
      </div>`;
      root.innerHTML = finishedHtml;
      $('#restartBtn').onclick = () => startSession();
      $('#backBtn').onclick = () => exitStudy();
      return;
    }
    idx = state.flashQueue[0];
  }
  const pair = state.all[idx];
  const ask = state.direction === 'ab' ? pair.a : pair.b;
  const ans = state.direction === 'ab' ? pair.b : pair.a;

  if (state.mode === 'flashcards') renderFlashcards(ask, ans, idx);
  else if (state.mode === 'choice') renderChoice(ask, ans, idx);
  else if (state.mode === 'typing') renderTyping(ask, ans, idx);
  else if (state.mode === 'listening') renderListening(ask, ans, idx);
}

function nextCard(correct) {
  // If session already finished, ignore further inputs
  if (state.mode === 'flashcards') {
    if (!state.flashQueue || state.flashQueue.length === 0) { setStats(); render(); return; }
    state.answered += 1;
    if (correct) state.correct += 1;
    const current = state.flashQueue.shift();
    const storeRef = getDatasetStore(state.datasetId);
    const ds = storeRef.datasets[state.datasetId];
    ds.streaks = ds.streaks || {};
    const key = keyFor(current);
    if (correct) {
      ds.streaks[key] = (ds.streaks[key] || 0) + 1;
    } else {
      ds.streaks[key] = 0;
    }
    // learned if streak >= required
    if (correct && (ds.streaks[key] || 0) >= (state.streakRequired || 1)) {
      ds.learned = ds.learned || {};
      ds.learned[key] = true;
      saveStore(storeRef);
      // Проверяем, можно ли разблокировать следующую порцию
      const unlocked = checkAndUnlockNextBatch();
      if (unlocked) {
        // Показываем уведомление о разблокировке
        showBatchUnlockNotification();
      }
    } else {
      // requeue for further practice
      state.flashQueue.push(current);
      saveStore(storeRef);
    }
    render();
  } else {
    if (state.i >= state.session.length) { setStats(); return; }
    state.answered += 1;
    if (correct) state.correct += 1;
    state.i += 1;
    if (state.i >= state.session.length) {
      const root = $('#studyApp');
      root.innerHTML = `<div class="card">
        <div class="term">Сессия завершена 🎉</div>
        <div class="answer">Точность: ${state.answered ? Math.round((state.correct / state.answered) * 100) : 0}%</div>
        <div class="actions">
          <button id="restartBtn" class="primary">Повторить</button>
          <button id="newSessionBtn">Новая сессия</button>
          <button id="backHomeBtn">К режимам</button>
        </div>
      </div>`;
      $('#restartBtn').onclick = () => startSession();
      $('#newSessionBtn').onclick = () => { state.seed = Date.now(); startSession(); };
      $('#backHomeBtn').onclick = () => exitStudy();
      setStats();
      return;
    }
    render();
  }
}

function renderFlashcards(question, answer, idxKey) {
  const root = $('#studyApp');
  const knownKey = keyFor(idxKey);
  root.innerHTML = `<div class="flip-wrap">
    <div class="flip-card" id="flipCard">
      <div class="flip-inner">
        <div class="flip-face flip-front">
          <div class="term">${escapeHtml(question)}</div>
        </div>
        <div class="flip-face flip-back">
          <div class="term">${escapeHtml(answer)}</div>
        </div>
      </div>
    </div>
  </div>
  <div class="actions">
    <button id="knowBtn" class="primary">Знаю</button>
    <button id="dontKnowBtn">Не знаю</button>
    <button id="nextBtn" style="display:none">Далее</button>
  </div>`;
  const card = $('#flipCard');
  // entry animation
  if (card) card.classList.add('enter');
  const knowBtn = $('#knowBtn');
  const dontBtn = $('#dontKnowBtn');
  const nextBtn = $('#nextBtn');

  const setFlipped = (f) => {
    if (!card) return;
    card.classList.toggle('flipped', !!f);
  };

  // Flip is handled by touch tap (via addSwipe) and Space key on desktop.
  knowBtn.onclick = () => { markProgress(knownKey, true); haptic(true); nextCard(true); };

  let waiting = false;
  let timer = null;
  const revealAndWait = () => {
    if (waiting) return;
    waiting = true;
    setFlipped(true);
    // disable main buttons while waiting
    knowBtn.disabled = true; dontBtn.disabled = true;
    // show next button for manual advance
    nextBtn.style.display = '';
    const goNext = () => { if (timer) { clearTimeout(timer); timer = null; } nextCard(false); };
    nextBtn.onclick = goNext;
    timer = setTimeout(goNext, Number(state.showDelay || 2200));
  };

  dontBtn.onclick = () => {
    markProgress(knownKey, false);
    haptic(false);
    if (state.showOnDontKnow) revealAndWait(); else nextCard(false);
  };

  // Keyboard shortcuts
  root.onkeydown = (e) => {
    if (e.code === 'Space') { e.preventDefault(); setFlipped(!card.classList.contains('flipped')); }
    if (e.key === '1') $('#knowBtn').click();
    if (e.key === '2') $('#dontKnowBtn').click();
  };
  // Touch gestures (swipe left/right) — attach to card so it's removed on rerender
  addSwipe(card,
    () => { // left
      markProgress(knownKey, false); state.showOnDontKnow ? revealAndWait() : nextCard(false);
    },
    () => { // right
      markProgress(knownKey, true); nextCard(true);
    },
    () => { // tap
      setFlipped(!card.classList.contains('flipped'));
    }
  );
  // Desktop/pen pointer click to flip (ignore touch to avoid double-trigger)
  card.addEventListener('pointerup', (e) => {
    if (waiting) return;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      setFlipped(!card.classList.contains('flipped'));
    }
  });
  root.tabIndex = 0; // focusable
  root.focus();
}

function renderChoice(question, answer, idxKey) {
  const root = $('#studyApp');
  const opts = buildOptions(answer);
  root.innerHTML = `<div class="card enter">
    <div class="term">${escapeHtml(question)}</div>
    <div class="hint">Выберите перевод</div>
    <div class="options" id="options"></div>
    <div class="result" id="result"></div>
    <div class="actions" id="choiceActions" style="display:none"><button id="nextBtn" class="primary">Далее</button></div>
  </div>`;
  const cont = $('#options');
  const nextBtn = $('#nextBtn');
  const resultEl = $('#result');
  const scheduleNext = (ok) => {
    if (ok) {
      haptic(true);
      setTimeout(() => nextCard(true), 600);
    } else {
      haptic(false);
      $('#choiceActions').style.display = '';
      nextBtn.onclick = () => nextCard(false);
      if (state.showOnDontKnow) setTimeout(() => nextCard(false), Number(state.showDelay || 2000));
    }
  };

  opts.forEach((o, idx) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.textContent = o;
    btn.onclick = () => {
      $$('.option').forEach(b => b.disabled = true);
      const ok = normalize(o) === normalize(answer);
      btn.classList.add(ok ? 'correct' : 'wrong');
      resultEl.textContent = ok ? 'Верно!' : `Неверно. Ответ: ${answer}`;
      resultEl.className = 'result ' + (ok ? 'ok' : 'bad');
      markProgress(keyFor(idxKey), ok);
      scheduleNext(ok);
    };
    cont.appendChild(btn);
    // Hint: numeric shortcuts
    btn.dataset.shortcut = String(idx + 1);
  });
  root.onkeydown = (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= opts.length) cont.children[n - 1].click();
  };
  root.tabIndex = 0; root.focus();
}

function renderTyping(question, answer, idxKey) {
  const root = $('#studyApp');
  root.innerHTML = `<div class="card">
    <div class="term">${escapeHtml(question)}</div>
    <div class="hint">Введите перевод и нажмите Enter</div>
    <input id="typeInput" class="type" placeholder="Ваш ответ" autocomplete="off" />
    <div class="result" id="result"></div>
    <div class="actions">
      <button id="checkBtn" class="primary" type="button">Проверить</button>
      <button id="skipBtn" type="button">Пропустить</button>
      <button id="nextBtn" type="button" style="display:none">Далее</button>
    </div>
  </div>`;
  if (root.firstElementChild) root.firstElementChild.classList.add('enter');
  const input = $('#typeInput');
  const result = $('#result');
  const checkBtn = $('#checkBtn');
  const skipBtn = $('#skipBtn');
  const nextBtn = $('#nextBtn');

  const showNextAndLock = () => {
    input.disabled = true;
    checkBtn.disabled = true;
    skipBtn.disabled = true;
    nextBtn.style.display = '';
    nextBtn.focus();
  };

  const check = () => {
    const ok = normalize(input.value) === normalize(answer);
    result.textContent = ok ? 'Верно!' : `Неверно. Ответ: ${answer}`;
    result.className = 'result ' + (ok ? 'ok' : 'bad');
    markProgress(keyFor(idxKey), ok);
    if (ok) {
      haptic(true);
      setTimeout(() => nextCard(true), 500);
    } else {
      haptic(false);
      showNextAndLock();
      nextBtn.onclick = () => nextCard(false);
    }
  };
  checkBtn.onclick = check;

  skipBtn.onclick = () => {
    result.textContent = `Ответ: ${answer}`;
    result.className = 'result bad';
    markProgress(keyFor(idxKey), false);
    showNextAndLock();
    nextBtn.onclick = () => nextCard(false);
  };

  // Ensure Enter triggers "Проверить" (or "Далее", если показана)
  const handleEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nextBtn.style.display !== 'none') nextBtn.click();
      else check();
    }
  };
  input.addEventListener('keydown', handleEnter);
  root.addEventListener('keydown', handleEnter, true);
  input.focus();
}




// Basic swipe/tap helper for touch devices
function addSwipe(el, onLeft, onRight, onTap) {
  let x0 = null, y0 = null, t0 = 0, startedInteractive = false;
  const thresh = 50; // px
  const vertLimit = 60; // px
  const timeMax = 600; // ms

  el.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    const target = e.target;
    startedInteractive = !!(target && target.closest('button, a, input, select, textarea, .actions'));
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    if (startedInteractive) { x0 = y0 = null; startedInteractive = false; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    const dt = Date.now() - t0;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const isTap = ax < 6 && ay < 6 && dt < 300;
    if (isTap) {
      // Ignore taps on interactive elements (buttons/links/inputs) to avoid
      // revealing answer when user presses action buttons.
      const endTarget = e.target;
      const interactive = endTarget && (endTarget.closest('button, a, input, select, textarea, .actions'));
      if (!interactive) { onTap && onTap(); }
      x0 = y0 = null; return;
    }
    if (dt <= timeMax && ay < vertLimit && ax > thresh) {
      if (dx > 0) onRight && onRight(); else onLeft && onLeft();
    }
    x0 = y0 = null;
  }, { passive: true });
}

function buildOptions(correctAns) {
  // pick 3 random wrong answers + correct, then shuffle
  const pool = state.all.map(p => state.direction === 'ab' ? p.b : p.a);
  const wrong = pool.filter(x => normalize(x) !== normalize(correctAns));
  shuffleInPlace(wrong, state.seed + state.i);
  const opts = [correctAns, ...wrong.slice(0, 3)];
  return shuffleInPlace(opts, state.seed + 1337 + state.i);
}

function keyFor(idx) {
  const p = state.all[idx];
  return p.a + '|' + p.b;
}

function markProgress(key, ok) {
  if (!state.datasetId) return;
  const store = getDatasetStore(state.datasetId);
  const ds = store.datasets[state.datasetId];
  const rec = ds.progress[key] || { right: 0, wrong: 0 };
  if (ok) rec.right += 1; else rec.wrong += 1;
  ds.progress[key] = rec;
  ds.stats.answered += 1;
  if (ok) ds.stats.correct += 1;
  saveStore(store);
}

function haptic(ok) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      if (ok === true) navigator.vibrate(20);
      else if (ok === false) navigator.vibrate([10, 40, 10]);
    }
  } catch {}
}

// Session control
function startSession() {
  try { ensureDataLoaded(); } catch (e) { setStatus(e.message); return; }
  // Read from tiles if present; fallback to previous state
  const modeTileSel = document.querySelector('#modeTiles .tile.selected')?.dataset.mode;
  const dirTileSel = document.querySelector('#dirTiles .tile.selected')?.dataset.dir;
  const modeVal = modeTileSel || document.querySelector('input[name="modeSeg"]:checked')?.value || state.mode;
  const dirVal = dirTileSel || document.querySelector('input[name="dirSeg"]:checked')?.value || state.direction;
  
  // Логирование статистики использования режимов
  logModeUsage(modeVal);
  state.mode = modeVal; state.direction = dirVal;
  // Pull latest settings from UI before session starts
  const sShowEl = $('#showOnDontKnow');
  if (sShowEl) state.showOnDontKnow = !!sShowEl.checked;
  const sDelayEl = $('#showDelay');
  if (sDelayEl) {
    const v = Number(sDelayEl.value);
    if (!isNaN(v)) state.showDelay = Math.max(300, Math.min(5000, v));
  }
  // Build session indices, possibly filtering learned for flashcards or if 'only unlearned' is checked
  const onlyUnl = document.getElementById('onlyUnlearned')?.checked;
  const includeLearned = document.getElementById('includeLearned')?.checked;

  // Получаем доступные индексы с учётом системы порций
  const availableIndices = getAvailableIndices();
  let pool = availableIndices;

  // Фильтруем выученные, если нужно
  if (((onlyUnl || state.mode === 'flashcards') && !includeLearned) && state.datasetId) {
    const ds = getDatasetStore(state.datasetId).datasets[state.datasetId];
    pool = availableIndices.filter(i => !ds.learned || !ds.learned[keyFor(i)]);
    // Fallback: if ничего не осталось (все выучены), используем все доступные
    if (pool.length === 0) {
      const onlyUnlEl = document.getElementById('onlyUnlearned');
      if (onlyUnlEl) onlyUnlEl.checked = false;
      const inclEl = document.getElementById('includeLearned');
      if (inclEl) inclEl.checked = true;
      pool = availableIndices;
    }
  }

  // Перемешиваем и берём все доступные слова из pool
  if (state.shuffleOrder) shuffleInPlace(pool, state.seed);
  const indices = pool; // Используем все доступные слова
  state.session = indices;
  state.i = 0;
  state.answered = 0;
  state.correct = 0;
  if (state.mode === 'flashcards') {
    state.flashQueue = [...state.session];
    state.flashTotal = state.flashQueue.length;
  } else {
    state.flashQueue = [];
    state.flashTotal = 0;
  }
  enterStudy();
  render();
}

// File handling
async function loadFile(file) {
  const text = await file.text();
  state.rawCsvText = text;
  handleCsvLoaded(text);
}

async function loadSample() {
  // Try to fetch local sample file if served from http(s)
  try {
    const res = await fetch('english_b1_vocabulary.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    state.rawCsvText = text;
    handleCsvLoaded(text);
  } catch (e) {
    setStatus('Не удалось загрузить пример. Откройте файл локально через «Загрузить CSV».');
  }
}

// Helpers
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function djb2Hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function refreshDirectionLabels() {
  const a = ($('#langA')?.value || state.langA || 'A').trim();
  const b = ($('#langB')?.value || state.langB || 'B').trim();
  state.langA = a; state.langB = b;
  const dirAB = $('#dirAB'); const dirBA = $('#dirBA');
  if (dirAB) dirAB.textContent = `${a} → ${b}`;
  if (dirBA) dirBA.textContent = `${b} → ${a}`;
  setStats();
}

function handleCsvLoaded(text) {
  const hasHeader = $('#hasHeader')?.checked ?? true;
  const parsed = parseCSV(text, hasHeader);
  state.all = parsed.rows;
  state.langA = ($('#langA')?.value?.trim()) || parsed.langA || 'A';
  state.langB = ($('#langB')?.value?.trim()) || parsed.langB || 'B';
  if ($('#langA')) $('#langA').value = state.langA;
  if ($('#langB')) $('#langB').value = state.langB;
  const id = djb2Hash(text);
  state.datasetId = id;
  updateDatasetMeta(id, { langA: state.langA, langB: state.langB, total: state.all.length });
  refreshDirectionLabels();
  if (!state.all.length) { setStatus('Не удалось разобрать CSV. Проверьте формат.'); return; }
  setStatus(`Загружено слов: ${state.all.length}. ${state.langA} / ${state.langB}.`);
  setStats();
  // enable proceed button and navigate to modes
  const proceed = document.getElementById('toModes');
  if (proceed) { proceed.disabled = false; }
  showView('modes');
}

// Wire up UI
function init() {
  $('#csvFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadFile(file);
  });
  const toModes = document.getElementById('toModes');
  if (toModes) toModes.addEventListener('click', () => showView('modes'));
  $('#loadSample').addEventListener('click', loadSample);
  $('#resetProgress').addEventListener('click', () => {
    if (!state.datasetId) { setStatus('Нет загруженного набора для сброса.'); return; }
    const store = loadStore();
    if (store.datasets && store.datasets[state.datasetId]) {
      delete store.datasets[state.datasetId];
      saveStore(store);
      setStatus('Прогресс для текущего CSV сброшен.');
    } else {
      setStatus('Для текущего CSV прогресс не найден.');
    }
    setStats();
  });
  const hasHeaderEl = $('#hasHeader');
  if (hasHeaderEl) hasHeaderEl.addEventListener('change', () => { if (state.rawCsvText) handleCsvLoaded(state.rawCsvText); });
  const la = $('#langA'); const lb = $('#langB');
  if (la) la.addEventListener('input', refreshDirectionLabels);
  if (lb) lb.addEventListener('input', refreshDirectionLabels);
  refreshDirectionLabels();
  // Navigation (tabs + top action)
  // Modes screen controls
  const backUpload = document.getElementById('backUpload');
  if (backUpload) backUpload.addEventListener('click', () => showView('upload'));
  const startStudy = document.getElementById('startStudy');
  if (startStudy) startStudy.addEventListener('click', startSession);
  const onlyUnlearned = document.getElementById('onlyUnlearned');
  const includeLearned = document.getElementById('includeLearned');
  if (includeLearned) includeLearned.addEventListener('change', () => {
    if (includeLearned.checked && onlyUnlearned) onlyUnlearned.checked = false;
  });
  if (onlyUnlearned) onlyUnlearned.addEventListener('change', () => {
    if (onlyUnlearned.checked && includeLearned) includeLearned.checked = false;
  });
  // Mode tiles
  const modeTiles = document.getElementById('modeTiles');
  if (modeTiles) modeTiles.addEventListener('click', (e) => {
    const btn = e.target.closest('.tile'); if (!btn) return;
    if (btn.dataset.mode) { state.mode = btn.dataset.mode; [...modeTiles.children].forEach(c=>c.classList.remove('selected')); btn.classList.add('selected'); }
  });
  const dirTiles = document.getElementById('dirTiles');
  if (dirTiles) dirTiles.addEventListener('click', (e) => {
    const btn = e.target.closest('.tile'); if (!btn) return;
    if (btn.dataset.dir) { state.direction = btn.dataset.dir; [...dirTiles.children].forEach(c=>c.classList.remove('selected')); btn.classList.add('selected'); }
  });
  // Study back
  const backModes = document.getElementById('backModes');
  if (backModes) backModes.addEventListener('click', exitStudy);

  // Batch learning controls
  const toggleBatchMode = document.getElementById('toggleBatchMode');
  if (toggleBatchMode) {
    toggleBatchMode.addEventListener('click', () => {
      state.batchMode = !state.batchMode;
      toggleBatchMode.textContent = state.batchMode ? 'Отключить порции' : 'Включить порции';
      updateBatchProgressUI();
    });
  }
  const batchSizeBtns = document.querySelectorAll('.batch-size-btn');
  batchSizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.batchSize = Number(btn.dataset.size);
      updateBatchProgressUI();
    });
  });

  // Settings sheet
  const openSettings = document.getElementById('openSettings');
  const openSettings2 = document.getElementById('openSettings2');
  const settingsClose = document.getElementById('settingsClose');
  const sb = document.getElementById('settingsBackdrop');
  if (openSettings) openSettings.addEventListener('click', openSettingsSheet);
  if (openSettings2) openSettings2.addEventListener('click', openSettingsSheet);
  if (settingsClose) settingsClose.addEventListener('click', closeSettingsSheet);
  if (sb) sb.addEventListener('click', closeSettingsSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettingsSheet(); });
  // Settings UI (persist to localStorage)
  const sShow = $('#showOnDontKnow');
  const sDelay = $('#showDelay');
  const sShuffle = $('#shuffleOrder');
  const sStreak = $('#streakToLearn');
  const sSpeechLang = $('#speechLang');
  // Theme
  const themeSeg = document.getElementById('themeSeg');
  const savedTheme = localStorage.getItem('vc-theme') || 'pastel';
  document.documentElement.setAttribute('data-theme', savedTheme);
  if (themeSeg) {
    const opt = themeSeg.querySelector(`input[value="${savedTheme}"]`); if (opt) opt.checked = true;
    themeSeg.addEventListener('change', (e) => {
      const v = themeSeg.querySelector('input[name="theme"]:checked')?.value || 'pastel';
      document.documentElement.setAttribute('data-theme', v);
      localStorage.setItem('vc-theme', v);
    });
  }
  const saved = loadSettings();
  if (saved) {
    if (typeof saved.showOnDontKnow === 'boolean') state.showOnDontKnow = saved.showOnDontKnow;
    if (typeof saved.showDelay === 'number') state.showDelay = saved.showDelay;
    if (typeof saved.shuffleOrder === 'boolean') state.shuffleOrder = saved.shuffleOrder;
    if (typeof saved.streakRequired === 'number') state.streakRequired = Math.max(1, saved.streakRequired);
    if (typeof saved.speechLang === 'string') state.speechLang = saved.speechLang;
  }
  if (sShow) { sShow.checked = !!state.showOnDontKnow; sShow.addEventListener('change', () => { state.showOnDontKnow = sShow.checked; saveSettings(); }); }
  if (sDelay) { sDelay.value = String(state.showDelay); sDelay.addEventListener('input', () => { const v = Number(sDelay.value); if (!isNaN(v)) { state.showDelay = Math.max(300, Math.min(5000, v)); saveSettings(); } }); }
  if (sShuffle) { sShuffle.checked = !!state.shuffleOrder; sShuffle.addEventListener('change', () => { state.shuffleOrder = sShuffle.checked; saveSettings(); }); }
  if (sStreak) { sStreak.value = String(state.streakRequired || 1); sStreak.addEventListener('input', () => { const v = Number(sStreak.value); if (!isNaN(v)) { state.streakRequired = Math.max(1, Math.min(10, v)); saveSettings(); } }); }
  if (sSpeechLang) { sSpeechLang.value = state.speechLang || 'auto'; sSpeechLang.addEventListener('change', () => { state.speechLang = sSpeechLang.value; saveSettings(); }); }
}

document.addEventListener('DOMContentLoaded', init);

function enterStudy() {
  showView('study');
  const modeName = state.mode === 'flashcards' ? 'Флип‑карточки' : state.mode === 'choice' ? 'Выбор ответа' : 'Ввод ответа';
  const dirText = state.direction === 'ab' ? `${state.langA} → ${state.langB}` : `${state.langB} → ${state.langA}`;
  const sm = $('#studyMode'); if (sm) sm.textContent = modeName;
  const sd = $('#studyDir'); if (sd) sd.textContent = dirText;
  setStats();
}

function exitStudy() {
  state.session = [];
  state.i = 0; state.answered = 0; state.correct = 0;
  showView('modes');
  setStatus('Готово. Можно запустить новую сессию.');
  setStats();
  render();
}

function showView(name) {
  const prev = state.view;
  if (prev === name) return;
  const oldEl = document.getElementById('view-' + prev);
  const newEl = document.getElementById('view-' + name);
  state.view = name;
  if (!newEl) return;
  // Prepare new view
  newEl.style.display = 'block';
  requestAnimationFrame(() => {
    newEl.classList.add('active');
  });
  // Animate out old
  if (oldEl && oldEl !== newEl) {
    oldEl.classList.remove('active');
    setTimeout(() => { oldEl.style.display = 'none'; }, 260);
  }
  if (name === 'modes') {
    setTimeout(() => {
      updateModeRecommendations();
      updateBatchProgressUI();
    }, 100);
  }
}

function getRemainingUnlearnedCount() {
  let remaining = state.all.length;
  if (state.datasetId) {
    const ds = getDatasetStore(state.datasetId).datasets[state.datasetId];
    const learned = ds && ds.learned ? new Set(Object.keys(ds.learned)) : new Set();
    remaining = state.all.filter((_, i) => !learned.has(keyFor(i))).length;
  }
  return remaining;
}

// ========== Batch Learning System ==========

// Обновить UI прогресса порций
function updateBatchProgressUI() {
  const batchProgress = document.getElementById('batchProgress');
  if (!batchProgress) return;

  // Показываем блок, если есть данные (чтобы кнопка переключения была видна)
  if (!state.all.length) {
    batchProgress.style.display = 'none';
    return;
  }

  batchProgress.style.display = 'block';

  // Если режим порций выключен, скрываем детали, но оставляем кнопку
  const batchCurrent = document.getElementById('batchCurrent');
  const batchUnlocked = document.getElementById('batchUnlocked');
  const batchLocked = document.getElementById('batchLocked');
  const batchSizeSelector = document.querySelector('.batch-size-selector');

  if (!state.batchMode) {
    if (batchCurrent) batchCurrent.style.display = 'none';
    if (batchUnlocked) batchUnlocked.style.display = 'none';
    if (batchLocked) batchLocked.style.display = 'none';
    if (batchSizeSelector) batchSizeSelector.style.display = 'none';
    return;
  }

  // Режим порций включен - показываем все детали
  if (batchCurrent) batchCurrent.style.display = 'block';
  if (batchSizeSelector) batchSizeSelector.style.display = 'block';

  const stats = getCurrentBatchStats();
  const start = stats.current * state.batchSize + 1;
  const end = Math.min((stats.current + 1) * state.batchSize, state.all.length);

  // Обновляем диапазон текущей порции
  const batchRange = document.getElementById('batchRange');
  if (batchRange) batchRange.textContent = `${start}-${end}`;

  // Обновляем прогресс-бар
  const batchBar = document.getElementById('batchBar');
  const batchStats = document.getElementById('batchStats');
  if (batchBar && batchStats) {
    const progress = stats.total > 0 ? (stats.learned / stats.total) * 100 : 0;
    batchBar.style.width = `${progress}%`;
    batchStats.textContent = `${stats.learned}/${stats.total}`;
  }

  // Показываем информацию о разблокированных порциях
  const batchUnlocked = document.getElementById('batchUnlocked');
  const unlockedCount = document.getElementById('unlockedCount');
  if (batchUnlocked && unlockedCount && stats.unlocked > 1) {
    batchUnlocked.style.display = 'block';
    unlockedCount.textContent = stats.unlocked;
  } else if (batchUnlocked) {
    batchUnlocked.style.display = 'none';
  }

  // Показываем информацию о следующей порции
  const batchLocked = document.getElementById('batchLocked');
  const nextBatchRange = document.getElementById('nextBatchRange');
  if (batchLocked && nextBatchRange && stats.unlocked < stats.totalBatches) {
    batchLocked.style.display = 'block';
    const nextStart = stats.unlocked * state.batchSize + 1;
    const nextEnd = Math.min((stats.unlocked + 1) * state.batchSize, state.all.length);
    nextBatchRange.textContent = `${nextStart}-${nextEnd}`;
  } else if (batchLocked) {
    batchLocked.style.display = 'none';
  }

  // Обновляем выбранный размер порции
  const sizeButtons = document.querySelectorAll('.batch-size-btn');
  sizeButtons.forEach(btn => {
    btn.classList.toggle('selected', Number(btn.dataset.size) === state.batchSize);
  });
}

// Получить доступные индексы с учётом режима порций
function getAvailableIndices() {
  if (!state.batchMode || !state.datasetId) {
    return Array.from({ length: state.all.length }, (_, i) => i);
  }

  const store = getDatasetStore(state.datasetId);
  const ds = store.datasets[state.datasetId];
  const unlockedBatches = ds.unlockedBatches || 1;
  const maxIndex = Math.min(unlockedBatches * state.batchSize, state.all.length);

  return Array.from({ length: maxIndex }, (_, i) => i);
}

// Получить индексы текущей порции
function getCurrentBatchIndices() {
  if (!state.datasetId) return [];

  const store = getDatasetStore(state.datasetId);
  const ds = store.datasets[state.datasetId];
  const currentBatch = ds.currentBatch || 0;
  const start = currentBatch * state.batchSize;
  const end = Math.min(start + state.batchSize, state.all.length);

  return Array.from({ length: end - start }, (_, i) => start + i);
}

// Получить статистику по текущей порции
function getCurrentBatchStats() {
  if (!state.datasetId || !state.batchMode) {
    return { total: state.all.length, learned: 0, current: 0, unlocked: 1 };
  }

  const store = getDatasetStore(state.datasetId);
  const ds = store.datasets[state.datasetId];
  const currentBatch = ds.currentBatch || 0;
  const unlockedBatches = ds.unlockedBatches || 1;
  const batchIndices = getCurrentBatchIndices();

  const learned = new Set(Object.keys(ds.learned || {}));
  const learnedInBatch = batchIndices.filter(i => learned.has(keyFor(i))).length;

  return {
    total: batchIndices.length,
    learned: learnedInBatch,
    current: currentBatch,
    unlocked: unlockedBatches,
    totalBatches: Math.ceil(state.all.length / state.batchSize),
  };
}

// Проверить и разблокировать следующую порцию
function checkAndUnlockNextBatch() {
  if (!state.datasetId || !state.batchMode) return false;

  const store = getDatasetStore(state.datasetId);
  const ds = store.datasets[state.datasetId];
  const stats = getCurrentBatchStats();

  // Если текущая порция выучена на 80%+ и есть ещё порции
  const progress = stats.total > 0 ? stats.learned / stats.total : 0;
  const totalBatches = Math.ceil(state.all.length / state.batchSize);

  if (progress >= 0.8 && ds.unlockedBatches < totalBatches) {
    ds.unlockedBatches += 1;
    saveStore(store);
    return true; // новая порция разблокирована!
  }

  return false;
}

// Показать уведомление о разблокировке новой порции
function showBatchUnlockNotification() {
  if (!state.batchMode) return;

  const stats = getCurrentBatchStats();
  const nextStart = (stats.unlocked - 1) * state.batchSize + 1;
  const nextEnd = Math.min(stats.unlocked * state.batchSize, state.all.length);

  // Создаём временное уведомление
  const notification = document.createElement('div');
  notification.className = 'batch-unlock-notification';
  notification.innerHTML = `
    <div class="notification-icon">🎉</div>
    <div class="notification-content">
      <div class="notification-title">Новая порция разблокирована!</div>
      <div class="notification-text">Теперь доступны слова ${nextStart}-${nextEnd}</div>
    </div>
  `;

  document.body.appendChild(notification);

  // Анимация появления
  setTimeout(() => notification.classList.add('show'), 10);

  // Автоматически убираем через 4 секунды
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 4000);

  // Обновляем UI прогресса
  setTimeout(() => updateBatchProgressUI(), 100);
}

// Settings sheet helpers
function openSettingsSheet() {
  const bd = document.getElementById('settingsBackdrop');
  const sh = document.getElementById('settingsSheet');
  if (bd) bd.classList.add('backdrop-show'), bd.classList.remove('hidden');
  if (sh) sh.classList.add('show'), sh.classList.remove('hidden');
}
function closeSettingsSheet() {
  const bd = document.getElementById('settingsBackdrop');
  const sh = document.getElementById('settingsSheet');
  if (bd) bd.classList.remove('backdrop-show'), setTimeout(() => bd.classList.add('hidden'), 250);
  if (sh) sh.classList.remove('show'), setTimeout(() => sh.classList.add('hidden'), 280);
}

// Settings persistence
const settingsKey = 'vocab-crammer:settings';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(settingsKey) || '{}'); } catch { return {}; }
}
function saveSettings() {
  const data = { 
    showOnDontKnow: !!state.showOnDontKnow, 
    showDelay: Number(state.showDelay || 2200), 
    shuffleOrder: !!state.shuffleOrder, 
    streakRequired: Number(state.streakRequired || 1),
    speechLang: state.speechLang || 'auto'
  };
  localStorage.setItem(settingsKey, JSON.stringify(data));
}

// Новые режимы обучения

// Режим аудирования с реальным синтезом речи
function renderListening(question, answer, idxKey) {
  const root = $('#studyApp');
  
  // Инициализируем подрежим, если не установлен
  if (!state.listeningSubmode) {
    state.listeningSubmode = 'word'; // 'word' или 'translation'
  }

  root.innerHTML = `<div class="card enter">
    <div class="listening-container">
      <div class="audio-visual" id="audioVisual">🎧</div>
      
      <!-- Переключатель подрежимов -->
      <div class="listening-mode-toggle">
        <button class="mode-toggle-btn ${state.listeningSubmode === 'word' ? 'active' : ''}" data-submode="word">
          📝 Ввод слова
        </button>
        <button class="mode-toggle-btn ${state.listeningSubmode === 'translation' ? 'active' : ''}" data-submode="translation">
          🔄 Ввод перевода
        </button>
      </div>

      <div id="listeningContent">
        <!-- Контент подрежима будет вставлен здесь -->
      </div>

      <div class="audio-controls">
        <button id="playAudio" class="primary audio-btn">🔊 Воспроизвести</button>
        <select id="voiceSelect" class="voice-selector">
          <option value="">Выберите голос...</option>
        </select>
      </div>
      
      <div class="listening-actions" style="display:none">
        <button id="revealBtn" class="ghost">👁 Показать</button>
        <button id="slowPlayBtn" class="ghost">🐌 Медленно</button>
      </div>
      
      <div class="result" id="result"></div>
    </div>
  </div>`;

  // Рендерим содержимое в зависимости от подрежима
  renderListeningSubmode(question, answer, idxKey);

  // Сразу устанавливаем обработчики для текущего подрежима
  setupListeningHandlers(question, answer, idxKey);

  // Обработчики переключения подрежимов
  const toggleBtns = document.querySelectorAll('.mode-toggle-btn');
  toggleBtns.forEach(btn => {
    btn.onclick = () => {
      const newSubmode = btn.dataset.submode;
      if (newSubmode !== state.listeningSubmode) {
        state.listeningSubmode = newSubmode;
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderListeningSubmode(question, answer, idxKey);
        setupListeningHandlers(question, answer, idxKey);
      }
    };
  });

  // Инициализируем аудио функциональность
  initListeningAudio(question, answer, idxKey);
}

// Рендеринг контента для подрежимов аудирования
function renderListeningSubmode(question, answer, idxKey) {
  const content = document.getElementById('listeningContent');
  if (!content) return;

  if (state.listeningSubmode === 'word') {
    // Подрежим: слушаем слово, вводим это же слово
    content.innerHTML = `
      <div class="term" id="listeningTerm" style="filter: blur(5px);">${escapeHtml(question)}</div>
      <div class="hint">Слушайте произношение и введите услышанное слово</div>
      <input id="listeningInput" class="type" placeholder="Введите услышанное слово" autocomplete="off" style="display:none" />
      <div class="actions" id="listeningMainActions" style="display:none">
        <button id="checkListeningBtn" class="primary">Проверить</button>
        <button id="knowBtn">Знаю без ввода</button>
        <button id="dontKnowBtn">Не знаю</button>
      </div>
    `;
  } else {
    // Подрежим: слушаем слово, вводим перевод
    content.innerHTML = `
      <div class="term">🔊 Слушайте и переводите</div>
      <div class="hint">Услышьте слово и введите его перевод</div>
      <div class="listening-word" id="listeningWord" style="display:none; margin: 12px 0; padding: 12px; background: var(--panel); border-radius: 12px; border: 1px dashed var(--border);">
        <span style="color: var(--muted); font-size: 14px;">Произнесено:</span>
        <div style="font-weight: 600; margin-top: 4px;">${escapeHtml(question)}</div>
      </div>
      <input id="listeningInput" class="type" placeholder="Введите перевод услышанного" autocomplete="off" style="display:none" />
      <div class="actions" id="listeningMainActions" style="display:none">
        <button id="checkListeningBtn" class="primary">Проверить перевод</button>
        <button id="knowBtn">Знаю перевод</button>
        <button id="dontKnowBtn">Не знаю</button>
      </div>
    `;
  }
}

// Инициализация аудио функциональности для режима аудирования  
function initListeningAudio(question, answer, idxKey) {

  const playBtn = $('#playAudio');
  const slowPlayBtn = $('#slowPlayBtn'); 
  const voiceSelect = $('#voiceSelect');
  const audioVisual = $('#audioVisual');
  let currentUtterance = null;

  // Загружаем доступные голоса
  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    voiceSelect.innerHTML = '<option value="">Автоматический выбор</option>';
    
    // Определяем язык слова (простая эвристика)
    const isEnglish = /^[a-zA-Z\s\-']+$/.test(question);
    const targetLang = isEnglish ? 'en' : 'ru';
    
    voices.forEach((voice, index) => {
      if (voice.lang.startsWith(targetLang)) {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${voice.name} (${voice.lang})`;
        if (voice.default) option.selected = true;
        voiceSelect.appendChild(option);
      }
    });
  }

  // Загружаем голоса при готовности или сразу
  if (speechSynthesis.getVoices().length > 0) {
    loadVoices();
  } else {
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speakText(text, rate = 0.8) {
    // Останавливаем предыдущее воспроизведение
    if (currentUtterance) {
      speechSynthesis.cancel();
    }

    if (!('speechSynthesis' in window)) {
      result.textContent = 'Ваш браузер не поддерживает синтез речи';
      result.className = 'result bad';
      return;
    }

    currentUtterance = new SpeechSynthesisUtterance(text);
    
    // Выбираем голос
    const voices = speechSynthesis.getVoices();
    const selectedVoiceIndex = voiceSelect.value;
    if (selectedVoiceIndex && voices[selectedVoiceIndex]) {
      currentUtterance.voice = voices[selectedVoiceIndex];
    }

    // Настройки произношения
    currentUtterance.rate = rate;
    currentUtterance.pitch = 1.0;
    currentUtterance.volume = 1.0;

    // Определяем язык из настроек или автоматически
    const speechLangSetting = state.speechLang || 'auto';
    if (speechLangSetting === 'auto') {
      const isEnglish = /^[a-zA-Z\s\-']+$/.test(text);
      currentUtterance.lang = isEnglish ? 'en-US' : 'ru-RU';
    } else {
      currentUtterance.lang = speechLangSetting;
    }

    return currentUtterance;
  }

  playBtn.onclick = () => {
    const utterance = speakText(question);
    if (!utterance) return;

    playBtn.textContent = '🔊 Воспроизводится...';
    playBtn.disabled = true;
    audioVisual.textContent = '🔊';
    audioVisual.style.animation = 'pulse 1s infinite';

    utterance.onend = () => {
      playBtn.textContent = '🔊 Повторить';
      playBtn.disabled = false;
      audioVisual.textContent = '🎧';
      audioVisual.style.animation = 'none';
      
      // Показываем дополнительные опции после прослушивания
      const actions = $('#listeningMainActions');
      const listeningActions = document.querySelector('.listening-actions');
      const input = $('#listeningInput');
      
      if (actions) actions.style.display = '';
      if (listeningActions) listeningActions.style.display = '';
      if (input) {
        input.style.display = '';
        input.focus(); // Фокус на поле ввода
      }
      
      // В режиме перевода показываем произнесенное слово после воспроизведения
      if (state.listeningSubmode === 'translation') {
        const listeningWord = document.getElementById('listeningWord');
        if (listeningWord) {
          listeningWord.style.display = 'block';
        }
      }
    };

    utterance.onerror = () => {
      playBtn.textContent = '❌ Ошибка';
      playBtn.disabled = false;
      audioVisual.textContent = '❌';
      audioVisual.style.animation = 'none';
      result.textContent = 'Ошибка воспроизведения. Попробуйте другой голос.';
      result.className = 'result bad';
    };

    speechSynthesis.speak(utterance);
  };

  slowPlayBtn.onclick = () => {
    const utterance = speakText(question, 0.5); // медленная скорость
    if (!utterance) return;

    slowPlayBtn.textContent = '🐌 Воспроизводится...';
    slowPlayBtn.disabled = true;

    utterance.onend = () => {
      slowPlayBtn.textContent = '🐌 Медленно';
      slowPlayBtn.disabled = false;
    };

    speechSynthesis.speak(utterance);
  };

}

// Настройка обработчиков для подрежимов аудирования
function setupListeningHandlers(question, answer, idxKey) {
  const revealBtn = $('#revealBtn');
  const input = $('#listeningInput');
  const knowBtn = $('#knowBtn');
  const dontBtn = $('#dontKnowBtn');
  const checkListeningBtn = $('#checkListeningBtn');
  const result = $('#result');
  const term = $('#listeningTerm');

  let revealed = false;

  // Кнопка показать/скрыть (только для подрежима "word")
  if (revealBtn) {
    revealBtn.onclick = () => {
      if (state.listeningSubmode === 'word' && term) {
        if (!revealed) {
          term.style.filter = 'none';
          revealBtn.textContent = '👁 Скрыть';
          revealed = true;
        } else {
          term.style.filter = 'blur(5px)';
          revealBtn.textContent = '👁 Показать';
          revealed = false;
        }
      } else if (state.listeningSubmode === 'translation') {
        // В режиме перевода показываем/скрываем произнесенное слово
        const listeningWord = document.getElementById('listeningWord');
        if (!revealed) {
          if (listeningWord) {
            listeningWord.style.display = 'block';
          }
          revealBtn.textContent = '👁 Скрыть слово';
          revealed = true;
        } else {
          if (listeningWord) {
            listeningWord.style.display = 'none';
          }
          revealBtn.textContent = '👁 Показать слово';
          revealed = false;
        }
      }
    };
  }

  // Проверка введенного текста
  if (checkListeningBtn) {
    checkListeningBtn.onclick = () => {
      const userInput = input.value.trim();
      const currentResult = document.getElementById('result');
      
      if (!userInput) {
        if (currentResult) {
          currentResult.textContent = 'Пожалуйста, введите ответ';
          currentResult.className = 'result bad';
        }
        return;
      }
      
      let isCorrect = false;
      let correctAnswer = '';
      let feedbackMessage = '';

      if (state.listeningSubmode === 'word') {
        // Проверяем услышанное слово
        correctAnswer = question;
        isCorrect = normalize(userInput) === normalize(question);
        feedbackMessage = isCorrect 
          ? 'Отлично! Правильно услышали!' 
          : `Неверно. Было произнесено: "${question}"`;
      } else {
        // Проверяем перевод услышанного слова
        correctAnswer = answer;
        isCorrect = normalize(userInput) === normalize(answer);
        feedbackMessage = isCorrect 
          ? 'Отлично! Правильный перевод!' 
          : `Неверно. Перевод: "${answer}"`;
      }
      
      markProgress(keyFor(idxKey), isCorrect);
      
      if (isCorrect) {
        haptic(true);
        if (currentResult) {
          currentResult.textContent = feedbackMessage;
          currentResult.className = 'result ok';
        }
        setTimeout(() => nextCard(true), 800);
      } else {
        haptic(false);
        if (currentResult) {
          currentResult.textContent = feedbackMessage;
          currentResult.className = 'result bad';
        }
        
        // Показываем правильный ответ визуально
        if (state.listeningSubmode === 'word') {
          const term = document.getElementById('listeningTerm');
          if (term) {
            term.style.filter = 'none';
            term.style.color = 'var(--danger)';
          }
        } else if (state.listeningSubmode === 'translation') {
          // В режиме перевода показываем произнесенное слово
          const listeningWord = document.getElementById('listeningWord');
          if (listeningWord) {
            listeningWord.style.display = 'block';
            listeningWord.style.borderColor = 'var(--danger)';
            listeningWord.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
          }
        }
        
        // Показываем кнопку "Далее"
        checkListeningBtn.style.display = 'none';
        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Далее';
        nextBtn.className = 'primary';
        nextBtn.onclick = () => nextCard(false);
        checkListeningBtn.parentNode.appendChild(nextBtn);
      }
    };
  }

  // Кнопки "Знаю"/"Не знаю" для быстрого ответа без ввода
  if (knowBtn) {
    knowBtn.onclick = () => { 
      markProgress(keyFor(idxKey), true); 
      haptic(true); 
      
      const currentResult = document.getElementById('result');
      const message = state.listeningSubmode === 'word' 
        ? 'Отлично! Знаете слово на слух' 
        : 'Отлично! Знаете перевод';
      
      if (currentResult) {
        currentResult.textContent = message;
        currentResult.className = 'result ok';
      }
      setTimeout(() => nextCard(true), 800);
    };
  }
  
  if (dontBtn) {
    dontBtn.onclick = () => { 
      markProgress(keyFor(idxKey), false); 
      haptic(false); 
      
      // Находим актуальный элемент результата
      const currentResult = document.getElementById('result');
      
      const message = state.listeningSubmode === 'word'
        ? `Слово: "${question}", перевод: "${answer}"`
        : `Было произнесено: "${question}", перевод: "${answer}"`;
      
      if (currentResult) {
        currentResult.textContent = message;
        currentResult.className = 'result bad';
        
        // Показываем правильный ответ визуально
        if (state.listeningSubmode === 'word') {
          const term = document.getElementById('listeningTerm');
          if (term) {
            term.style.filter = 'none';
            term.style.color = 'var(--danger)';
          }
        } else if (state.listeningSubmode === 'translation') {
          // В режиме перевода показываем произнесенное слово
          const listeningWord = document.getElementById('listeningWord');
          if (listeningWord) {
            listeningWord.style.display = 'block';
            listeningWord.style.borderColor = 'var(--danger)';
            listeningWord.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
          }
        }
      }
      
      setTimeout(() => nextCard(false), 2500);
    };
  }

  // Enter для проверки ввода
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim() && checkListeningBtn) {
        e.preventDefault();
        checkListeningBtn.click();
      }
    });
    
    // Фокус на поле ввода когда оно появляется
    if (input.style.display !== 'none') {
      setTimeout(() => input.focus(), 100);
    }
  }
}



// Система аналитики и рекомендаций
function logModeUsage(mode) {
  const usageKey = 'vocab-crammer:mode-usage';
  try {
    const usage = JSON.parse(localStorage.getItem(usageKey) || '{}');
    usage[mode] = (usage[mode] || 0) + 1;
    usage.lastUsed = mode;
    usage.sessionCount = (usage.sessionCount || 0) + 1;
    localStorage.setItem(usageKey, JSON.stringify(usage));
  } catch (e) {
    console.warn('Не удалось сохранить статистику использования:', e);
  }
}

function getModeRecommendation() {
  try {
    const usageKey = 'vocab-crammer:mode-usage';
    const usage = JSON.parse(localStorage.getItem(usageKey) || '{}');
    const sessionCount = usage.sessionCount || 0;

    // Для новичков рекомендуем карточки
    if (sessionCount < 3) return 'flashcards';

    // Анализируем точность по режимам
    const store = loadStore();
    if (state.datasetId && store.datasets[state.datasetId]) {
      const stats = store.datasets[state.datasetId].stats;
      const accuracy = stats.answered > 0 ? (stats.correct / stats.answered) : 0;

      // Если точность низкая, рекомендуем флэш-карточки
      if (accuracy < 0.6) return 'flashcards';

      // Если средняя, рекомендуем выбор
      if (accuracy < 0.8) return 'choice';

      // Высокая точность - можно сложные режимы
      return Math.random() > 0.5 ? 'typing' : 'listening';
    }

    return 'flashcards';
  } catch (e) {
    return 'flashcards';
  }
}

function updateModeRecommendations() {
  const recommended = getModeRecommendation();
  const tiles = document.querySelectorAll('#modeTiles .tile');
  
  tiles.forEach(tile => {
    const badge = tile.querySelector('.tile-badge');
    if (tile.dataset.mode === recommended && !badge?.textContent.includes('РЕКОМЕНДУЕТСЯ')) {
      if (badge) {
        badge.textContent = '🎯 РЕКОМЕНДУЕТСЯ';
        badge.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
      }
    }
  });
}

// Система прогрессивной сложности
function getAdaptiveDifficulty() {
  if (!state.datasetId) return 'medium';
  
  try {
    const store = getDatasetStore(state.datasetId);
    const stats = store.datasets[state.datasetId].stats;
    const accuracy = stats.answered > 0 ? (stats.correct / stats.answered) : 0;
    const sessionsCount = stats.answered / 20; // примерно 20 слов за сессию
    
    if (sessionsCount < 2 || accuracy < 0.5) return 'easy';
    if (sessionsCount < 5 || accuracy < 0.7) return 'medium';
    if (accuracy < 0.85) return 'hard';
    return 'expert';
  } catch (e) {
    return 'medium';
  }
}

// Улучшенная система флэш-карточек с интервальными повторениями
function calculateNextReviewDate(streak, difficulty = 'medium') {
  const baseInterval = { easy: 1, medium: 2, hard: 3, expert: 4 }[difficulty] || 2;
  const multipliers = [1, 2, 4, 8, 15, 30]; // дни
  const index = Math.min(streak, multipliers.length - 1);
  const days = baseInterval * multipliers[index];
  return Date.now() + (days * 24 * 60 * 60 * 1000);
}

// Умная система подсказок
function generateSmartHint(question, answer, mode) {
  const hints = [];
  
  if (mode === 'typing') {
    // Подсказки для ввода
    hints.push(`Длина: ${answer.length} букв`);
    if (answer.length > 3) {
      hints.push(`Начинается на "${answer.charAt(0).toUpperCase()}"`);
    }
    if (answer.includes(' ')) {
      hints.push(`Содержит ${answer.split(' ').length} слова`);
    }
  }
  
  if (mode === 'choice') {
    // Подсказки для множественного выбора
    if (question.length > answer.length) {
      hints.push('Перевод короче оригинала');
    } else if (question.length < answer.length) {
      hints.push('Перевод длиннее оригинала');
    }
  }
  
  return hints.length > 0 ? hints[Math.floor(Math.random() * hints.length)] : null;
}
