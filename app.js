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
  if (!store.datasets[id]) store.datasets[id] = { progress: {}, stats: { answered: 0, correct: 0 }, meta: {}, learned: {}, streaks: {} };
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
  else if (state.mode === 'matching') renderMatching();
  else if (state.mode === 'blitz') renderBlitz(ask, ans, idx);
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

// Matching pairs — builds a round of N pairs (default up to 6)
function renderMatching() {
  const root = $('#studyApp');
  const remaining = state.session.length - state.i;
  if (remaining <= 0) { nextCard(true); return; }
  const round = Math.min(6, remaining);
  const indices = state.session.slice(state.i, state.i + round);
  const cards = [];
  indices.forEach((idx) => {
    const p = state.all[idx];
    cards.push({ key: idx, side: 'a', text: state.direction === 'ab' ? p.a : p.b });
    cards.push({ key: idx, side: 'b', text: state.direction === 'ab' ? p.b : p.a });
  });
  shuffleInPlace(cards, state.seed + state.i);

  root.innerHTML = `<div class="card enter">
    <div class="term">Найдите пары</div>
    <div class="match-grid" id="matchGrid"></div>
    <div class="result" id="result"></div>
  </div>`;
  const grid = $('#matchGrid');
  const result = $('#result');
  const picked = [];
  const matchedKeys = new Set();

  function refresh() {
    grid.innerHTML = '';
    cards.forEach((c, i) => {
      const div = document.createElement('button');
      div.className = 'match-card';
      div.textContent = c.text;
      div.disabled = matchedKeys.has(c.key);
      if (picked.find(p => p.index === i)) div.classList.add('active');
      if (matchedKeys.has(c.key)) div.classList.add('matched');
      div.onclick = () => onPick(i);
      grid.appendChild(div);
    });
  }

  function onPick(i) {
    if (matchedKeys.has(cards[i].key)) return;
    const already = picked.find(p => p.index === i);
    if (already) { picked.splice(picked.indexOf(already), 1); refresh(); return; }
    picked.push({ index: i, card: cards[i] });
    if (picked.length === 2) {
      const [p1, p2] = picked;
      picked.length = 0;
      if (p1.card.key === p2.card.key && p1.card.side !== p2.card.side) {
        matchedKeys.add(p1.card.key);
        markProgress(keyFor(p1.card.key), true);
        haptic(true);
        refresh();
        if (matchedKeys.size === indices.length) {
          // advance by number of pairs used
          state.i += round;
          setTimeout(() => render(), 250);
        }
      } else {
        haptic(false);
        const nodes = grid.children;
        nodes[p1.index].classList.add('wrong');
        nodes[p2.index].classList.add('wrong');
        setTimeout(() => { nodes[p1.index].classList.remove('wrong'); nodes[p2.index].classList.remove('wrong'); refresh(); }, 300);
      }
    } else {
      refresh();
    }
  }

  refresh();
}

// Blitz mode — rapid know/don't know with a countdown
let blitzTimer = null;
function renderBlitz(question, answer, idxKey) {
  const root = $('#studyApp');
  if (!state.blitzUntil) {
    // start a new 60-second blitz window
    state.blitzUntil = Date.now() + 60000;
    if (blitzTimer) { clearInterval(blitzTimer); blitzTimer = null; }
    blitzTimer = setInterval(() => {
      const t = Math.max(0, state.blitzUntil - Date.now());
      const s = Math.ceil(t / 1000);
      const el = $('#blitzTimer');
      if (el) el.textContent = `${s}s`;
      if (t <= 0) {
        clearInterval(blitzTimer); blitzTimer = null; endBlitz();
      }
    }, 250);
  }
  root.innerHTML = `<div class="card enter">
    <div class="term">${escapeHtml(question)}</div>
    <div class="blitz-timer">Таймер: <span id="blitzTimer"></span></div>
    <div class="actions blitz-actions">
      <button id="knowBtn" class="primary">Знаю</button>
      <button id="dontKnowBtn">Не знаю</button>
    </div>
  </div>`;
  const knowBtn = $('#knowBtn');
  const dontBtn = $('#dontKnowBtn');
  knowBtn.onclick = () => { haptic(true); markProgress(keyFor(idxKey), true); nextCard(true); };
  dontBtn.onclick = () => { haptic(false); markProgress(keyFor(idxKey), false); nextCard(false); };
  root.onkeydown = (e) => {
    if (e.key === '1' || e.key.toLowerCase() === 'j') knowBtn.click();
    if (e.key === '2' || e.key.toLowerCase() === 'f') dontBtn.click();
  };
  root.tabIndex = 0; root.focus();
  // update timer immediately
  const el = $('#blitzTimer'); if (el) { const t = Math.max(0, state.blitzUntil - Date.now()); el.textContent = `${Math.ceil(t/1000)}s`; }
}

function endBlitz() {
  const root = $('#studyApp');
  root.innerHTML = `<div class="card enter">
    <div class="term">Время вышло ⏱️</div>
    <div class="answer">Ответов: ${state.answered}, Точность: ${state.answered ? Math.round((state.correct/state.answered)*100) : 0}%</div>
    <div class="actions"><button id="againBtn" class="primary">Ещё раунд</button><button id="backBtn">К режимам</button></div>
  </div>`;
  $('#againBtn').onclick = () => { state.blitzUntil = null; startSession(); };
  $('#backBtn').onclick = () => { state.blitzUntil = null; exitStudy(); };
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
  const size = Number($('#sizeRange')?.value || 30);
  // Read from tiles if present; fallback to previous state
  const modeTileSel = document.querySelector('#modeTiles .tile.selected')?.dataset.mode;
  const dirTileSel = document.querySelector('#dirTiles .tile.selected')?.dataset.dir;
  const modeVal = modeTileSel || document.querySelector('input[name="modeSeg"]:checked')?.value || state.mode;
  const dirVal = dirTileSel || document.querySelector('input[name="dirSeg"]:checked')?.value || state.direction;
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
  const baseIndices = pickSessionIndices(state.all.length, size);
  let indices = baseIndices;
  if (((onlyUnl || state.mode === 'flashcards') && !includeLearned) && state.datasetId) {
    const ds = getDatasetStore(state.datasetId).datasets[state.datasetId];
    indices = baseIndices.filter(i => !ds.learned || !ds.learned[keyFor(i)]);
    // Fallback: if ничего не осталось (все выучены), запускаем сессию по всем словам
    if (indices.length === 0) {
      const onlyUnlEl = document.getElementById('onlyUnlearned');
      if (onlyUnlEl) onlyUnlEl.checked = false;
      const inclEl = document.getElementById('includeLearned');
      if (inclEl) inclEl.checked = true;
      indices = baseIndices;
    }
  }
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
  const sizeRange = document.getElementById('sizeRange');
  const sizeVal = document.getElementById('sizeVal');
  if (sizeRange && sizeVal) { sizeVal.textContent = sizeRange.value; sizeRange.addEventListener('input', () => { sizeVal.textContent = sizeRange.value; }); }
  const startStudy = document.getElementById('startStudy');
  if (startStudy) startStudy.addEventListener('click', startSession);
  const fillRemaining = document.getElementById('fillRemainingBtn');
  const onlyUnlearned = document.getElementById('onlyUnlearned');
  const includeLearned = document.getElementById('includeLearned');
  if (fillRemaining) fillRemaining.addEventListener('click', () => {
    const remaining = getRemainingUnlearnedCount();
    const sizeRange = document.getElementById('sizeRange');
    const sizeVal = document.getElementById('sizeVal');
    if (remaining > 0) {
      if (sizeRange) { sizeRange.value = String(Math.max(1, remaining)); }
      if (sizeVal) sizeVal.textContent = String(Math.max(1, remaining));
      if (onlyUnlearned) onlyUnlearned.checked = true;
      if (includeLearned) includeLearned.checked = false;
    } else {
      // всё выучено — предложим учить все
      const total = state.all.length;
      if (sizeRange) { sizeRange.value = String(Math.max(1, total)); }
      if (sizeVal) sizeVal.textContent = String(Math.max(1, total));
      if (onlyUnlearned) onlyUnlearned.checked = false;
      if (includeLearned) includeLearned.checked = true;
    }
  });
  if (includeLearned) includeLearned.addEventListener('change', () => {
    if (includeLearned.checked && onlyUnlearned) onlyUnlearned.checked = false;
    adjustSizeRangeToUnlearned();
  });
  if (onlyUnlearned) onlyUnlearned.addEventListener('change', () => {
    if (onlyUnlearned.checked && includeLearned) includeLearned.checked = false;
    adjustSizeRangeToUnlearned();
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
  }
  if (sShow) { sShow.checked = !!state.showOnDontKnow; sShow.addEventListener('change', () => { state.showOnDontKnow = sShow.checked; saveSettings(); }); }
  if (sDelay) { sDelay.value = String(state.showDelay); sDelay.addEventListener('input', () => { const v = Number(sDelay.value); if (!isNaN(v)) { state.showDelay = Math.max(300, Math.min(5000, v)); saveSettings(); } }); }
  if (sShuffle) { sShuffle.checked = !!state.shuffleOrder; sShuffle.addEventListener('change', () => { state.shuffleOrder = sShuffle.checked; saveSettings(); }); }
  if (sStreak) { sStreak.value = String(state.streakRequired || 1); sStreak.addEventListener('input', () => { const v = Number(sStreak.value); if (!isNaN(v)) { state.streakRequired = Math.max(1, Math.min(10, v)); saveSettings(); } }); }
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
  if (name === 'modes') adjustSizeRangeToUnlearned();
}

function adjustSizeRangeToUnlearned() {
  try {
    const sizeRange = document.getElementById('sizeRange');
    const sizeVal = document.getElementById('sizeVal');
    if (!sizeRange) return;
    const includeLearned = document.getElementById('includeLearned')?.checked;
    const remaining = includeLearned ? state.all.length : getRemainingUnlearnedCount();
    sizeRange.max = String(Math.max(1, remaining));
    if (Number(sizeRange.value) > remaining) sizeRange.value = String(remaining);
    if (sizeVal) sizeVal.textContent = sizeRange.value;
  } catch {}
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
  const data = { showOnDontKnow: !!state.showOnDontKnow, showDelay: Number(state.showDelay || 2200), shuffleOrder: !!state.shuffleOrder, streakRequired: Number(state.streakRequired || 1) };
  localStorage.setItem(settingsKey, JSON.stringify(data));
}
