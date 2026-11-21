'use strict';

let cloudAccount;
let cloudBase;
let cloudQueue = [];
let cloudStoreKey;
let sendingCloud = false;
let parkedCloud = false;

function readCloudQueue() {
  try {
    const pending = JSON.parse(browserStorage?.getItem(cloudStoreKey));
    return Array.isArray(pending) ? pending : [];
  } catch {
    return [];
  }
}

function saveCloudQueue() {
  try { browserStorage?.setItem(cloudStoreKey, JSON.stringify(cloudQueue)); } catch {}
}

function cloudPreview() {
  const state = { progress: cloudBase ? JSON.parse(JSON.stringify(cloudBase.progress)) : { regular: emptyLedger(), hardcore: emptyLedger() }, epoch: cloudBase?.epoch || 0 };
  for (const event of cloudQueue) {
    if (event.type === 'import') {
      if (!cloudBase) state.progress = JSON.parse(JSON.stringify(event.progress));
      continue;
    }
    if (event.type === 'reset' && event.epoch === state.epoch) {
      state.epoch++;
      state.progress.hardcore = emptyLedger();
    }
    if (event.type === 'solve') {
      const [level, set] = event.key.split(':');
      if (level === 'hardcore' && event.epoch !== state.epoch) continue;
      recordSolved(state.progress[level === 'hardcore' ? 'hardcore' : 'regular'], event.key, set, event.id, event.points);
    }
  }
  return state;
}

function accountStatus(message = '') {
  $('account-status').textContent = cloudAccount
    ? (cloudAccount.name || 'Аккаунт подключён') + ' · ' + message
    : message;
}

async function sendCloudProgress() {
  if (!cloudAccount || sendingCloud || parkedCloud || !cloudQueue.length) return;
  sendingCloud = true;
  try {
    while (cloudQueue.length) {
      const batch = cloudQueue.slice(0, 50);
      accountStatus('сохраняем прогресс…');
      const reply = await fetch('/api/progress', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: cloudAccount.id, changes: batch })
      });
      if (!reply.ok) {
        if ([401, 409].includes(reply.status)) parkedCloud = true;
        if (reply.status === 507) throw new Error('storage-full');
        throw new Error('Sync failed');
      }
      const expected = cloudPreview().epoch;
      cloudBase = await reply.json();
      cloudQueue.splice(0, batch.length);
      saveCloudQueue();
      const updated = cloudPreview();
      progress = updated.progress;
      if (difficulty === 'hardcore' && updated.epoch > expected && !isHistory()) showLostAttempt();
      else {
        updateProgress();
        requestDraw();
      }
    }
    accountStatus('прогресс сохранён в аккаунте');
  } catch (error) {
    if (error.message === 'storage-full') accountStatus('хранилище заполнено. Результат сохранён на этом устройстве.');
    else accountStatus(parkedCloud ? 'сеанс изменился. Обнови страницу, чтобы продолжить синхронизацию.' : 'сохранено на устройстве, ожидает синхронизации');
  } finally {
    sendingCloud = false;
  }
}

async function initAccount() {
  let result;
  try {
    const reply = await fetch('/api/account', { cache: 'no-store', credentials: 'same-origin' });
    if (!reply.ok || !reply.headers.get('Content-Type')?.includes('application/json')) return;
    result = await reply.json();
  } catch {
    return;
  }
  if (!result.providers?.length) return;
  $('account-button').hidden = false;
  $('account-button').addEventListener('click', () => $('account-dialog').showModal());
  const accountAction = $('account-action');
  if (!result.account?.id) {
    const providers = result.providers.map(name => name === 'apple' ? 'Apple' : 'Google');
    accountAction.textContent = 'Войти через ' + providers.join(' или ');
    accountStatus('Сохраняй прогресс в аккаунте, чтобы продолжить на другом устройстве.');
    return;
  }
  cloudAccount = result.account;
  cloudBase = result.data;
  cloudStoreKey = 'terra-outbox-' + cloudAccount.id;
  cloudQueue = readCloudQueue();
  if (!cloudBase && !cloudQueue.some(change => change.type === 'import')) {
    cloudQueue.unshift({ type: 'import', progress });
    saveCloudQueue();
  }
  progress = cloudPreview().progress;
  cloudGame = true;
  if (!isHistory()) startRound(target?.id);
  accountAction.href = '/auth/signout';
  accountAction.textContent = 'Выйти';
  accountStatus('прогресс привязан к аккаунту');

  window.addEventListener('terra:progress', ({ detail }) => {
    cloudQueue.push({ ...detail, epoch: cloudPreview().epoch });
    saveCloudQueue();
    sendCloudProgress();
  });
  window.addEventListener('online', sendCloudProgress);
  window.addEventListener('focus', sendCloudProgress);
  sendCloudProgress();
}

if (!globalThis.TERRA_OFFLINE && /^(http|https):$/.test(location.protocol)) initAccount();
