// SUM INVADERS — SCHOOL EDITION (INICIAL / MEDIO / SUPERIOR)
// - Niveles: INICIAL, MEDIO, SUPERIOR
// - Subniveles: BÁSICO, AVANZADO
// - 5 estrellas por subnivel
// - Estrella = racha de aciertos (INICIAL 5, MEDIO/SUPERIOR 10)
// - Countdown 3-2-1 con blur (sin START). Durante el countdown no se ve target ni sumas.

(() => {
  'use strict';


// -------------------------
// Google Sheets score saving (Apps Script Web App)
// Columns in your sheet: player, score, level, time
// -------------------------
// IMPORTANT: always use the URL provided by config.js.
// If it's missing, we prefer to fail loudly instead of silently writing to an old endpoint.
const SCORE_ENDPOINT = (typeof window !== 'undefined' && window.SCORES_API_URL)
  ? String(window.SCORES_API_URL)
  : '';

const FORM_ACTION_URL = (typeof window !== 'undefined' && window.SCORES_FORM_ACTION_URL)
  ? String(window.SCORES_FORM_ACTION_URL)
  : '';
const FORM_ENTRIES = (typeof window !== 'undefined' && window.SCORES_FORM_ENTRIES)
  ? window.SCORES_FORM_ENTRIES
  : null;

// Track run duration for the "time" column (seconds since run start)
let runStartMs = 0;
let turnStartMs = 0;
let turnTimesSec = [];
let turnsPlayed = 0;

function getPlayerNameSafe() {
  const el = document.getElementById('player-name');
  const name = (el?.value || '').trim();
  return name || 'ANON';
}

function getRunTimeSeconds() {
  if (!runStartMs) return 0;
  return Math.max(0, Math.round((Date.now() - runStartMs) / 1000));
}

function recordTurnNow() {
  if (!turnStartMs) return;
  const t = Math.max(0, (Date.now() - turnStartMs) / 1000);
  turnTimesSec.push(t);
}
function formatSec1(x) {
  const v = Math.max(0, Number(x) || 0);
  return (Math.round(v * 10) / 10).toFixed(1);
}
function formatTotalMmSs(x) {
  const v = Math.max(0, Number(x) || 0);
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  return `${m}m ${formatSec1(s)}s`;
}

function sendScoreToSheet(payload) {
  // Fire-and-forget write to Apps Script Web App.
  // Why: from file:// or GitHub Pages, CORS + redirects can cause flaky GET fetches.
  // We don't need to read the response for saving, only to send the request reliably.
  return new Promise((resolve) => {
    try {
      if (!SCORE_ENDPOINT) {
        console.warn('[Scores] Missing SCORES_API_URL (config.js not loaded?)');
        resolve({ ok: false, reason: 'missing_endpoint' });
        return;
      }

      const url = new URL(SCORE_ENDPOINT);
      url.searchParams.set('action', 'save');

      // Keep payload small and string-safe
      const bodyObj = {};
      Object.entries(payload || {}).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        bodyObj[k] = String(v);
      });
      bodyObj._ = String(Date.now());
      bodyObj.sid = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

      const finalUrl = url.toString();
      const json = JSON.stringify(bodyObj);

      // 1) Best-effort: sendBeacon (very reliable, ignores CORS, survives navigation)
      try {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const ok = navigator.sendBeacon(finalUrl, new Blob([json], { type: 'text/plain;charset=UTF-8' }));
          if (ok) {
            resolve({ ok: true, event: 'beacon' });
            return;
          }
        }
      } catch (e) {
        // ignore
      }

      // 2) Fallback: POST no-cors (response is opaque, but request is sent)
      try {
        fetch(finalUrl, {
          method: 'POST',
          mode: 'no-cors',
          cache: 'no-store',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: json,
          keepalive: true,
        }).catch(() => {});
        resolve({ ok: true, event: 'post_no_cors' });
        return;
      } catch (e) {
        // continue
      }

      // 3) Last resort: GET pixel ping (query params)
      try {
        const u2 = new URL(SCORE_ENDPOINT);
        u2.searchParams.set('action', 'save');
        Object.entries(bodyObj).forEach(([k, v]) => u2.searchParams.set(k, String(v)));
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = u2.toString();
        resolve({ ok: true, event: 'img_ping' });
        return;
      } catch (e) {
        // ignore
      }

      resolve({ ok: false, reason: 'all_methods_failed' });
    } catch (err) {
      console.warn('[Scores] sendScoreToSheet exception:', err);
      resolve({ ok: false, reason: 'exception', err: String(err) });
    }
  });
}



async function sendScoreToForm(payload) {
  // Disabled: we are using Apps Script only.
  return Promise.resolve({ ok: false, reason: 'forms_disabled' });
}

async function __sendScoreToForm_DISABLED__(payload) {
// Primary save path for GitHub Pages: submit to Google Forms (no-cors).
  if (!FORM_ACTION_URL || !FORM_ENTRIES) {
    console.warn('[Scores] Missing Google Form config (SCORES_FORM_ACTION_URL / SCORES_FORM_ENTRIES).');
    return { ok: false, reason: 'missing_form_config' };
  }
  try {
    const body = new URLSearchParams();
    body.set(FORM_ENTRIES.player, String(payload.player ?? ''));
    body.set(FORM_ENTRIES.score, String(payload.score ?? 0));
    body.set(FORM_ENTRIES.level, String(payload.level ?? ''));
    body.set(FORM_ENTRIES.time, String(payload.time ?? 0));

    // Extra fields (ignored by Forms if not present)
    // body.set('submit', 'Submit');

    await fetch(FORM_ACTION_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
    });

    return { ok: true };
  } catch (err) {
    console.warn('[Scores] Form submit failed:', err);
    return { ok: false, reason: 'exception', err: String(err) };
  }
}

// Helper: send the current run score/progress to Sheets (used on game over / victory)
// NOTE: `score` is declared later in this module; the function is only called after init.
function sendProgressScore(levelLabel) {
  // Send the parameter names expected by the Apps Script: player, score, level, time (lowercase).
  // We use an image GET ping to avoid CORS issues on GitHub Pages / file://.
  sendScoreToSheet({
    player: getPlayerNameSafe(),
    score: String(score ?? 0),
    level: String(levelLabel || ''),
    time: String(getRunTimeSeconds()),
    ts: new Date().toISOString(),
  });
}


  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  
  // -------------------------
  // SFX (simple, gesture-unlocked)
  // -------------------------
  const SFX_PATHS = {
    insertCoin: 'assets/sfx/insert-coin.mp3',
    button:     'assets/sfx/button.mp3',
    wrong:      'assets/sfx/wrong.mp3',
    gameOver:   'assets/sfx/game-over.mp3',
    levelUp:    'assets/sfx/level-up.mp3',  };

  function makeSfxPool(src, size = 3) {
    const pool = [];
    for (let i = 0; i < size; i++) {
      const a = new Audio(src);
      a.preload = 'auto';
      pool.push(a);
    }
    return pool;
  }

  const SFX = {
    insertCoin: makeSfxPool(SFX_PATHS.insertCoin, 2),
    button:     makeSfxPool(SFX_PATHS.button, 3),
    wrong:      makeSfxPool(SFX_PATHS.wrong, 2),
    gameOver:   makeSfxPool(SFX_PATHS.gameOver, 1),
    levelUp:    makeSfxPool(SFX_PATHS.levelUp, 2),  };

  let audioUnlocked = false;
  async function unlockAudioOnce() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    // Prime audio on the first user gesture (needed for non-gesture sounds like GAME OVER).
    // IMPORTANT: do NOT prime/stop the same Audio instances that we want to audibly play
    // on the very first click (e.g. INSERT COIN), otherwise the "prime" pause can cancel it.
    const pools = Object.entries(SFX)
      .filter(([key]) => key !== 'insertCoin')   // let INSERT COIN play cleanly on first click
      .map(([, pool]) => pool)
      .flat();

    pools.forEach((a) => {
      try {
        const prevVol = a.volume;
        a.volume = 0.0001;

        // Kick playback, then stop it on the next tick (not when the play promise resolves),
        // to avoid racing with real SFX playback.
        a.play().catch(() => {});
        setTimeout(() => {
          try { a.pause(); a.currentTime = 0; } catch (_) {}
          try { a.volume = prevVol; } catch (_) {}
        }, 0);
      } catch (_) {
        // ignore
      }
    });
  }

  function playSfx(key) {
    const pool = SFX[key];
    if (!pool || !pool.length) return;
    // pick a free channel or reuse the first
    const a = pool.find((x) => x.paused || x.ended) || pool[0];
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  function bindSfxClick(el, key) {
    if (!el) return;
    el.addEventListener('click', () => {
      unlockAudioOnce();
      playSfx(key);
    });
  }

// -------------------------
  // DOM
  // -------------------------
  const startScreen = $('#start-screen');
  const difficultyScreen = $('#difficulty-screen');
  const rulesScreen = $('#rules-screen');
  const gameScreen = $('#game-screen');
  const gameoverScreen = $('#gameover-screen');
  const leaderboardScreen = $('#leaderboard-screen');

  const insertCoinEl = $('#insert-coin');

  // Unlock/prime audio once on the first user gesture (for non-gesture sounds).
  document.addEventListener('pointerdown', unlockAudioOnce, { once: true, passive: true });
  const startBtn = $('#start-btn');
  const top10Btn = $('#top10-btn');

  const diffInicial = $('#diff-easy');
  const diffMedio = $('#diff-medium');
  const diffSuperior = $('#diff-hard');
  const diffBack = $('#diff-back');

  const rulesTextEl = $('#rules-text');
  const rulesOkBtn = $('#rules-ok');
  const rulesBackBtn = $('#rules-back');

  const gameUi = $('#game-ui');
  const countdownEl = $('#countdown');
  const targetEl = $('#target');
  const optionBtns = $$('.options .opt-btn');

  const scoreEl = $('#score');
  const starsEl = $('#stars');
  const tmrEl = $('#tmr');
  const streakEl = $('#streak');
  const livesEl = $('#err');

  // Basic guards (safer)
// NOTE: Do not abort the whole game if some optional UI nodes are missing.
// Only require the core navigation elements to exist; everything else is optional.
const mustCore = [startScreen, difficultyScreen, rulesScreen, gameScreen, insertCoinEl, startBtn];
if (mustCore.some((x) => !x)) {
  console.error('[BOOT] Missing *core* DOM nodes. Check index.html ids for: startScreen, difficultyScreen, rulesScreen, gameScreen, insertCoin, startBtn.');
  throw new Error('Missing core DOM nodes');
}


  const allScreens = [startScreen, difficultyScreen, rulesScreen, gameScreen, gameoverScreen, leaderboardScreen].filter(Boolean);
  function showScreen(el) {
    allScreens.forEach((s) => s.classList.remove('active'));
    el.classList.add('active');
  }

  // -------------------------
  // Timing (tweakable)
  // -------------------------
  const COUNTDOWN_STEP_MS = 900; // readable
  const FEEDBACK_MS = 1100;       // time to see green/red
  const STAR_REWARD_MS = COUNTDOWN_STEP_MS * 3; // same as full countdown

  // -------------------------
  // Difficulty model
  // -------------------------
  const LEVELS = {
    INICIAL:  { timeSec: 20, baseOptions: 2, streakGoal: 5,  sublevels: ['BASICO', 'AVANZADO'] },
    MEDIO:    { timeSec: 15, baseOptions: 2, streakGoal: 5, sublevels: ['BASICO', 'AVANZADO'] },
    SUPERIOR: { timeSec: 10, baseOptions: 3, streakGoal: 5, sublevels: ['BASICO', 'AVANZADO'] },
  };

  // Target ramps per ⭐ within each sublevel (5 stars => next sublevel/level)
  // Each array item is [minTarget, maxTarget] for that star index (0..4)
  const RAMP_TARGETS = {
    INICIAL: {
      BASICO: [
        [2, 20], [2, 20], [2, 20], [2, 20], [2, 20],
      ],
      AVANZADO: [
        [20, 50], [50, 60], [60, 70], [70, 80], [80, 100],
      ],
    },
    MEDIO: {
      BASICO: [
        [100, 120], [120, 140], [140, 160], [160, 180], [180, 200],
      ],
      AVANZADO: [
        [200, 260], [260, 320], [320, 380], [380, 440], [440, 500],
      ],
    },
    SUPERIOR: {
      BASICO: [
        [200, 220], [220, 240], [240, 260], [260, 280], [280, 300],
      ],
      AVANZADO: [
        [300, 450], [450, 600], [600, 750], [750, 900], [900, 1000],
      ],
    },
  };

  // Operand ranges used to *construct* equations a+b = target in each sublevel.
  // We retry until both addends fall within these ranges.
  const OPERAND_RANGES = {
    INICIAL: {
      BASICO:   { a:[0, 20],   b:[0, 20]   },
      AVANZADO: { a:[5, 99],   b:[5, 99]   },
    },
    MEDIO: {
      BASICO:   { a:[10, 120], b:[10, 120] },
      AVANZADO: { a:[50, 350], b:[50, 350] },
    },
    SUPERIOR: {
      BASICO:   { a:[30, 200], b:[30, 200] },
      AVANZADO: { a:[100, 900], b:[100, 900] },
    },
  };


  // -------------------------
  // State
  // -------------------------
  let coinInserted = false;
  let currentLevel = 'INICIAL';     // INICIAL|MEDIO|SUPERIOR
  let currentSub = 'BASICO';        // BASICO|AVANZADO

  const MAX_STARS = 5;
  const MAX_STEPS = 10;

  let score = 0;
  let stars = 0;     // 0..5 within current sublevel
  let streak = 0;    // 0..goal
let lives = 6;     // 0..6 (each wrong answer loses one)

  let currentTarget = 0;
  let stepsLeft = MAX_STEPS;
  let stepTimer = null;
  let turnActive = false;

  // -------------------------
  // HUD rendering
  // -------------------------
  function renderScore() {
    if (scoreEl) scoreEl.textContent = String(score).padStart(6, '0');
  }

  function renderStars() {
    const out = [];
    for (let i = 0; i < MAX_STARS; i++) {
      out.push(`<span class="star ${i < stars ? 'on' : ''}">★</span>`);
    }
    if (starsEl) starsEl.innerHTML = out.join('');
  }

  function renderStreak(goal) {
    const out = [];
    for (let i = 0; i < goal; i++) {
      out.push(`<span class="pip ${i < streak ? 'on' : ''}"></span>`);
    }
    if (streakEl) streakEl.innerHTML = out.join('');
  }

  function renderTimer() {
    const on = '|'.repeat(Math.max(0, stepsLeft));
    const off = '.'.repeat(Math.max(0, MAX_STEPS - stepsLeft));
    if (tmrEl) tmrEl.textContent = on + off;
  }

  // -------------------------
  // HUD Lives (static display)
  // -------------------------
  // The HUD has a dedicated "VIDAS" slot (id="err" in index.html).
  // Even if this edition doesn't consume lives, we render a stable indicator
  // so the panel is never empty.
  const MAX_LIVES_UI = 6;
  function renderLives() {
    if (!livesEl) return;
    const out = [];
    for (let i = 0; i < MAX_LIVES_UI; i++) {
      const lost = (i >= lives);
      out.push(`<span class="life${lost ? ' lost' : ''}"></span>`);
    }
    livesEl.innerHTML = out.join('');
  }

  function getConfig() {
    const L = LEVELS[currentLevel];
    const r = OPERAND_RANGES[currentLevel][currentSub];
    const ramp = RAMP_TARGETS[currentLevel][currentSub][Math.min(stars, MAX_STARS-1)];
    return {
      timeSec: L.timeSec,
      // NORMA: en SUPERIOR hay 3 sumas en BÁSICO y 4 en AVANZADO
      options: (currentLevel === 'SUPERIOR' ? (currentSub === 'AVANZADO' ? 4 : 3) : L.baseOptions),
      streakGoal: L.streakGoal,
      ranges: r,
      targetRamp: ramp,
    };
  }

  // -------------------------
  // Countdown with blur + hide game elements
  // -------------------------
  async function runCountdown() {
    if (gameUi) gameUi.classList.add('blurred');
    if (countdownEl) countdownEl.classList.remove('hidden');

    if (countdownEl) countdownEl.textContent = '3'; await sleep(COUNTDOWN_STEP_MS);
    if (countdownEl) countdownEl.textContent = '2'; await sleep(COUNTDOWN_STEP_MS);
    if (countdownEl) countdownEl.textContent = '1'; await sleep(COUNTDOWN_STEP_MS);

    if (countdownEl) countdownEl.classList.add('hidden');
    if (gameUi) gameUi.classList.remove('blurred');
  }

  // -------------------------
  // RNG / option generation
  // -------------------------
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickTarget([tMin, tMax]) {
    return randInt(tMin, tMax);
  }


  function isSumFeasible(sum, ranges) {
    const [aMin, aMax] = ranges.a;
    const [bMin, bMax] = ranges.b;
    const aLow = Math.max(aMin, sum - bMax);
    const aHigh = Math.min(aMax, sum - bMin);
    return aLow <= aHigh;
  }

  function pickFeasibleTarget(ramp, ranges) {
    const [tMin, tMax] = ramp;
    // Try random picks first
    for (let i = 0; i < 2000; i++) {
      const t = randInt(tMin, tMax);
      if (t > 1 && isSumFeasible(t, ranges)) return t;
    }
    // Fallback: scan range to guarantee progress
    for (let t = tMin; t <= tMax; t++) {
      if (t > 1 && isSumFeasible(t, ranges)) return t;
    }
    // Last resort (should never happen with sane ranges)
    return randInt(tMin, tMax);
  }

  function findAddendsForSum(sum, aRange, bRange) {
    const [aMin, aMax] = aRange;
    const [bMin, bMax] = bRange;

    // Feasible a range so that b = sum - a stays inside bRange
    const aLow = Math.max(aMin, sum - bMax);
    const aHigh = Math.min(aMax, sum - bMin);
    if (aLow > aHigh) return null;

    const a = randInt(aLow, aHigh);
    const b = sum - a;
    return [a, b];
  }

  function buildOptions(target, optionCount, ramp, ranges) {
    const [tMin, tMax] = ramp;

    // ensure 1 correct + (optionCount-1) wrong, all FEASIBLE with operand ranges
    const vals = new Set([target]);

    let guard = 0;
    let maxDelta = 9;

    while (vals.size < optionCount && guard < 4000) {
      guard++;

      // expand search if we're struggling
      if (guard % 600 === 0) maxDelta = Math.min(maxDelta + 6, 40);

      const delta = (Math.random() < 0.5 ? -1 : 1) * randInt(1, maxDelta);
      const w = target + delta;

      if (w < tMin || w > tMax || w <= 1 || w === target) continue;
      if (!isSumFeasible(w, ranges)) continue;

      vals.add(w);
    }

    const arr = Array.from(vals);

    // If we still couldn't fill (very rare), fill with random feasible uniques inside ramp.
    guard = 0;
    while (arr.length < optionCount && guard < 5000) {
      guard++;
      const w = randInt(tMin, tMax);
      if (w <= 1 || w === target) continue;
      if (!isSumFeasible(w, ranges)) continue;
      if (arr.includes(w)) continue;
      arr.push(w);
    }

    // shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildSuperiorOptions(target, optionCount, ramp, ranges) {
    const [tMin, tMax] = ramp;
    const unit = Math.abs(target) % 10;

    const vals = new Set([target]);

    // We need at least 2 results with the same unit as the TARGET (target already counts as 1)
    let needSameUnit = 1;

    let guard = 0;
    while (vals.size < optionCount && guard < 6000) {
      guard++;

      const mustMatchUnit = (needSameUnit > 0);
      let w;

      if (mustMatchUnit) {
        // pick a number in ramp with the same unit
        const baseMin = tMin - (tMin % 10);
        const baseMax = tMax - (tMax % 10);
        const base = randInt(baseMin, baseMax);
        w = base - (base % 10) + unit;

        // nudge into bounds if needed
        while (w < tMin) w += 10;
        while (w > tMax) w -= 10;
      } else {
        // any feasible wrong option
        w = randInt(tMin, tMax);
      }

      if (w < tMin || w > tMax || w <= 1) continue;
      if (w === target) continue;
      if (!isSumFeasible(w, ranges)) continue;

      if (!vals.has(w)) {
        vals.add(w);
        if (Math.abs(w) % 10 === unit && needSameUnit > 0) needSameUnit--;
      }
    }

    const arr = Array.from(vals);

    // Safety: if somehow we didn't satisfy the unit requirement, patch one feasible option to match the unit.
    const sameUnitCount = arr.filter(v => Math.abs(v) % 10 === unit).length;
    if (sameUnitCount < 2) {
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] === target) continue;
        let candidate = arr[i] - (Math.abs(arr[i]) % 10) + unit;
        while (candidate < tMin) candidate += 10;
        while (candidate > tMax) candidate -= 10;
        if (candidate === target) continue;
        if (!isSumFeasible(candidate, ranges)) continue;
        if (arr.includes(candidate)) continue;
        arr[i] = candidate;
        break;
      }
    }

    // shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // -------------------------
  // NORMA (NIVEL SUPERIOR):
  // - En cada pantalla SOLO una suma puede dar exactamente el TARGET.
  // - Si hay 3 (tier 1) o 4 (tier 2) sumas, al menos DOS de los RESULTADOS
  //   deben tener la misma cifra de unidades que el TARGET.
  //   (Ej: TARGET 312 -> al menos 2 resultados terminan en 2.)
  // -------------------------
  function enforceSuperiorUnitRule(optionTargets, target, ramp) {
    const unit = Math.abs(target) % 10;
    const [tMin, tMax] = ramp;

    // Ensure exactly one equals target (keep the first occurrence)
    const result = [target];
    for (const v of optionTargets) {
      if (result.length >= optionTargets.length) break;
      if (v !== target) result.push(v);
    }

    // Ensure at least two share target unit
    let sameUnitCount = result.filter(v => Math.abs(v) % 10 === unit).length;
    let guard = 0;
    while (sameUnitCount < 2 && guard < 1500) {
      guard++;

      // pick an index that isn't the correct one (0)
      const idx = randInt(1, result.length - 1);
      let candidate = result[idx] - (Math.abs(result[idx]) % 10) + unit;

      // bring candidate into ramp bounds in steps of 10
      while (candidate < tMin) candidate += 10;
      while (candidate > tMax) candidate -= 10;

      if (candidate < tMin || candidate > tMax) continue;
      if (candidate <= 1) continue;
      if (candidate === target) continue;
      if (result.includes(candidate)) continue;

      result[idx] = candidate;
      sameUnitCount = result.filter(v => Math.abs(v) % 10 === unit).length;
    }

    return result;
  }

  function renderOptions(optionTargets, ranges, optionCount) {
    // Hide/show buttons based on optionCount
    optionBtns.forEach((btn, idx) => {
      btn.classList.remove('correct', 'wrong', 'locked');
      btn.disabled = false;
      btn.style.visibility = (idx < optionCount) ? 'visible' : 'hidden';
    });

    for (let i = 0; i < optionCount; i++) {
      const t = optionTargets[i];
      const addends = findAddendsForSum(t, ranges.a, ranges.b);

      // With feasible targets this should always succeed. Keep a safe fallback anyway.
      if (!addends) {
        const [aMin, aMax] = ranges.a;
        const a = randInt(aMin, aMax);
        const b = t - a;
        optionBtns[i].textContent = `${a} + ${b}`;
        continue;
      }

      const [a, b] = addends;
      optionBtns[i].textContent = `${a} + ${b}`;
    }
  }

  // -------------------------
  // Target falling
  // -------------------------
  function stopStepTimer() {
    if (stepTimer) clearInterval(stepTimer);
    stepTimer = null;
  }

  function setTargetVisual(stepIndex) {
    // stepIndex 0..MAX_STEPS
    const topStart = 12; // %
    const topEnd = 82;   // %
    const t = topStart + (topEnd - topStart) * (stepIndex / MAX_STEPS);
    if (targetEl) targetEl.style.top = `${t}%`;
  }

  function resetTurnPosition() {
    stepsLeft = MAX_STEPS;
    setTargetVisual(0);
    renderTimer();
  }

  function startStepTimer(timeSec) {
    stopStepTimer();
    const stepMs = (timeSec * 1000) / MAX_STEPS;
    let stepIndex = 0;
    stepTimer = setInterval(() => {
      if (!turnActive) return;
      stepIndex++;
      stepsLeft = Math.max(0, MAX_STEPS - stepIndex);
      setTargetVisual(stepIndex);
      renderTimer();
      if (stepIndex >= MAX_STEPS) {
        stopStepTimer();
        turnActive = false;
        recordTurnNow();
        showEndFlow('GAMEOVER');
      }
    }, stepMs);
  }

  // -------------------------
  // Star reward animation
  // -------------------------
  let starPopEl = null;
  function ensureStarPop() {
    if (starPopEl) return;
    starPopEl = document.createElement('div');
    starPopEl.id = 'star-pop';
    starPopEl.innerHTML = '<div class="big-star">★</div>';
    gameScreen.appendChild(starPopEl);
  }

  async function playStarReward() {
    ensureStarPop();
    playSfx('levelUp');

    // Flash all stars
    if (starsEl) starsEl.classList.add('flash');
    if (starsEl) setTimeout(() => starsEl.classList.remove('flash'), 600);

    // Big star pop (visible long enough)
    starPopEl.classList.add('show');
    await sleep(STAR_REWARD_MS);
    starPopEl.classList.remove('show');
  }

  // -------------------------
  // Level up overlay (opción 1: clara y directa)
  // -------------------------
  let levelUpEl = null;
  function ensureLevelUp() {
    if (levelUpEl) return;
    levelUpEl = document.createElement('div');
    levelUpEl.id = 'levelup';
    levelUpEl.innerHTML = `
      <div class="levelup-box">
        <div class="levelup-title">¡Nivel superado!</div>
        <div class="levelup-sub" id="levelup-sub">...</div>
        <button class="start-btn" id="levelup-ok" type="button">OK!</button>
      </div>
    `;
    gameScreen.appendChild(levelUpEl);
  }

  async function showLevelUp(nextLabel) {
    ensureLevelUp();
    const sub = $('#levelup-sub', levelUpEl);
    const ok = $('#levelup-ok', levelUpEl);
    if (ok && !ok.dataset.sfxBound) { ok.dataset.sfxBound = '1'; bindSfxClick(ok, 'button'); }
    if (sub) sub.textContent = nextLabel;

    // Pause game, blur background
    turnActive = false;
    stopStepTimer();
    if (gameUi) gameUi.classList.add('blurred');

    levelUpEl.classList.add('active');

    await new Promise((resolve) => {
      const handler = async () => {
        ok.removeEventListener('click', handler);
        levelUpEl.classList.remove('active');
        if (gameUi) gameUi.classList.remove('blurred');
        await runCountdown();
        resolve();
      };
      ok.addEventListener('click', handler);
    });
  }

  // -------------------------
  // Turns
  // -------------------------
  async function nextTurn() {
    const cfg = getConfig();

    resetTurnPosition();

    turnStartMs = Date.now();
    turnsPlayed += 1;

    currentTarget = pickFeasibleTarget(cfg.targetRamp, cfg.ranges);
    if (targetEl) targetEl.style.opacity = '1';
    if (targetEl) targetEl.textContent = String(currentTarget);

    let optionTargets;
    if (currentLevel === 'SUPERIOR') {
      // SUPERIOR (tier 1 y tier 2): 1 correcta + al menos 2 resultados con la misma unidad del TARGET
      optionTargets = buildSuperiorOptions(currentTarget, cfg.options, cfg.targetRamp, cfg.ranges);
    } else {
      optionTargets = buildOptions(currentTarget, cfg.options, cfg.targetRamp, cfg.ranges);
    }

    renderOptions(optionTargets, cfg.ranges, cfg.options);

    turnActive = true;
    startStepTimer(cfg.timeSec);

    // Render HUD
    renderScore();
    renderStars();
    renderStreak(cfg.streakGoal);
  }

  function resetRunState() {
    score = 0;
    stars = 0;
    streak = 0;
    lives = 6;
    turnTimesSec = [];
    turnsPlayed = 0;
    renderScore();
    renderStars();
    renderStreak(getConfig().streakGoal);
    renderLives();
  }

  async function startRun() {
    resetRunState();

    runStartMs = Date.now();

    // Hide any leftover visuals before first countdown
    if (targetEl) targetEl.textContent = '';
    if (targetEl) targetEl.style.opacity = '0';
    optionBtns.forEach((b) => { b.textContent = ''; b.style.visibility = 'hidden'; });

    showScreen(gameScreen);
    await runCountdown();
    await nextTurn();
  }

  // -------------------------
  // Answer handling
  // -------------------------
  async function handleAnswer(btn) {
    if (!turnActive) return;

    const cfg = getConfig();
    turnActive = false;
    stopStepTimer();
    recordTurnNow();

    const parts = btn.textContent.split('+').map((s) => parseInt(s.trim(), 10));
    const chosen = (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) ? (parts[0] + parts[1]) : NaN;
    const isCorrect = (chosen === currentTarget);

    // SFX: correct uses button click, wrong uses ONLY wrong
    if (isCorrect) {
      playSfx('button');
    } else {
      playSfx('wrong');
    }


    optionBtns.forEach((b)=>{ if(b!==btn) b.classList.add('locked'); b.disabled=true; });
    btn.classList.add(isCorrect ? 'correct' : 'wrong');

    // Update streak/progress immediately (so the child sees the reward before countdown)
    if (!isCorrect) {
      streak = 0;
      lives = Math.max(0, lives - 1);
      renderLives();
      renderStreak(cfg.streakGoal);
      await nextPaint();
      if (lives <= 0) {
        showEndFlow('GAMEOVER');
        return;
      }
    } else {
      // Speed-based scoring: each turn starts at 10 points and loses 1 point per second until solved.
      const elapsedSec = Math.floor(Math.max(0, (Date.now() - turnStartMs) / 1000));
      const gained = Math.max(0, 10 - elapsedSec);
      score += gained;
      streak += 1;
      renderScore();
      renderStreak(cfg.streakGoal);
      await nextPaint();
    }

    await sleep(FEEDBACK_MS);
    // keep result visible a moment, then reset
    optionBtns.forEach((b) => { b.classList.remove('correct','wrong','locked'); b.disabled=false; });
    await sleep(200);

    if (!isCorrect) {
      await runCountdown();
      await nextTurn();
      return;
    }

    if (streak >= cfg.streakGoal) {
      streak = 0;
      stars += 1;
      renderStars();
      renderStreak(cfg.streakGoal);

      // Paint the filled star/progress before the star celebration & countdown
      await nextPaint();

      await playStarReward();

      if (stars >= MAX_STARS) {
        stars = 0;
        renderStars();

        if (currentSub === 'BASICO') {
          currentSub = 'AVANZADO';
          sendProgressScore(`${currentLevel}-TIER2`);
          await showLevelUp(`${currentLevel} · AVANZADO desbloqueado`);
        } else {
          if (currentLevel === 'INICIAL') {
            currentLevel = 'MEDIO'; currentSub = 'BASICO';
            sendProgressScore('INICIAL-COMPLETE');
            await showLevelUp('MEDIO desbloqueado');
          } else if (currentLevel === 'MEDIO') {
            currentLevel = 'SUPERIOR'; currentSub = 'BASICO';
            sendProgressScore('MEDIO-COMPLETE');
            await showLevelUp('SUPERIOR desbloqueado');
          } else {
            sendProgressScore('SUPERIOR-COMPLETE');
            showEndFlow('VICTORY');
            return;
          }
        }
      } else {
        await runCountdown();
      }

      await nextTurn();
      return;
    }

    await runCountdown();
    await nextTurn();
  }

  optionBtns.forEach((btn) => btn.addEventListener('click', () => { unlockAudioOnce(); handleAnswer(btn); }));

  
  // -------------------------
  // END SCREEN (GAME OVER / VICTORY)
  // -------------------------
  const endTitleEl = $('#end-title');
  const endSubtitleEl = $('#end-subtitle');
  const endLevelsEl = $('#end-levels');
  const endAvgEl = $('#end-avg');
  const endBestEl = $('#end-best');
  const endTotalEl = $('#end-total');
  const endTotalMmSsEl = $('#end-total-mmss');

  const finalScoreEl = $('#final-score');          // reused for SCORE value
  const submitScoreBtn = $('#submit-score-btn');
  const restartBtn = $('#restart-btn');
  const saveStatusEl = $('#save-status');
  const lbYourScoreEl = $('#lb-your-score');
  const leaderboardAgainBtn = $('#leaderboard-again-btn');

  function showSaveStatus(msg) {
    if (!saveStatusEl) return;
    saveStatusEl.textContent = msg;
    saveStatusEl.classList.remove('hidden');
  }
  function hideSaveStatus() {
    if (!saveStatusEl) return;
    saveStatusEl.classList.add('hidden');
  }


// -------------------------
// LEADERBOARD (TOP 10) — fetch from Apps Script (if CORS/JSON enabled)
// Expected common formats:
// 1) JSON array of objects: [{player, score, level, time}, ...]
// 2) JSON object: {data:[...]} or {top10:[...]}
// 3) JSON array of arrays: [[player, score, level, time], ...]
// -------------------------
const lbListInicialEl = document.getElementById('lb-list-inicial');
const lbListMedioEl   = document.getElementById('lb-list-medio');
const lbListSuperiorEl= document.getElementById('lb-list-superior');

function normalizeLeaderboardRows(raw) {
  if (!raw) return [];
  const data = Array.isArray(raw) ? raw : (raw.data || raw.top10 || raw.rows || raw.scores || []);
  if (!Array.isArray(data)) return [];

  // array of arrays
  if (data.length && Array.isArray(data[0])) {
    return data.map((r) => ({
      player: String(r[0] ?? '').trim(),
      score: Number(r[1] ?? 0) || 0,
      level: String(r[2] ?? '').trim(),
      time: Number(r[3] ?? 0) || 0,
    }));
  }

  // array of objects
  return data.map((r) => ({
    player: String(r.player ?? r.name ?? r.username ?? '').trim(),
    score: Number(r.score ?? r.points ?? 0) || 0,
    level: String(r.level ?? r.mode ?? '').trim(),
    time: Number(r.time ?? r.seconds ?? 0) || 0,
  }));
}

function renderLeaderboard(rows) {
  const safe = (s) => (s || '').toString().replace(/[<>]/g, '');
  const norm = (lv) => {
    const u = String(lv || '').toUpperCase().trim();
    const base = u.split(/[-_\s]/)[0]; // INICIAL-BASICO -> INICIAL
    if (base.includes('INICIAL')) return 'INICIAL';
    if (base.includes('MEDIO')) return 'MEDIO';
    if (base.includes('SUPERIOR')) return 'SUPERIOR';
    // fallback: try contains
    if (u.includes('INICIAL')) return 'INICIAL';
    if (u.includes('MEDIO')) return 'MEDIO';
    if (u.includes('SUPERIOR')) return 'SUPERIOR';
    return 'OTROS';
  };

  const groups = { INICIAL: [], MEDIO: [], SUPERIOR: [] };
  (rows || []).forEach((r) => {
    const k = norm(r.level);
    if (groups[k]) groups[k].push(r);
  });

  // Sort each group (score desc, time asc)
  Object.keys(groups).forEach((k) => {
    groups[k].sort((a, b) => {
      const sd = (Number(b.score) || 0) - (Number(a.score) || 0);
      if (sd !== 0) return sd;
      return (Number(a.time) || 0) - (Number(b.time) || 0);
    });
  });

  const fmtTime = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m.toString().padStart(2,'0')}:${r.toString().padStart(2,'0')}`;
  };

  const renderTo = (el, list) => {
    if (!el) return;
    el.innerHTML = '';
    list.slice(0, 10).forEach((r) => {
      const li = document.createElement('li');
      li.className = 'lb-row';
      li.innerHTML = `
        <span class="rk-name">${safe((r.player || 'ANON').slice(0, 16))}</span>
        <span class="rk-score">${safe(String(r.score ?? 0))}</span>
        <span class="rk-time">${safe(fmtTime(r.time))}</span>
      `;
      el.appendChild(li);
    });
  };

  renderTo(lbListInicialEl, groups.INICIAL);
  renderTo(lbListMedioEl, groups.MEDIO);
  renderTo(lbListSuperiorEl, groups.SUPERIOR);
}


async function fetchTop10() {
  // Preferred: normal fetch (works if your Apps Script returns CORS headers)
  const variants = [
    '?action=top10',
    '?mode=top10',
    '?top=10',
    '?read=top10',
    '?op=top10',
  ];

  // Small JSONP helper (works even without CORS, but requires the Apps Script to support ?callback=)
  function jsonp(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const cbName = `__si_jsonp_${Date.now()}_${Math.floor(Math.random()*1e9)}`;
      const script = document.createElement('script');
      const cleanup = () => {
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout'));
      }, timeoutMs);

      window[cbName] = (data) => {
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      const glue = url.includes('?') ? '&' : '?';
      script.src = `${url}${glue}callback=${encodeURIComponent(cbName)}&_=${Date.now()}`;
      script.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('JSONP load error'));
      };
      document.head.appendChild(script);
    });
  }

  for (const qs of variants) {
    const url = `${SCORE_ENDPOINT}${qs}`;

    // 1) Try fetch (may fail due to CORS)
    try {
      const res = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const rows = normalizeLeaderboardRows(data);
        if (rows.length) return rows;
      }
    } catch (_) {}

    // 2) Try JSONP (no CORS needed, but the Apps Script must wrap JSON if callback is present)
    try {
      const data = await jsonp(url);
      const rows = normalizeLeaderboardRows(data);
      if (rows.length) return rows;
    } catch (_) {}
  }
  return [];
}

async function showLeaderboardAndLoad() {
  showScreen(leaderboardScreen);
  [lbListInicialEl, lbListMedioEl, lbListSuperiorEl].forEach((el) => {
    if (el) el.innerHTML = '<li class="lb-empty">Cargando...</li>';
  });
  const rows = await fetchTop10();
  renderLeaderboard(rows);
}


  function currentEndLevelLabel(kind) {
    // kind: 'GAMEOVER' | 'VICTORY'
    return `${currentLevel}-${currentSub}-${kind}`;
  }

  function fillEndStats() {
    const totalSec = (Date.now() - runStartMs) / 1000;
    const avg = turnTimesSec.length ? (turnTimesSec.reduce((a,b)=>a+b,0) / turnTimesSec.length) : 0;
    const best = turnTimesSec.length ? Math.min(...turnTimesSec) : 0;

    if (finalScoreEl) finalScoreEl.textContent = String(score).padStart(6, '0');
    if (endLevelsEl) endLevelsEl.textContent = String(turnsPlayed || 0);
    if (endAvgEl) endAvgEl.textContent = `${formatSec1(avg)} s`;
    if (endBestEl) endBestEl.textContent = `${formatSec1(best)} s`;
    if (endTotalEl) endTotalEl.textContent = `${formatSec1(totalSec)} s`;
    if (endTotalMmSsEl) endTotalMmSsEl.textContent = formatTotalMmSs(totalSec);

    if (lbYourScoreEl) lbYourScoreEl.textContent = String(score);
  }

  function showEndFlow(kind) {
    // kind: 'GAMEOVER' | 'VICTORY'
    if (kind === 'GAMEOVER') playSfx('gameOver');
    if (kind === 'VICTORY') playSfx('levelUp');
    stopStepTimer();
    turnActive = false;

    // record the current turn time if the run ended mid-turn
    recordTurnNow();

    hideSaveStatus();
    const input = document.getElementById('player-name');
    if (input) input.value = '';

    if (endTitleEl) endTitleEl.textContent = (kind === 'VICTORY') ? 'CONGRATULATIONS' : 'GAME OVER';
    if (endSubtitleEl) {
      endSubtitleEl.textContent = (kind === 'VICTORY')
        ? 'YOU COMPLETED ALL LEVELS'
        : 'THE NUMBER TOUCHED THE BASE';
    }

    fillEndStats();
    showScreen(gameoverScreen);

    // store kind for saving
    gameoverScreen.dataset.endKind = kind;
  }

  async function saveEndScoreAndGoToScores() {
    const input = document.getElementById('player-name');
    const player = ((input?.value || '').trim() || 'ANON');

    const kind = gameoverScreen?.dataset?.endKind || 'GAMEOVER';

    const payload = {
      player,
      score,
      level: currentEndLevelLabel(kind),
      time: getRunTimeSeconds(),
    };

    showSaveStatus('Guardando puntuación...');
    // 1) Save to Google Forms (disabled)
    const formRes = { ok: false, reason: 'forms_disabled' };
    console.log('[Scores] Form result:', formRes);

    // 2) (Optional) also ping Apps Script as backup (and to keep current TOP10 source consistent)
    const apiRes = await sendScoreToSheet(payload);
    console.log('[Scores] AppsScript ping result:', apiRes);

    // Brief delay so the newly appended row appears in the next Top10 call.
    await sleep(900);

    showSaveStatus('¡Guardado!');
    await showLeaderboardAndLoad();
  }

  // Bind buttons (once)
  if (submitScoreBtn && !submitScoreBtn.dataset.bound) {
    submitScoreBtn.dataset.bound = '1';
    bindSfxClick(submitScoreBtn, 'button');
    submitScoreBtn.addEventListener('click', saveEndScoreAndGoToScores);
  }
  if (restartBtn && !restartBtn.dataset.bound) {
    restartBtn.dataset.bound = '1';
    bindSfxClick(restartBtn, 'button');
    restartBtn.addEventListener('click', () => showScreen(difficultyScreen));
  }
  if (leaderboardAgainBtn && !leaderboardAgainBtn.dataset.bound) {
    leaderboardAgainBtn.dataset.bound = '1';
    bindSfxClick(leaderboardAgainBtn, 'button');
    leaderboardAgainBtn.addEventListener('click', () => showScreen(difficultyScreen));
  }

  // -------------------------
  // UI FLOW: coin -> start -> level select -> rules -> game
  // -------------------------
  // -------------------------
  function enableStart() {
    startBtn.classList.remove('disabled');
    startBtn.classList.add('ready');
  }
  function disableStart() {
    startBtn.classList.add('disabled');
    startBtn.classList.remove('ready');
  }

  disableStart();
  showScreen(startScreen);

  // Button SFX bindings (non-answer buttons)
  bindSfxClick(startBtn, 'button');
  bindSfxClick(top10Btn, 'button');
  bindSfxClick(diffInicial, 'button');
  bindSfxClick(diffMedio, 'button');
  bindSfxClick(diffSuperior, 'button');
  bindSfxClick(diffBack, 'button');
  bindSfxClick(rulesOkBtn, 'button');
  bindSfxClick(rulesBackBtn, 'button');

  // Rules screen BACK: return to difficulty selection
  if (rulesBackBtn && !rulesBackBtn.dataset.bound) {
    rulesBackBtn.dataset.bound = '1';
    rulesBackBtn.addEventListener('click', () => {
      unlockAudioOnce();
      playSfx('button');
      showScreen(difficultyScreen);
    });
  }

  insertCoinEl.addEventListener('click', () => {
    playSfx('insertCoin');
    if (coinInserted) return;
    coinInserted = true;
    // Hide INSERT COIN without shifting layout and stop any blink animation.
    // Some markup wraps the text in a child with .blink, so remove it from descendants too.
    insertCoinEl.classList.add('coin-hidden');
    insertCoinEl.setAttribute('aria-hidden', 'true');
    insertCoinEl.style.visibility = 'hidden';
    insertCoinEl.style.pointerEvents = 'none';
    // Kill blink on this node and any children
    insertCoinEl.classList.remove('blink');
    insertCoinEl.querySelectorAll?.('.blink')?.forEach((n) => n.classList.remove('blink'));
    enableStart();
  });

  // IMPORTANT: Start must NOT start directly.
  startBtn.addEventListener('click', () => {
    unlockAudioOnce();
    playSfx('button');
    if (!coinInserted) return;
    showScreen(difficultyScreen);
  });

  if (diffBack) diffBack.addEventListener('click', () => { unlockAudioOnce(); playSfx('button'); showScreen(startScreen); });

  function setRulesText(levelKey) {
    const goal = LEVELS[levelKey].streakGoal;
    rulesTextEl.innerHTML = `
      <p>Necesitas <strong>5 estrellas</strong> para pasar de nivel.</p>
      <p>¿Quieres una estrella? Haz <strong>${goal} sumas seguidas correctas</strong>.</p>
      <p>Si fallas, no pierdes estrellas. Solo se reinicia el contador.</p>
    `;
  }

  function goRules(levelKey) {
    unlockAudioOnce();
    playSfx('button');
    currentLevel = levelKey;
    currentSub = 'BASICO';
    stars = 0;
    streak = 0;
    setRulesText(levelKey);
    showScreen(rulesScreen);
  }

  diffInicial.addEventListener('click', () => goRules('INICIAL'));
  diffMedio.addEventListener('click', () => goRules('MEDIO'));
  diffSuperior.addEventListener('click', () => goRules('SUPERIOR'));

  rulesOkBtn.addEventListener('click', async () => {
    unlockAudioOnce();
    playSfx('button');
    await startRun();
  });

  if (top10Btn) {
    top10Btn.addEventListener('click', async () => {
      unlockAudioOnce();
      playSfx('button');
      await showLeaderboardAndLoad();
    });
  }
})();