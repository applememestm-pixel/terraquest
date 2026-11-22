'use strict';

const $ = id => document.getElementById(id);
const regions = {
  World: { name: 'Весь мир', progress: 'Изучено в мире', center: [12, 12] },
  Africa: { name: 'Африка', progress: 'Изучено в Африке', center: [19, 3] },
  Europe: { name: 'Европа', progress: 'Изучено в Европе', center: [17, 52] },
  Asia: { name: 'Азия', progress: 'Изучено в Азии', center: [93, 36] },
  'North America': { name: 'Северная Америка', progress: 'Изучено в Северной Америке', center: [-99, 39] },
  'South America': { name: 'Южная Америка', progress: 'Изучено в Южной Америке', center: [-60, -15] },
  Oceania: { name: 'Океания', progress: 'Изучено в Океании', center: [149, -17] }
};
const stageNames = {
  find: 'Поиск на карте', reverse: 'Страна по столице', capital: 'Столица',
  flag: 'Флаг', arms: 'Герб', done: 'Задание выполнено', complete: 'Прогресс',
  lost: 'Хардкор', explore: 'Историческая карта'
};
const countryForms = { RU:'Россию', US:'США', CA:'Канаду', AU:'Австралию', BR:'Бразилию', GH:'Гану', KE:'Кению', DE:'Германию', FR:'Францию', IT:'Италию', ES:'Испанию', JP:'Японию', CN:'Китай', IN:'Индию', EG:'Египет', GB:'Великобританию', NZ:'Новую Зеландию', AR:'Аргентину', MX:'Мексику', ZA:'ЮАР' };
const atlasInfo = {
  countries: { unit: 'страну', source: 'Natural Earth', url: 'https://www.naturalearthdata.com/' },
  japan: { unit: 'префектуру', center: [138, 35], globeZoom: 3.5 },
  russia: { unit: 'субъект', center: [95, 62], globeZoom: 1.5 },
  usa: { unit: 'штат', center: [-122, 43], globeZoom: 1.35 },
  history: { unit: 'территорию', center: [20, 29] }
};
let atlas = 'countries';
let historyYear;
let historySelection;
let browsingProfiles = false;
let features;
let countries;
let byId;
let geometryById;
let atlasData;
const browserStorage = (() => {
  try { return globalThis.terraStorage || localStorage; } catch { return null; }
})();
let progress = readProgress(browserStorage);
let cloudGame = false;
let region = 'World';
let mode = 'quick';
let countryMode = 'quick';
let difficulty = 'normal';
let usedHint = false;
let roundPoints = 0;
let mapMisses = 0;
let mapPoints = null;
let colorMode = 'natural';
let view = 'globe';
let round = [];
let target;
let stage = 'find';
let questionOptions = [];
let wrongId;
let reveal = false;
let hoverId;
let zoom = 1;
let spin = [-12, -12];
let offset = [0, 0];
let frame;
let pulseStart = null;
let flight;
let width;
let height;
let pixelRatio;
let projectedAtlas;
let hitCamera;
let hitShapes = [];
let hitDots = [];
const sphere = {type: 'Sphere'};
const graticule = d3.geoGraticule().step([20, 20])();
const canvas = $('atlas');
const ctx = canvas.getContext('2d');
const hitContext = document.createElement('canvas').getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const images = new Map();

function element(tag, content, options = {}) {
  const el = document.createElement(tag);
  Object.assign(el, options);
  if (content != null) el.textContent = content;
  return el;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const isWorld = () => atlas === 'countries';
const isHistory = () => atlas === 'history';
const isMapQuestion = () => stage === 'find' || stage === 'reverse';
const usesMapPoints = () => difficulty === 'normal' && isMapQuestion();
const ledger = () => difficulty === 'hardcore' ? progress.hardcore : progress.regular;
const setKey = (quiz = mode) => progressKey(difficulty, atlas, quiz);
const inRegion = (key = region) => countries.filter(country => key === 'World' || country.region === key);
const studied = (country, quiz = mode) => Boolean(ledger().completed[setKey(quiz)]?.[country.id]);
const painted = country => Boolean(ledger().painted[atlas]?.[country.id]);
const remaining = () => inRegion().filter(country => !studied(country));
const formatNumber = new Intl.NumberFormat('ru-RU');

function say(message = '', tone = '') {
  $('feedback').textContent = message;
  $('feedback').dataset.tone = tone;
}

function updateProgress() {
  if (isHistory()) return;
  const pool = inRegion();
  const earned = pool.filter(country => studied(country)).length;
  $('score-label').textContent = difficulty === 'hardcore' ? 'Счёт хардкора' : 'Общий счёт';
  $('score').textContent = formatNumber.format(ledger().score);
  $('progress-label').textContent = 'Пройдено в режиме';
  $('progress-count').textContent = earned + ' / ' + pool.length;
  $('progress-bar').max = Math.max(1, pool.length);
  $('progress-bar').value = earned;
}

function nextQuestion() {
  target = round.find(country => !studied(country));
  questionOptions = [];
  usedHint = false;
  roundPoints = 0;
  mapMisses = 0;
  mapPoints = null;
  wrongId = null;
  reveal = false;
  hoverId = null;
  pulseStart = null;
  flight = null;
  canvas.style.cursor = '';
  changeStage(target ? QUIZZES[mode][0] : 'complete');
  updateProgress();
  requestDraw();
}

function startRound(preferredId) {
  round = shuffle(remaining());
  const preferred = round.findIndex(country => country.id === preferredId);
  if (preferred >= 0) round.unshift(...round.splice(preferred, 1));
  nextQuestion();
}

function title(lead, name) {
  const el = element('h2', lead);
  if (name) el.append(element('strong', name));
  return el;
}

function actionButton(label, handler, className = 'button primary next-button') {
  const button = element('button', label, { type: 'button', className });
  button.addEventListener('click', handler);
  return button;
}

function renderQuestion() {
  $('stage-label').textContent = stageNames[stage].toLocaleUpperCase('ru');
  const steps = isHistory() ? [] : QUIZZES[mode];
  const active = ['done', 'complete'].includes(stage) ? steps.length - 1 : steps.indexOf(stage);
  $('steps').replaceChildren(...steps.map((_, i) => element('i', null, { className: i <= active ? 'active' : '' })));
  $('steps').hidden = active < 0;
  if (active >= 0) $('steps').setAttribute('aria-label', 'Этап ' + (active + 1) + ' из ' + steps.length);
  const box = $('question');
  box.replaceChildren();
  const hasQuestion = !['done', 'complete', 'lost', 'explore'].includes(stage);
  $('hint').hidden = !LEVELS[difficulty].hint || usesMapPoints();
  $('skip').hidden = difficulty === 'hardcore';
  document.querySelector('.question-actions').hidden = !hasQuestion || difficulty === 'hardcore';
  $('country-list').disabled = !isMapQuestion() && !isHistory();
  if (stage === 'find') {
    const form = isWorld() && countryForms[target.id];
    box.append(title(form ? 'Найди на карте' : 'Найди ' + atlasInfo[atlas].unit, form || target.name));
    box.append(element('p', 'Нажми на карте или выбери ответ из списка.', { className: 'question-copy' }));
  } else if (stage === 'reverse') {
    box.append(title('Найди страну по столице', target.capitals[0]));
    box.append(element('p', 'Нажми на страну на карте или выбери её из списка.', { className: 'question-copy' }));
  } else if (stage === 'capital') {
    renderCapitalQuestion(box);
  } else if (stage === 'flag' || stage === 'arms') {
    const isFlag = stage === 'flag';
    box.append(title(isFlag ? 'Выбери флаг' : 'Выбери герб или эмблему', target.name));
    if (!isFlag && ['LB', 'LY', 'TR'].includes(target.id)) {
      box.append(element('p', 'У страны нет официального герба. Выбери используемую эмблему.', { className: 'question-copy' }));
    }
    const options = element('div', null, { className: isFlag ? 'choices' : 'choices emblems' });
    for (const [index, country] of questionOptions.entries()) {
      const button = actionButton(null, () => {
        if (country.id === target.id) {
          advanceQuestion();
        } else {
          button.disabled = true;
          incorrect('Попробуй другой вариант.');
        }
      }, 'choice');
      button.setAttribute('aria-label', 'Вариант ' + (index + 1));
      const urls = isFlag
        ? [country.flag, ...globalThis.TERRA_OFFLINE ? [] : ['https://flagcdn.com/w160/' + country.id.toLowerCase() + '.png']]
        : country.armsSources;
      let sourceIndex = 0;
      const img = element('img', null, { alt: '', referrerPolicy: 'no-referrer' });
      button.disabled = true;
      img.addEventListener('load', () => { button.disabled = false; });
      const questionTarget = target;
      img.addEventListener('error', () => {
        sourceIndex++;
        if (sourceIndex < urls.length) {
          img.src = urls[sourceIndex];
        } else {
          img.hidden = true;
          button.disabled = true;
          if (questionTarget === target && stage === (isFlag ? 'flag' : 'arms') && country.id === target.id) {
            say('Изображение не загрузилось.', 'error');
            box.append(actionButton('Загрузить снова', () => { say(); renderQuestion(); }));
          }
        }
      });
      img.src = urls[0];
      button.append(img, element('span', 'Вариант ' + (index + 1)));
      options.append(button);
    }
    box.append(options);
  } else if (stage === 'done') {
    const result = roundPoints ? '+' + formatNumber.format(roundPoints) + ' к счёту' : '0 очков за ответ с подсветкой';
    box.append(title('Верно!', target.name), element('p', result, { className: 'question-copy points' }));
    if (isWorld()) {
      box.append(countryCard(COUNTRY_INFO.profiles[target.id]));
      box.append(element('a', 'Страна и фотографии в каталоге', { href: '#catalog/' + target.id, className: 'catalog-inline' }));
    }
    box.append(actionButton('Следующее задание', nextQuestion));
  } else if (stage === 'lost') {
    box.append(title('Попытка закончена'), element('p', 'Счёт, раскраска и пройденные задания хардкора сброшены.', { className: 'question-copy' }), actionButton('Новая попытка', () => startRound()));
  } else if (stage === 'explore') {
    box.append(title(historySelection?.name || atlasData.title));
    box.append(element('p', historySelection ? atlasData.title + ' · исторические границы' : atlasData.note, { className: 'question-copy' }));
    if (historySelection) box.append(actionButton('Снять выделение', () => selectHistoryTerritory(), 'button subtle next-button'));
  } else {
    const skipped = remaining().length > 0;
    if (skipped) {
      box.append(title('Раунд завершён'), element('p', 'Пропущенные страны вернутся в новом раунде.', { className: 'question-copy' }), actionButton('Новый раунд', () => startRound()));
    } else {
      box.append(title('Все задания пройдены'), element('p', 'Другие задания есть в настройках атласа, режима и сложности.', { className: 'question-copy' }));
    }
  }
  updateAttemptScore();
}

function updateAttemptScore() {
  const line = $('attempt-score');
  line.hidden = !usesMapPoints();
  if (usesMapPoints()) line.textContent = 'Очки за ответ: ' + MAP_POINTS[mapMisses];
}

const compactNumber = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

function sourceLink(name, url) {
  if (globalThis.TERRA_OFFLINE) return element('span', name);
  return element('a', name, { href: url, target: '_blank', rel: 'noopener' });
}

function countryCard(info) {
  const panel = element('section', null, { className: 'country-card' });
  panel.setAttribute('aria-label', 'Справка о стране');
  const stats = element('dl', null, { className: 'country-metrics' });
  const metrics = [
    ['Население', info.population, 'чел.'],
    ['Номинальный ВВП', info.gdp, 'долл. США'],
    ['ВВП по ППС', info.ppp, 'межд. долл.']
  ];
  for (const [name, metric, unit] of metrics) {
    const item = element('div');
    const amount = metric ? compactNumber.format(metric.value) + ' ' + unit : 'Нет данных';
    const value = element('dd', amount);
    if (metric) {
      value.title = formatNumber.format(metric.value) + ' ' + unit;
      value.append(element('small', String(metric.year)));
    }
    item.append(element('dt', name), value);
    stats.append(item);
  }
  panel.append(stats);

  const system = element('dl', null, { className: 'country-system' });
  for (const [name, value] of [
    ['Форма правления', info.government],
    ['Устройство', info.structure],
    ['Политический режим', info.regime ? info.regime.label + ' · ' + info.regime.year : 'Нет оценки V-Dem']
  ]) {
    const row = element('div');
    row.append(element('dt', name), element('dd', value || 'Нет данных'));
    system.append(row);
  }
  panel.append(system);

  if (info.unions.length) {
    const unions = element('div', null, { className: 'country-unions' });
    for (const id of info.unions) {
      const { name, url } = COUNTRY_INFO.unions[id];
      unions.append(sourceLink(name, url));
    }
    panel.append(element('h3', 'Союзы и объединения'), unions);
  }

  const history = element('ul', null, { className: 'country-facts' });
  for (const fact of info.facts) history.append(element('li', fact));
  panel.append(element('h3', 'Из истории'), history);
  const details = element('details', null, { className: 'country-sources' });
  details.append(element('summary', 'Источники'));
  const sources = element('ul');
  for (const [name, url] of Object.entries({ ...COUNTRY_INFO.sources, ...info.sources })) {
    const row = element('li');
    row.append(sourceLink(name, url));
    sources.append(row);
  }
  details.append(sources);
  panel.append(details);
  return panel;
}

function renderCapitalQuestion(box) {
  const choices = difficulty === 'easy';
  box.append(title(choices ? 'Выбери столицу' : 'Назови столицу', target.name));
  if (choices) {
    const options = element('div', null, { className: 'text-choices' });
    questionOptions.forEach(country => {
      const button = actionButton(country.capitals[0], () => {
        if (country.id === target.id) advanceQuestion();
        else {
          button.disabled = true;
          incorrect('Попробуй другую столицу.');
        }
      }, 'button subtle');
      options.append(button);
    });
    box.append(options);
    return;
  }
  const form = element('form', null, { className: 'capital-form' });
  const field = element('input', null, { required: true, autocomplete: 'off', placeholder: 'Название столицы' });
  field.setAttribute('aria-label', 'Название столицы');
  form.append(field, element('button', 'Проверить', { className: 'button primary', type: 'submit' }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const answer = normalize(field.value);
    if (!answer) return;
    if (target.capitals.some(capital => normalize(capital) === answer)) advanceQuestion();
    else incorrect('Попробуй ещё раз.');
  });
  box.append(form);
}

function normalize(text) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
}

function changeStage(next) {
  stage = next;
  if (next === 'flag' || next === 'arms' || (next === 'capital' && difficulty === 'easy')) {
    const field = { flag: 'flag', arms: 'armsSources', capital: 'capitals' }[next];
    const correctCapitals = next === 'capital' ? new Set(target.capitals.map(normalize)) : null;
    let others = shuffle(countries.filter(country => country.id !== target.id && country[field]?.length));
    if (correctCapitals) {
      const seen = new Set(correctCapitals);
      others = others.filter(country => {
        const name = normalize(country.capitals[0]);
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
    }
    if (!LEVELS[difficulty].hint) {
      others.sort((a, b) => d3.geoDistance(a.point, target.point) - d3.geoDistance(b.point, target.point));
    } else if (difficulty === 'normal') {
      others.sort((a, b) => (b.region === target.region) - (a.region === target.region));
    }
    questionOptions = shuffle([target, ...others.slice(0, 3)]);
  }
  say();
  renderQuestion();
}

function advanceQuestion() {
  const steps = QUIZZES[mode];
  const next = steps[steps.indexOf(stage) + 1];
  if (next) {
    changeStage(next);
    return;
  }
  const alreadySolved = studied(target);
  roundPoints = recordSolved(ledger(), setKey(), atlas, target.id, scoreRound(difficulty, steps.length, usedHint, mapPoints));
  if (!alreadySolved) persistGame({ type: 'solve', key: setKey(), id: target.id, points: roundPoints });
  updateProgress();
  changeStage('done');
  requestDraw();
}

function incorrect(message) {
  if (difficulty !== 'hardcore') {
    say(message, 'error');
    requestDraw();
    return;
  }
  progress.hardcore = emptyLedger();
  persistGame({ type: 'reset' });
  showLostAttempt();
}

function persistGame(change) {
  if (cloudGame) window.dispatchEvent(new CustomEvent('terra:progress', { detail: change }));
  else saveProgress(browserStorage, progress);
}

function showLostAttempt() {
  target = null;
  reveal = false;
  wrongId = null;
  hoverId = null;
  pulseStart = null;
  flight = null;
  updateProgress();
  changeStage('lost');
  requestDraw();
}

function focusCountry(country, minimumZoom) {
  if (view === 'map') {
    const [px, py] = getProjectedAtlas().projection(country.point);
    const { scale, x: tx, y: ty } = cameraTransform(1);
    const x = px * scale + tx;
    const y = py * scale + ty;
    if (x < 40 || x > width - 40 || y < 56 || y > height - 56) {
      offset[0] += width / 2 - x;
      offset[1] += height / 2 - y;
    }
    requestDraw();
    return;
  }
  const [lon, lat] = d3.geoCentroid(geometryById.get(country.id));
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  const end = [spin[0] + wrap(-lon - spin[0]), Math.max(-82, Math.min(82, -lat))];
  if (reducedMotion.matches) {
    spin = end;
    zoom = Math.max(zoom, minimumZoom);
  } else {
    flight = { start: performance.now(), spin: [...spin], end, zoom, endZoom: Math.max(zoom, minimumZoom) };
  }
  requestDraw();
}

function chooseCountry(id) {
  if (isHistory()) {
    selectHistoryTerritory(id);
    return;
  }
  if (!isMapQuestion() || !target) return;
  const country = byId.get(id);
  if (id !== target.id) {
    if (usesMapPoints()) {
      mapMisses = Math.min(mapMisses + 1, 3);
      updateAttemptScore();
      if (mapMisses === 3) {
        wrongId = null;
        if (!reveal) focusCountry(target, 1);
        reveal = true;
        say('Ответ подсвечен. Нажми на него, чтобы завершить это задание без очков.');
        requestDraw();
        return;
      }
    }
    wrongId = id;
    incorrect(country && LEVELS[difficulty].hint ? 'Это ' + country.name + '. Попробуй ещё раз.' : 'Попробуй ещё раз.');
    return;
  }
  if (usesMapPoints()) mapPoints = MAP_POINTS[mapMisses];
  reveal = false;
  wrongId = null;
  pulseStart = performance.now();
  focusCountry(country, 1);
  advanceQuestion();
  requestDraw();
}

function showHint() {
  if (!target || !LEVELS[difficulty].hint || usesMapPoints()) return;
  usedHint = true;
  if (isMapQuestion()) {
    focusCountry(target, 1);
    reveal = true;
    say('Ответ выделен на карте.');
    requestDraw();
  } else if (stage === 'capital') {
    say('Первая буква: ' + (target.capitals[0]?.[0] || '—') + '.');
  } else {
    const index = questionOptions.indexOf(target) + 1;
    say('Правильный вариант — ' + index + '.');
  }
}

function countryPicker() {
  const results = $('country-options');
  const query = normalize($('country-search').value);
  const pool = browsingProfiles ? WORLD.countries.filter(country => ledger().painted.countries?.[country.id]) : inRegion();
  const filtered = pool.filter(country => normalize(country.name).includes(query));
  results.replaceChildren(...filtered.sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(country =>
    actionButton(country.name, () => {
      $('countries-dialog').close();
      if (browsingProfiles) {
        $('profile-title').textContent = country.name;
        $('profile-details').replaceChildren(countryCard(COUNTRY_INFO.profiles[country.id]));
        $('profile-dialog').showModal();
      } else {
        chooseCountry(country.id);
      }
    }, 'button subtle')
  ));
  if (!filtered.length) results.append(element('p', 'Совпадений нет.'));
}

function openCountryList(profiles = false) {
  browsingProfiles = profiles;
  $('countries-title').textContent = profiles ? 'Изученные страны' : isWorld() ? 'Список стран' : 'Список на карте';
  $('country-search').value = '';
  countryPicker();
  $('countries-dialog').showModal();
  $('country-search').focus();
}

function progressDialog() {
  const list = element('ul', null, { className: 'stats' });
  const recorded = ledger().painted;
  const pools = { countries: WORLD.countries, japan: ATLAS_DATA.japan.countries, russia: ATLAS_DATA.russia.countries, usa: ATLAS_DATA.usa.countries };
  for (const [key, items] of Object.entries(pools)) {
    const count = items.filter(country => recorded[key]?.[country.id]).length;
    const row = element('li', null);
    row.append(element('span', $('atlas-set').querySelector('[value="' + key + '"]').textContent), element('strong', count + ' / ' + items.length));
    list.append(row);
  }
  const heading = element('p', (difficulty === 'hardcore' ? 'Счёт хардкора' : 'Общий счёт') + ' · ' + formatNumber.format(ledger().score), { className: 'question-copy' });
  $('progress-details').replaceChildren(heading, list);
  if (Object.keys(recorded.countries || {}).length) {
    $('progress-details').append(element('p', '🏅 Первая страна', { className: 'question-copy' }));
    $('progress-details').append(actionButton('Изученные страны', () => {
      $('progress-dialog').close();
      openCountryList(true);
    }, 'button subtle next-button'));
  }
  for (const [key, info] of Object.entries(regions)) {
    if (key === 'World') continue;
    const items = WORLD.countries.filter(country => country.region === key);
    const completed = ledger().completed;
    const full = items.every(country => Object.keys(LEVELS).some(level => completed[progressKey(level, 'countries', 'full')]?.[country.id]));
    if (full) $('progress-details').append(element('p', '🏅 Полный раунд · ' + info.name, { className: 'question-copy' }));
  }
  $('progress-dialog').showModal();
}

function setPressed(attribute, value) {
  document.querySelectorAll('[data-' + attribute + ']').forEach(button =>
    button.setAttribute('aria-pressed', String(button.dataset[attribute] === value))
  );
}

function selectHistoryTerritory(id) {
  historySelection = byId.get(id);
  if (historySelection) focusCountry(historySelection, 1);
  renderQuestion();
  requestDraw();
}

function atlasLabel() {
  return isWorld() ? regions[region].name : isHistory() ? atlasData.title : $('atlas-set').selectedOptions[0].textContent;
}

function setView(next) {
  view = next;
  setPressed('view', view);
  $('atlas-help').textContent = view === 'globe' ? 'Перетащи, чтобы вращать' : 'Перетащи, чтобы перемещать';
  resetCamera();
}

function useAtlas(next, resetView = true) {
  atlas = next;
  historySelection = null;
  atlasData = isWorld() ? WORLD : isHistory() ? ATLAS_DATA.history[historyYear] : ATLAS_DATA[atlas];
  features = atlasData.features;
  countries = atlasData.countries;
  byId = new Map(countries.map(country => [country.id, country]));
  geometryById = new Map(features.map(feature => [feature.id, feature]));
  region = isWorld() ? $('region').value : 'World';
  mode = isWorld() ? countryMode : 'quick';
  $('quiz-mode').value = mode;
  $('atlas-region').textContent = atlasLabel();
  $('country-list').textContent = isWorld() ? 'Список стран' : 'Список';
  $('region').parentElement.hidden = !isWorld();
  $('quiz-mode').parentElement.hidden = !isWorld();
  $('colors').parentElement.hidden = !isWorld();
  $('history-year').parentElement.hidden = !isHistory();
  $('difficulty').parentElement.hidden = isHistory();
  $('difficulty-note').hidden = isHistory();
  $('atlas-note').hidden = !atlasData.notice;
  $('atlas-note').textContent = atlasData.notice || '';
  if (atlasData.noticeSource) $('atlas-note').append(' ', sourceLink('Резолюция ООН', atlasData.noticeSource));
  document.querySelector('.region-progress').hidden = isHistory();
  const source = $('atlas-source');
  source.textContent = atlasData.source || atlasInfo[atlas].source || 'geoBoundaries';
  source.href = atlasData.url || atlasInfo[atlas].url || 'https://www.geoboundaries.org/';
  if (resetView) setView(isWorld() ? 'globe' : 'map');
  else resetCamera();

  if (isHistory()) {
    target = null;
    pulseStart = null;
    wrongId = null;
    reveal = false;
    hoverId = null;
    changeStage('explore');
  } else {
    startRound(isWorld() && region === 'World' ? 'EG' : undefined);
  }
  requestDraw();
}

const cameraCenter = () => isWorld() ? regions[region].center : atlasInfo[atlas].center;

function resetCamera() {
  zoom = view === 'globe' ? atlasInfo[atlas].globeZoom || 1 : 1;
  spin = cameraCenter().map(value => -value);
  offset = [0, 0];
  flight = null;
  requestDraw();
}

function requestDraw() {
  if (frame == null) frame = requestAnimationFrame(draw);
}

function baseProjection(detail, visibleFeatures) {
  if (view === 'globe') {
    return d3.geoOrthographic()
      .rotate(spin).translate([width / 2, height / 2])
      .scale(Math.min(width - 32, height - 78) * .49 * detail).precision(.55);
  }
  const global = isHistory() || (isWorld() && region === 'World');
  const projection = global
    ? d3.geoEqualEarth()
    : d3.geoAzimuthalEqualArea().rotate(cameraCenter().map(value => -value)).clipAngle(125);
  const contents = global ? sphere : { type: 'FeatureCollection', features: visibleFeatures };
  return projection.precision(.75).fitExtent([[25, 54], [width - 25, height - 54]], contents).precision(.12);
}

function makePath(projection, geometry) {
  const path = new Path2D();
  const drawPath = d3.geoPath(projection, path);
  drawPath(geometry);
  return path;
}

function projectTerritories(projection, visibleFeatures) {
  // Use the same clipped polygon stream for painting, area and hit bounds.
  let shape, left, top, right, bottom, area, polygonArea;
  let firstX, firstY, lastX, lastY, first;
  const stream = projection.stream({
    polygonStart() { polygonArea = 0; },
    polygonEnd() { area += Math.abs(polygonArea) / 2; },
    lineStart() { first = true; },
    lineEnd() {
      if (first) return;
      polygonArea += lastX * firstY - firstX * lastY;
      shape.closePath();
    },
    point(x, y) {
      if (first) {
        firstX = x;
        firstY = y;
        shape.moveTo(x, y);
        first = false;
      } else {
        polygonArea += lastX * y - x * lastY;
        shape.lineTo(x, y);
      }
      lastX = x;
      lastY = y;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  });
  const territories = new Map();
  for (const feature of visibleFeatures) {
    shape = new Path2D();
    left = top = Infinity;
    right = bottom = -Infinity;
    area = 0;
    d3.geoStream(feature, stream);
    if (left !== Infinity) territories.set(feature.id, { feature, shape, left, top, right, bottom, area });
  }
  return territories;
}

function getProjectedAtlas() {
  const globe = view === 'globe';
  const detail = globe ? 2 ** Math.round(Math.log2(zoom)) : 1;
  const key = [view, region, width, height, detail, ...(globe ? spin : [])].join('|');
  if (projectedAtlas?.key === key && projectedAtlas.features === features) return projectedAtlas;
  const visibleFeatures = globe || region === 'World' ? features
    : features.filter(feature => byId.get(feature.id)?.region === region);
  const projection = baseProjection(detail, visibleFeatures);
  const territories = projectTerritories(projection, visibleFeatures);
  const center = globe ? projection.invert(projection.translate()) : null;
  const labels = [];
  for (const country of countries) {
    if (!country.point || (region !== 'World' && country.region !== region)) continue;
    if (globe && d3.geoDistance(country.point, center) > Math.PI / 2 - .025) continue;
    const [x, y] = projection(country.point);
    labels.push({ country, x, y, area: territories.get(country.id)?.area || 0 });
  }
  const boundary = globe || isHistory() || (isWorld() && region === 'World') ? makePath(projection, sphere) : null;
  projectedAtlas = { key, features, projection, territories, labels, boundary, detail, grid: makePath(projection, graticule) };
  return projectedAtlas;
}

function cameraTransform(detail) {
  const scale = zoom / detail;
  return { scale, x: width / 2 * (1 - scale) + offset[0], y: height / 2 * (1 - scale) + offset[1] };
}

function useImage(url) {
  if (!images.has(url)) {
    const img = new Image();
    img.addEventListener('load', requestDraw);
    img.src = url;
    images.set(url, img);
  }
  return images.get(url);
}

function naturalColor(country, feature) {
  if (country?.terrain) return country.terrain;
  const [, lat] = d3.geoCentroid(feature);
  if (Math.abs(lat) > 57) return '#9ab7ad';
  if (Math.abs(lat) > 42) return '#87ad72';
  return '#7ba76e';
}

function drawCountry(territory, scale, selected) {
  const { feature, shape, left, top, right, bottom } = territory;
  const id = feature.id;
  const country = byId.get(id);
  const unlocked = country && painted(country);
  const historical = isHistory();
  const hinted = (reveal && id === target?.id) || selected;
  const inactive = region !== 'World' && country?.region !== region;
  ctx.fillStyle = historical ? country?.terrain || '#a3aabe'
    : unlocked ? naturalColor(country, feature)
    : country?.claimed ? '#b7a497' : inactive ? '#7a8497' : '#bac2ce';
  if (historical && historySelection?.id === id) ctx.fillStyle = '#95b3ff';
  if (id === wrongId) ctx.fillStyle = '#ea8193';
  if (hinted && !unlocked) ctx.fillStyle = '#a5bdff';
  if (hoverId === id && (isMapQuestion() || historical) && !unlocked && !hinted && id !== wrongId) ctx.fillStyle = '#dce7ff';
  ctx.fill(shape);
  if (unlocked && colorMode === 'flag' && country.flag) {
    const img = useImage(country.flag);
    if (img.complete && img.naturalWidth) {
      const w = right - left;
      const h = bottom - top;
      if (w > 0 && h > 0 && Number.isFinite(w * h)) {
        ctx.save();
        ctx.clip(shape);
        ctx.drawImage(img, left, top, w, h);
        ctx.restore();
      }
    }
  }
  ctx.strokeStyle = hinted || historySelection?.id === id ? '#678dff'
    : country?.claimed ? '#664835' : inactive ? '#546179' : '#56647b';
  ctx.lineWidth = (hinted || historySelection?.id === id ? 2.3 : .7) / scale;
  if (country?.claimed) ctx.setLineDash([3 / scale, 2 / scale]);
  ctx.lineJoin = 'round';
  ctx.stroke(shape);
  if (country?.claimed) ctx.setLineDash([]);
}

function draw(time) {
  frame = null;
  if (!width || !height) return;
  if (flight) {
    const t = Math.min(1, (time - flight.start) / 420);
    const ease = 1 - Math.pow(1 - Math.max(t, 0), 3);
    spin = flight.spin.map((value, i) => value + (flight.end[i] - value) * ease);
    zoom = flight.zoom + (flight.endZoom - flight.zoom) * ease;
    if (t === 1) flight = null;
  }
  const lift = pulseStart && view === 'globe'
    ? reducedMotion.matches ? 0 : 9 * Math.min(1, Math.max(0, (time - pulseStart) / 220))
    : 0;
  if (flight || (pulseStart && view === 'globe' && !reducedMotion.matches && time - pulseStart < 220)) requestDraw();
  const { projection, territories, labels, boundary, detail, grid } = getProjectedAtlas();
  const camera = cameraTransform(detail);
  const { x: tx, y: ty, scale } = camera;
  const globe = view === 'globe';
  const [cx, cy] = projection.translate();
  const radius = projection.scale();
  ctx.clearRect(0, 0, width, height);
  hitCamera = camera;
  hitShapes = [];
  hitDots = [];
  let lifted;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.scale(scale, scale);
  if (boundary) {
    if (globe) {
      const shadowY = cy + 9 / scale;
      const shadowRadius = radius + 24 / scale;
      const shadow = ctx.createRadialGradient(cx, shadowY, Math.max(0, radius - 8 / scale), cx, shadowY, shadowRadius);
      shadow.addColorStop(0, '#080f2396');
      shadow.addColorStop(1, '#080f2300');
      ctx.fillStyle = shadow;
      ctx.fillRect(cx - shadowRadius, shadowY - shadowRadius, shadowRadius * 2, shadowRadius * 2);
    }
    ctx.fillStyle = globe ? '#657185' : '#455570';
    ctx.fill(boundary);
  }
  ctx.strokeStyle = '#d6e3fa25';
  ctx.lineWidth = .7 / scale;
  ctx.stroke(grid);
  const left = (-12 - tx) / scale;
  const right = (width + 12 - tx) / scale;
  const top = (-12 - ty) / scale;
  const bottom = (height + 12 - ty) / scale;
  for (const territory of territories.values()) {
    if (territory.right < left || territory.left > right || territory.bottom < top || territory.top > bottom) continue;
    if (territory.feature.id === target?.id && lift > 0) {
      lifted = territory;
    } else {
      drawCountry(territory, scale, false);
    }
    hitShapes.push(territory);
  }
  if (globe) {
    const light = ctx.createRadialGradient(cx - radius * .36, cy - radius * .44, radius * .12, cx, cy, radius * 1.05);
    light.addColorStop(0, '#ffffff24');
    light.addColorStop(.59, '#0d1a3100');
    light.addColorStop(1, '#0a142260');
    ctx.fillStyle = light;
    ctx.fill(boundary);
    ctx.strokeStyle = '#bccce680';
    ctx.lineWidth = 1.15 / scale;
    ctx.stroke(boundary);
  }
  ctx.restore();
  for (const label of labels) {
    const { country, area } = label;
    if (area * scale * scale >= 26 && !(reveal && country.id === target?.id)) continue;
    const x = label.x * scale + tx;
    const y = label.y * scale + ty;
    if (x < 0 || y < 0 || x > width || y > height) continue;
    const marked = country.id === target?.id && (reveal || pulseStart !== null);
    const dotRadius = marked ? 5.2 : hoverId === country.id ? 3.8 : 2.6;
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = marked ? '#83a5ff' : wrongId === country.id ? '#ea8193' : painted(country) ? '#98cc8f' : '#e0e5ed';
    ctx.fill();
    ctx.strokeStyle = '#34425c';
    ctx.lineWidth = 1;
    ctx.stroke();
    hitDots.push([country.id, x, y, marked ? 8 : 5]);
  }
  if (lifted) {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);
    for (let depth = 0; depth < lift; depth += 2) {
      ctx.translate(0, -2 / scale);
      ctx.fillStyle = '#334fac';
      ctx.fill(lifted.shape);
    }
    drawCountry(lifted, scale, true);
    ctx.restore();
  }
}

function at(x, y) {
  if (!hitCamera) return;
  let nearest;
  let minDistance = Infinity;
  for (const [id, px, py, r] of hitDots) {
    const distance = Math.hypot(x - px, y - py);
    if (distance <= r && distance < minDistance) {
      minDistance = distance;
      nearest = id;
    }
  }
  if (nearest) return nearest;
  x = (x - hitCamera.x) / hitCamera.scale;
  y = (y - hitCamera.y) / hitCamera.scale;
  for (let i = hitShapes.length - 1; i >= 0; i--) {
    const { feature, shape, left, top, right, bottom } = hitShapes[i];
    if (x >= left && x <= right && y >= top && y <= bottom && hitContext.isPointInPath(shape, x, y)) return feature.id;
  }
}

function resize() {
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  pixelRatio = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  requestDraw();
}

function moveBy(dx, dy) {
  flight = null;
  if (view === 'globe') {
    const speed = 130 / (Math.min(width, height) * .49 * zoom);
    spin = [spin[0] + dx * speed, Math.max(-82, Math.min(82, spin[1] - dy * speed))];
  } else {
    offset = [
      Math.max(-width * zoom, Math.min(width * zoom, offset[0] + dx)),
      Math.max(-height * zoom, Math.min(height * zoom, offset[1] + dy))
    ];
  }
  requestDraw();
}

function changeZoom(factor) {
  flight = null;
  const next = Math.max(.72, Math.min(9, zoom * factor));
  if (next === zoom) return;
  zoom = next;
  requestDraw();
}

const pointers = new Map();
const separation = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || pointers.size >= 2) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, distance: 0, suppressClick: false });
  if (pointers.size === 2) {
    for (const point of pointers.values()) point.suppressClick = true;
  }
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  const point = pointers.get(event.pointerId);
  if (point) {
    const next = { x: event.clientX, y: event.clientY };
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    if (pointers.size === 2) {
      const other = [...pointers.values()].find(candidate => candidate !== point);
      const before = separation(point, other);
      if (before > 8) changeZoom(separation(next, other) / before);
    } else {
      point.distance += Math.hypot(dx, dy);
    }
    if (pointers.size === 1 && point.distance > 4) {
      canvas.classList.add('dragging');
      moveBy(dx, dy);
    }
    point.x = next.x;
    point.y = next.y;
  } else if (event.pointerType === 'mouse' && (isMapQuestion() || isHistory())) {
    const next = at(event.offsetX, event.offsetY);
    if (next !== hoverId) {
      hoverId = next;
      canvas.style.cursor = hoverId ? 'pointer' : '';
      requestDraw();
    }
  }
});
function endDrag(event) {
  const point = pointers.get(event.pointerId);
  if (!point) return;
  if (event.type === 'pointerup' && point.distance <= 4 && !point.suppressClick) {
    const bounds = canvas.getBoundingClientRect();
    const id = at(event.clientX - bounds.left, event.clientY - bounds.top);
    if (id) chooseCountry(id);
  }
  pointers.delete(event.pointerId);
  if (!pointers.size) canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
canvas.addEventListener('pointerleave', () => {
  hoverId = null;
  canvas.style.cursor = '';
  requestDraw();
});
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const pixels = event.deltaY * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? height : 1);
  changeZoom(Math.exp(-Math.max(-200, Math.min(200, pixels)) * .0015));
}, {passive: false});
canvas.addEventListener('keydown', event => {
  const keys = { ArrowLeft: [-25, 0], ArrowRight: [25, 0], ArrowUp: [0, -25], ArrowDown: [0, 25] };
  if (keys[event.key]) moveBy(...keys[event.key]);
  else if (['+', '=', '-'].includes(event.key)) changeZoom(event.key === '-' ? 1 / 1.2 : 1.2);
  else return;
  event.preventDefault();
});

$('zoom-in').addEventListener('click', () => changeZoom(1.28));
$('zoom-out').addEventListener('click', () => changeZoom(1 / 1.28));
$('reset').addEventListener('click', resetCamera);
$('hint').addEventListener('click', showHint);
$('skip').addEventListener('click', () => {
  if (!target || difficulty === 'hardcore' || !['find','reverse','capital','flag','arms'].includes(stage)) return;
  const skipped = target.name;
  round = round.filter(country => country.id !== target.id);
  nextQuestion();
  say(skipped + ' · пропуск за 0 очков.');
});
$('country-list').addEventListener('click', () => openCountryList());
$('country-search').addEventListener('input', countryPicker);
$('progress-button').addEventListener('click', progressDialog);
$('region').addEventListener('change', event => {
  region = event.target.value;
  $('atlas-region').textContent = regions[region].name;
  resetCamera();
  startRound();
});
$('colors').addEventListener('change', event => {
  colorMode = event.target.value;
  requestDraw();
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (view === button.dataset.view) return;
  setView(button.dataset.view);
}));
 
$('quiz-mode').addEventListener('change', event => {
  mode = countryMode = event.target.value;
  startRound(target?.id);
});
$('difficulty').addEventListener('change', event => {
  difficulty = event.target.value;
  $('difficulty-note').textContent = LEVELS[difficulty].note;
  startRound(target?.id);
});
$('atlas-set').addEventListener('change', event => useAtlas(event.target.value));
$('history-year').addEventListener('change', event => {
  historyYear = event.target.value;
  useAtlas('history', false);
});
window.addEventListener('storage', event => {
  if (cloudGame || event.key !== PROGRESS_KEY) return;
  const previousScore = progress.hardcore.score;
  progress = readProgress(browserStorage);
  if (!isHistory() && difficulty === 'hardcore' && previousScore > progress.hardcore.score) {
    showLostAttempt();
  } else {
    updateProgress();
    requestDraw();
  }
});

const historicalOptions = Object.entries(ATLAS_DATA.history);
$('history-year').replaceChildren(...historicalOptions.map(([year, map]) => element('option', map.title, { value: year })));
historyYear = historicalOptions[Math.floor(historicalOptions.length / 2)][0];
$('history-year').value = historyYear;
difficulty = $('difficulty').value;
countryMode = $('quiz-mode').value;
colorMode = $('colors').value;
$('difficulty-note').textContent = LEVELS[difficulty].note;
useAtlas($('atlas-set').value);
new ResizeObserver(resize).observe(canvas);





