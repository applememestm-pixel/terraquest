'use strict';

const LEVELS = {
  easy: { name: 'Изи', points: 10, hint: true, note: 'Столицы с вариантами ответа. Подсказки бесплатны.' },
  normal: { name: 'Норм', points: 20, hint: true, note: 'За поиск на карте — 100, 50 или 25 очков. После трёх ошибок ответ подсвечивается за 0 очков.' },
  hard: { name: 'Хард', points: 35, hint: false, note: 'Без подсказок. Варианты флагов и гербов — соседние страны.' },
  hardcore: { name: 'Хардкор', points: 50, hint: false, note: 'Первая ошибка обнуляет счёт и стирает весь прогресс хардкора.' }
};

const QUIZZES = {
  quick: ['find'],
  full: ['find', 'capital', 'flag', 'arms'],
  flags: ['flag'],
  arms: ['arms'],
  capitals: ['capital'],
  reverse: ['reverse']
};

const PROGRESS_KEY = 'terra-atlas-progress-v2';
const LEGACY_PROGRESS_KEY = 'terra-atlas-progress-v1';
const MAP_POINTS = [100, 50, 25, 0];

function emptyLedger() {
  return { score: 0, completed: {}, painted: {} };
}

function progressKey(difficulty, atlas, mode) {
  return [difficulty, atlas, mode].join(':');
}

function parseStorage(storage, key) {
  try {
    return JSON.parse(storage.getItem(key));
  } catch {
    return null;
  }
}

function readProgress(storage) {
  const stored = parseStorage(storage, PROGRESS_KEY);
  if ([stored?.regular, stored?.hardcore].every(entry => entry?.completed && entry.painted && Number.isFinite(entry.score))) {
    return stored;
  }
  const result = { regular: emptyLedger(), hardcore: emptyLedger() };
  const old = parseStorage(storage, LEGACY_PROGRESS_KEY) || {};
  for (const [id, value] of Object.entries(old)) {
    if (!/^[A-Z]{2}$/.test(id)) continue;
    if (value >= 1) recordSolved(result.regular, progressKey('normal', 'countries', 'quick'), 'countries', id, 0);
    if (value >= 2) recordSolved(result.regular, progressKey('normal', 'countries', 'full'), 'countries', id, 0);
  }
  return result;
}

function recordSolved(ledger, key, atlas, id, points) {
  const completed = (ledger.completed[key] ??= {});
  if (completed[id]) return 0;
  completed[id] = true;
  (ledger.painted[atlas] ??= {})[id] = true;
  ledger.score += points;
  return points;
}

function scoreRound(difficulty, numberOfSteps, usedHint, mapPoints = null) {
  if (mapPoints !== null) return mapPoints;
  const multiplier = difficulty === 'normal' && usedHint ? .5 : 1;
  return Math.floor(LEVELS[difficulty].points * numberOfSteps * multiplier);
}

function saveProgress(storage, value) {
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(value));
  } catch {
    // The current session still retains its score when browser storage is unavailable.
  }
}
